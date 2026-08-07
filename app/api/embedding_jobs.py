from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.ai.client import AIConfigurationError
from app.database import get_db
from app.schemas.embedding_job import (
    EmbeddingJobCreate,
    EmbeddingJobItemPage,
    EmbeddingJobItemResponse,
    EmbeddingJobResponse,
)
from app.services.embedding_job_manager import (
    EmbeddingJobConflictError,
    EmbeddingJobManager,
    EmbeddingJobNotFoundError,
    EmbeddingJobService,
)
from app.storage.image_storage import ImageStorage

router = APIRouter(prefix="/api/embedding-jobs", tags=["embedding-jobs"])


def get_service(
    request: Request, session: Annotated[Session, Depends(get_db)]
) -> EmbeddingJobService:
    return EmbeddingJobService(
        session,
        ImageStorage(request.app.state.images_dir, request.app.state.thumbnails_dir),
        request.app.state.ai_settings_key_file,
    )


ServiceDependency = Annotated[EmbeddingJobService, Depends(get_service)]


def http_error(error: Exception) -> HTTPException:
    if isinstance(error, EmbeddingJobNotFoundError):
        return HTTPException(404, str(error))
    if isinstance(error, AIConfigurationError):
        return HTTPException(503, str(error))
    return HTTPException(409, str(error))


@router.post("", response_model=EmbeddingJobResponse, status_code=202)
def create_job(
    payload: EmbeddingJobCreate, request: Request, service: ServiceDependency
) -> EmbeddingJobResponse:
    try:
        job = service.create_job(**payload.model_dump())
        manager: EmbeddingJobManager = request.app.state.embedding_job_manager
        manager.submit(job.id)
        return EmbeddingJobResponse.model_validate(job)
    except (EmbeddingJobConflictError, AIConfigurationError) as error:
        raise http_error(error) from error


@router.get("/{job_id}", response_model=EmbeddingJobResponse)
def get_job(job_id: int, service: ServiceDependency) -> EmbeddingJobResponse:
    try:
        return EmbeddingJobResponse.model_validate(service.get_job(job_id))
    except EmbeddingJobNotFoundError as error:
        raise http_error(error) from error


@router.get("/{job_id}/items", response_model=EmbeddingJobItemPage)
def list_items(
    job_id: int,
    service: ServiceDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    status: str | None = None,
) -> EmbeddingJobItemPage:
    try:
        service.get_job(job_id)
    except EmbeddingJobNotFoundError as error:
        raise http_error(error) from error
    statuses = [part.strip() for part in (status or "").split(",") if part.strip()]
    if any(value not in {"queued", "running", "success", "skipped", "failed"} for value in statuses):
        raise HTTPException(422, "Invalid item status filter")
    items, total = service.repository.list_items(
        job_id, offset=offset, limit=limit, statuses=statuses or None
    )
    return EmbeddingJobItemPage(
        items=[EmbeddingJobItemResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.post("/{job_id}/cancel", response_model=EmbeddingJobResponse)
def cancel_job(
    job_id: int, request: Request, service: ServiceDependency
) -> EmbeddingJobResponse:
    request.app.state.embedding_job_manager.cancel(job_id)
    try:
        return EmbeddingJobResponse.model_validate(service.cancel(job_id))
    except (EmbeddingJobNotFoundError, EmbeddingJobConflictError) as error:
        raise http_error(error) from error


@router.post("/{job_id}/retry-failed", response_model=EmbeddingJobResponse, status_code=202)
def retry_failed(
    job_id: int, request: Request, service: ServiceDependency
) -> EmbeddingJobResponse:
    try:
        job = service.retry_failed(job_id)
        request.app.state.embedding_job_manager.submit(job_id)
        return EmbeddingJobResponse.model_validate(job)
    except (EmbeddingJobNotFoundError, EmbeddingJobConflictError) as error:
        raise http_error(error) from error


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, service: ServiceDependency) -> Response:
    try:
        service.delete(job_id)
    except (EmbeddingJobNotFoundError, EmbeddingJobConflictError) as error:
        raise http_error(error) from error
    return Response(status_code=204)
