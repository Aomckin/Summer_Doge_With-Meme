import json
import shutil
from dataclasses import asdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event, Lock
from zipfile import ZIP_STORED, ZipFile

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.models.export_job import ExportJob, ExportJobItem
from app.models.meme import Meme
from app.repositories.export_job_repository import ExportJobRepository
from app.repositories.meme_repository import MemeRepository
from app.storage.image_storage import ImageStorage
from app.utils.download_names import safe_download_filename, safe_extension, sanitize_stem, unique_archive_name

EXPORT_RETENTION = timedelta(hours=24)
DISK_SAFETY_BYTES = 512 * 1024 * 1024
ACTIVE_STATUSES = {"pending", "running", "cancelling"}
DOWNLOADABLE_STATUSES = {"ready", "completed_with_errors"}


class ExportJobNotFoundError(LookupError): pass
class ExportJobConflictError(RuntimeError): pass
class ExportArchiveGoneError(FileNotFoundError): pass
class InsufficientExportSpaceError(RuntimeError): pass


def utc_now() -> datetime:
    return datetime.now(UTC)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@dataclass(frozen=True)
class ImageSnapshot:
    id: int
    position: int
    original_filename: str
    file_path: str
    mime_type: str
    file_size: int
    file_hash: str


@dataclass(frozen=True)
class MemeSnapshot:
    id: int
    title: str
    description: str | None
    source: str | None
    tags: tuple[str, ...]
    template: str | None
    images: tuple[ImageSnapshot, ...]


