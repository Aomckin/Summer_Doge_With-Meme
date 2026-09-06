from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import time

import pytest
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.enrichment import EnrichmentAudit, EnrichmentJobItem, MemeEnrichmentSuggestion
from app.ai.client import AIInvalidResponseError
from app.models.ai_settings import AIModel, AIProvider
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.models.meme_image import MemeImage
from app.models.tag import MemeTag, Tag
from app.models.template import Template
from app.schemas.enrichment import EnrichmentCandidate, EnrichmentJobCreate
from app.services.meme_enrichment_service import EnrichmentConflictError, MemeEnrichmentService
from app.services.ai_settings_service import AISettingsService
from app.services.enrichment_job_manager import EnrichmentJobManager, EnrichmentJobService
from app.storage.image_storage import ImageStorage
from tests.vault_helpers import ensure_default_vault


def png(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), color).save(output, format="PNG")
    return output.getvalue()


def context(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'enrichment.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbs")
    with factory() as session:
        vault = ensure_default_vault(session)
        provider = AIProvider(name="Test", protocol="openai_responses", base_url="https://example.test", enabled=True)
        model = AIModel(provider=provider, model_id="vision", display_name="Vision", supports_vision=True, enabled=True, is_active=True)
        session.add_all([provider, model])
        template = Template(name="震惊猫")
        session.add(template)
        meme = Meme(
            vault_id=vault.id,
            title="IMG_123", description=None, original_filename="IMG_123.png",
            stored_filename="cover.png", file_path="cover.png", thumbnail_path="cover.png",
            mime_type="image/png", file_size=10, width=8, height=8, file_hash="0" * 64,
        )
        for position, color in enumerate(("red", "blue")):
            stored = storage.save(f"{position}.png", png(color))
            meme.images.append(MemeImage(
                vault_id=vault.id,
                original_filename=stored.original_filename, stored_filename=stored.stored_filename,
                file_path=stored.file_path.name, thumbnail_path=stored.thumbnail_path.name,
                mime_type=stored.mime_type, file_size=stored.file_size, width=stored.width,
                height=stored.height, file_hash=stored.file_hash, position=position,
            ))
        manual = Tag(name="人工标签")
        meme.tag_links.append(MemeTag(tag=manual, source="manual"))
        session.add(meme)
        session.commit()
        meme_id, template_id, model_id = meme.id, template.id, model.id
    return factory, storage, meme_id, template_id, model_id, vault


class FakeEnrichmentClient:
    def __init__(self) -> None:
        self.positions: list[int] = []

    def analyze_enrichment(self, **kwargs):
        self.positions = [image.position for image in kwargs["images"]]
        assert kwargs["title"] == "IMG_123"
        assert "人工标签" in kwargs["tags"]
        return SimpleNamespace(
            model_name="vision-test", suggested_title="我已经停止思考",
            suggested_description="角色陷入明显的茫然状态。", add_tags=("无语", "无语"),
            remove_tags=(), suggested_template_name="震惊猫", confidence=None,
            reason="画面表现出茫然。", input_tokens=11, output_tokens=7, total_tokens=18,
        )


def test_provider_analysis_creates_one_suggestion_without_modifying_meme(tmp_path: Path) -> None:
    factory, storage, meme_id, template_id, _, vault = context(tmp_path)
    client = FakeEnrichmentClient()
    with factory() as session:
        service = MemeEnrichmentService(session, storage)
        attempt = service.analyze(meme_id, client)
        assert attempt.error is None
        assert client.positions == [0, 1]
        meme = service.get_meme(meme_id)
        assert meme.title == "IMG_123"
        assert meme.description is None
        suggestion = session.scalar(select(MemeEnrichmentSuggestion))
        assert suggestion is not None
        assert suggestion.suggested_title == "我已经停止思考"
        assert suggestion.suggested_template_id == template_id
        assert service.add_tags(suggestion) == ["无语"]


def test_source_hash_is_stable_and_apply_is_transactional(tmp_path: Path) -> None:
    factory, storage, meme_id, template_id, model_id, vault = context(tmp_path)
    with factory() as session:
        service = MemeEnrichmentService(session, storage)
        meme = service.get_meme(meme_id)
        first = service.source_hash(meme)
        assert service.source_hash(meme) == first
        suggestion = service.create_suggestion(EnrichmentCandidate(
            meme_id=meme_id, suggested_title="新标题", suggested_description="新描述",
            add_tags=["无语"], remove_tags=[], suggested_template_id=template_id,
            reason="test",
        ), source="luna")
        session.add(MemeEmbedding(
            meme_id=meme_id, model_record_id=model_id, model_id_snapshot="test",
            embedding_kind="meme_fused_v1", dimension=1024, vector_blob=b"0" * 4096,
            source_hash="x" * 64, status="ready", indexed_image_count=2, total_image_count=2,
        ))
        session.commit()
        updated, meme = service.apply(suggestion.id, ["title", "add_tags"])
        assert updated.status == "partially_accepted"
        assert meme.title == "新标题"
        assert meme.description is None
        assert {link.tag.name for link in meme.tag_links} == {"人工标签", "无语"}
        assert session.scalar(select(MemeEmbedding).where(MemeEmbedding.meme_id == meme_id)).status == "stale"
        assert session.scalar(select(EnrichmentAudit).where(EnrichmentAudit.action == "applied")) is not None
        completed, meme = service.apply(suggestion.id, ["description", "template"])
        assert completed.status == "applied"
        assert meme.description == "新描述"


def test_changed_meme_marks_suggestion_stale_and_protects_manual_removal(tmp_path: Path) -> None:
    factory, storage, meme_id, _, _, vault = context(tmp_path)
    with factory() as session:
        service = MemeEnrichmentService(session, storage)
        suggestion = service.create_suggestion(EnrichmentCandidate(
            meme_id=meme_id, remove_tags=["人工标签"], reason="wrong",
        ), source="provider")
        meme = service.get_meme(meme_id)
        meme.description = "人工刚修改"
        session.commit()
        with pytest.raises(EnrichmentConflictError, match="stale"):
            service.apply(suggestion.id, ["remove_tags"])
        assert service.get_suggestion(suggestion.id).status == "stale"
        with pytest.raises(EnrichmentConflictError, match="user/manual"):
            service.apply(suggestion.id, ["remove_tags"], allow_stale=True)


def test_background_job_uses_shared_service_and_accumulates_tokens(tmp_path: Path, monkeypatch) -> None:
    factory, storage, meme_id, _, _, vault = context(tmp_path)
    client = FakeEnrichmentClient()
    monkeypatch.setattr(AISettingsService, "build_active_client", lambda self: client)
    key_file = tmp_path / "key"
    with factory() as session:
        job = EnrichmentJobService(session, storage, key_file).create_job(
            vault_id=vault.id, scope="filename_title", query=None, tags=[], analyze_title=True,
            analyze_description=True, analyze_tags=True, analyze_template=True,
            max_workers=2,
        )
        assert job.total_count == 1
        job_id = job.id
    manager = EnrichmentJobManager(factory, storage.images_dir, storage.thumbnails_dir, key_file)
    manager.startup()
    manager.submit(job_id)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with factory() as session:
            job = EnrichmentJobService(session, storage, key_file).get_job(job_id)
            if job.status in {"completed", "completed_with_errors", "failed"}:
                break
        time.sleep(0.02)
    manager.shutdown()
    with factory() as session:
        job = EnrichmentJobService(session, storage, key_file).get_job(job_id)
        assert job.status == "completed"
        assert (job.success_count, job.failed_count, job.total_tokens) == (1, 0, 18)
        suggestion = session.scalar(select(MemeEnrichmentSuggestion).where(MemeEnrichmentSuggestion.job_id == job_id))
        assert suggestion is not None and suggestion.meme_id == meme_id


def test_failed_background_job_persists_usage_and_response_summary(tmp_path: Path, monkeypatch) -> None:
    factory, storage, _, _, _, vault = context(tmp_path)

    class InvalidClient:
        def analyze_enrichment(self, **kwargs):
            raise AIInvalidResponseError(
                "AI service returned an invalid enrichment response",
                model_name="vision-test", input_tokens=13, output_tokens=5,
                total_tokens=18, response_summary='{"unexpected": true}',
            )

    monkeypatch.setattr(AISettingsService, "build_active_client", lambda self: InvalidClient())
    key_file = tmp_path / "key"
    with factory() as session:
        job = EnrichmentJobService(session, storage, key_file).create_job(
            vault_id=vault.id, scope="filename_title", query=None, tags=[], analyze_title=True,
            analyze_description=True, analyze_tags=True, analyze_template=True,
            max_workers=1,
        )
        job_id = job.id
    manager = EnrichmentJobManager(factory, storage.images_dir, storage.thumbnails_dir, key_file)
    manager.startup()
    manager.submit(job_id)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with factory() as session:
            job = EnrichmentJobService(session, storage, key_file).get_job(job_id)
            if job.status in {"completed", "completed_with_errors", "failed"}:
                break
        time.sleep(0.02)
    manager.shutdown()
    with factory() as session:
        job = EnrichmentJobService(session, storage, key_file).get_job(job_id)
        item = session.scalar(select(EnrichmentJobItem).where(EnrichmentJobItem.job_id == job_id))
        assert job.status == "completed_with_errors"
        assert (job.failed_count, job.total_tokens) == (1, 18)
        assert item is not None
        assert item.total_tokens == 18
        assert item.response_summary == '{"unexpected": true}'


def test_id_range_scope_is_inclusive_and_validated(tmp_path: Path) -> None:
    factory, storage, meme_id, _, _, vault = context(tmp_path)
    with factory() as session:
        first = session.get(Meme, meme_id)
        assert first is not None
        for index in range(2):
            session.add(Meme(
                vault_id=vault.id,
                title=f"range-{index}", original_filename=f"range-{index}.png",
                stored_filename=f"range-{index}.png", file_path=f"range-{index}.png",
                thumbnail_path=f"range-{index}.png", mime_type="image/png",
                file_size=10, width=8, height=8, file_hash=str(index + 1) * 64,
            ))
        session.commit()
        ids = [item.id for item in session.scalars(select(Meme).order_by(Meme.id)).all()]
        service = EnrichmentJobService(session, storage, tmp_path / "key")
        selected = service.select_memes(
            vault_id=vault.id, scope="id_range", query=None, tags=[],
            start_meme_id=ids[1], end_meme_id=ids[2],
        )
        assert [item.id for item in selected] == ids[1:3]

    valid = EnrichmentJobCreate(vault_id=1, scope="id_range", start_meme_id=10, end_meme_id=20)
    assert (valid.start_meme_id, valid.end_meme_id) == (10, 20)
    with pytest.raises(ValueError, match="less than or equal"):
        EnrichmentJobCreate(vault_id=1, scope="id_range", start_meme_id=20, end_meme_id=10)
