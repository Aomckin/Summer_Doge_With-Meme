from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding
from app.models.meme_relation import MemeRelation
from app.models.tag import MemeTag
from app.repositories.ai_settings_repository import AISettingsRepository
from app.repositories.similarity_ignore_repository import (
    SimilarityIgnoreRepository,
    canonical_pair,
)
from app.services.embedding_config import EMBEDDING_DIMENSION, EMBEDDING_KIND
from app.services.embedding_vectors import deserialize_vector
from app.services.semantic_index import SemanticIndex


class SimilarityInspectionUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class SimilarityPair:
    meme_a: Meme
    meme_b: Meme
    score: float
    weak_relation_exists: bool


class SimilarityInspectionService:
    def __init__(self, session: Session, semantic_index: SemanticIndex) -> None:
        self.session = session
        self.semantic_index = semantic_index
        self.ignore_repository = SimilarityIgnoreRepository(session)

    def inspect(
        self,
        *,
        start_meme_id: int,
        end_meme_id: int,
        top_k: int,
        similarity_threshold: float,
    ) -> dict[str, object]:
        model = AISettingsRepository(self.session).active_embedding_model()
        if model is None:
            raise SimilarityInspectionUnavailableError(
                "Semantic embedding model is not configured"
            )
        requested_ids = set(
            self.session.scalars(
                select(Meme.id).where(
                    Meme.id >= start_meme_id, Meme.id <= end_meme_id
                )
            )
        )
        requested_count = len(requested_ids)
        records = list(
            self.session.scalars(
                select(MemeEmbedding).where(
                    MemeEmbedding.meme_id.in_(requested_ids),
                    MemeEmbedding.status == "ready",
                    MemeEmbedding.model_record_id == model.id,
                    MemeEmbedding.model_id_snapshot == model.model_id,
                    MemeEmbedding.dimension == EMBEDDING_DIMENSION,
                    MemeEmbedding.embedding_kind == EMBEDDING_KIND,
                )
            )
        ) if requested_ids else []
        ready_ids = {record.meme_id for record in records}
        ignored = self.ignore_repository.pairs_for_sources(ready_ids)
        best_scores: dict[tuple[int, int], float] = {}
        for record in records:
            vector = deserialize_vector(
                record.vector_blob or b"", dimension=EMBEDDING_DIMENSION
            )
            hits = self.semantic_index.search(
                vector,
                model_record_id=model.id,
                model_id=model.model_id,
                dimension=EMBEDDING_DIMENSION,
                exclude_id=record.meme_id,
            )[:top_k]
            for hit in hits:
                if hit.score < similarity_threshold:
                    break
                pair = canonical_pair(record.meme_id, hit.meme_id)
                if pair in ignored:
                    continue
                best_scores[pair] = max(best_scores.get(pair, -1.0), hit.score)

        ids = {item for pair in best_scores for item in pair}
        memes = self._memes(ids)
        existing_pairs = {
            (edge.meme_a_id, edge.meme_b_id)
            for edge in self.session.scalars(
                select(MemeRelation).where(
                    or_(MemeRelation.meme_a_id.in_(ids), MemeRelation.meme_b_id.in_(ids))
                )
            )
        } if ids else set()
        pairs = [
            SimilarityPair(
                meme_a=memes[pair[0]],
                meme_b=memes[pair[1]],
                score=score,
                weak_relation_exists=pair in existing_pairs,
            )
            for pair, score in sorted(
                best_scores.items(), key=lambda item: (-item[1], item[0])
            )
            if pair[0] in memes and pair[1] in memes
        ]
        return {
            "requested_count": requested_count,
            "ready_count": len(ready_ids),
            "missing_or_stale_count": requested_count - len(ready_ids),
            "candidate_pair_count": len(pairs),
            "pairs": pairs,
        }

    def create_ignore(self, left_id: int, right_id: int):
        try:
            record = self.ignore_repository.create(left_id, right_id)
            self.session.commit()
            return record
        except Exception:
            self.session.rollback()
            raise

    def delete_ignore(self, left_id: int, right_id: int) -> bool:
        try:
            deleted = self.ignore_repository.delete(left_id, right_id)
            self.session.commit()
            return deleted
        except Exception:
            self.session.rollback()
            raise

    def _memes(self, ids: set[int]) -> dict[int, Meme]:
        if not ids:
            return {}
        rows = self.session.scalars(
            select(Meme)
            .options(
                selectinload(Meme.images),
                selectinload(Meme.tag_links).selectinload(MemeTag.tag),
                selectinload(Meme.template),
            )
            .where(Meme.id.in_(ids))
        ).unique()
        return {meme.id: meme for meme in rows}
