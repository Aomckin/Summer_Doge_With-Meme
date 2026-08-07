from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Event, Lock

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.ai.embedding_client import MultimodalEmbeddingClient
from app.models.embedding_job import EmbeddingJob, EmbeddingJobItem
from app.models.meme import Meme
from app.repositories.ai_settings_repository import AISettingsRepository
from app.repositories.embedding_job_repository import EmbeddingJobRepository
from app.repositories.meme_embedding_repository import MemeEmbeddingRepository
from app.services.ai_settings_service import AISettingsService
from app.services.embedding_config import EMBEDDING_DIMENSION
from app.services.meme_embedding_content import MemeEmbeddingContentBuilder
from app.services.meme_embedding_service import MemeEmbeddingAttempt, MemeEmbeddingService
from app.storage.image_storage import ImageStorage

ACTIVE_STATUSES = {"pending", "running", "cancelling"}
TERMINAL_STATUSES = {
    "cancelled", "completed", "completed_with_errors", "interrupted", "failed"
}


def utc_now() -> datetime:
    return datetime.now(UTC)


class EmbeddingJobNotFoundError(LookupError):
    pass


class EmbeddingJobConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class WorkResult:
    item_id: int
    attempt: MemeEmbeddingAttempt


class EmbeddingJobService:
    def __init__(
        self,
        session: Session,
        storage: ImageStorage,
        key_file: Path,
    ) -> None:
        self.session = session
        self.storage = storage
        self.key_file = key_file
        self.repository = EmbeddingJobRepository(session)

    def create_job(self, *, scope: str, max_workers: int) -> EmbeddingJob:
        if self.repository.running() is not None:
            raise EmbeddingJobConflictError("An embedding job is already active")
        model = AISettingsService(
            self.session, self.key_file
        ).repository.active_embedding_model()
        if model is None:
            raise EmbeddingJobConflictError("Semantic embedding model is not configured")
        # Validate the complete provider contract before creating durable work.
        AISettingsService(
            self.session, self.key_file
        ).build_active_multimodal_embedding_client()
        statement = select(Meme).order_by(Meme.id)
        memes = list(self.session.scalars(statement))
        selected: list[Meme] = []
        embeddings = MemeEmbeddingRepository(self.session)
        for meme in memes:
            embedding = embeddings.get_for_meme(meme.id)
            if scope == "all":
                selected.append(meme)
            elif scope == "failed" and embedding is not None and embedding.status == "failed":
                selected.append(meme)
            elif scope == "missing_or_stale" and (
                embedding is None or embedding.status == "stale"
            ):
                selected.append(meme)
        job = EmbeddingJob(
            status="pending",
            scope=scope,
            model_record_id=model.id,
            model_id_snapshot=model.model_id,
            dimension=EMBEDDING_DIMENSION,
            max_workers=max_workers,
            total_count=len(selected),
        )
        self.repository.create(job)
        builder = MemeEmbeddingContentBuilder(self.storage)
        for meme in selected:
            loaded = self.session.scalar(EmbeddingJobRepository.load_meme_statement(meme.id))
            assert loaded is not None
            content = builder.build(
                loaded,
                model_record_id=model.id,
                model_id_snapshot=model.model_id,
                include_image_data=False,
            )
            job.items.append(
                EmbeddingJobItem(
                    meme_id=meme.id,
                    source_hash=content.source_hash,
                    status="queued",
                )
            )
        self.session.commit()
        return job

    def get_job(self, job_id: int) -> EmbeddingJob:
        job = self.repository.get(job_id)
        if job is None:
            raise EmbeddingJobNotFoundError(f"Embedding job {job_id} does not exist")
        return job

    def cancel(self, job_id: int) -> EmbeddingJob:
        job = self.get_job(job_id)
        if job.status not in ACTIVE_STATUSES:
            raise EmbeddingJobConflictError("Only an active embedding job can be cancelled")
        job.status = "cancelling"
        self.session.commit()
        return job

    def retry_failed(self, job_id: int) -> EmbeddingJob:
        job = self.get_job(job_id)
        if job.status not in TERMINAL_STATUSES:
            raise EmbeddingJobConflictError("Active jobs cannot be retried")
        failed = [item for item in job.items if item.status == "failed"]
        if not failed:
            raise EmbeddingJobConflictError("This job has no failed items")
        job.processed_count -= len(failed)
        job.failed_count -= len(failed)
        builder = MemeEmbeddingContentBuilder(self.storage)
        for item in failed:
            meme = self.session.scalar(EmbeddingJobRepository.load_meme_statement(item.meme_id))
            if meme is not None:
                item.source_hash = builder.build(
                    meme,
                    model_record_id=job.model_record_id,
                    model_id_snapshot=job.model_id_snapshot,
                    include_image_data=False,
                ).source_hash
            item.status = "queued"
            item.error_message = None
            item.started_at = None
            item.completed_at = None
        job.status = "pending"
        job.error_message = None
        job.completed_at = None
        self.session.commit()
        return job

    def delete(self, job_id: int) -> None:
        job = self.get_job(job_id)
        if job.status in ACTIVE_STATUSES:
            raise EmbeddingJobConflictError("Cancel the active job before deleting it")
        self.session.delete(job)
        self.session.commit()


