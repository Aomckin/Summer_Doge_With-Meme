from collections.abc import Sequence

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from app.models.enrichment import (
    EnrichmentAudit,
    EnrichmentJob,
    EnrichmentJobItem,
    MemeEnrichmentSuggestion,
)
from app.models.meme import Meme
from app.models.tag import MemeTag


class EnrichmentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    @staticmethod
    def meme_statement(meme_id: int):
        return select(Meme).options(
            selectinload(Meme.images),
            selectinload(Meme.tag_links).selectinload(MemeTag.tag),
            selectinload(Meme.template),
        ).where(Meme.id == meme_id)

    def get_meme(self, meme_id: int) -> Meme | None:
        return self.session.scalar(self.meme_statement(meme_id))

    def create_suggestion(self, suggestion: MemeEnrichmentSuggestion) -> MemeEnrichmentSuggestion:
        self.session.add(suggestion)
        self.session.flush()
        self.session.refresh(suggestion)
        return suggestion

    def get_suggestion(self, suggestion_id: int) -> MemeEnrichmentSuggestion | None:
        return self.session.get(MemeEnrichmentSuggestion, suggestion_id)

    def latest_for_meme(self, meme_id: int) -> MemeEnrichmentSuggestion | None:
        return self.session.scalar(
            select(MemeEnrichmentSuggestion)
            .where(MemeEnrichmentSuggestion.meme_id == meme_id)
            .order_by(MemeEnrichmentSuggestion.id.desc())
        )

    def list_suggestions(
        self, *, offset: int = 0, limit: int = 50, statuses: Sequence[str] | None = None,
        source: str | None = None, latest_only: bool = True,
    ) -> tuple[list[MemeEnrichmentSuggestion], int]:
        filters = []
        if statuses:
            filters.append(MemeEnrichmentSuggestion.status.in_(statuses))
        if source:
            filters.append(MemeEnrichmentSuggestion.source == source)
        if latest_only:
            filters.append(MemeEnrichmentSuggestion.status != "superseded")
        total = int(self.session.scalar(select(func.count()).select_from(MemeEnrichmentSuggestion).where(*filters)) or 0)
        items = list(self.session.scalars(
            select(MemeEnrichmentSuggestion).where(*filters)
            .order_by(MemeEnrichmentSuggestion.id.desc()).offset(offset).limit(limit)
        ))
        return items, total

    def supersede_pending(self, meme_id: int) -> None:
        self.session.execute(update(MemeEnrichmentSuggestion).where(
            MemeEnrichmentSuggestion.meme_id == meme_id,
            MemeEnrichmentSuggestion.status.in_(["pending", "partially_accepted"]),
        ).values(status="superseded"))

    def create_job(self, job: EnrichmentJob) -> EnrichmentJob:
        self.session.add(job)
        self.session.flush()
        self.session.refresh(job)
        return job

    def get_job(self, job_id: int) -> EnrichmentJob | None:
        return self.session.get(EnrichmentJob, job_id)

    def active_job(self) -> EnrichmentJob | None:
        return self.session.scalar(select(EnrichmentJob).where(
            EnrichmentJob.status.in_(["pending", "running", "cancelling"])
        ).order_by(EnrichmentJob.id.desc()))

    def list_job_items(self, job_id: int, *, offset: int, limit: int, statuses: Sequence[str] | None = None) -> tuple[list[EnrichmentJobItem], int]:
        filters = [EnrichmentJobItem.job_id == job_id]
        if statuses:
            filters.append(EnrichmentJobItem.status.in_(statuses))
        total = int(self.session.scalar(select(func.count()).select_from(EnrichmentJobItem).where(*filters)) or 0)
        items = list(self.session.scalars(select(EnrichmentJobItem).where(*filters).order_by(EnrichmentJobItem.id).offset(offset).limit(limit)))
        return items, total

    def audit(self, suggestion_id: int, action: str, fields_json: str, before_json: str | None = None, after_json: str | None = None) -> None:
        self.session.add(EnrichmentAudit(
            suggestion_id=suggestion_id, action=action, fields_json=fields_json,
            before_json=before_json, after_json=after_json,
        ))
