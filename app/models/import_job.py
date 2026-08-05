from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), index=True, default="queued")
    total_entries: Mapped[int] = mapped_column(Integer, default=0)
    image_entries: Mapped[int] = mapped_column(Integer, default=0)
    processed_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_size: Mapped[int] = mapped_column(Integer, default=100)
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("templates.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_filename: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    archive_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["ImportJobItem"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class ImportJobItem(Base):
    __tablename__ = "import_job_items"
    __table_args__ = (UniqueConstraint("job_id", "entry_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("import_jobs.id", ondelete="CASCADE"), index=True
    )
    entry_index: Mapped[int] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(20), index=True)
    meme_id: Mapped[int | None] = mapped_column(
        ForeignKey("memes.id", ondelete="SET NULL"), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    job: Mapped[ImportJob] = relationship(back_populates="items")
    meme: Mapped["Meme | None"] = relationship()
