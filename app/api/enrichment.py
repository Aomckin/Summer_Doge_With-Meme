from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.ai.client import AIConfigurationError, AIInvalidResponseError, AIRequestTimeoutError, AIUpstreamError
from app.database import get_db
from app.models.enrichment import MemeEnrichmentSuggestion
from app.schemas.enrichment import (
    EnrichmentApplyRequest,
    EnrichmentJobCreate,
    EnrichmentJobItemPage,
    EnrichmentJobItemResponse,
    EnrichmentJobEstimate,
    EnrichmentJobResponse,
    EnrichmentSuggestionPage,
    EnrichmentSuggestionResponse,
)
from app.services.ai_settings_service import AISettingsService
from app.services.enrichment_job_manager import (
    EnrichmentJobConflictError,
    EnrichmentJobManager,
    EnrichmentJobNotFoundError,
    EnrichmentJobService,
)
from app.services.meme_enrichment_service import (
    EnrichmentConflictError,
    EnrichmentNotFoundError,
    MemeEnrichmentService,
)
from app.storage.image_storage import ImageStorage

router = APIRouter(tags=["enrichment"])


def enrichment_service(request: Request, session: Annotated[Session, Depends(get_db)]) -> MemeEnrichmentService:
    return MemeEnrichmentService(
        session, ImageStorage(request.app.state.images_dir, request.app.state.thumbnails_dir)
    )


def job_service(request: Request, session: Annotated[Session, Depends(get_db)]) -> EnrichmentJobService:
    return EnrichmentJobService(
        session,
        ImageStorage(request.app.state.images_dir, request.app.state.thumbnails_dir),
        request.app.state.ai_settings_key_file,
    )


EnrichmentServiceDependency = Annotated[MemeEnrichmentService, Depends(enrichment_service)]
JobServiceDependency = Annotated[EnrichmentJobService, Depends(job_service)]


def suggestion_response(service: MemeEnrichmentService, item: MemeEnrichmentSuggestion) -> EnrichmentSuggestionResponse:
    return EnrichmentSuggestionResponse(
        id=item.id, meme_id=item.meme_id, source=item.source,
        provider_id=item.provider_id, model_record_id=item.model_record_id,
        model_id_snapshot=item.model_id_snapshot, job_id=item.job_id,
        suggested_title=item.suggested_title,
        suggested_description=item.suggested_description,
        suggested_template_id=item.suggested_template_id,
        add_tags=service.add_tags(item), remove_tags=service.remove_tags(item),
        confidence=service.confidence(item), reason=item.reason, status=item.status,
        source_hash=item.source_hash,
        stale=item.status == "stale" or (
            item.status in {"pending", "partially_accepted", "accepted"}
            and service.is_stale(item)
        ),
        applied_fields=service.applied_fields(item), created_at=item.created_at,
        reviewed_at=item.reviewed_at, applied_at=item.applied_at,
    )


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, (EnrichmentNotFoundError, EnrichmentJobNotFoundError)):
        return HTTPException(404, str(error))
    if isinstance(error, AIConfigurationError):
        return HTTPException(503, str(error))
    if isinstance(error, AIRequestTimeoutError):
        return HTTPException(504, str(error))
    if isinstance(error, (AIUpstreamError, AIInvalidResponseError)):
        return HTTPException(502, str(error))
    if isinstance(error, ValueError):
        return HTTPException(422, str(error))
    return HTTPException(409, str(error))


@router.post("/api/enrichment-jobs", response_model=EnrichmentJobResponse, status_code=202)
def create_job(payload: EnrichmentJobCreate, request: Request, service: JobServiceDependency) -> EnrichmentJobResponse:
    try:
        job = service.create_job(**payload.model_dump())
        manager: EnrichmentJobManager = request.app.state.enrichment_job_manager
        manager.submit(job.id)
        return EnrichmentJobResponse.model_validate(job)
    except (EnrichmentJobConflictError, AIConfigurationError) as error:
        raise _http_error(error) from error


@router.post("/api/enrichment-jobs/estimate", response_model=EnrichmentJobEstimate)
def estimate_job(payload: EnrichmentJobCreate, service: JobServiceDependency) -> EnrichmentJobEstimate:
    count = service.estimate(
        vault_id=payload.vault_id,
        scope=payload.scope, query=payload.query, tags=payload.tags,
        start_meme_id=payload.start_meme_id, end_meme_id=payload.end_meme_id,
    )
    return EnrichmentJobEstimate(total_count=count, estimated_requests=count)


@router.get("/api/enrichment-jobs/{job_id}", response_model=EnrichmentJobResponse)
def get_job(job_id: int, service: JobServiceDependency) -> EnrichmentJobResponse:
    try:
        return EnrichmentJobResponse.model_validate(service.get_job(job_id))
    except EnrichmentJobNotFoundError as error:
        raise _http_error(error) from error


@router.get("/api/enrichment-jobs/{job_id}/items", response_model=EnrichmentJobItemPage)
def list_job_items(job_id: int, service: JobServiceDependency, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), status: list[str] | None = Query(None)) -> EnrichmentJobItemPage:
    try:
        service.get_job(job_id)
        items, total = service.repository.list_job_items(job_id, offset=offset, limit=limit, statuses=status)
        return EnrichmentJobItemPage(items=[EnrichmentJobItemResponse.model_validate(item) for item in items], total=total, offset=offset, limit=limit)
    except EnrichmentJobNotFoundError as error:
        raise _http_error(error) from error


