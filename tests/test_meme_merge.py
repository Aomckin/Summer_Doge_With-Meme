from pathlib import Path

import pytest
from sqlalchemy import create_engine, or_, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.ai_settings import AIModel, AIProvider
from app.models.caption import Caption
from app.models.collection import Collection, CollectionItem
from app.models.enrichment import MemeEnrichmentSuggestion
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.models.meme_image import MemeImage
from app.models.meme_relation import MemeRelation
from app.models.meme_similarity_ignore import MemeSimilarityIgnore
from app.models.tag import MemeTag, Tag
from app.services.embedding_config import EMBEDDING_KIND
from app.services.embedding_vectors import serialize_vector
from app.services.meme_enrichment_service import MemeEnrichmentService
from app.services.meme_merge_service import MemeMergeError, MemeMergeService
from app.storage.image_storage import ImageStorage
from tests.vault_helpers import ensure_default_vault


@pytest.fixture
def merge_context(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'merge.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory, tmp_path
    engine.dispose()


def add_meme(session, root: Path, title: str, image_count: int) -> Meme:
    vault = ensure_default_vault(session)
    meme = Meme(
        vault_id=vault.id,
        title=title,
        description=f"{title} description",
        original_filename=f"{title}-0.png",
        stored_filename=f"{title}-0.png",
        file_path=f"{title}-0.png",
        thumbnail_path=f"{title}-0-thumb.png",
        mime_type="image/png",
        file_size=10,
        width=10,
        height=10,
        file_hash=(title.encode().hex() + "0" * 64)[:64],
        source=f"source-{title}",
    )
    session.add(meme)
    session.flush()
    for position in range(image_count):
        stored = f"{title}-{position}.png"
        thumb = f"{title}-{position}-thumb.png"
        (root / stored).write_bytes(f"image-{title}-{position}".encode())
        (root / thumb).write_bytes(f"thumb-{title}-{position}".encode())
        meme.images.append(
            MemeImage(
                vault_id=vault.id,
                original_filename=stored,
                stored_filename=stored,
                file_path=stored,
                thumbnail_path=thumb,
                mime_type="image/png",
                file_size=10,
                width=10,
                height=10,
                file_hash=(f"{title}-{position}".encode().hex() + "0" * 64)[:64],
                position=position,
            )
        )
    session.flush()
    return meme


def add_ready_embedding(session, meme: Meme) -> MemeEmbedding:
    provider = session.scalar(select(AIProvider))
    if provider is None:
        provider = AIProvider(
            name="provider", protocol="dashscope_multimodal_embedding",
            base_url="https://example.test", api_key_ciphertext="x", enabled=True,
        )
        model = AIModel(
            provider=provider, model_id="qwen3-vl-embedding", display_name="Qwen",
            supports_vision=False, supports_image_embedding=True, enabled=True,
            is_embedding_active=True,
        )
        session.add_all([provider, model])
        session.flush()
    else:
        model = session.scalar(select(AIModel))
    record = MemeEmbedding(
        meme_id=meme.id, model_record_id=model.id,
        model_id_snapshot=model.model_id, embedding_kind=EMBEDDING_KIND,
        dimension=1024, vector_blob=serialize_vector([1.0] + [0.0] * 1023, dimension=1024),
        source_hash="a" * 64, status="ready", indexed_image_count=1,
        total_image_count=len(meme.images),
    )
    session.add(record)
    session.flush()
    return record


@pytest.mark.parametrize("target_count,source_count", [(1, 1), (2, 3)])
def test_merge_moves_images_without_copying_files_and_keeps_target_cover(
    merge_context, target_count: int, source_count: int
) -> None:
    factory, root = merge_context
    with factory() as session:
        target = add_meme(session, root, "target", target_count)
        source = add_meme(session, root, "source", source_count)
        target_id, source_id = target.id, source.id
        target_metadata = (
            target.title, target.description, target.source, target.template_id,
            target.created_at.replace(tzinfo=None), target.stored_filename,
        )
        filenames = [item.file_path for item in [*target.images, *source.images]]
        session.commit()

        merged = MemeMergeService(session).merge(target_id, source_id)
        assert session.get(Meme, source_id) is None
        assert [item.position for item in merged.images] == list(range(target_count + source_count))
        assert [item.file_path for item in merged.images] == filenames
        assert (
            merged.title, merged.description, merged.source, merged.template_id,
            merged.created_at.replace(tzinfo=None), merged.stored_filename,
        ) == target_metadata
        assert all((root / filename).is_file() for filename in filenames)
        asset_files = [path for path in root.iterdir() if path.suffix == ".png"]
        assert len(asset_files) == 2 * (target_count + source_count)


def test_merge_unions_tags_with_shared_priority_and_moves_captions(merge_context) -> None:
    factory, root = merge_context
    with factory() as session:
        target = add_meme(session, root, "target", 1)
        source = add_meme(session, root, "source", 1)
        shared_user = Tag(name="shared-user")
        shared_confidence = Tag(name="shared-confidence")
        source_only = Tag(name="source-only")
        session.add_all([shared_user, shared_confidence, source_only])
        session.flush()
        target.tag_links.extend([
            MemeTag(tag=shared_user, source="user", confidence=None),
            MemeTag(tag=shared_confidence, source="ai", confidence=0.4),
        ])
        source.tag_links.extend([
            MemeTag(tag=shared_user, source="ai", confidence=0.99),
            MemeTag(tag=shared_confidence, source="ai", confidence=0.8),
            MemeTag(tag=source_only, source="manual", confidence=0.7),
        ])
        caption = Caption(
            meme=source, content="保留正文", scene="群聊", tone="无语",
            length="short", source="manual",
        )
        session.add(caption)
        session.flush()
        target_id, source_id, caption_id = target.id, source.id, caption.id
        session.commit()

        merged = MemeMergeService(session).merge(target_id, source_id)
        links = {link.tag.name: link for link in merged.tag_links}
        assert set(links) == {"shared-user", "shared-confidence", "source-only"}
        assert (links["shared-user"].source, links["shared-user"].confidence) == ("user", None)
        assert (links["shared-confidence"].source, links["shared-confidence"].confidence) == ("ai", 0.8)
        assert (links["source-only"].source, links["source-only"].confidence) == ("manual", None)
        moved = session.get(Caption, caption_id)
        assert moved is not None and moved.meme_id == target_id
        assert (moved.content, moved.scene, moved.tone, moved.length, moved.source) == (
            "保留正文", "群聊", "无语", "short", "manual"
        )
        assert session.get(Meme, source_id) is None


def test_merge_reconnects_relations_without_self_loops_or_duplicates(merge_context) -> None:
    factory, root = merge_context
    with factory() as session:
        target = add_meme(session, root, "target", 1)
        source = add_meme(session, root, "source", 1)
        third = add_meme(session, root, "third", 1)
        fourth = add_meme(session, root, "fourth", 1)
        pairs = [
            (target.id, source.id), (source.id, third.id),
            (target.id, third.id), (source.id, fourth.id),
        ]
        for left, right in pairs:
            session.add(MemeRelation(meme_a_id=min(left, right), meme_b_id=max(left, right)))
        target_id, source_id, third_id, fourth_id = target.id, source.id, third.id, fourth.id
        session.commit()

        MemeMergeService(session).merge(target_id, source_id)
        remaining = {
            (edge.meme_a_id, edge.meme_b_id)
            for edge in session.scalars(select(MemeRelation))
        }
        assert remaining == {
            (min(target_id, third_id), max(target_id, third_id)),
            (min(target_id, fourth_id), max(target_id, fourth_id)),
        }
        assert all(left != right and source_id not in (left, right) for left, right in remaining)


def test_merge_discards_source_derivatives_invalidates_target_and_cascades_ignores(merge_context) -> None:
    factory, root = merge_context
    with factory() as session:
        target = add_meme(session, root, "target", 1)
        source = add_meme(session, root, "source", 1)
        third = add_meme(session, root, "third", 1)
        target_embedding = add_ready_embedding(session, target)
        source_embedding = add_ready_embedding(session, source)
        suggestion = MemeEnrichmentSuggestion(
            meme=target,
            source="manual",
            source_hash=MemeEnrichmentService.source_hash(target),
        )
        session.add(suggestion)
        session.add(MemeSimilarityIgnore(meme_a_id=source.id, meme_b_id=third.id))
        session.flush()
        target_id, source_id = target.id, source.id
        target_embedding_id, source_embedding_id = target_embedding.id, source_embedding.id
        suggestion_id = suggestion.id
        session.commit()

        MemeMergeService(session).merge(target_id, source_id)
        assert session.get(MemeEmbedding, target_embedding_id).status == "stale"
        assert session.get(MemeEmbedding, source_embedding_id) is None
        assert list(session.scalars(select(MemeSimilarityIgnore))) == []
        stored_suggestion = session.get(MemeEnrichmentSuggestion, suggestion_id)
        enrichment = MemeEnrichmentService(
            session,
            ImageStorage(root / "managed-images", root / "managed-thumbnails"),
        )
        assert stored_suggestion is not None and enrichment.is_stale(stored_suggestion)


def test_merge_rolls_back_all_database_assets_on_midway_failure(merge_context) -> None:
    factory, root = merge_context

    class FailingMergeService(MemeMergeService):
        def _move_captions(self, target: Meme, source: Meme) -> None:
            super()._move_captions(target, source)
            raise RuntimeError("injected failure")

    with factory() as session:
        target = add_meme(session, root, "target", 2)
        source = add_meme(session, root, "source", 2)
        tag = Tag(name="source-tag")
        source.tag_links.append(MemeTag(tag=tag, source="user"))
        caption = Caption(meme=source, content="asset", source="manual")
        session.add(caption)
        target_id, source_id = target.id, source.id
        filenames = [item.file_path for item in [*target.images, *source.images]]
        session.commit()

        with pytest.raises(RuntimeError, match="injected"):
            FailingMergeService(session).merge(target_id, source_id)
        session.expire_all()
        restored_target = session.get(Meme, target_id)
        restored_source = session.get(Meme, source_id)
        assert restored_target is not None and len(restored_target.images) == 2
        assert restored_source is not None and len(restored_source.images) == 2
        assert [item.position for item in restored_target.images] == [0, 1]
        assert [item.position for item in restored_source.images] == [0, 1]
        assert [link.tag.name for link in restored_source.tag_links] == ["source-tag"]
        assert restored_source.captions[0].content == "asset"
        assert all((root / filename).is_file() for filename in filenames)


def test_merge_rejects_same_or_missing_meme(merge_context) -> None:
    factory, root = merge_context
    with factory() as session:
        target = add_meme(session, root, "target", 1)
        session.commit()
        with pytest.raises(MemeMergeError):
            MemeMergeService(session).merge(target.id, target.id)
        with pytest.raises(LookupError):
            MemeMergeService(session).merge(target.id, 999)


def test_merge_unions_collection_memberships_and_preserves_positions(merge_context) -> None:
    factory, root = merge_context
    with factory() as session:
        target = add_meme(session, root, "target", 1)
        source = add_meme(session, root, "source", 1)
        c1, c2, c3 = Collection(name="C1"), Collection(name="C2"), Collection(name="C3")
        session.add_all([c1, c2, c3])
        session.flush()
        session.add_all([
            CollectionItem(collection_id=c1.id, meme_id=target.id, position=4),
            CollectionItem(collection_id=c1.id, meme_id=source.id, position=8),
            CollectionItem(collection_id=c2.id, meme_id=source.id, position=3),
            CollectionItem(collection_id=c3.id, meme_id=source.id, position=6),
        ])
        target_id, source_id = target.id, source.id
        session.commit()

        MemeMergeService(session).merge(target_id, source_id)
        items = list(session.scalars(select(CollectionItem).order_by(CollectionItem.collection_id)))
        assert [(item.collection_id, item.meme_id, item.position) for item in items] == [
            (c1.id, target_id, 4),
            (c2.id, target_id, 3),
            (c3.id, target_id, 6),
        ]
