import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.export_job import ExportJobCreate, ExportJobItemPage, ExportJobItemResponse, ExportJobResponse
from app.services.export_job_service import (
    ExportArchiveGoneError, ExportJobConflictError, ExportJobManager,
    ExportJobNotFoundError, ExportJobService, InsufficientExportSpaceError,
)
from app.storage.image_storage import ImageStorage

router = APIRouter(prefix="/api/export-jobs", tags=["export-jobs"])


def get_export_job_service(request: Request, session: Annotated[Session, Depends(get_db)]) -> ExportJobService:
    return ExportJobService(
        session, ImageStorage(request.app.state.images_dir, request.app.state.thumbnails_dir),
        request.app.state.export_archives_dir,
    )


ServiceDependency = Annotated[ExportJobService, Depends(get_export_job_service)]


def _response(job) -> ExportJobResponse:
    return ExportJobResponse(
        id=job.id, status=job.status, scope=job.scope, query=job.query,
        tags=json.loads(job.tags_json), template_id=job.template_id,
        organization=job.organization, include_manifest=job.include_manifest,
        archive_name=job.archive_name, total_memes=job.total_memes,
        total_images=job.total_images, processed_memes=job.processed_memes,
        processed_images=job.processed_images, success_count=job.success_count,
        skipped_count=job.skipped_count, failed_count=job.failed_count,
        estimated_bytes=job.estimated_bytes, archive_size=job.archive_size,
        current_meme_id=job.current_meme_id, current_filename=job.current_filename,
        error_message=job.error_message, created_at=job.created_at,
        started_at=job.started_at, completed_at=job.completed_at, expires_at=job.expires_at,
    )


@router.post("", response_model=ExportJobResponse, status_code=202)
def create_export_job(payload: ExportJobCreate, request: Request, service: ServiceDependency) -> ExportJobResponse:
    try:
        job = service.create_job(**payload.model_dump())
    except InsufficientExportSpaceError as error:
        raise HTTPException(507, str(error)) from error
    manager: ExportJobManager = request.app.state.export_job_manager
    manager.submit(job.id)
    return _response(job)


@router.get("/{job_id}", response_model=ExportJobResponse)
def get_export_job(job_id: int, service: ServiceDependency) -> ExportJobResponse:
    try: return _response(service.get_job(job_id))
    except ExportJobNotFoundError as error: raise HTTPException(404, str(error)) from error


@router.get("/{job_id}/items", response_model=ExportJobItemPage)
def list_export_items(job_id: int, service: ServiceDependency,
                      offset: Annotated[int, Query(ge=0)] = 0,
                      limit: Annotated[int, Query(ge=1, le=500)] = 100,
                      failed_only: bool = True) -> ExportJobItemPage:
    try: service.get_job(job_id)
    except ExportJobNotFoundError as error: raise HTTPException(404, str(error)) from error
    items, total = service.repository.list_items(job_id, offset=offset, limit=limit, failed_only=failed_only)
    return ExportJobItemPage(
        items=[ExportJobItemResponse.model_validate(item) for item in items],
        total=total, offset=offset, limit=limit,
    )


@router.get("/{job_id}/download")
def download_export(job_id: int, service: ServiceDependency) -> FileResponse:
    try: path, filename = service.download_path(job_id)
    except ExportJobNotFoundError as error: raise HTTPException(404, str(error)) from error
    except ExportJobConflictError as error: raise HTTPException(409, str(error)) from error
    except ExportArchiveGoneError as error: raise HTTPException(410, str(error)) from error
    return FileResponse(path, media_type="application/zip", filename=filename, content_disposition_type="attachment")


@router.post("/{job_id}/cancel", response_model=ExportJobResponse)
def cancel_export(job_id: int, request: Request, service: ServiceDependency) -> ExportJobResponse:
    request.app.state.export_job_manager.cancel(job_id)
    try: return _response(service.cancel(job_id))
    except ExportJobNotFoundError as error: raise HTTPException(404, str(error)) from error
    except ExportJobConflictError as error: raise HTTPException(409, str(error)) from error


@router.delete("/{job_id}", status_code=204)
def delete_export(job_id: int, service: ServiceDependency) -> Response:
    try: service.delete(job_id)
    except ExportJobNotFoundError as error: raise HTTPException(404, str(error)) from error
    except ExportJobConflictError as error: raise HTTPException(409, str(error)) from error
    return Response(status_code=204)
