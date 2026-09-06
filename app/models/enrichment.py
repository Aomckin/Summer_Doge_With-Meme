from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class EnrichmentJob(Base):
    __tablename__ = "enrichment_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 任务候选 Meme 所属仓库；旧任务在迁移中回填为默认 meme Vault。
    vault_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(30), index=True, default="pending")
    scope: Mapped[str] = mapped_column(String(40))
    scope_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope_tags_json: Mapped[str] = mapped_column(Text, default="[]")
    start_meme_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_meme_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_models.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_id_snapshot: Mapped[str] = mapped_column(String(200))
    analyze_title: Mapped[bool] = mapped_column(default=True)
    analyze_description: Mapped[bool] = mapped_column(default=True)
    analyze_tags: Mapped[bool] = mapped_column(default=True)
    analyze_template: Mapped[bool] = mapped_column(default=True)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    processed_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    max_workers: Mapped[int] = mapped_column(Integer, default=2)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["EnrichmentJobItem"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="EnrichmentJobItem.id"
    )


class EnrichmentJobItem(Base):
    __tablename__ = "enrichment_job_items"
    __table_args__ = (UniqueConstraint("job_id", "meme_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("enrichment_jobs.id", ondelete="CASCADE"), index=True
    )
    meme_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(20), index=True, default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    suggestion_id: Mapped[int | None] = mapped_column(
        ForeignKey("meme_enrichment_suggestions.id", ondelete="SET NULL"), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped[EnrichmentJob] = relationship(back_populates="items")


class MemeEnrichmentSuggestion(Base):
    __tablename__ = "meme_enrichment_suggestions"
    __table_args__ = (UniqueConstraint("job_id", "meme_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meme_id: Mapped[int] = mapped_column(
        ForeignKey("memes.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(String(30), index=True)
    provider_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="SET NULL"), nullable=True
    )
    model_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_models.id", ondelete="SET NULL"), nullable=True
    )
    model_id_snapshot: Mapped[str | None] = mapped_column(String(200), nullable=True)
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("enrichment_jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    suggested_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suggested_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("templates.id", ondelete="SET NULL"), nullable=True
    )
    add_tags_json: Mapped[str] = mapped_column(Text, default="[]")
    remove_tags_json: Mapped[str] = mapped_column(Text, default="[]")
    field_confidence_json: Mapped[str] = mapped_column(Text, default="{}")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), index=True, default="pending")
    source_hash: Mapped[str] = mapped_column(String(64), index=True)
    review_source_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    applied_fields_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    meme: Mapped["Meme"] = relationship()


class EnrichmentAudit(Base):
    __tablename__ = "enrichment_audits"

    id: Mapped[int] = mapped_column(primary_key=True)
    suggestion_id: Mapped[int] = mapped_column(
        ForeignKey("meme_enrichment_suggestions.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(String(30))
    fields_json: Mapped[str] = mapped_column(Text, default="[]")
    before_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
