import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from threading import Event, Lock
from zipfile import BadZipFile, LargeZipFile, ZipFile, ZipInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.models.import_job import ImportJob, ImportJobItem
from app.repositories.import_job_repository import ImportJobRepository
from app.services.meme_service import DuplicateImageError, MemeService
from app.storage.image_storage import ImageStorage, StoredImage

MAX_ARCHIVE_ENTRIES = 20_000
MAX_TOTAL_UNCOMPRESSED_SIZE = 20 * 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO = 1_000
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ARCHIVE_SUFFIXES = {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"}
ACTIVE_STATUSES = {"queued", "running", "cancelling"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}


class ImportJobNotFoundError(LookupError):
    pass


class ImportJobConflictError(RuntimeError):
    pass


class UnsafeArchiveError(ValueError):
    pass


def utc_now() -> datetime:
    return datetime.now(UTC)


def is_ignored_member(name: str) -> bool:
    normalized = name.replace("\\", "/")
    parts = [part for part in PurePosixPath(normalized).parts if part not in {"", "/"}]
    if any(
        part == "__MACOSX" or (part.startswith(".") and part not in {".", ".."})
        for part in parts
    ):
        return True
    basename = parts[-1].lower() if parts else ""
    return basename in {".ds_store", "thumbs.db"}


def is_safe_member_path(name: str) -> bool:
    if "\x00" in name:
        return False
    normalized = name.replace("\\", "/")
    posix = PurePosixPath(normalized)
    windows = PureWindowsPath(name)
    return (
        not posix.is_absolute()
        and not windows.is_absolute()
        and not windows.drive
        and ".." not in posix.parts
    )


def is_image_candidate(info: ZipInfo) -> bool:
    if info.is_dir() or is_ignored_member(info.filename):
        return False
    suffix = PurePosixPath(info.filename.replace("\\", "/")).suffix.lower()
    return suffix in IMAGE_SUFFIXES and suffix not in ARCHIVE_SUFFIXES


class ImportJobService:
    def __init__(
        self,
        session: Session,
        storage: ImageStorage,
        archives_dir: Path,
    ) -> None:
        self.session = session
        self.storage = storage
        self.archives_dir = archives_dir.resolve()
        self.archives_dir.mkdir(parents=True, exist_ok=True)
        self.repository = ImportJobRepository(session)

    def create_job(
        self,
        *,
        original_filename: str,
        archive_path: Path,
        tags: list[str],
        template_id: int | None,
        source: str | None,
        chunk_size: int,
    ) -> ImportJob:
        job = ImportJob(
            original_filename=Path(original_filename.replace("\\", "/")).name[:255]
            or "archive.zip",
            archive_path=archive_path.name,
            tags_json=json.dumps(tags, ensure_ascii=False),
            template_id=template_id,
            source=source or None,
            chunk_size=chunk_size,
        )
        try:
            self.repository.create(job)
            self.session.commit()
        except Exception:
            self.session.rollback()
            archive_path.unlink(missing_ok=True)
            raise
        return job

    def get_job(self, job_id: int) -> ImportJob:
        job = self.repository.get(job_id)
        if job is None:
            raise ImportJobNotFoundError(f"Import job {job_id} does not exist")
        return job

    def cancel(self, job_id: int) -> ImportJob:
        job = self.get_job(job_id)
        if job.status not in ACTIVE_STATUSES:
            raise ImportJobConflictError("Only an active import job can be cancelled")
        job.status = "cancelling"
        self.session.commit()
        return job

    def retry_failed(self, job_id: int) -> ImportJob:
        job = self.get_job(job_id)
        if job.status not in TERMINAL_STATUSES or job.failed_count < 1:
            raise ImportJobConflictError("This import job has no retryable failed items")
        archive = self._archive_path(job)
        if not archive.is_file():
            raise ImportJobConflictError("The source archive is no longer available")
        job.processed_count -= job.failed_count
        job.failed_count = 0
        job.status = "queued"
        job.current_filename = None
        job.error_message = None
        job.completed_at = None
        self.session.commit()
        return job

    def delete(self, job_id: int) -> None:
        job = self.get_job(job_id)
        if job.status in ACTIVE_STATUSES:
            raise ImportJobConflictError("Cancel the active import job before deleting it")
        archive = self._archive_path(job, required=False)
        self.repository.delete(job)
        self.session.commit()
        if archive is not None:
            archive.unlink(missing_ok=True)

    def run(self, job_id: int, cancel_event: Event | None = None) -> None:
        event = cancel_event or Event()
        job = self.get_job(job_id)
        retry_indexes = None
        if job.processed_count > 0:
            retry_indexes = {
                item.entry_index
                for item in self.session.scalars(
                    select(ImportJobItem).where(
                        ImportJobItem.job_id == job.id,
                        ImportJobItem.status == "failed",
                    )
                )
            }
        archive_path = self._archive_path(job)
        job.status = "running"
        job.started_at = job.started_at or utc_now()
        job.completed_at = None
        self.session.commit()
        try:
            with ZipFile(archive_path, "r", allowZip64=True) as archive:
                infos = archive.infolist()
                candidates = self._validate_archive(infos)
                if retry_indexes is not None:
                    candidates = [pair for pair in candidates if pair[0] in retry_indexes]
                else:
                    job = self.get_job(job_id)
                    job.total_entries = len(infos)
                    job.image_entries = len(candidates)
                    self.session.commit()
                self._process_members(job_id, archive, candidates, event)
        except (BadZipFile, LargeZipFile, UnsafeArchiveError) as error:
            self.session.rollback()
            self._finish_fatal(job_id, str(error))
            archive_path.unlink(missing_ok=True)
            job = self.get_job(job_id)
            job.archive_path = None
            self.session.commit()
            return
        except Exception as error:
            self.session.rollback()
            self._finish_fatal(job_id, f"Import interrupted by an unexpected error: {error}")
            return

        job = self.get_job(job_id)
        job.current_filename = None
        job.completed_at = utc_now()
        if event.is_set() or job.status == "cancelling":
            job.status = "cancelled"
        else:
            job.status = "completed"
        self.session.commit()
        if job.status == "cancelled" or job.failed_count == 0:
            archive_path.unlink(missing_ok=True)
            job.archive_path = None
            self.session.commit()

    def _validate_archive(self, infos: list[ZipInfo]) -> list[tuple[int, ZipInfo]]:
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise UnsafeArchiveError(
                f"Archive has more than {MAX_ARCHIVE_ENTRIES} members"
            )
        total_size = sum(info.file_size for info in infos)
        if total_size > MAX_TOTAL_UNCOMPRESSED_SIZE:
            raise UnsafeArchiveError("Archive exceeds the total uncompressed size limit")
        for info in infos:
            compressed = max(info.compress_size, 1)
            if info.file_size / compressed > MAX_COMPRESSION_RATIO:
                raise UnsafeArchiveError(
                    f"Archive member has an unsafe compression ratio: {info.filename}"
                )
        return [
            (index, info)
            for index, info in enumerate(infos)
            if is_image_candidate(info)
        ]

    def _process_members(
        self,
        job_id: int,
        archive: ZipFile,
        candidates: list[tuple[int, ZipInfo]],
        event: Event,
    ) -> None:
        job = self.get_job(job_id)
        tags = json.loads(job.tags_json)
        chunk_size = job.chunk_size
        for start in range(0, len(candidates), chunk_size):
            batch = candidates[start : start + chunk_size]
            stored_files: list[StoredImage] = []
            attempted: list[tuple[int, ZipInfo]] = []
            for entry_index, info in batch:
                if event.is_set():
                    break
                job = self.get_job(job_id)
                job.current_filename = info.filename
                attempted.append((entry_index, info))
                status = "failed"
                meme_id = None
                error_message = None
                try:
                    if not is_safe_member_path(info.filename):
                        raise UnsafeArchiveError("Unsafe archive member path")
                    if info.flag_bits & 0x1:
                        raise ValueError("Encrypted archive members are not supported")
                    if info.file_size > self.storage.max_file_size:
                        raise ValueError("Image exceeds the per-image size limit")
                    with archive.open(info, "r") as member:
                        content = member.read(self.storage.max_file_size + 1)
                    if len(content) > self.storage.max_file_size:
                        raise ValueError("Image exceeds the per-image size limit")
                    validated = self.storage.validate(content)
                    try:
                        with self.session.begin_nested():
                            meme, stored = MemeService(
                                self.session, self.storage
                            ).create_meme_no_commit(
                                info.filename,
                                validated,
                                title=(PurePosixPath(info.filename).stem or "Meme")[:255],
                                source=job.source,
                                tags=tags,
                                template_id=job.template_id,
                            )
                        stored_files.append(stored)
                        status = "success"
                        meme_id = meme.id
                    except DuplicateImageError:
                        status = "skipped"
                        error_message = "Image already exists"
                except Exception as error:
                    error_message = str(error) or error.__class__.__name__
                self.repository.put_item(
                    job,
                    entry_index=entry_index,
                    filename=info.filename,
                    status=status,
                    meme_id=meme_id,
                    error_message=error_message,
                )
                job.processed_count += 1
                setattr(job, f"{status}_count", getattr(job, f"{status}_count") + 1)
            try:
                self.session.commit()
            except Exception as error:
                self.session.rollback()
                for stored in stored_files:
                    self.storage.delete(stored.file_path, stored.thumbnail_path)
                self._record_batch_failure(job_id, attempted, error)
            if event.is_set():
                break

    def _record_batch_failure(
        self, job_id: int, attempted: list[tuple[int, ZipInfo]], error: Exception
    ) -> None:
        job = self.get_job(job_id)
        message = f"Database batch commit failed: {error}"
        for entry_index, info in attempted:
            self.repository.put_item(
                job,
                entry_index=entry_index,
                filename=info.filename,
                status="failed",
                error_message=message,
            )
        job.processed_count += len(attempted)
        job.failed_count += len(attempted)
        self.session.commit()

    def _finish_fatal(self, job_id: int, message: str) -> None:
        job = self.get_job(job_id)
        job.status = "failed"
        job.error_message = message
        job.current_filename = None
        job.completed_at = utc_now()
        self.session.commit()

    def _archive_path(
        self, job: ImportJob, *, required: bool = True
    ) -> Path | None:
        if not job.archive_path:
            if required:
                raise ImportJobConflictError("The source archive is unavailable")
            return None
        path = (self.archives_dir / Path(job.archive_path).name).resolve()
        path.relative_to(self.archives_dir)
        return path


class ImportJobManager:
    """One-process, one-worker coordinator; durable state remains in SQLite."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        images_dir: Path,
        thumbnails_dir: Path,
        archives_dir: Path,
    ) -> None:
        self.session_factory = session_factory
        self.images_dir = images_dir
        self.thumbnails_dir = thumbnails_dir
        self.archives_dir = archives_dir
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="meme-import")
        self.events: dict[int, Event] = {}
        self.lock = Lock()

    def recover_interrupted(self) -> None:
        self.archives_dir.mkdir(parents=True, exist_ok=True)
        for partial in self.archives_dir.glob("*.part"):
            partial.unlink(missing_ok=True)
        with self.session_factory() as session:
            session.execute(
                update(ImportJob)
                .where(ImportJob.status.in_(["running", "cancelling"]))
                .values(
                    status="interrupted",
                    error_message="Application stopped before the import completed",
                    completed_at=utc_now(),
                    current_filename=None,
                )
            )
            session.commit()

    def submit(self, job_id: int) -> None:
        event = Event()
        with self.lock:
            self.events[job_id] = event
        self.executor.submit(self._run, job_id, event)

    def cancel(self, job_id: int) -> None:
        with self.lock:
            event = self.events.get(job_id)
        if event is not None:
            event.set()

    def shutdown(self) -> None:
        with self.lock:
            for event in self.events.values():
                event.set()
        self.executor.shutdown(wait=True, cancel_futures=False)

    def _run(self, job_id: int, event: Event) -> None:
        try:
            with self.session_factory() as session:
                ImportJobService(
                    session,
                    ImageStorage(self.images_dir, self.thumbnails_dir),
                    self.archives_dir,
                ).run(job_id, event)
        finally:
            with self.lock:
                self.events.pop(job_id, None)
