import json
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.import_job import ImportJobItemPage, ImportJobItemResponse, ImportJobResponse
from app.services.import_job_service import (
    ImportJobConflictError,
    ImportJobManager,
    ImportJobNotFoundError,
    ImportJobService,
)
from app.storage.image_storage import ImageStorage

router = APIRouter(prefix="/api/import-jobs", tags=["import-jobs"])
COPY_CHUNK_SIZE = 1024 * 1024
MAX_ARCHIVE_UPLOAD_SIZE = 20 * 1024 * 1024 * 1024


def get_import_job_service(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> ImportJobService:
    return ImportJobService(
        session,
        ImageStorage(request.app.state.images_dir, request.app.state.thumbnails_dir),
        request.app.state.import_archives_dir,
    )


ServiceDependency = Annotated[ImportJobService, Depends(get_import_job_service)]


def _parse_tags(value: str | None) -> list[str]:
    return list(
        dict.fromkeys(tag.strip().lower() for tag in (value or "").split(",") if tag.strip())
    )


def _parse_template_id(value: str | None) -> int | None:
    if not (normalized := (value or "").strip()):
        return None
    try:
        result = int(normalized)
    except ValueError as error:
        raise HTTPException(422, "template_id must be an integer") from error
    if result < 1:
        raise HTTPException(422, "template_id must be positive")
    return result


def _response(job) -> ImportJobResponse:
    return ImportJobResponse(
        id=job.id,
        original_filename=job.original_filename,
        status=job.status,
        total_entries=job.total_entries,
        image_entries=job.image_entries,
        processed_count=job.processed_count,
        success_count=job.success_count,
        skipped_count=job.skipped_count,
        failed_count=job.failed_count,
        chunk_size=job.chunk_size,
        tags=json.loads(job.tags_json),
        template_id=job.template_id,
        source=job.source,
        current_filename=job.current_filename,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def _not_found_or_conflict(error: Exception) -> HTTPException:
    if isinstance(error, ImportJobNotFoundError):
        return HTTPException(404, str(error))
    return HTTPException(409, str(error))


@router.post("", response_model=ImportJobResponse, status_code=202)
async def create_import_job(
    request: Request,
    service: ServiceDependency,
    archive: Annotated[UploadFile, File()],
    tags: Annotated[str | None, Form()] = None,
    template_id: Annotated[str | None, Form()] = None,
    source: Annotated[str | None, Form(max_length=500)] = None,
    chunk_size: Annotated[int, Form(ge=1, le=1000)] = 100,
) -> ImportJobResponse:
    filename = archive.filename or "archive.zip"
    if Path(filename).suffix.lower() != ".zip":
        raise HTTPException(415, "Only ZIP archives are supported")
    target = service.archives_dir / f"{uuid4().hex}.zip"
    partial = target.with_suffix(".part")
    try:
        copied = 0
        with partial.open("xb") as destination:
            while chunk := await archive.read(COPY_CHUNK_SIZE):
                copied += len(chunk)
                if copied > MAX_ARCHIVE_UPLOAD_SIZE:
                    raise HTTPException(413, "ZIP archive exceeds the upload size limit")
                destination.write(chunk)
        partial.replace(target)
        job = service.create_job(
            original_filename=filename,
            archive_path=target,
            tags=_parse_tags(tags),
            template_id=_parse_template_id(template_id),
            source=(source or "").strip() or None,
            chunk_size=chunk_size,
        )
    except HTTPException:
        partial.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise
    except (IntegrityError, ValueError) as error:
        partial.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise HTTPException(422, str(error)) from error
    except Exception:
        partial.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise
    finally:
        await archive.close()
    manager: ImportJobManager = request.app.state.import_job_manager
    manager.submit(job.id)
    return _response(job)


@router.get("/{job_id}", response_model=ImportJobResponse)
def get_import_job(job_id: int, service: ServiceDependency) -> ImportJobResponse:
    try:
        return _response(service.get_job(job_id))
    except ImportJobNotFoundError as error:
        raise _not_found_or_conflict(error) from error


@router.get("/{job_id}/items", response_model=ImportJobItemPage)
def list_import_job_items(
    job_id: int,
    service: ServiceDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    status: Annotated[str | None, Query()] = None,
) -> ImportJobItemPage:
    try:
        service.get_job(job_id)
    except ImportJobNotFoundError as error:
        raise _not_found_or_conflict(error) from error
    statuses = [part.strip() for part in (status or "").split(",") if part.strip()]
    if any(value not in {"success", "skipped", "failed"} for value in statuses):
        raise HTTPException(422, "Invalid item status filter")
    items, total = service.repository.list_items(
        job_id, offset=offset, limit=limit, statuses=statuses or None
    )
    return ImportJobItemPage(
        items=[ImportJobItemResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.post("/{job_id}/cancel", response_model=ImportJobResponse)
def cancel_import_job(
    job_id: int, request: Request, service: ServiceDependency
) -> ImportJobResponse:
    # Signal the in-process worker before waiting for SQLite; it will finish the
    # current member and release the batch transaction as soon as possible.
    request.app.state.import_job_manager.cancel(job_id)
    try:
        job = service.cancel(job_id)
    except (ImportJobNotFoundError, ImportJobConflictError) as error:
        raise _not_found_or_conflict(error) from error
    return _response(job)


@router.post("/{job_id}/retry-failed", response_model=ImportJobResponse, status_code=202)
def retry_failed_import_job(
    job_id: int, request: Request, service: ServiceDependency
) -> ImportJobResponse:
    try:
        job = service.retry_failed(job_id)
    except (ImportJobNotFoundError, ImportJobConflictError) as error:
        raise _not_found_or_conflict(error) from error
    request.app.state.import_job_manager.submit(job_id)
    return _response(job)


@router.delete("/{job_id}", status_code=204)
def delete_import_job(job_id: int, service: ServiceDependency) -> Response:
    try:
        service.delete(job_id)
    except (ImportJobNotFoundError, ImportJobConflictError) as error:
        raise _not_found_or_conflict(error) from error
    return Response(status_code=204)
