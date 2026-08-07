from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.models.meme_embedding import MemeEmbedding, SemanticIndexState


class MemeEmbeddingRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_for_meme(self, meme_id: int) -> MemeEmbedding | None:
        return self.session.scalar(
            select(MemeEmbedding).where(MemeEmbedding.meme_id == meme_id)
        )

    def compatible_ready(
        self, *, model_record_id: int, model_id: str, dimension: int, kind: str
    ) -> list[MemeEmbedding]:
        return list(self.session.scalars(
            select(MemeEmbedding)
            .where(
                MemeEmbedding.status == "ready",
                MemeEmbedding.model_record_id == model_record_id,
                MemeEmbedding.model_id_snapshot == model_id,
                MemeEmbedding.dimension == dimension,
                MemeEmbedding.embedding_kind == kind,
            )
            .order_by(MemeEmbedding.meme_id)
        ))

    def generation(self) -> int:
        state = self.session.get(SemanticIndexState, 1)
        return state.generation if state is not None else 0

    def bump_generation(self) -> int:
        state = self.session.get(SemanticIndexState, 1)
        if state is None:
            state = SemanticIndexState(id=1, generation=1)
            self.session.add(state)
        else:
            state.generation += 1
        self.session.flush()
        return state.generation

    def count_status(
        self, *, model_record_id: int | None, model_id: str | None, dimension: int,
        kind: str,
    ) -> dict[str, int]:
        total = int(self.session.scalar(select(func.count(Meme.id))) or 0)
        rows = self.session.execute(
            select(MemeEmbedding.status, func.count(MemeEmbedding.id)).group_by(
                MemeEmbedding.status
            )
        ).all()
        all_counts = {str(status): int(count) for status, count in rows}
        existing = sum(all_counts.values())
        compatible_ready = 0
        if model_record_id is not None and model_id is not None:
            compatible_ready = int(self.session.scalar(
                select(func.count(MemeEmbedding.id)).where(
                    MemeEmbedding.status == "ready",
                    MemeEmbedding.model_record_id == model_record_id,
                    MemeEmbedding.model_id_snapshot == model_id,
                    MemeEmbedding.dimension == dimension,
                    MemeEmbedding.embedding_kind == kind,
                )
            ) or 0)
        return {
            "total": total,
            "ready": compatible_ready,
            "missing": max(0, total - existing),
            "stale": all_counts.get("stale", 0),
            "failed": all_counts.get("failed", 0),
            "incompatible": max(0, all_counts.get("ready", 0) - compatible_ready),
        }
