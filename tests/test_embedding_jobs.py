from io import BytesIO
from pathlib import Path
from threading import Event, Lock, get_ident

from PIL import Image
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from app.ai.embedding_client import FusedEmbeddingResult
from app.database import Base
from app.models.ai_settings import AIModel, AIProvider
from app.models.embedding_job import EmbeddingJob, EmbeddingJobItem
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.services.ai_settings_service import AISettingsService
from app.services.embedding_job_manager import EmbeddingJobManager, EmbeddingJobService
from app.services.embedding_vectors import serialize_vector
from app.services.semantic_index import SemanticIndex
from app.storage.image_storage import ImageStorage


def image_bytes(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), color).save(output, format="PNG")
    return output.getvalue()


def context(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'jobs.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbs")
    with factory() as session:
        provider = AIProvider(
            name="Dash", protocol="dashscope_multimodal_embedding",
            base_url="https://example.test", api_key_ciphertext="cipher", enabled=True,
        )
        model = AIModel(
            provider=provider, model_id="qwen3-vl-embedding", display_name="Qwen",
            supports_image_embedding=True, enabled=True, is_embedding_active=True,
        )
        session.add_all([provider, model])
        for index, color in enumerate(("red", "green", "blue"), start=1):
            stored = storage.save(f"{index}.png", image_bytes(color))
            from app.models.meme_image import MemeImage

            meme = Meme(
                title=f"Meme {index}", description="description",
                original_filename=stored.original_filename, stored_filename=stored.stored_filename,
                file_path=stored.file_path.name, thumbnail_path=stored.thumbnail_path.name,
                mime_type=stored.mime_type, file_size=stored.file_size, width=stored.width,
                height=stored.height, file_hash=stored.file_hash, source=None,
            )
            meme.images.append(MemeImage(
                original_filename=stored.original_filename, stored_filename=stored.stored_filename,
                file_path=stored.file_path.name, thumbnail_path=stored.thumbnail_path.name,
                mime_type=stored.mime_type, file_size=stored.file_size, width=stored.width,
                height=stored.height, file_hash=stored.file_hash, position=0,
            ))
            session.add(meme)
        session.commit()
        model_id = model.id
    return engine, factory, storage, model_id


class FakeClient:
    def __init__(self, fail_title: str | None = None) -> None:
        self.fail_title = fail_title
        self.calls = 0
        self.lock = Lock()

    def embed_fused(self, contents, *, dimension=1024, instruct=None):
        text = str(contents[0].get("text", ""))
        with self.lock:
            self.calls += 1
        if self.fail_title and self.fail_title in text:
            raise RuntimeError("fake upstream failure")
        vector = [0.0] * dimension
        vector[0] = 1.0
        return FusedEmbeddingResult(
            "qwen3-vl-embedding", tuple(vector), 2, 3, 5, "fake-request"
        )


def test_job_scope_snapshots_and_failed_retry(tmp_path: Path, monkeypatch) -> None:
    engine, factory, storage, model_id = context(tmp_path)
    fake = FakeClient()
    monkeypatch.setattr(AISettingsService, "build_active_multimodal_embedding_client", lambda self: fake)
    index = SemanticIndex(factory)
    with factory() as session:
        memes = list(session.scalars(select(Meme).order_by(Meme.id)))
        session.add(MemeEmbedding(
            meme_id=memes[0].id, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding",
            embedding_kind="meme_fused_v1", dimension=1024,
            vector_blob=serialize_vector([1.0] + [0.0] * 1023), source_hash="a" * 64,
            status="stale", indexed_image_count=1, total_image_count=1,
        ))
        session.add(MemeEmbedding(
            meme_id=memes[1].id, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding",
            embedding_kind="meme_fused_v1", dimension=1024,
            vector_blob=None, source_hash="b" * 64, status="failed",
            indexed_image_count=0, total_image_count=1,
        ))
        session.commit()
        service = EmbeddingJobService(session, storage, tmp_path / "key")
        missing = service.create_job(scope="missing_or_stale", max_workers=4)
        assert {item.meme_id for item in missing.items} == {memes[0].id, memes[2].id}
        missing.status = "cancelled"
        session.commit()
        failed = service.create_job(scope="failed", max_workers=2)
        assert [item.meme_id for item in failed.items] == [memes[1].id]
        failed.status = "completed_with_errors"
        failed.items[0].status = "failed"
        failed.failed_count = failed.processed_count = 1
        session.commit()
        retried = service.retry_failed(failed.id)
        assert retried.status == "pending"
        assert retried.items[0].status == "queued"
        retried.status = "cancelled"
        session.commit()
        all_job = service.create_job(scope="all", max_workers=1)
        assert all_job.total_count == 3
    engine.dispose()


def test_manager_uses_one_database_writer_and_one_failure_does_not_stop_others(tmp_path: Path, monkeypatch) -> None:
    engine, factory, storage, _ = context(tmp_path)
    fake = FakeClient(fail_title="Meme 2")
    monkeypatch.setattr(AISettingsService, "build_active_multimodal_embedding_client", lambda self: fake)
    index = SemanticIndex(factory)
    with factory() as session:
        service = EmbeddingJobService(session, storage, tmp_path / "key")
        job = service.create_job(scope="all", max_workers=4)
        job_id = job.id
    writer_threads: set[int] = set()

    def record_writes(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            writer_threads.add(get_ident())

    event.listen(engine, "before_cursor_execute", record_writes)
    manager = EmbeddingJobManager(
        factory, storage.images_dir, storage.thumbnails_dir, tmp_path / "key"
    )
    manager._run(job_id, Event())
    manager.shutdown()
    event.remove(engine, "before_cursor_execute", record_writes)
    with factory() as session:
        finished = session.get(EmbeddingJob, job_id)
        assert finished.status == "completed_with_errors"
        assert finished.success_count == 2
        assert finished.failed_count == 1
        assert finished.processed_count == 3
        assert len(list(session.scalars(select(MemeEmbedding).where(MemeEmbedding.status == "ready")))) == 2
    assert len(writer_threads) == 1
    engine.dispose()


def test_cancel_stops_submission_and_startup_recovers_running(tmp_path: Path, monkeypatch) -> None:
    engine, factory, storage, _ = context(tmp_path)
    fake = FakeClient()
    monkeypatch.setattr(AISettingsService, "build_active_multimodal_embedding_client", lambda self: fake)
    index = SemanticIndex(factory)
    with factory() as session:
        job = EmbeddingJobService(session, storage, tmp_path / "key").create_job(
            scope="all", max_workers=4
        )
        job_id = job.id
    manager = EmbeddingJobManager(factory, storage.images_dir, storage.thumbnails_dir, tmp_path / "key")
    cancelled = Event()
    cancelled.set()
    manager._run(job_id, cancelled)
    with factory() as session:
        job = session.get(EmbeddingJob, job_id)
        assert job.status == "cancelled"
        assert job.processed_count == 0
        job.status = "running"
        job.items[0].status = "running"
        session.commit()
    manager.startup()
    with factory() as session:
        job = session.get(EmbeddingJob, job_id)
        assert job.status == "interrupted"
        assert job.items[0].status == "queued"
    manager.shutdown()
    engine.dispose()
