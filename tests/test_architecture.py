import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.inspection import inspect as inspect_mapper
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.ai_settings import AIModel, AIProvider
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.repositories.meme_embedding_repository import MemeEmbeddingRepository
from app.services.derived_data_invalidation import invalidate_meme_semantic_data
from app.services.embedding_job_manager import EmbeddingJobManager
from app.services.embedding_vectors import serialize_vector
from app.services.meme_embedding_service import MemeEmbeddingAttempt, MemeEmbeddingService
from app.services.semantic_index import SemanticIndex
from app.services.semantic_search_service import SemanticSearchService
from app.storage.image_storage import ImageStorage


ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_IMPORTS = ("numpy", "app.services.semantic_index", "app.ai.embedding_client")


def run_python(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", source],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def assert_light_import(module: str, symbol: str) -> None:
    forbidden = repr(FORBIDDEN_IMPORTS)
    result = run_python(
        f"import sys; from {module} import {symbol}; "
        f"bad=[name for name in {forbidden} if name in sys.modules]; print(bad)"
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[]"


def test_import_meme_service_without_semantic_index() -> None:
    assert_light_import("app.services.meme_service", "MemeService")


def test_import_tag_service_without_semantic_index() -> None:
    assert_light_import("app.services.tag_service", "TagService")


def test_import_template_service_without_semantic_index() -> None:
    assert_light_import("app.services.template_service", "TemplateService")


def test_tag_maintenance_does_not_import_semantic_index() -> None:
    result = run_python(
        "import sys; from scripts.tag_maintenance.importer import import_candidates; "
        "bad=[name for name in "
        "('numpy', 'app.services.semantic_index', 'app.ai.embedding_client', "
        "'app.services.meme_service') if name in sys.modules]; print(bad)"
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[]"


def test_all_models_configure_mappers() -> None:
    result = run_python(
        "import app.models; from sqlalchemy.orm import configure_mappers; "
        "configure_mappers(); print('ORM OK')"
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ORM OK"


def test_model_import_order_independent() -> None:
    for imports in (
        "import app.models.meme_embedding; import app.models.ai_settings",
        "import app.models.ai_settings; import app.models.meme_embedding",
    ):
        result = run_python(
            f"{imports}; from sqlalchemy.orm import configure_mappers; "
            "configure_mappers(); print('ORM OK')"
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "ORM OK"


def test_meme_embedding_has_no_unused_ai_model_relationship() -> None:
    assert "model_record" not in inspect_mapper(MemeEmbedding).relationships
    assert "embedding" not in inspect_mapper(Meme).relationships


def test_basic_services_do_not_import_numpy() -> None:
    result = run_python(
        "import sys; from app.services.meme_service import MemeService; "
        "from app.services.tag_service import TagService; "
        "from app.services.template_service import TemplateService; "
        "print('numpy' in sys.modules)"
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "False"


def test_single_and_batch_rebuild_share_core_service(tmp_path: Path, monkeypatch) -> None:
    calls: list[str] = []
    model = SimpleNamespace(id=7, model_id="qwen3-vl-embedding")
    search = SemanticSearchService(
        SimpleNamespace(rollback=lambda: None),
        ImageStorage(tmp_path / "images", tmp_path / "thumbs"),
        tmp_path / "key",
        SimpleNamespace(),
        SimpleNamespace(),
        client=SimpleNamespace(),
    )
    search.active_model = lambda: model

    def fake_rebuild(_self, _session, _client, **_kwargs):
        calls.append("single")
        return SimpleNamespace()

    monkeypatch.setattr(MemeEmbeddingService, "rebuild_one", fake_rebuild)
    search.rebuild_meme(1)

    class SessionContext:
        def __enter__(self):
            return SimpleNamespace()

        def __exit__(self, *_args):
            return False

    def fake_generate(_self, _session, _client, **kwargs):
        calls.append("batch")
        return MemeEmbeddingAttempt(kwargs["meme_id"], skipped=True)

    monkeypatch.setattr(MemeEmbeddingService, "generate", fake_generate)
    manager = EmbeddingJobManager(
        SessionContext,
        tmp_path / "images",
        tmp_path / "thumbs",
        tmp_path / "key",
    )
    try:
        manager._work(3, 1, "a" * 64, 7, model.model_id, SimpleNamespace())
    finally:
        manager.shutdown()
    assert calls == ["single", "batch"]


def semantic_database(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'architecture.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        provider = AIProvider(
            name="provider", protocol="dashscope_multimodal_embedding",
            base_url="https://example.test", enabled=True,
        )
        model = AIModel(
            provider=provider, model_id="qwen3-vl-embedding", display_name="Qwen",
            supports_vision=False, supports_image_embedding=True, enabled=True,
            is_embedding_active=True,
        )
        meme = Meme(
            title="meme", description=None, original_filename="meme.png",
            stored_filename="meme.png", file_path="meme.png", thumbnail_path=None,
            mime_type="image/png", file_size=1, width=1, height=1,
            file_hash="f" * 64, source=None,
        )
        session.add_all([provider, model, meme])
        session.flush()
        session.add(MemeEmbedding(
            meme_id=meme.id, model_record_id=model.id,
            model_id_snapshot=model.model_id, embedding_kind="meme_fused_v1",
            dimension=1024,
            vector_blob=serialize_vector([1.0] + [0.0] * 1023, dimension=1024),
            source_hash="s" * 64, status="ready",
            indexed_image_count=1, total_image_count=1,
        ))
        session.commit()
        return engine, factory, meme.id, model.id


def test_semantic_invalidation_updates_database_state(tmp_path: Path) -> None:
    engine, factory, meme_id, _ = semantic_database(tmp_path)
    with factory() as session:
        assert invalidate_meme_semantic_data(session, [meme_id]) == 1
        session.commit()
        repository = MemeEmbeddingRepository(session)
        assert repository.get_for_meme(meme_id).status == "stale"
        assert repository.generation() == 1
    engine.dispose()


def test_semantic_index_detects_stale_generation(tmp_path: Path) -> None:
    engine, factory, meme_id, model_record_id = semantic_database(tmp_path)
    index = SemanticIndex(factory)
    vector = [1.0] + [0.0] * 1023
    assert [hit.meme_id for hit in index.search(
        vector,
        model_record_id=model_record_id,
        model_id="qwen3-vl-embedding",
        dimension=1024,
    )] == [meme_id]
    with factory() as session:
        invalidate_meme_semantic_data(session, [meme_id])
        session.commit()
    assert index.search(
        vector,
        model_record_id=model_record_id,
        model_id="qwen3-vl-embedding",
        dimension=1024,
    ) == []
    engine.dispose()


def test_tagging_workflow_smoke() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "scripts.tag_maintenance", "--help"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "Offline Meme Vault tag maintenance" in result.stdout