class ExportJobService:
    def __init__(self, session: Session, storage: ImageStorage, archives_dir: Path) -> None:
        self.session = session
        self.storage = storage
        self.archives_dir = archives_dir.resolve()
        self.archives_dir.mkdir(parents=True, exist_ok=True)
        self.repository = ExportJobRepository(session)

    def create_job(self, *, scope: str, query: str | None, tags: list[str], template_id: int | None,
                   organization: str, include_manifest: bool, archive_name: str) -> ExportJob:
        self.cleanup_expired()
        snapshots = self._snapshots(scope=scope, query=query, tags=tags, template_id=template_id)
        total_images, estimated = self._estimate(snapshots, organization)
        free = shutil.disk_usage(self.archives_dir).free
        required = estimated + DISK_SAFETY_BYTES
        if free < required:
            raise InsufficientExportSpaceError(
                f"Insufficient disk space: estimated {estimated} bytes plus {DISK_SAFETY_BYTES} bytes safety reserve, {free} bytes available"
            )
        job = ExportJob(
            scope=scope, query=query if scope == "filtered" else None,
            tags_json=json.dumps(tags if scope == "filtered" else [], ensure_ascii=False),
            template_id=template_id if scope == "filtered" else None,
            organization=organization, include_manifest=include_manifest,
            archive_name=sanitize_stem(archive_name, "meme-vault-export", max_length=180),
            snapshot_json=json.dumps([asdict(snapshot) for snapshot in snapshots], ensure_ascii=False),
            total_memes=len(snapshots), total_images=total_images, estimated_bytes=estimated,
        )
        self.repository.create(job)
        self.session.commit()
        return job

    def get_job(self, job_id: int) -> ExportJob:
        self.cleanup_expired()
        job = self.repository.get(job_id)
        if job is None:
            raise ExportJobNotFoundError(f"Export job {job_id} does not exist")
        return job

    def cancel(self, job_id: int) -> ExportJob:
        job = self.get_job(job_id)
        if job.status not in ACTIVE_STATUSES:
            raise ExportJobConflictError("Only an active export can be cancelled")
        job.status = "cancelling"
        self.session.commit()
        return job

    def delete(self, job_id: int) -> None:
        job = self.get_job(job_id)
        if job.status in ACTIVE_STATUSES:
            raise ExportJobConflictError("Cancel the active export before deleting it")
        archive = self._archive_path(job, required=False)
        self.repository.delete(job)
        self.session.commit()
        if archive:
            archive.unlink(missing_ok=True)

    def download_path(self, job_id: int) -> tuple[Path, str]:
        job = self.get_job(job_id)
        if job.status == "expired":
            raise ExportArchiveGoneError("Export archive has expired")
        if job.status not in DOWNLOADABLE_STATUSES:
            raise ExportJobConflictError("Export archive is not ready")
        archive = self._archive_path(job)
        if not archive.is_file():
            raise ExportArchiveGoneError("Export archive is missing")
        return archive, safe_download_filename(job.archive_name, f"export-{job.id}", ".zip", max_stem_length=180)

    def cleanup_expired(self) -> None:
        now = utc_now()
        jobs = list(self.session.scalars(select(ExportJob).where(ExportJob.status.in_(DOWNLOADABLE_STATUSES))))
        changed = False
        for job in jobs:
            if job.expires_at and aware(job.expires_at) <= now:
                archive = self._archive_path(job, required=False)
                if archive: archive.unlink(missing_ok=True)
                job.status = "expired"
                job.archive_path = None
                changed = True
        if changed:
            self.session.commit()

    def run(self, job_id: int, cancel_event: Event | None = None) -> None:
        event = cancel_event or Event()
        job = self.get_job(job_id)
        job.status, job.started_at = "running", utc_now()
        self.session.commit()
        part = self.archives_dir / f"export-{job.id}.part"
        final = self.archives_dir / f"export-{job.id}.zip"
        part.unlink(missing_ok=True)
        final.unlink(missing_ok=True)
        try:
            snapshots = self._load_snapshots(job.snapshot_json)
            self.session.rollback()
            manifest = self._build_archive(job_id, snapshots, part, event)
            if event.is_set():
                part.unlink(missing_ok=True)
                job = self.repository.get(job_id)
                assert job is not None
                job.status, job.completed_at = "cancelled", utc_now()
                job.current_meme_id = job.current_filename = None
                self.session.commit()
                return
            part.replace(final)
            job = self.repository.get(job_id)
            assert job is not None
            job.archive_path = final.name
            job.archive_size = final.stat().st_size
            job.status = "completed_with_errors" if job.failed_count or job.skipped_count else "ready"
            job.completed_at = utc_now()
            job.expires_at = utc_now() + EXPORT_RETENTION
            job.current_meme_id = job.current_filename = None
            self.session.commit()
            _ = manifest
        except Exception as error:
            self.session.rollback()
            part.unlink(missing_ok=True)
            job = self.repository.get(job_id)
            if job is not None:
                job.status, job.error_message, job.completed_at = "failed", str(error), utc_now()
                job.current_meme_id = job.current_filename = None
                self.session.commit()

    def _build_archive(self, job_id: int, snapshots: list[MemeSnapshot], part: Path, event: Event) -> dict:
        job = self.repository.get(job_id)
        assert job is not None
        used: set[str] = set()
        manifest_memes: list[dict] = []
        with ZipFile(part, "w", compression=ZIP_STORED, allowZip64=True) as archive:
            for meme in snapshots:
                if event.is_set(): break
                job = self.repository.get(job_id)
                assert job is not None
                job.current_meme_id = meme.id
                destinations = self._destinations(meme, job.organization)
                manifest_images = []
                for image in meme.images:
                    archive_paths: list[str] = []
                    for base in destinations:
                        if event.is_set(): break
                        arcname = self._arcname(meme, image, base, used)
                        job.current_filename = arcname
                        status, error = "success", None
                        try:
                            source = self.storage.original_path(image.file_path)
                            if not source.is_file(): raise FileNotFoundError("Original image is missing")
                            archive.write(source, arcname, compress_type=ZIP_STORED)
                            archive_paths.append(arcname)
                        except Exception as exc:
                            status, error = "failed", str(exc)
                        self.repository.add_item(ExportJobItem(
                            job_id=job.id, meme_id=meme.id, image_id=image.id, status=status,
                            archive_filename=arcname, file_size=image.file_size, error_message=error,
                        ))
                        job.processed_images += 1
                        setattr(job, f"{status}_count", getattr(job, f"{status}_count") + 1)
                    manifest_images.append({
                        "id": image.id, "position": image.position,
                        "original_filename": image.original_filename, "mime_type": image.mime_type,
                        "file_size": image.file_size, "sha256": image.file_hash,
                        "archive_paths": archive_paths,
                    })
                job.processed_memes += 1
                self.session.commit()
                manifest_memes.append({
                    "id": meme.id, "title": meme.title, "description": meme.description,
                    "source": meme.source, "tags": list(meme.tags), "template": meme.template,
                    "images": manifest_images,
                })
            manifest = {
                "export_version": "0.5.4", "generated_at": utc_now().isoformat(),
                "filters": {"scope": job.scope, "query": job.query, "tags": json.loads(job.tags_json), "template_id": job.template_id},
                "organization": job.organization, "memes": manifest_memes,
            }
            if not event.is_set():
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"), compress_type=ZIP_STORED)
        return manifest

    def _snapshots(self, *, scope: str, query: str | None, tags: list[str], template_id: int | None) -> list[MemeSnapshot]:
        memes = MemeRepository(self.session).list_all_for_export(
            q=query if scope == "filtered" else None,
            tags=tags if scope == "filtered" else None,
            template_id=template_id if scope == "filtered" else None,
        )
        return [self._snapshot(meme) for meme in memes]

    @staticmethod
    def _snapshot(meme: Meme) -> MemeSnapshot:
        return MemeSnapshot(
            id=meme.id, title=meme.title, description=meme.description, source=meme.source,
            tags=tuple(sorted(tag.name for tag in meme.tags)),
            template=meme.template.name if meme.template else None,
            images=tuple(ImageSnapshot(
                id=image.id, position=image.position, original_filename=image.original_filename,
                file_path=image.file_path, mime_type=image.mime_type, file_size=image.file_size,
                file_hash=image.file_hash,
            ) for image in sorted(meme.images, key=lambda item: item.position)),
        )

    @staticmethod
    def _load_snapshots(value: str) -> list[MemeSnapshot]:
        snapshots: list[MemeSnapshot] = []
        for raw in json.loads(value):
            snapshots.append(MemeSnapshot(
                id=int(raw["id"]), title=str(raw["title"]),
                description=raw.get("description"), source=raw.get("source"),
                tags=tuple(str(tag) for tag in raw.get("tags", [])),
                template=raw.get("template"),
                images=tuple(ImageSnapshot(
                    id=int(image["id"]), position=int(image["position"]),
                    original_filename=str(image["original_filename"]),
                    file_path=str(image["file_path"]), mime_type=str(image["mime_type"]),
                    file_size=int(image["file_size"]), file_hash=str(image["file_hash"]),
                ) for image in raw.get("images", [])),
            ))
        return snapshots

    @staticmethod
    def _estimate(snapshots: list[MemeSnapshot], organization: str) -> tuple[int, int]:
        count = size = 0
        for meme in snapshots:
            copies = max(1, len(meme.tags)) if organization == "tag" else 1
            count += len(meme.images) * copies
            size += sum(image.file_size for image in meme.images) * copies
        overhead = max(64 * 1024, count * 512)
        return count, size + overhead

    @staticmethod
    def _destinations(meme: MemeSnapshot, organization: str) -> list[str]:
        if organization == "template":
            return [f"templates/{sanitize_stem(meme.template, '未归类')}"]
        if organization == "tag":
            return [f"tags/{sanitize_stem(tag, '无标签')}" for tag in meme.tags] or ["tags/无标签"]
        return ["images"]

    @staticmethod
    def _arcname(meme: MemeSnapshot, image: ImageSnapshot, base: str, used: set[str]) -> str:
        title = sanitize_stem(meme.title, f"meme-{meme.id}")
        prefix = f"{meme.id:06d}_{title}"
        extension = safe_extension(image.original_filename, image.mime_type)
        if len(meme.images) == 1:
            name = f"{base}/{prefix}{extension}"
        else:
            original = sanitize_stem(Path(image.original_filename).stem, f"image-{image.position + 1}")
            name = f"{base}/{prefix}/{image.position + 1:02d}_{original}{extension}"
        return unique_archive_name(name, used)

    def _archive_path(self, job: ExportJob, *, required: bool = True) -> Path | None:
        if not job.archive_path:
            if required: raise ExportArchiveGoneError("Export archive is unavailable")
            return None
        path = (self.archives_dir / Path(job.archive_path).name).resolve()
        path.relative_to(self.archives_dir)
        return path


