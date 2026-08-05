from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.export_job import ExportJob, ExportJobItem


class ExportJobRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, job: ExportJob) -> ExportJob:
        self.session.add(job)
        self.session.flush()
        self.session.refresh(job)
        return job

    def get(self, job_id: int) -> ExportJob | None:
        return self.session.get(ExportJob, job_id)

    def delete(self, job: ExportJob) -> None:
        self.session.delete(job)
        self.session.flush()

    def add_item(self, item: ExportJobItem) -> None:
        self.session.add(item)

    def list_items(
        self, job_id: int, *, offset: int = 0, limit: int = 100, failed_only: bool = False
    ) -> tuple[list[ExportJobItem], int]:
        filters = [ExportJobItem.job_id == job_id]
        if failed_only:
            filters.append(ExportJobItem.status.in_(["failed", "skipped"]))
        total = self.session.scalar(
            select(func.count()).select_from(ExportJobItem).where(*filters)
        ) or 0
        items = list(self.session.scalars(
            select(ExportJobItem).where(*filters).order_by(ExportJobItem.id)
            .offset(offset).limit(limit)
        ))
        return items, total
