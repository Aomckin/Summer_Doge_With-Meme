from math import ceil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.ai.embedding_client import MultimodalEmbeddingClient
from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.models.tag import MemeTag
from app.repositories.ai_settings_repository import AISettingsRepository
from app.repositories.embedding_job_repository import EmbeddingJobRepository
from app.repositories.meme_embedding_repository import MemeEmbeddingRepository
from app.repositories.meme_repository import MemeRepository
from app.services.ai_settings_service import AISettingsService
from app.services.embedding_vectors import deserialize_vector, normalize_vector
from app.services.embedding_config import (
    EMBEDDING_DIMENSION,
    EMBEDDING_KIND,
    QUERY_INSTRUCTION,
)
from app.services.meme_embedding_service import MemeEmbeddingService
from app.services.semantic_index import SearchHit, SemanticIndex, SemanticSearchResultCache
from app.storage.image_storage import ImageStorage


class MemeEmbeddingUnavailableError(RuntimeError):
    pass


class SemanticSearchService:
    def __init__(
        self,
        session: Session,
        storage: ImageStorage,
        key_file: Path,
        semantic_index: SemanticIndex,
        result_cache: SemanticSearchResultCache,
        *,
        client: MultimodalEmbeddingClient | None = None,
    ) -> None:
        self.session = session
        self.storage = storage
        self.key_file = key_file
        self.semantic_index = semantic_index
        self.result_cache = result_cache
        self.client = client
        self.embedding_repository = MemeEmbeddingRepository(session)

    def active_model(self):
        return AISettingsRepository(self.session).active_embedding_model()

    def status(self) -> dict[str, object]:
        model = self.active_model()
        counts = self.embedding_repository.count_status(
            model_record_id=model.id if model else None,
            model_id=model.model_id if model else None,
            dimension=EMBEDDING_DIMENSION,
            kind=EMBEDDING_KIND,
        )
        running = EmbeddingJobRepository(self.session).running()
        return {
            "total_memes": counts["total"],
            "ready_count": counts["ready"],
            "missing_count": counts["missing"],
            "stale_count": counts["stale"],
            "failed_count": counts["failed"],
            "incompatible_count": counts["incompatible"],
            "active_model_id": model.model_id if model else None,
            "dimension": EMBEDDING_DIMENSION,
            "running_job": self._job_summary(running) if running else None,
        }

    def rebuild_meme(self, meme_id: int) -> MemeEmbedding:
        model = self.active_model()
        if model is None:
            raise MemeEmbeddingUnavailableError("Semantic embedding model is not configured")
        client = self.client or AISettingsService(
            self.session, self.key_file
        ).build_active_multimodal_embedding_client()
        try:
            return MemeEmbeddingService(self.storage).rebuild_one(
                self.session,
                client,
                meme_id=meme_id,
                model_record_id=model.id,
                model_id=model.model_id,
            )
        except Exception:
            self.session.rollback()
            raise

    def search(
        self, *, query: str, tags: list[str], page: int, page_size: int
    ) -> dict[str, object]:
        model = self.active_model()
        if model is None:
            raise MemeEmbeddingUnavailableError("Semantic embedding model is not configured")
        normalized_query = query.strip()
        normalized_tags = tuple(sorted({tag.strip().lower() for tag in tags if tag.strip()}))
        key = (
            model.id,
            model.model_id,
            self.semantic_index.generation,
            normalized_query,
            normalized_tags,
        )
        hits = self.result_cache.get(key)
        if hits is None:
            client = self.client or AISettingsService(
                self.session, self.key_file
            ).build_active_multimodal_embedding_client()
            result = client.embed_fused(
                ({"text": normalized_query},),
                dimension=EMBEDDING_DIMENSION,
                instruct=QUERY_INSTRUCTION,
            )
            vector = normalize_vector(result.vector, dimension=EMBEDDING_DIMENSION)
            allowed = None
            if normalized_tags:
                allowed = {
                    meme.id
                    for meme in MemeRepository(self.session).list_all_for_export(
                        tags=normalized_tags
                    )
                }
            hits = self.semantic_index.search(
                vector,
                model_record_id=model.id,
                model_id=model.model_id,
                dimension=EMBEDDING_DIMENSION,
                allowed_ids=allowed,
            )
            self.result_cache.put(key, hits)
        total = len(hits)
        total_pages = ceil(total / page_size) if total else 0
        effective_page = min(page, total_pages) if total_pages else 1
        start = (effective_page - 1) * page_size
        page_hits = hits[start : start + page_size]
        memes = self._memes_for_hits(page_hits)
        counts = self.embedding_repository.count_status(
            model_record_id=model.id,
            model_id=model.model_id,
            dimension=EMBEDDING_DIMENSION,
            kind=EMBEDDING_KIND,
        )
        return {
            "hits": [(memes[hit.meme_id], hit.score) for hit in page_hits],
            "total": total,
            "page": effective_page,
            "page_size": page_size,
            "total_pages": total_pages,
            "indexed_count": counts["ready"],
            "missing_count": counts["total"] - counts["ready"],
            "model_id": model.model_id,
        }

    def similar(self, meme_id: int, *, limit: int) -> list[tuple[Meme, float]]:
        if self.session.get(Meme, meme_id) is None:
            raise LookupError(f"Meme {meme_id} does not exist")
        model = self.active_model()
        record = self.embedding_repository.get_for_meme(meme_id)
        if (
            model is None
            or record is None
            or record.status != "ready"
            or record.model_record_id != model.id
            or record.model_id_snapshot != model.model_id
            or record.dimension != EMBEDDING_DIMENSION
            or record.embedding_kind != EMBEDDING_KIND
            or record.vector_blob is None
        ):
            raise MemeEmbeddingUnavailableError("Meme has no valid semantic embedding")
        vector = deserialize_vector(record.vector_blob, dimension=record.dimension)
        hits = self.semantic_index.search(
            vector,
            model_record_id=model.id,
            model_id=model.model_id,
            dimension=record.dimension,
            exclude_id=meme_id,
        )[:limit]
        memes = self._memes_for_hits(hits)
        return [(memes[hit.meme_id], hit.score) for hit in hits]

    def _memes_for_hits(self, hits: list[SearchHit]) -> dict[int, Meme]:
        ids = [hit.meme_id for hit in hits]
        if not ids:
            return {}
        memes = self.session.scalars(
            select(Meme)
            .options(
                selectinload(Meme.images),
                selectinload(Meme.tag_links).selectinload(MemeTag.tag),
                selectinload(Meme.template),
            )
            .where(Meme.id.in_(ids))
        ).unique()
        return {meme.id: meme for meme in memes}

    @staticmethod
    def _job_summary(job: object) -> dict[str, object]:
        return {
            "id": getattr(job, "id"),
            "status": getattr(job, "status"),
            "processed_count": getattr(job, "processed_count"),
            "total_count": getattr(job, "total_count"),
        }