class ExportJobManager:
    def __init__(self, session_factory: sessionmaker[Session], images_dir: Path, thumbnails_dir: Path, archives_dir: Path) -> None:
        self.session_factory, self.images_dir, self.thumbnails_dir, self.archives_dir = session_factory, images_dir, thumbnails_dir, archives_dir
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="meme-export")
        self.events: dict[int, Event] = {}
        self.lock = Lock()

    def startup(self) -> None:
        self.archives_dir.mkdir(parents=True, exist_ok=True)
        for part in self.archives_dir.glob("*.part"): part.unlink(missing_ok=True)
        with self.session_factory() as session:
            session.execute(update(ExportJob).where(ExportJob.status.in_(["running", "cancelling"])).values(
                status="interrupted", error_message="Application stopped before export completed",
                completed_at=utc_now(), current_meme_id=None, current_filename=None,
            ))
            session.commit()
            ExportJobService(session, ImageStorage(self.images_dir, self.thumbnails_dir), self.archives_dir).cleanup_expired()

    def submit(self, job_id: int) -> None:
        event = Event()
        with self.lock: self.events[job_id] = event
        self.executor.submit(self._run, job_id, event)

    def cancel(self, job_id: int) -> None:
        with self.lock: event = self.events.get(job_id)
        if event: event.set()

    def shutdown(self) -> None:
        with self.lock:
            for event in self.events.values(): event.set()
        self.executor.shutdown(wait=True, cancel_futures=False)

    def _run(self, job_id: int, event: Event) -> None:
        try:
            with self.session_factory() as session:
                ExportJobService(session, ImageStorage(self.images_dir, self.thumbnails_dir), self.archives_dir).run(job_id, event)
        finally:
            with self.lock: self.events.pop(job_id, None)
