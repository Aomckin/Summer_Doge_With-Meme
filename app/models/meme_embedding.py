from datetime import UTC, datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

def utc_now() -> datetime:
    return datetime.now(UTC)


class MemeEmbedding(Base):
    __tablename__ = "meme_embeddings"
    __table_args__ = (
        CheckConstraint("status IN ('ready','stale','failed')", name="ck_meme_embedding_status"),
        CheckConstraint(
            "status != 'ready' OR vector_blob IS NOT NULL",
            name="ck_ready_embedding_has_vector",
        ),
        CheckConstraint(
            "embedding_kind = 'meme_fused_v1'",
            name="ck_meme_embedding_kind",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meme_id: Mapped[int] = mapped_column(
        ForeignKey("memes.id", ondelete="CASCADE"), unique=True, index=True
    )
    model_record_id: Mapped[int] = mapped_column(
        ForeignKey("ai_models.id", ondelete="RESTRICT"), index=True
    )
    model_id_snapshot: Mapped[str] = mapped_column(String(200))
    embedding_kind: Mapped[str] = mapped_column(String(40), default="meme_fused_v1")
    dimension: Mapped[int] = mapped_column(Integer, default=1024)
    vector_blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    source_hash: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    indexed_image_count: Mapped[int] = mapped_column(Integer, default=0)
    total_image_count: Mapped[int] = mapped_column(Integer, default=0)
    text_tokens: Mapped[int] = mapped_column(Integer, default=0)
    image_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )



class SemanticIndexState(Base):
    __tablename__ = "semantic_index_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    generation: Mapped[int] = mapped_column(Integer, default=0)
