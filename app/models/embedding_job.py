from datetime import UTC, datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

def utc_now() -> datetime:
    return datetime.now(UTC)


class EmbeddingJob(Base):
    __tablename__ = "embedding_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(30), index=True, default="pending")
    scope: Mapped[str] = mapped_column(String(30))
    model_record_id: Mapped[int] = mapped_column(ForeignKey("ai_models.id", ondelete="RESTRICT"), index=True)
    model_id_snapshot: Mapped[str] = mapped_column(String(200))
    dimension: Mapped[int] = mapped_column(Integer, default=1024)
    max_workers: Mapped[int] = mapped_column(Integer, default=4)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    processed_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    text_tokens: Mapped[int] = mapped_column(Integer, default=0)
    image_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["EmbeddingJobItem"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="EmbeddingJobItem.id"
    )


class EmbeddingJobItem(Base):
    __tablename__ = "embedding_job_items"
    __table_args__ = (UniqueConstraint("job_id", "meme_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("embedding_jobs.id", ondelete="CASCADE"), index=True)
    # Keep the durable snapshot even if the Meme is deleted while a job runs.
    meme_id: Mapped[int] = mapped_column(Integer, index=True)
    source_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), index=True, default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    text_tokens: Mapped[int] = mapped_column(Integer, default=0)
    image_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped[EmbeddingJob] = relationship(back_populates="items")
