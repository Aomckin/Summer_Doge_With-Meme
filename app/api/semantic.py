from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.ai.client import (
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
)
from app.api.mappers import meme_to_response
from app.database import get_db
from app.schemas.semantic import (
    MemeEmbeddingStatusResponse,
    ScoredMeme,
    SemanticIndexStatusResponse,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SimilarMemeResponse,
)
from app.services.semantic_search_service import (
    MemeEmbeddingUnavailableError,
    SemanticSearchService,
)
from app.storage.image_storage import ImageStorage

router = APIRouter(tags=["semantic-search"])


def get_service(
    request: Request, session: Annotated[Session, Depends(get_db)]
) -> SemanticSearchService:
    return SemanticSearchService(
        session,
        ImageStorage(request.app.state.images_dir, request.app.state.thumbnails_dir),
        request.app.state.ai_settings_key_file,
        request.app.state.semantic_index,
        request.app.state.semantic_search_cache,
    )


ServiceDependency = Annotated[SemanticSearchService, Depends(get_service)]


@router.get("/api/semantic-index/status", response_model=SemanticIndexStatusResponse)
def semantic_index_status(service: ServiceDependency) -> dict[str, object]:
    return service.status()


@router.post("/api/semantic-search", response_model=SemanticSearchResponse)
def semantic_search(
    payload: SemanticSearchRequest, service: ServiceDependency
) -> SemanticSearchResponse:
    try:
        result = service.search(**payload.model_dump())
    except (AIConfigurationError, MemeEmbeddingUnavailableError) as error:
        raise HTTPException(503, str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(504, str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(502, str(error)) from error
    hits = result.pop("hits")
    return SemanticSearchResponse(
        items=[ScoredMeme(meme=meme_to_response(meme), score=score) for meme, score in hits],
        **result,
    )


@router.get("/api/memes/{meme_id}/similar", response_model=SimilarMemeResponse)
def similar_memes(
    meme_id: int,
    service: ServiceDependency,
    limit: Annotated[int, Query(ge=1, le=24)] = 12,
) -> SimilarMemeResponse:
    try:
        items = service.similar(meme_id, limit=limit)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except MemeEmbeddingUnavailableError as error:
        raise HTTPException(409, str(error)) from error
    return SimilarMemeResponse(
        items=[ScoredMeme(meme=meme_to_response(meme), score=score) for meme, score in items]
    )


@router.post(
    "/api/memes/{meme_id}/embedding/rebuild",
    response_model=MemeEmbeddingStatusResponse,
)
def rebuild_meme_embedding(
    meme_id: int, service: ServiceDependency
) -> MemeEmbeddingStatusResponse:
    try:
        record = service.rebuild_meme(meme_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except (AIConfigurationError, MemeEmbeddingUnavailableError) as error:
        raise HTTPException(503, str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(504, str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(502, str(error)) from error
    return MemeEmbeddingStatusResponse.model_validate(record, from_attributes=True)
