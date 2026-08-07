from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.embedding_job import EmbeddingJob, EmbeddingJobItem
from app.models.meme import Meme
from app.models.tag import MemeTag


class EmbeddingJobRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, job: EmbeddingJob) -> EmbeddingJob:
        self.session.add(job)
        self.session.flush()
        self.session.refresh(job)
        return job

    def get(self, job_id: int) -> EmbeddingJob | None:
        return self.session.get(EmbeddingJob, job_id)

    def running(self) -> EmbeddingJob | None:
        return self.session.scalar(
            select(EmbeddingJob)
            .where(EmbeddingJob.status.in_(["pending", "running", "cancelling"]))
            .order_by(EmbeddingJob.id.desc())
        )

    def list_items(
        self, job_id: int, *, offset: int = 0, limit: int = 100,
        statuses: Sequence[str] | None = None,
    ) -> tuple[list[EmbeddingJobItem], int]:
        filters = [EmbeddingJobItem.job_id == job_id]
        if statuses:
            filters.append(EmbeddingJobItem.status.in_(statuses))
        total = int(self.session.scalar(
            select(func.count(EmbeddingJobItem.id)).where(*filters)
        ) or 0)
        items = list(self.session.scalars(
            select(EmbeddingJobItem).where(*filters).order_by(EmbeddingJobItem.id)
            .offset(offset).limit(limit)
        ))
        return items, total

    @staticmethod
    def load_meme_statement(meme_id: int):
        return (
            select(Meme)
            .options(
                selectinload(Meme.images),
                selectinload(Meme.tag_links).selectinload(MemeTag.tag),
                selectinload(Meme.template),
            )
            .where(Meme.id == meme_id)
        )
