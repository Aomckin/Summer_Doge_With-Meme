from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, Request
from app.ai.client import (
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
)
from app.services.ai_settings_service import AISettingsService
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.template import TemplateCreate, TemplateResponse, TemplateUpdate
from app.services.template_service import (
    TemplateNameConflictError,
    TemplateNotFoundError,
    TemplateService,
)


router = APIRouter(prefix="/api/templates", tags=["templates"])


def _response(template):
    body = TemplateResponse.model_validate(template)
    if template.reference_stored_filename:
        body.reference_image_url = f"/media/template-images/{template.reference_stored_filename}"
        body.reference_thumbnail_url = f"/media/template-thumbnails/{template.reference_thumbnail_filename}"
    return body


def get_template_service(
    session: Annotated[Session, Depends(get_db)],
) -> TemplateService:
    return TemplateService(session)


ServiceDependency = Annotated[TemplateService, Depends(get_template_service)]


def _translate_error(error: Exception) -> None:
    if isinstance(error, TemplateNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, TemplateNameConflictError):
        raise HTTPException(status_code=409, detail=str(error)) from error
    raise error


@router.get("", response_model=list[TemplateResponse])
def list_templates(service: ServiceDependency) -> list[TemplateResponse]:
    return [
        _response(template)
        for template in service.list_templates()
    ]


@router.post("", response_model=TemplateResponse, status_code=201)
def create_template(
    payload: TemplateCreate,
    service: ServiceDependency,
) -> TemplateResponse:
    try:
        template = service.create_template(payload.name, payload.description)
    except (TemplateNameConflictError, ValueError) as error:
        if isinstance(error, TemplateNameConflictError):
            _translate_error(error)
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _response(template)


@router.post(
    "/with-reference-image",
    response_model=TemplateResponse,
    status_code=201,
)
async def create_template_with_reference_image(
    request: Request,
    name: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    service: ServiceDependency,
    description: Annotated[str | None, Form()] = None,
) -> TemplateResponse:
    try:
        embedding_client = AISettingsService(
            service.session,
            request.app.state.ai_settings_key_file,
        ).build_active_embedding_client()
        template = service.create_template_with_reference_image(
            name,
            description,
            file.filename or "reference",
            await file.read(),
            embedding_client,
        )
    except TemplateNameConflictError as error:
        _translate_error(error)
    except ValueError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return _response(template)


@router.get("/{template_id}", response_model=TemplateResponse)
def get_template(
    template_id: int,
    service: ServiceDependency,
) -> TemplateResponse:
    try:
        template = service.get_template(template_id)
    except TemplateNotFoundError as error:
        _translate_error(error)
    return _response(template)


@router.patch("/{template_id}", response_model=TemplateResponse)
def update_template(
    template_id: int,
    payload: TemplateUpdate,
    service: ServiceDependency,
) -> TemplateResponse:
    try:
        template = service.update_template(
            template_id,
            payload.model_dump(exclude_unset=True),
        )
    except (TemplateNotFoundError, TemplateNameConflictError) as error:
        _translate_error(error)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _response(template)


@router.post("/{template_id}/reference-image", response_model=TemplateResponse)
async def upload_reference_image(template_id: int, request: Request, file: UploadFile = File(...), service: ServiceDependency = None) -> TemplateResponse:
    try:
        embedding_client = AISettingsService(service.session, request.app.state.ai_settings_key_file).build_active_embedding_client()
        template = service.set_reference_image(template_id, file.filename or "reference", await file.read(), embedding_client)
    except TemplateNotFoundError as error:
        _translate_error(error)
    except ValueError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return _response(template)


@router.delete("/{template_id}/reference-image", status_code=204)
def delete_reference_image(template_id: int, service: ServiceDependency) -> Response:
    try:
        service.delete_reference_image(template_id)
    except TemplateNotFoundError as error:
        _translate_error(error)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=204)


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    service: ServiceDependency,
) -> Response:
    try:
        service.delete_template(template_id)
    except TemplateNotFoundError as error:
        _translate_error(error)
    return Response(status_code=204)
