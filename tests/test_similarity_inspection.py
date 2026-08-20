from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.ai_settings import AIModel, AIProvider
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.models.meme_relation import MemeRelation
from app.models.meme_similarity_ignore import MemeSimilarityIgnore
from app.schemas.similarity_inspection import SimilarityInspectionRequest
from app.services.embedding_config import EMBEDDING_KIND
from app.services.embedding_vectors import serialize_vector
from app.services.semantic_index import SemanticIndex
from app.services.similarity_inspection_service import SimilarityInspectionService


@pytest.fixture
def context(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'inspection.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        provider = AIProvider(
            name="DashScope",
            protocol="dashscope_multimodal_embedding",
            base_url="https://example.test",
            api_key_ciphertext="unused",
            enabled=True,
        )
        model = AIModel(
            provider=provider,
            model_id="qwen3-vl-embedding",
            display_name="Qwen",
            supports_vision=False,
            supports_image_embedding=True,
            enabled=True,
            is_embedding_active=True,
        )
        session.add_all([provider, model])
        session.commit()
        model_record_id = model.id
    yield factory, SemanticIndex(factory), model_record_id
    engine.dispose()


def add_meme(session, title: str) -> Meme:
    suffix = title.encode().hex()[:40].ljust(40, "0")
    meme = Meme(
        title=title,
        description=None,
        original_filename=f"{title}.png",
        stored_filename=f"{suffix}.png",
        file_path=f"{suffix}.png",
        thumbnail_path=None,
        mime_type="image/png",
        file_size=10,
        width=10,
        height=10,
        file_hash=suffix.ljust(64, "0"),
        source=None,
    )
    session.add(meme)
    session.flush()
    return meme


def vector(x: float, y: float = 0.0) -> list[float]:
    value = [0.0] * 1024
    value[0] = x
    value[1] = y
    return value


def add_embedding(
    session,
    meme: Meme,
    model_record_id: int,
    values: list[float],
    *,
    status: str = "ready",
    model_id: str = "qwen3-vl-embedding",
) -> None:
    session.add(
        MemeEmbedding(
            meme_id=meme.id,
            model_record_id=model_record_id,
            model_id_snapshot=model_id,
            embedding_kind=EMBEDDING_KIND,
            dimension=1024,
            vector_blob=serialize_vector(values, dimension=1024),
            source_hash="a" * 64,
            status=status,
            indexed_image_count=1,
            total_image_count=1,
        )
    )


def test_inspection_uses_inclusive_scope_and_whole_index_candidates(context) -> None:
    factory, index, model_id = context
    with factory() as session:
        old = add_meme(session, "old")
        first = add_meme(session, "first")
        second = add_meme(session, "second")
        missing = add_meme(session, "missing")
        stale = add_meme(session, "stale")
        incompatible = add_meme(session, "incompatible")
        add_embedding(session, old, model_id, vector(1.0))
        add_embedding(session, first, model_id, vector(1.0))
        add_embedding(session, second, model_id, vector(0.9, 0.43589))
        add_embedding(session, stale, model_id, vector(1.0), status="stale")
        add_embedding(session, incompatible, model_id, vector(1.0), model_id="old-model")
        session.commit()

        result = SimilarityInspectionService(session, index).inspect(
            start_meme_id=first.id,
            end_meme_id=incompatible.id,
            top_k=2,
            similarity_threshold=0.85,
        )
        assert result["requested_count"] == 5
        assert result["ready_count"] == 2
        assert result["missing_or_stale_count"] == 3
        pairs = result["pairs"]
        assert [(pair.meme_a.id, pair.meme_b.id) for pair in pairs] == [
            (old.id, first.id),
            (old.id, second.id),
            (first.id, second.id),
        ]
        assert pairs[0].score > pairs[1].score
        assert result["candidate_pair_count"] == 3
        assert missing.id not in {item for pair in pairs for item in (pair.meme_a.id, pair.meme_b.id)}

        whole = SimilarityInspectionService(session, index).inspect(
            scope="whole_vault",
            top_k=2,
            similarity_threshold=0.85,
        )
        assert whole["requested_count"] == 6
        assert whole["ready_count"] == 3
        assert whole["missing_or_stale_count"] == 3


