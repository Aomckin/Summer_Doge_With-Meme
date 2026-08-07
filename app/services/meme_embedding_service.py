from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.ai.client import AIInvalidResponseError
from app.ai.embedding_client import FusedEmbeddingResult, MultimodalEmbeddingClient
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding, utc_now
from app.models.tag import MemeTag
from app.repositories.meme_embedding_repository import MemeEmbeddingRepository
from app.services.embedding_config import (
    DOCUMENT_INSTRUCTION,
    EMBEDDING_DIMENSION,
    EMBEDDING_KIND,
)
from app.services.embedding_vectors import serialize_vector
from app.services.meme_embedding_content import MemeEmbeddingContent, MemeEmbeddingContentBuilder
from app.storage.image_storage import ImageStorage


@dataclass(frozen=True)
class MemeEmbeddingAttempt:
    meme_id: int
    content: MemeEmbeddingContent | None = None
    embedding: FusedEmbeddingResult | None = None
    vector_blob: bytes | None = None
    skipped: bool = False
    error: Exception | None = None

    @property
    def error_message(self) -> str | None:
        if self.error is None:
            return None
        return (str(self.error) or self.error.__class__.__name__)[:4000]


class MemeEmbeddingService:
    """One implementation of the content -> Provider -> persisted vector pipeline."""

    def __init__(self, storage: ImageStorage) -> None:
        self.storage = storage

    @staticmethod
    def load_meme(session: Session, meme_id: int) -> Meme | None:
        return session.scalar(
            select(Meme)
            .options(
                selectinload(Meme.images),
                selectinload(Meme.tag_links).selectinload(MemeTag.tag),
                selectinload(Meme.template),
            )
            .where(Meme.id == meme_id)
        )

    def generate(
        self,
        session: Session,
        client: MultimodalEmbeddingClient,
        *,
        meme_id: int,
        model_record_id: int,
        model_id: str,
        expected_source_hash: str | None = None,
    ) -> MemeEmbeddingAttempt:
        content: MemeEmbeddingContent | None = None
        try:
            meme = self.load_meme(session, meme_id)
            if meme is None:
                return MemeEmbeddingAttempt(
                    meme_id, skipped=True, error=LookupError(f"Meme {meme_id} does not exist")
                )
            content = MemeEmbeddingContentBuilder(self.storage).build(
                meme,
                model_record_id=model_record_id,
                model_id_snapshot=model_id,
            )
            if expected_source_hash is not None and content.source_hash != expected_source_hash:
                return MemeEmbeddingAttempt(
                    meme_id,
                    content=content,
                    skipped=True,
                    error=RuntimeError("Meme changed after the job snapshot was created"),
                )
            result = client.embed_fused(
                content.contents,
                dimension=EMBEDDING_DIMENSION,
                instruct=DOCUMENT_INSTRUCTION,
            )
            if result.model_id != model_id:
                raise AIInvalidResponseError(
                    f"Embedding response model {result.model_id!r} does not match {model_id!r}"
                )
            blob = serialize_vector(result.vector, dimension=EMBEDDING_DIMENSION)
            return MemeEmbeddingAttempt(meme_id, content, result, blob)
        except Exception as error:
            return MemeEmbeddingAttempt(
                meme_id,
                content=content,
                error=error,
            )

    def persist(
        self,
        session: Session,
        attempt: MemeEmbeddingAttempt,
        *,
        model_record_id: int,
        model_id: str,
        source_hash: str,
    ) -> MemeEmbedding | None:
        if attempt.skipped:
            return None
        repository = MemeEmbeddingRepository(session)
        record = repository.get_for_meme(attempt.meme_id)
        if record is None:
            record = MemeEmbedding(
                meme_id=attempt.meme_id,
                model_record_id=model_record_id,
                model_id_snapshot=model_id,
                embedding_kind=EMBEDDING_KIND,
                dimension=EMBEDDING_DIMENSION,
                source_hash=source_hash,
                status="failed",
            )
            session.add(record)
        content = attempt.content
        record.model_record_id = model_record_id
        record.model_id_snapshot = model_id
        record.embedding_kind = EMBEDDING_KIND
        record.dimension = EMBEDDING_DIMENSION
        record.source_hash = content.source_hash if content else source_hash
        record.indexed_image_count = content.indexed_image_count if content else 0
        record.total_image_count = content.total_image_count if content else 0
        if attempt.error is not None or attempt.embedding is None or attempt.vector_blob is None:
            record.status = "failed"
            record.last_error = attempt.error_message or "Embedding request failed"
        else:
            result = attempt.embedding
            record.model_id_snapshot = result.model_id
            record.vector_blob = attempt.vector_blob
            record.status = "ready"
            record.text_tokens = result.input_tokens
            record.image_tokens = result.image_tokens
            record.total_tokens = result.total_tokens
            record.last_error = None
            record.indexed_at = utc_now()
        repository.bump_generation()
        return record

    def rebuild_one(
        self,
        session: Session,
        client: MultimodalEmbeddingClient,
        *,
        meme_id: int,
        model_record_id: int,
        model_id: str,
    ) -> MemeEmbedding:
        attempt = self.generate(
            session,
            client,
            meme_id=meme_id,
            model_record_id=model_record_id,
            model_id=model_id,
        )
        if attempt.skipped:
            assert attempt.error is not None
            raise attempt.error
        try:
            record = self.persist(
                session,
                attempt,
                model_record_id=model_record_id,
                model_id=model_id,
                source_hash=attempt.content.source_hash if attempt.content else "",
            )
            assert record is not None
            session.commit()
            session.refresh(record)
        except Exception:
            session.rollback()
            raise
        if attempt.error is not None:
            raise attempt.error
        return record
