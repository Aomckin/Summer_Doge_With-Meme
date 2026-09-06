from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
import re
from threading import Event, Lock

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.models.enrichment import EnrichmentJob, EnrichmentJobItem, MemeEnrichmentSuggestion
from app.models.meme import Meme
from app.models.ai_analysis import MemeAIAnalysis
from app.repositories.ai_settings_repository import AISettingsRepository
from app.repositories.enrichment_repository import EnrichmentRepository
from app.repositories.meme_repository import MemeRepository
from app.services.ai_settings_service import AISettingsService
from app.services.meme_enrichment_service import EnrichmentAttempt, MemeEnrichmentService
from app.storage.image_storage import ImageStorage

ACTIVE_STATUSES = {"pending", "running", "cancelling"}
TERMINAL_STATUSES = {"cancelled", "completed", "completed_with_errors", "interrupted", "failed"}


def utc_now() -> datetime:
    return datetime.now(UTC)


class EnrichmentJobNotFoundError(LookupError):
    pass


class EnrichmentJobConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class WorkResult:
    item_id: int
    attempt: EnrichmentAttempt


class EnrichmentJobService:
    def __init__(self, session: Session, storage: ImageStorage, key_file: Path) -> None:
        self.session = session
        self.storage = storage
        self.key_file = key_file
        self.repository = EnrichmentRepository(session)

    def create_job(self, *, vault_id: int, scope: str, query: str | None, tags: list[str], analyze_title: bool,
                   analyze_description: bool, analyze_tags: bool, analyze_template: bool,
                   max_workers: int, start_meme_id: int | None = None,
                   end_meme_id: int | None = None) -> EnrichmentJob:
        if self.repository.active_job() is not None:
            raise EnrichmentJobConflictError("An enrichment job is already active")
        settings = AISettingsService(self.session, self.key_file)
        client = settings.build_active_client()
        del client
        model = settings.repository.active_model()
        if model is None:
            raise EnrichmentJobConflictError("Image analysis model is not configured")
        selected = self.select_memes(
            vault_id=vault_id, scope=scope, query=query, tags=tags,
            start_meme_id=start_meme_id, end_meme_id=end_meme_id,
        )
        job = EnrichmentJob(
            status="pending", vault_id=vault_id, scope=scope, scope_query=query,
            scope_tags_json=json.dumps(tags, ensure_ascii=False),
            start_meme_id=start_meme_id, end_meme_id=end_meme_id,
            provider_id=model.provider_id, model_record_id=model.id,
            model_id_snapshot=model.model_id,
            analyze_title=analyze_title, analyze_description=analyze_description,
            analyze_tags=analyze_tags, analyze_template=analyze_template,
            max_workers=max_workers, total_count=len(selected),
        )
        self.repository.create_job(job)
        for meme in selected:
            job.items.append(EnrichmentJobItem(meme_id=meme.id, status="queued"))
        self.session.commit()
        return job

    def estimate(self, *, vault_id: int, scope: str, query: str | None, tags: list[str],
                 start_meme_id: int | None = None, end_meme_id: int | None = None) -> int:
        return len(self.select_memes(
            vault_id=vault_id, scope=scope, query=query, tags=tags,
            start_meme_id=start_meme_id, end_meme_id=end_meme_id,
        ))

    def select_memes(self, *, vault_id: int, scope: str, query: str | None, tags: list[str],
                     start_meme_id: int | None = None,
                     end_meme_id: int | None = None) -> list[Meme]:
        memes = MemeRepository(self.session).list_all_for_export(
            vault_id=vault_id,
            q=query if scope == "filtered" else None,
            tags=tags if scope == "filtered" else None,
        )
        if scope == "id_range":
            if start_meme_id is None or end_meme_id is None:
                raise ValueError("Meme ID range requires both a start and end ID")
            if start_meme_id > end_meme_id:
                raise ValueError("Start Meme ID must be less than or equal to end Meme ID")
            return [meme for meme in memes if start_meme_id <= meme.id <= end_meme_id]
        return [meme for meme in memes if self._matches_scope(meme, scope)]

    def _matches_scope(self, meme: Meme, scope: str) -> bool:
        if scope in {"all", "filtered"}:
            return True
        if scope == "missing_description":
            return not (meme.description or "").strip()
        if scope == "missing_tags":
            return not meme.tag_links
        if scope == "missing_template":
            return meme.template_id is None
        if scope == "filename_title":
            title = meme.title.strip()
            return bool(
                title == meme.original_filename
                or re.match(r"^(IMG[_-]?\d+|Screenshot[_ -]?\d*|微信图片[_-]?\d+|\d+)$", title, re.I)
                or re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", title, re.I)
            )
        suggestion = self.session.scalar(select(MemeEnrichmentSuggestion).where(
            MemeEnrichmentSuggestion.meme_id == meme.id
        ).order_by(MemeEnrichmentSuggestion.id.desc()))
        if scope == "never_analyzed":
            legacy = self.session.scalar(select(MemeAIAnalysis.id).where(
                MemeAIAnalysis.meme_id == meme.id
            ).limit(1))
            return suggestion is None and legacy is None
        if scope == "stale_suggestions":
            return suggestion is not None and (
                suggestion.status == "stale"
                or MemeEnrichmentService.source_hash(meme) != suggestion.source_hash
            )
        return False

    def get_job(self, job_id: int) -> EnrichmentJob:
        job = self.repository.get_job(job_id)
        if job is None:
            raise EnrichmentJobNotFoundError(f"Enrichment job {job_id} does not exist")
        return job

    def cancel(self, job_id: int) -> EnrichmentJob:
        job = self.get_job(job_id)
        if job.status not in ACTIVE_STATUSES:
            raise EnrichmentJobConflictError("Only an active enrichment job can be cancelled")
        job.status = "cancelling"
        self.session.commit()
        return job

    def retry_failed(self, job_id: int) -> EnrichmentJob:
        job = self.get_job(job_id)
        if job.status not in TERMINAL_STATUSES:
            raise EnrichmentJobConflictError("Active jobs cannot be retried")
        failed = [item for item in job.items if item.status == "failed"]
        if not failed:
            raise EnrichmentJobConflictError("This job has no failed items")
        job.processed_count -= len(failed)
        job.failed_count -= len(failed)
        for item in failed:
            item.status = "queued"
            item.error_message = None
            item.response_summary = None
            item.started_at = item.completed_at = None
        job.status = "pending"
        job.completed_at = None
        job.error_message = None
        self.session.commit()
        return job

    def delete(self, job_id: int) -> None:
        job = self.get_job(job_id)
        if job.status in ACTIVE_STATUSES:
            raise EnrichmentJobConflictError("Cancel the active job before deleting it")
        self.session.delete(job)
        self.session.commit()