def test_top_k_threshold_pair_dedup_ignore_and_relation_status(context) -> None:
    factory, index, model_id = context
    with factory() as session:
        first = add_meme(session, "first")
        second = add_meme(session, "second")
        third = add_meme(session, "third")
        add_embedding(session, first, model_id, vector(1.0))
        add_embedding(session, second, model_id, vector(1.0))
        add_embedding(session, third, model_id, vector(0.7, 0.714142))
        session.add(MemeRelation(meme_a_id=first.id, meme_b_id=second.id))
        session.commit()
        service = SimilarityInspectionService(session, index)

        top_one = service.inspect(
            start_meme_id=first.id,
            end_meme_id=second.id,
            top_k=1,
            similarity_threshold=0.5,
        )
        assert len(top_one["pairs"]) == 1
        assert top_one["pairs"][0].weak_relation_exists is True

        threshold = service.inspect(
            start_meme_id=first.id,
            end_meme_id=first.id,
            top_k=20,
            similarity_threshold=0.8,
        )
        assert [(pair.meme_a.id, pair.meme_b.id) for pair in threshold["pairs"]] == [
            (first.id, second.id)
        ]

        service.create_ignore(second.id, first.id)
        ignored = service.inspect(
            start_meme_id=first.id,
            end_meme_id=second.id,
            top_k=1,
            similarity_threshold=0.5,
        )
        assert ignored["pairs"] == []
        service.delete_ignore(first.id, second.id)
        restored = service.inspect(
            start_meme_id=first.id,
            end_meme_id=second.id,
            top_k=1,
            similarity_threshold=0.5,
        )
        assert len(restored["pairs"]) == 1


def test_ignore_is_canonical_idempotent_and_cascades_on_meme_delete(context) -> None:
    factory, index, _ = context
    with factory() as session:
        first = add_meme(session, "first")
        second = add_meme(session, "second")
        session.commit()
        service = SimilarityInspectionService(session, index)
        first_record = service.create_ignore(second.id, first.id)
        repeated = service.create_ignore(first.id, second.id)
        assert first_record.id == repeated.id
        assert (first_record.meme_a_id, first_record.meme_b_id) == (first.id, second.id)
        assert len(list(session.scalars(select(MemeSimilarityIgnore)))) == 1

        session.delete(second)
        session.commit()
        assert list(session.scalars(select(MemeSimilarityIgnore))) == []


def test_inspection_never_calls_provider_or_creates_embeddings(context) -> None:
    factory, index, model_id = context
    with factory() as session:
        first = add_meme(session, "first")
        second = add_meme(session, "second")
        add_embedding(session, first, model_id, vector(1.0))
        add_embedding(session, second, model_id, vector(1.0))
        session.commit()
        before = list(session.scalars(select(MemeEmbedding)))
        result = SimilarityInspectionService(session, index).inspect(
            start_meme_id=first.id,
            end_meme_id=first.id,
            top_k=5,
            similarity_threshold=0.85,
        )
        after = list(session.scalars(select(MemeEmbedding)))
        assert len(result["pairs"]) == 1
        assert [item.id for item in after] == [item.id for item in before]


@pytest.mark.parametrize(
    "values",
    [
        {"start_meme_id": 2, "end_meme_id": 1},
        {"start_meme_id": 1, "end_meme_id": 1001},
        {"start_meme_id": 1, "end_meme_id": 1, "top_k": 0},
        {"start_meme_id": 1, "end_meme_id": 1, "top_k": 21},
        {"start_meme_id": 1, "end_meme_id": 1, "similarity_threshold": -0.01},
        {"start_meme_id": 1, "end_meme_id": 1, "similarity_threshold": 1.01},
    ],
)
def test_inspection_request_rejects_invalid_parameters(values: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        SimilarityInspectionRequest.model_validate(values)
