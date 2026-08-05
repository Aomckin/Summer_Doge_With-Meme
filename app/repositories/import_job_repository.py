from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.import_job import ImportJob, ImportJobItem


class ImportJobRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, job: ImportJob) -> ImportJob:
        self.session.add(job)
        self.session.flush()
        self.session.refresh(job)
        return job

    def get(self, job_id: int) -> ImportJob | None:
        return self.session.get(ImportJob, job_id)

    def delete(self, job: ImportJob) -> None:
        self.session.delete(job)
        self.session.flush()

    def list_items(
        self,
        job_id: int,
        *,
        offset: int = 0,
        limit: int = 100,
        statuses: Sequence[str] | None = None,
    ) -> tuple[list[ImportJobItem], int]:
        filters = [ImportJobItem.job_id == job_id]
        if statuses:
            filters.append(ImportJobItem.status.in_(statuses))
        total = self.session.scalar(
            select(func.count()).select_from(ImportJobItem).where(*filters)
        ) or 0
        items = list(
            self.session.scalars(
                select(ImportJobItem)
                .where(*filters)
                .order_by(ImportJobItem.entry_index)
                .offset(offset)
                .limit(limit)
            )
        )
        return items, total

    def get_item(self, job_id: int, entry_index: int) -> ImportJobItem | None:
        return self.session.scalar(
            select(ImportJobItem).where(
                ImportJobItem.job_id == job_id,
                ImportJobItem.entry_index == entry_index,
            )
        )

    def put_item(
        self,
        job: ImportJob,
        *,
        entry_index: int,
        filename: str,
        status: str,
        meme_id: int | None = None,
        error_message: str | None = None,
    ) -> ImportJobItem:
        item = self.get_item(job.id, entry_index)
        if item is None:
            item = ImportJobItem(
                job=job, entry_index=entry_index, filename=filename, status=status
            )
            self.session.add(item)
        item.filename = filename
        item.status = status
        item.meme_id = meme_id
        item.error_message = error_message
        self.session.flush()
        return item
