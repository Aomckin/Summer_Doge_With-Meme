from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.ai.client import (
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
)
from app.api.memes import AIClientDependency
from app.database import get_db
from app.schemas.caption import (
    CaptionCandidatesResponse,
    CaptionCreate,
    CaptionGenerateRequest,
    CaptionResponse,
    CaptionRewriteRequest,
    CaptionUpdate,
)
from app.services.caption_service import CaptionNotFoundError, CaptionService
from app.services.meme_service import MemeFileMissingError
from app.storage.image_storage import ImageStorage


router = APIRouter(prefix="/api/memes/{meme_id}/captions", tags=["captions"])


def get_caption_service(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> CaptionService:
    return CaptionService(
        session,
        ImageStorage(
            request.app.state.images_dir,
            request.app.state.thumbnails_dir,
        ),
    )


ServiceDependency = Annotated[CaptionService, Depends(get_caption_service)]


@router.get("", response_model=list[CaptionResponse])
def list_captions(
    meme_id: int,
    service: ServiceDependency,
) -> list[CaptionResponse]:
    try:
        return [
            CaptionResponse.model_validate(caption)
            for caption in service.list_captions(meme_id)
        ]
    except CaptionNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("", response_model=CaptionResponse, status_code=201)
def create_caption(
    meme_id: int,
    payload: CaptionCreate,
    service: ServiceDependency,
) -> CaptionResponse:
    try:
        return CaptionResponse.model_validate(
            service.create_caption(meme_id, **payload.model_dump())
        )
    except CaptionNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/generate", response_model=CaptionCandidatesResponse)
def generate_captions(
    meme_id: int,
    payload: CaptionGenerateRequest,
    service: ServiceDependency,
    ai_client: AIClientDependency,
) -> CaptionCandidatesResponse:
    try:
        result = service.generate_captions(
            meme_id,
            ai_client,
            **payload.model_dump(),
        )
        return CaptionCandidatesResponse(
            model_name=result.model_name,
            captions=list(result.captions),
        )
    except CaptionNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/rewrite", response_model=CaptionCandidatesResponse)
def rewrite_caption(
    meme_id: int,
    payload: CaptionRewriteRequest,
    service: ServiceDependency,
    ai_client: AIClientDependency,
) -> CaptionCandidatesResponse:
    try:
        result = service.rewrite_caption(
            meme_id,
            ai_client,
            **payload.model_dump(),
        )
        return CaptionCandidatesResponse(
            model_name=result.model_name,
            captions=list(result.captions),
        )
    except CaptionNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.patch("/{caption_id}", response_model=CaptionResponse)
def update_caption(
    meme_id: int,
    caption_id: int,
    payload: CaptionUpdate,
    service: ServiceDependency,
) -> CaptionResponse:
    try:
        return CaptionResponse.model_validate(
            service.update_caption(
                meme_id,
                caption_id,
                payload.model_dump(exclude_unset=True),
            )
        )
    except CaptionNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.delete("/{caption_id}", status_code=204)
def delete_caption(
    meme_id: int,
    caption_id: int,
    service: ServiceDependency,
) -> Response:
    try:
        service.delete_caption(meme_id, caption_id)
        return Response(status_code=204)
    except CaptionNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