class EnrichmentJobManager:
    """One coordinator owns SQLite writes; workers only read and call the Provider."""

    def __init__(self, session_factory: sessionmaker[Session], images_dir: Path,
                 thumbnails_dir: Path, key_file: Path) -> None:
        self.session_factory = session_factory
        self.images_dir = images_dir
        self.thumbnails_dir = thumbnails_dir
        self.key_file = key_file
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="enrichment-coordinator")
        self.events: dict[int, Event] = {}
        self.lock = Lock()
        self.accepting = True

    def startup(self) -> None:
        with self.session_factory() as session:
            session.execute(update(EnrichmentJob).where(
                EnrichmentJob.status.in_(["running", "cancelling"])
            ).values(status="interrupted", error_message="Application stopped before enrichment completed", completed_at=utc_now()))
            session.execute(update(EnrichmentJobItem).where(
                EnrichmentJobItem.status == "running"
            ).values(status="queued", started_at=None))
            session.commit()

    def submit(self, job_id: int) -> None:
        with self.lock:
            if not self.accepting:
                raise EnrichmentJobConflictError("Application is shutting down")
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
                repository = EnrichmentRepository(session)
                job = repository.get_job(job_id)
                if job is None:
                    return
                job.status = "running"
                job.started_at = job.started_at or utc_now()
                session.commit()
                client = AISettingsService(session, self.key_file).build_active_client()
                active = AISettingsRepository(session).active_model()
                if active is None:
                    raise EnrichmentJobConflictError("Image analysis model is not configured")
                configuration_signature = self._configuration_signature(active)
                queued_ids = list(session.scalars(select(EnrichmentJobItem.id).where(
                    EnrichmentJobItem.job_id == job_id, EnrichmentJobItem.status == "queued"
                ).order_by(EnrichmentJobItem.id)))
                with ThreadPoolExecutor(max_workers=job.max_workers, thread_name_prefix="enrichment-api") as workers:
                    pending: dict[Future[WorkResult], int] = {}
                    cursor = 0
                    while cursor < len(queued_ids) or pending:
                        while cursor < len(queued_ids) and len(pending) < job.max_workers and not cancel_event.is_set():
                            session.expire_all()
                            current = AISettingsRepository(session).active_model()
                            if current is None or self._configuration_signature(current) != configuration_signature:
                                job.status = "interrupted"
                                job.error_message = "Image analysis model or provider configuration changed"
                                cancel_event.set()
                                break
                            item_id = queued_ids[cursor]
                            cursor += 1
                            item = session.get(EnrichmentJobItem, item_id)
                            assert item is not None
                            item.status = "running"
                            item.attempt_count += 1
                            item.started_at = utc_now()
                            session.commit()
                            pending[workers.submit(
                                self._work, item_id, item.meme_id, job.id,
                                job.provider_id, job.model_record_id, job.model_id_snapshot,
                                job.analyze_title, job.analyze_description,
                                job.analyze_tags, job.analyze_template, client,
                            )] = item_id
                        if not pending:
                            break
                        done, _ = wait(pending, return_when=FIRST_COMPLETED)
                        for future in done:
                            item_id = pending.pop(future)
                            try:
                                result = future.result()
                            except Exception as error:
                                result = WorkResult(item_id, EnrichmentAttempt(error=error))
                            self._write_result(session, job_id, result)
                job = repository.get_job(job_id)
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
                job = session.get(EnrichmentJob, job_id)
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
            getattr(model, "id"), getattr(model, "model_id"), getattr(model, "enabled"),
            getattr(model, "supports_vision"), getattr(model, "is_active"),
            getattr(provider, "id"), getattr(provider, "enabled"), getattr(provider, "protocol"),
            getattr(provider, "base_url"), getattr(provider, "api_key_ciphertext"),
            getattr(provider, "timeout_seconds"), getattr(provider, "max_retries"),
            getattr(provider, "retry_delay_seconds"),
        )

    def _work(self, item_id: int, meme_id: int, job_id: int,
              provider_id: int | None, model_record_id: int | None,
              model_id_snapshot: str, analyze_title: bool,
              analyze_description: bool, analyze_tags: bool,
              analyze_template: bool, client: object) -> WorkResult:
        with self.session_factory() as session:
            attempt = MemeEnrichmentService(
                session, ImageStorage(self.images_dir, self.thumbnails_dir)
            ).analyze(
                meme_id, client, provider_id=provider_id,
                model_record_id=model_record_id, model_id_snapshot=model_id_snapshot,
                job_id=job_id, analyze_title=analyze_title,
                analyze_description=analyze_description, analyze_tags=analyze_tags,
                analyze_template=analyze_template, commit=False,
            )
            session.rollback()
        return WorkResult(item_id, attempt)

    def _write_result(self, session: Session, job_id: int, result: WorkResult) -> None:
        item = session.get(EnrichmentJobItem, result.item_id)
        job = session.get(EnrichmentJob, job_id)
        if item is None or job is None:
            return
        item.completed_at = utc_now()
        job.processed_count += 1
        item.input_tokens += result.attempt.input_tokens
        item.output_tokens += result.attempt.output_tokens
        item.total_tokens += result.attempt.total_tokens
        item.response_summary = result.attempt.response_summary
        job.input_tokens += result.attempt.input_tokens
        job.output_tokens += result.attempt.output_tokens
        job.total_tokens += result.attempt.total_tokens
        if session.get(Meme, item.meme_id) is None:
            item.status = "skipped"
            item.error_message = "Meme was deleted"
            job.skipped_count += 1
        elif result.attempt.error is not None or result.attempt.candidate is None:
            item.status = "failed"
            item.error_message = str(result.attempt.error or "Analysis failed")[:4000]
            job.failed_count += 1
        else:
            suggestion = MemeEnrichmentService(
                session, ImageStorage(self.images_dir, self.thumbnails_dir)
            ).create_suggestion(
                result.attempt.candidate, source="provider", provider_id=job.provider_id,
                model_record_id=job.model_record_id,
                model_id_snapshot=result.attempt.model_name or job.model_id_snapshot,
                job_id=job.id, commit=False,
            )
            item.status = "success"
            item.suggestion_id = suggestion.id
            job.success_count += 1
        session.commit()
