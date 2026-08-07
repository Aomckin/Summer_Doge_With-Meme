import asyncio
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.ai.embedding_client import FusedEmbeddingResult
from app.api.semantic import get_service as get_semantic_service, router as semantic_router
from app.database import Base
from app.models.ai_settings import AIModel, AIProvider
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.models.tag import MemeTag, Tag
from app.models.template import Template
from app.repositories.meme_embedding_repository import MemeEmbeddingRepository
from app.services.derived_data_invalidation import invalidate_meme_semantic_data
from app.services.embedding_config import EMBEDDING_KIND
from app.services.embedding_vectors import deserialize_vector, normalize_vector, serialize_vector
from app.services.meme_embedding_content import MemeEmbeddingContentBuilder
from app.services.semantic_index import SemanticIndex, SemanticSearchResultCache
from app.services.semantic_search_service import MemeEmbeddingUnavailableError, SemanticSearchService
from app.services.meme_service import MemeService
from app.services.tag_service import TagService
from app.services.template_service import TemplateService
from app.storage.image_storage import ImageStorage
from app.storage.template_image_storage import TemplateImageStorage


def png(color=(20, 40, 60, 255), *, size=(12, 8), mode="RGBA") -> bytes:
    output = BytesIO()
    Image.new(mode, size, color).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def semantic_context(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'semantic.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbs")
    with factory() as session:
        provider = AIProvider(
            name="DashScope", protocol="dashscope_multimodal_embedding",
            base_url="https://example.test", api_key_ciphertext="unused", enabled=True,
        )
        model = AIModel(
            provider=provider, model_id="qwen3-vl-embedding", display_name="Qwen",
            supports_vision=False, supports_image_embedding=True, enabled=True,
            is_embedding_active=True,
        )
        template = Template(name="未归类")
        session.add_all([provider, model, template])
        session.commit()
        model_id = model.id
    yield factory, storage, model_id, tmp_path
    engine.dispose()


def add_meme(session: Session, storage: ImageStorage, title: str, *, tags=(), image_count=1) -> Meme:
    color_seed = sum(title.encode("utf-8")) % 200
    first = storage.save(f"{title}-0.png", png((color_seed, 40, 60, 255)))
    meme = Meme(
        title=title, description="蓝色舞台中人物被强光照亮",
        original_filename=first.original_filename, stored_filename=first.stored_filename,
        file_path=first.file_path.name, thumbnail_path=first.thumbnail_path.name,
        mime_type=first.mime_type, file_size=first.file_size, width=first.width,
        height=first.height, file_hash=first.file_hash, source=None,
    )
    from app.models.meme_image import MemeImage

    for position in range(image_count):
        stored = first if position == 0 else storage.save(f"{title}-{position}.png", png((20 + position, 40, 60, 255)))
        meme.images.append(MemeImage(
            original_filename=stored.original_filename, stored_filename=stored.stored_filename,
            file_path=stored.file_path.name, thumbnail_path=stored.thumbnail_path.name,
            mime_type=stored.mime_type, file_size=stored.file_size, width=stored.width,
            height=stored.height, file_hash=stored.file_hash, position=position,
        ))
    session.add(meme)
    for name in tags:
        with session.no_autoflush:
            tag = session.scalar(select(Tag).where(Tag.name == name))
        if tag is None:
            tag = Tag(name=name)
            session.add(tag)
            session.flush()
        meme.tag_links.append(MemeTag(tag=tag, source="user"))
    session.commit()
    return meme


def test_float32_vector_round_trip_normalizes_and_rejects_invalid_values() -> None:
    blob = serialize_vector([3.0, 4.0], dimension=2)
    assert len(blob) == 8
    restored = deserialize_vector(blob, dimension=2)
    assert restored.dtype == np.dtype("<f4")
    assert restored.tolist() == pytest.approx([0.6, 0.8])
    with pytest.raises(ValueError, match="dimension"):
        serialize_vector([1], dimension=2)
    with pytest.raises(ValueError, match="NaN"):
        normalize_vector([float("nan"), 1], dimension=2)
    with pytest.raises(ValueError, match="non-zero"):
        normalize_vector([0, 0], dimension=2)
    with pytest.raises(ValueError, match="exactly"):
        deserialize_vector(blob[:-1], dimension=2)


def test_rebuild_api_maps_model_snapshot_to_public_model_id() -> None:
    record = SimpleNamespace(
        meme_id=27,
        status="ready",
        model_id_snapshot="qwen3-vl-embedding",
        dimension=1024,
        embedding_kind="meme_fused_v1",
        indexed_image_count=1,
        total_image_count=1,
        text_tokens=12,
        image_tokens=34,
        total_tokens=46,
        last_error=None,
        indexed_at=None,
    )
    service = SimpleNamespace(rebuild_meme=lambda meme_id: record)
    app = FastAPI()
    app.include_router(semantic_router)
    app.dependency_overrides[get_semantic_service] = lambda: service

    async def send_request():
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.post("/api/memes/27/embedding/rebuild")

    response = asyncio.run(send_request())

    assert response.status_code == 200
    assert response.json()["model_id"] == "qwen3-vl-embedding"


def test_content_hash_is_stable_and_tracks_title_tags_and_image_order(semantic_context) -> None:
    factory, storage, model_id, _ = semantic_context
    with factory() as session:
        meme = add_meme(session, storage, "闪光弹", tags=("舞台", "蓝色调"), image_count=6)
        builder = MemeEmbeddingContentBuilder(storage)
        first = builder.build(meme, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding")
        repeated = builder.build(meme, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding")
        assert first.source_hash == repeated.source_hash
        assert first.indexed_image_count == 5
        assert first.total_image_count == 6
        assert len(first.contents) == 6
        meme.title = "闪光弹 2"
        assert builder.build(meme, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding").source_hash != first.source_hash
        meme.title = "闪光弹"
        meme.tag_links.pop()
        tag_hash = builder.build(meme, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding").source_hash
        assert tag_hash != first.source_hash
        images = sorted(meme.images, key=lambda item: item.position)
        images[0].position, images[1].position = images[1].position, images[0].position
        assert builder.build(meme, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding").source_hash != tag_hash


def test_gif_fallback_reads_first_frame_and_outputs_data_uri(semantic_context) -> None:
    factory, storage, model_id, _ = semantic_context
    frames = [Image.new("RGB", (20, 10), color) for color in ("red", "blue")]
    output = BytesIO()
    frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:], loop=0)
    with factory() as session:
        meme = add_meme(session, storage, "gif")
        image = meme.images[0]
        original = storage.original_path(image.file_path)
        original.write_bytes(output.getvalue())
        image.thumbnail_path = None
        content = MemeEmbeddingContentBuilder(storage).build(
            meme, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding"
        )
        assert str(content.contents[1]["image"]).startswith("data:image/jpeg;base64,")


def ready_embedding(session: Session, meme: Meme, model_id: int, vector: list[float]) -> None:
    session.add(MemeEmbedding(
        meme_id=meme.id, model_record_id=model_id, model_id_snapshot="qwen3-vl-embedding",
        embedding_kind="meme_fused_v1", dimension=1024,
        vector_blob=serialize_vector(vector, dimension=1024), source_hash="a" * 64,
        status="ready", indexed_image_count=1, total_image_count=1,
    ))


class FakeClient:
    def __init__(self, vector: list[float]) -> None:
        self.vector = vector
        self.calls = 0

    def embed_fused(self, contents, *, dimension=1024, instruct=None):
        self.calls += 1
        return FusedEmbeddingResult(
            "qwen3-vl-embedding", tuple(self.vector), 3, 0, 3, "request-test"
        )


def test_semantic_search_orders_cosine_filters_tags_and_caches_pages(semantic_context) -> None:
    factory, storage, model_id, tmp_path = semantic_context
    e1 = [0.0] * 1024
    e1[0] = 1.0
    e2 = [0.0] * 1024
    e2[0], e2[1] = 0.8, 0.6
    with factory() as session:
        first = add_meme(session, storage, "first", tags=("反讽",))
        second = add_meme(session, storage, "second", tags=("反讽", "猫"))
        third = add_meme(session, storage, "third", tags=("猫",))
        ready_embedding(session, first, model_id, e1)
        ready_embedding(session, second, model_id, e2)
        ready_embedding(session, third, model_id, e1)
        session.commit()
    index = SemanticIndex(factory)
    fake = FakeClient(e1)
    with factory() as session:
        service = SemanticSearchService(
            session, storage, tmp_path / "key", index, SemanticSearchResultCache(), client=fake
        )
        result = service.search(query="离谱回复", tags=["反讽"], page=1, page_size=24)
        assert [meme.id for meme, _ in result["hits"]] == [first.id, second.id]
        assert result["hits"][0][1] > result["hits"][1][1]
        service.search(query="离谱回复", tags=["反讽"], page=2, page_size=24)
        assert fake.calls == 1


def test_index_generation_invalidates_query_cache_and_similar_never_calls_provider(semantic_context) -> None:
    factory, storage, model_id, tmp_path = semantic_context
    vector = [0.0] * 1024
    vector[0] = 1.0
    with factory() as session:
        first = add_meme(session, storage, "first")
        second = add_meme(session, storage, "second")
        ready_embedding(session, first, model_id, vector)
        ready_embedding(session, second, model_id, vector)
        session.commit()
    index = SemanticIndex(factory)
    fake = FakeClient(vector)
    cache = SemanticSearchResultCache()
    with factory() as session:
        service = SemanticSearchService(session, storage, tmp_path / "key", index, cache, client=fake)
        service.search(query="相似反应", tags=[], page=1, page_size=24)
        MemeEmbeddingRepository(session).bump_generation()
        session.commit()
        service.search(query="相似反应", tags=[], page=1, page_size=24)
        assert fake.calls == 2
        calls = fake.calls
        similar = service.similar(first.id, limit=12)
        assert [meme.id for meme, _ in similar] == [second.id]
        assert fake.calls == calls
        record = session.scalar(select(MemeEmbedding).where(MemeEmbedding.meme_id == first.id))
        record.status = "stale"
        session.commit()
        with pytest.raises(MemeEmbeddingUnavailableError):
            service.similar(first.id, limit=12)


def test_missing_statistics_and_stale_marking(semantic_context) -> None:
    factory, storage, model_id, _ = semantic_context
    with factory() as session:
        first = add_meme(session, storage, "first")
        second = add_meme(session, storage, "second")
        ready_embedding(session, first, model_id, [1.0] + [0.0] * 1023)
        session.commit()
        repository = MemeEmbeddingRepository(session)
        counts = repository.count_status(
            model_record_id=model_id, model_id="qwen3-vl-embedding", dimension=1024,
            kind=EMBEDDING_KIND,
        )
        assert counts["missing"] == 1
        assert invalidate_meme_semantic_data(session, [first.id]) == 1
        session.commit()
        assert repository.get_for_meme(first.id).status == "stale"
        assert repository.get_for_meme(second.id) is None


def test_business_mutations_mark_embeddings_stale_and_delete_cascades(semantic_context) -> None:
    factory, storage, model_id, tmp_path = semantic_context
    vector = [1.0] + [0.0] * 1023
    with factory() as session:
        meme = add_meme(session, storage, "mutable", tags=("source-tag",))
        ready_embedding(session, meme, model_id, vector)
        session.commit()
        record = MemeEmbeddingRepository(session).get_for_meme(meme.id)
        MemeService(session, storage).update_meme(meme.id, {"title": "changed"})
        assert record.status == "stale"

        record.status = "ready"
        session.commit()
        tag = session.scalar(select(Tag).where(Tag.name == "source-tag"))
        TagService(session).rename_tag(tag.id, "renamed-tag")
        assert record.status == "stale"

        target = Tag(name="target-tag")
        session.add(target)
        record.status = "ready"
        session.commit()
        TagService(session).merge_tags(tag.id, target.id)
        assert record.status == "stale"

        template = session.scalar(select(Template).where(Template.name == "未归类"))
        meme.template_id = template.id
        record.status = "ready"
        session.commit()
        TemplateService(
            session,
            TemplateImageStorage(tmp_path / "template-images", tmp_path / "template-thumbs"),
        ).update_template(template.id, {"name": "重命名模板"})
        assert record.status == "stale"

        record.status = "ready"
        session.commit()
        MemeService(session, storage).delete_meme(meme.id)
        assert MemeEmbeddingRepository(session).get_for_meme(meme.id) is None
