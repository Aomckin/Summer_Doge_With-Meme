from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.ai.client import (
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
)
from app.api.mappers import meme_to_response
from app.api.semantic import get_service as get_semantic_search_service
from app.schemas.recommendation import ChatRecommendationRequest
from app.schemas.semantic import ScoredMeme, SemanticSearchResponse
from app.services.chat_recommendation_service import ChatRecommendationService
from app.services.semantic_search_service import (
    MemeEmbeddingUnavailableError,
    SemanticSearchService,
)

router = APIRouter(tags=["recommendations"])


def get_service(
    semantic_search: Annotated[
        SemanticSearchService, Depends(get_semantic_search_service)
    ],
) -> ChatRecommendationService:
    return ChatRecommendationService(semantic_search)


ServiceDependency = Annotated[ChatRecommendationService, Depends(get_service)]


@router.post(
    "/api/meme-recommendations/chat", response_model=SemanticSearchResponse
)
def recommend_chat_memes(
    payload: ChatRecommendationRequest, service: ServiceDependency
) -> SemanticSearchResponse:
    try:
        result = service.recommend(**payload.model_dump())
    except (AIConfigurationError, MemeEmbeddingUnavailableError) as error:
        raise HTTPException(503, str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(504, str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(502, str(error)) from error
    hits = result.pop("hits")
    return SemanticSearchResponse(
        items=[
            ScoredMeme(meme=meme_to_response(meme), score=score)
            for meme, score in hits
        ],
        **result,
    )
