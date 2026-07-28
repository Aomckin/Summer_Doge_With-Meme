from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.ai.client import (
    AIRequestTimeoutError,
    AIUpstreamError,
)
from app.ai.presets import PROVIDER_PRESETS
from app.database import get_db
from app.models.ai_settings import AIModel, AIProvider
from app.schemas.ai_settings import (
    ConnectionTestResponse,
    ModelCreate,
    ModelResponse,
    ModelUpdate,
    ProviderCreate,
    ProviderPresetResponse,
    ProviderResponse,
    ProviderUpdate,
)
from app.services.ai_settings_service import (
    AISettingsConflictError,
    AISettingsNotFoundError,
    AISettingsService,
    AISettingsValidationError,
)


router = APIRouter(prefix="/api/ai-settings", tags=["ai-settings"])


def get_ai_settings_service(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> AISettingsService:
    return AISettingsService(
        session,
        request.app.state.ai_settings_key_file,
    )


ServiceDependency = Annotated[
    AISettingsService,
    Depends(get_ai_settings_service),
]


def _provider_response(provider: AIProvider) -> ProviderResponse:
    return ProviderResponse(
        id=provider.id,
        name=provider.name,
        protocol=provider.protocol,
        base_url=provider.base_url,
        has_api_key=provider.api_key_ciphertext is not None,
        api_key_hint=provider.api_key_hint,
        timeout_seconds=provider.timeout_seconds,
        max_retries=provider.max_retries,
        retry_delay_seconds=provider.retry_delay_seconds,
        enabled=provider.enabled,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


def _model_response(model: AIModel) -> ModelResponse:
    return ModelResponse.model_validate(model)


def _settings_error(error: Exception) -> HTTPException:
    if isinstance(error, AISettingsNotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, AISettingsConflictError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, AISettingsValidationError):
        return HTTPException(status_code=422, detail=str(error))
    if isinstance(error, AIRequestTimeoutError):
        return HTTPException(status_code=504, detail=str(error))
    return HTTPException(status_code=502, detail=str(error))


@router.get("/presets", response_model=list[ProviderPresetResponse])
def list_presets() -> list[ProviderPresetResponse]:
    return [ProviderPresetResponse.model_validate(item) for item in PROVIDER_PRESETS]


@router.get("/providers", response_model=list[ProviderResponse])
def list_providers(service: ServiceDependency) -> list[ProviderResponse]:
    return [_provider_response(item) for item in service.list_providers()]


@router.post("/providers", response_model=ProviderResponse, status_code=201)
def create_provider(
    payload: ProviderCreate,
    service: ServiceDependency,
) -> ProviderResponse:
    try:
        provider = service.create_provider(payload.model_dump())
    except (
        AISettingsConflictError,
        AISettingsValidationError,
    ) as error:
        raise _settings_error(error) from error
    return _provider_response(provider)


@router.patch("/providers/{provider_id}", response_model=ProviderResponse)
def update_provider(
    provider_id: int,
    payload: ProviderUpdate,
    service: ServiceDependency,
) -> ProviderResponse:
    try:
        provider = service.update_provider(
            provider_id,
            payload.model_dump(exclude_unset=True),
        )
    except (
        AISettingsConflictError,
        AISettingsNotFoundError,
        AISettingsValidationError,
    ) as error:
        raise _settings_error(error) from error
    return _provider_response(provider)


@router.delete("/providers/{provider_id}", status_code=204)
def delete_provider(
    provider_id: int,
    service: ServiceDependency,
) -> Response:
    try:
        service.delete_provider(provider_id)
    except AISettingsNotFoundError as error:
        raise _settings_error(error) from error
    return Response(status_code=204)


@router.post(
    "/providers/{provider_id}/test",
    response_model=ConnectionTestResponse,
)
def test_provider(
    provider_id: int,
    service: ServiceDependency,
) -> ConnectionTestResponse:
    try:
        model_ids = service.test_provider(provider_id)
    except (
        AISettingsNotFoundError,
        AISettingsValidationError,
        AIRequestTimeoutError,
        AIUpstreamError,
    ) as error:
        raise _settings_error(error) from error
    return ConnectionTestResponse(
        ok=True,
        message="连接成功",
        model_count=len(model_ids),
    )


@router.post(
    "/providers/{provider_id}/refresh-models",
    response_model=list[ModelResponse],
)
def refresh_models(
    provider_id: int,
    service: ServiceDependency,
) -> list[ModelResponse]:
    try:
        models = service.refresh_models(provider_id)
    except (
        AISettingsConflictError,
        AISettingsNotFoundError,
        AISettingsValidationError,
        AIRequestTimeoutError,
        AIUpstreamError,
    ) as error:
        raise _settings_error(error) from error
    return [_model_response(item) for item in models]


@router.get("/models", response_model=list[ModelResponse])
def list_models(service: ServiceDependency) -> list[ModelResponse]:
    return [_model_response(item) for item in service.list_models()]


@router.post("/models", response_model=ModelResponse, status_code=201)
def create_model(
    payload: ModelCreate,
    service: ServiceDependency,
) -> ModelResponse:
    try:
        model = service.create_model(payload.model_dump())
    except (
        AISettingsConflictError,
        AISettingsNotFoundError,
        AISettingsValidationError,
    ) as error:
        raise _settings_error(error) from error
    return _model_response(model)


@router.patch("/models/{model_id}", response_model=ModelResponse)
def update_model(
    model_id: int,
    payload: ModelUpdate,
    service: ServiceDependency,
) -> ModelResponse:
    try:
        model = service.update_model(
            model_id,
            payload.model_dump(exclude_unset=True),
        )
    except (
        AISettingsConflictError,
        AISettingsNotFoundError,
        AISettingsValidationError,
    ) as error:
        raise _settings_error(error) from error
    return _model_response(model)


@router.delete("/models/{model_id}", status_code=204)
def delete_model(
    model_id: int,
    service: ServiceDependency,
) -> Response:
    try:
        service.delete_model(model_id)
    except AISettingsNotFoundError as error:
        raise _settings_error(error) from error
    return Response(status_code=204)