@router.post("/api/enrichment-jobs/{job_id}/cancel", response_model=EnrichmentJobResponse)
def cancel_job(job_id: int, request: Request, service: JobServiceDependency) -> EnrichmentJobResponse:
    try:
        job = service.cancel(job_id)
        request.app.state.enrichment_job_manager.cancel(job_id)
        return EnrichmentJobResponse.model_validate(job)
    except (EnrichmentJobNotFoundError, EnrichmentJobConflictError) as error:
        raise _http_error(error) from error


@router.post("/api/enrichment-jobs/{job_id}/retry-failed", response_model=EnrichmentJobResponse, status_code=202)
def retry_job(job_id: int, request: Request, service: JobServiceDependency) -> EnrichmentJobResponse:
    try:
        job = service.retry_failed(job_id)
        request.app.state.enrichment_job_manager.submit(job_id)
        return EnrichmentJobResponse.model_validate(job)
    except (EnrichmentJobNotFoundError, EnrichmentJobConflictError) as error:
        raise _http_error(error) from error


@router.delete("/api/enrichment-jobs/{job_id}", status_code=204)
def delete_job(job_id: int, service: JobServiceDependency) -> Response:
    try:
        service.delete(job_id)
        return Response(status_code=204)
    except (EnrichmentJobNotFoundError, EnrichmentJobConflictError) as error:
        raise _http_error(error) from error


@router.get("/api/enrichment-suggestions", response_model=EnrichmentSuggestionPage)
def list_suggestions(service: EnrichmentServiceDependency, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200), status: list[str] | None = Query(None), source: str | None = Query(None), latest_only: bool = True) -> EnrichmentSuggestionPage:
    items, total = service.list_suggestions(offset=offset, limit=limit, statuses=status, source=source, latest_only=latest_only)
    return EnrichmentSuggestionPage(items=[suggestion_response(service, item) for item in items], total=total, offset=offset, limit=limit)


@router.get("/api/enrichment-suggestions/{suggestion_id}", response_model=EnrichmentSuggestionResponse)
def get_suggestion(suggestion_id: int, service: EnrichmentServiceDependency) -> EnrichmentSuggestionResponse:
    try:
        return suggestion_response(service, service.get_suggestion(suggestion_id))
    except EnrichmentNotFoundError as error:
        raise _http_error(error) from error


@router.post("/api/enrichment-suggestions/{suggestion_id}/apply", response_model=EnrichmentSuggestionResponse)
def apply_suggestion(suggestion_id: int, payload: EnrichmentApplyRequest, service: EnrichmentServiceDependency) -> EnrichmentSuggestionResponse:
    try:
        suggestion, _ = service.apply(suggestion_id, payload.fields, allow_stale=payload.allow_stale)
        return suggestion_response(service, suggestion)
    except (EnrichmentNotFoundError, EnrichmentConflictError, ValueError) as error:
        raise _http_error(error) from error


@router.post("/api/enrichment-suggestions/{suggestion_id}/reject", response_model=EnrichmentSuggestionResponse)
def reject_suggestion(suggestion_id: int, service: EnrichmentServiceDependency) -> EnrichmentSuggestionResponse:
    try:
        return suggestion_response(service, service.reject(suggestion_id))
    except (EnrichmentNotFoundError, EnrichmentConflictError) as error:
        raise _http_error(error) from error


def _reanalyze(meme_id: int, request: Request, service: MemeEnrichmentService) -> EnrichmentSuggestionResponse:
    settings = AISettingsService(service.session, request.app.state.ai_settings_key_file)
    model = settings.repository.active_model()
    try:
        client = settings.build_active_client()
        attempt = service.analyze(
            meme_id, client, provider_id=model.provider_id if model else None,
            model_record_id=model.id if model else None,
            model_id_snapshot=model.model_id if model else None,
        )
        if attempt.error is not None:
            raise attempt.error
        suggestion = service.repository.latest_for_meme(meme_id)
        if suggestion is None:
            raise RuntimeError("Analysis did not create a suggestion")
        return suggestion_response(service, suggestion)
    except Exception as error:
        raise _http_error(error) from error


@router.post("/api/enrichment-suggestions/{suggestion_id}/reanalyze", response_model=EnrichmentSuggestionResponse)
def reanalyze_suggestion(suggestion_id: int, request: Request, service: EnrichmentServiceDependency) -> EnrichmentSuggestionResponse:
    try:
        old = service.get_suggestion(suggestion_id, mark_stale=False)
    except EnrichmentNotFoundError as error:
        raise _http_error(error) from error
    return _reanalyze(old.meme_id, request, service)


@router.post("/api/memes/{meme_id}/enrichment", response_model=EnrichmentSuggestionResponse)
def enrich_meme(meme_id: int, request: Request, service: EnrichmentServiceDependency) -> EnrichmentSuggestionResponse:
    return _reanalyze(meme_id, request, service)