class EmbeddingJobManager:
    """One coordinator thread, bounded external workers, one SQLite writer."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        images_dir: Path,
        thumbnails_dir: Path,
        key_file: Path,
    ) -> None:
        self.session_factory = session_factory
        self.images_dir = images_dir
        self.thumbnails_dir = thumbnails_dir
        self.key_file = key_file
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embedding-coordinator")
        self.events: dict[int, Event] = {}
        self.lock = Lock()
        self.accepting = True

    def startup(self) -> None:
        with self.session_factory() as session:
            session.execute(
                update(EmbeddingJob)
                .where(EmbeddingJob.status.in_(["running", "cancelling"]))
                .values(
                    status="interrupted",
                    error_message="Application stopped before semantic indexing completed",
                    completed_at=utc_now(),
                )
            )
            session.execute(
                update(EmbeddingJobItem)
                .where(EmbeddingJobItem.status == "running")
                .values(status="queued", started_at=None)
            )
            session.commit()

    def submit(self, job_id: int) -> None:
        with self.lock:
            if not self.accepting:
                raise EmbeddingJobConflictError("Application is shutting down")
            event = Event()
            self.events[job_id] = event
        self.executor.submit(self._run, job_id, event)

    def cancel(self, job_id: int) -> None:
        with self.lock:
            event = self.events.get(job_id)
        if event is not None:
            event.set()

    def shutdown(self) -> None:
        with self.lock:
            self.accepting = False
            for event in self.events.values():
                event.set()
        self.executor.shutdown(wait=True, cancel_futures=False)

    def _run(self, job_id: int, cancel_event: Event) -> None:
        try:
            with self.session_factory() as session:
                repository = EmbeddingJobRepository(session)
                job = repository.get(job_id)
                if job is None:
                    return
                job.status = "running"
                job.started_at = job.started_at or utc_now()
                job.completed_at = None
                session.commit()
                try:
                    client = AISettingsService(
                        session, self.key_file
                    ).build_active_multimodal_embedding_client()
                    active_at_start = AISettingsRepository(session).active_embedding_model()
                    assert active_at_start is not None
                    configuration_signature = self._configuration_signature(active_at_start)
                except Exception as error:
                    job.status = "failed"
                    job.error_message = str(error)
                    job.completed_at = utc_now()
                    session.commit()
                    return
                queued_ids = list(
                    session.scalars(
                        select(EmbeddingJobItem.id)
                        .where(
                            EmbeddingJobItem.job_id == job_id,
                            EmbeddingJobItem.status == "queued",
                        )
                        .order_by(EmbeddingJobItem.id)
                    )
                )
                with ThreadPoolExecutor(
                    max_workers=job.max_workers, thread_name_prefix="embedding-api"
                ) as workers:
                    pending: dict[Future[WorkResult], int] = {}
                    cursor = 0
                    while cursor < len(queued_ids) or pending:
                        while (
                            cursor < len(queued_ids)
                            and len(pending) < job.max_workers
                            and not cancel_event.is_set()
                        ):
                            session.expire_all()
                            current = AISettingsRepository(session).active_embedding_model()
                            if (
                                current is None
                                or current.id != job.model_record_id
                                or current.model_id != job.model_id_snapshot
                                or self._configuration_signature(current) != configuration_signature
                            ):
                                job.status = "interrupted"
                                job.error_message = "Embedding model or provider configuration changed"
                                cancel_event.set()
                                break
                            item_id = queued_ids[cursor]
                            cursor += 1
                            item = session.get(EmbeddingJobItem, item_id)
                            assert item is not None
                            item.status = "running"
                            item.attempt_count += 1
                            item.started_at = utc_now()
                            session.commit()
                            future = workers.submit(
                                self._work,
                                item_id,
                                item.meme_id,
                                item.source_hash,
                                job.model_record_id,
                                job.model_id_snapshot,
                                client,
                            )
                            pending[future] = item_id
                        if not pending:
                            break
                        done, _ = wait(pending, return_when=FIRST_COMPLETED)
                        for future in done:
                            failed_item_id = pending.pop(future)
                            try:
                                result = future.result()
                            except Exception as error:
                                item = session.get(EmbeddingJobItem, failed_item_id)
                                result = WorkResult(
                                    item_id=failed_item_id,
                                    attempt=MemeEmbeddingAttempt(
                                        item.meme_id if item is not None else 0,
                                        error=error,
                                    ),
                                )
                            self._write_result(session, job_id, result)
                    job = repository.get(job_id)
                    assert job is not None
                    if job.status == "interrupted":
                        pass
                    elif cancel_event.is_set() or job.status == "cancelling":
                        job.status = "cancelled"
                    elif job.failed_count:
                        job.status = "completed_with_errors"
                    else:
                        job.status = "completed"
                    job.completed_at = utc_now()
                    session.commit()
        except Exception as error:
            with self.session_factory() as session:
                job = session.get(EmbeddingJob, job_id)
                if job is not None:
                    job.status = "failed"
                    job.error_message = str(error)[:4000]
                    job.completed_at = utc_now()
                    session.commit()
        finally:
            with self.lock:
                self.events.pop(job_id, None)

    @staticmethod
    def _configuration_signature(model: object) -> tuple[object, ...]:
        provider = getattr(model, "provider")
        return (
            getattr(model, "id"),
            getattr(model, "model_id"),
            getattr(model, "enabled"),
            getattr(model, "supports_image_embedding"),
            getattr(model, "is_embedding_active"),
            getattr(provider, "id"),
            getattr(provider, "enabled"),
            getattr(provider, "protocol"),
            getattr(provider, "base_url"),
            getattr(provider, "api_key_ciphertext"),
            getattr(provider, "timeout_seconds"),
            getattr(provider, "max_retries"),
            getattr(provider, "retry_delay_seconds"),
        )

    def _work(
        self,
        item_id: int,
        meme_id: int,
        expected_hash: str,
        model_record_id: int,
        model_id: str,
        client: MultimodalEmbeddingClient,
    ) -> WorkResult:
        with self.session_factory() as session:
            attempt = MemeEmbeddingService(
                ImageStorage(self.images_dir, self.thumbnails_dir)
            ).generate(
                session,
                client,
                meme_id=meme_id,
                model_record_id=model_record_id,
                model_id=model_id,
                expected_source_hash=expected_hash,
            )
        return WorkResult(item_id, attempt)

    def _write_result(self, session: Session, job_id: int, result: WorkResult) -> None:
        item = session.get(EmbeddingJobItem, result.item_id)
        job = session.get(EmbeddingJob, job_id)
        if item is None or job is None:
            return
        attempt = result.attempt
        item.completed_at = utc_now()
        job.processed_count += 1
        if session.get(Meme, item.meme_id) is None:
            item.status = "skipped"
            item.error_message = "Meme was deleted"
            job.skipped_count += 1
            session.commit()
            return
        if attempt.skipped:
            item.status = "skipped"
            item.error_message = attempt.error_message
            job.skipped_count += 1
            session.commit()
            return
        embedding_service = MemeEmbeddingService(
            ImageStorage(self.images_dir, self.thumbnails_dir)
        )
        embedding_service.persist(
            session,
            attempt,
            model_record_id=job.model_record_id,
            model_id=job.model_id_snapshot,
            source_hash=item.source_hash,
        )
        if attempt.error is not None or attempt.embedding is None:
            item.status = "failed"
            item.error_message = attempt.error_message or "Embedding request failed"
            job.failed_count += 1
            session.commit()
            return
        embedding = attempt.embedding
        item.status = "success"
        item.text_tokens = embedding.input_tokens
        item.image_tokens = embedding.image_tokens
        item.total_tokens = embedding.total_tokens
        item.error_message = None
        job.success_count += 1
        job.text_tokens += embedding.input_tokens
        job.image_tokens += embedding.image_tokens
        job.total_tokens += embedding.total_tokens
        session.commit()
