from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class ExportJob(Base):
    __tablename__ = "export_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(30), index=True, default="pending")
    scope: Mapped[str] = mapped_column(String(20))
    query: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    template_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    organization: Mapped[str] = mapped_column(String(20), default="flat")
    include_manifest: Mapped[bool] = mapped_column(Boolean, default=True)
    archive_name: Mapped[str] = mapped_column(String(255))
    snapshot_json: Mapped[str] = mapped_column(Text, default="[]")
    total_memes: Mapped[int] = mapped_column(Integer, default=0)
    total_images: Mapped[int] = mapped_column(Integer, default=0)
    processed_memes: Mapped[int] = mapped_column(Integer, default=0)
    processed_images: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    estimated_bytes: Mapped[int] = mapped_column(Integer, default=0)
    archive_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_meme_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_filename: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    archive_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["ExportJobItem"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class ExportJobItem(Base):
    __tablename__ = "export_job_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("export_jobs.id", ondelete="CASCADE"), index=True
    )
    meme_id: Mapped[int] = mapped_column(Integer, index=True)
    image_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    archive_filename: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    job: Mapped[ExportJob] = relationship(back_populates="items")
