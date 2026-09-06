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
        self,
        *,
        vault_id: int,
        model_record_id: int,
        model_id: str,
        dimension: int,
        kind: str,
    ) -> list[MemeEmbedding]:
        # 语义索引按 Vault 分片：只加载当前仓库 Meme 的兼容 ready 向量。
        return list(self.session.scalars(
            select(MemeEmbedding)
            .join(Meme, Meme.id == MemeEmbedding.meme_id)
            .where(
                Meme.vault_id == vault_id,
                MemeEmbedding.status == "ready",
                MemeEmbedding.model_record_id == model_record_id,
                MemeEmbedding.model_id_snapshot == model_id,
                MemeEmbedding.dimension == dimension,
                MemeEmbedding.embedding_kind == kind,
            )
            .order_by(MemeEmbedding.meme_id)
        ))

    def generation(self, vault_id: int) -> int:
        state = self.session.scalar(
            select(SemanticIndexState).where(SemanticIndexState.vault_id == vault_id)
        )
        return state.generation if state is not None else 0

    def bump_generation(self, vault_id: int) -> int:
        state = self.session.scalar(
            select(SemanticIndexState).where(SemanticIndexState.vault_id == vault_id)
        )
        if state is None:
            state = SemanticIndexState(vault_id=vault_id, generation=1)
            self.session.add(state)
        else:
            state.generation += 1
        self.session.flush()
        return state.generation

    def count_status(
        self, *, vault_id: int, model_record_id: int | None, model_id: str | None,
        dimension: int,
        kind: str,
    ) -> dict[str, int]:
        total = int(
            self.session.scalar(
                select(func.count(Meme.id)).where(Meme.vault_id == vault_id)
            )
            or 0
        )
        rows = self.session.execute(
            select(MemeEmbedding.status, func.count(MemeEmbedding.id))
            .join(Meme, Meme.id == MemeEmbedding.meme_id)
            .where(Meme.vault_id == vault_id)
            .group_by(MemeEmbedding.status)
        ).all()
        all_counts = {str(status): int(count) for status, count in rows}
        existing = sum(all_counts.values())
        compatible_ready = 0
        if model_record_id is not None and model_id is not None:
            compatible_ready = int(self.session.scalar(
                select(func.count(MemeEmbedding.id))
                .join(Meme, Meme.id == MemeEmbedding.meme_id)
                .where(
                    Meme.vault_id == vault_id,
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
