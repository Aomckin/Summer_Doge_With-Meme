from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.mappers import meme_to_response
from app.database import get_db
from app.schemas.similarity_inspection import (
    MemeMergeRequest,
    SimilarityIgnoreRequest,
    SimilarityIgnoreResponse,
    SimilarityInspectionRequest,
    SimilarityInspectionResponse,
    SimilarityPairResponse,
)
from app.schemas.meme import MemeResponse
from app.services.meme_merge_service import MemeMergeError, MemeMergeService
from app.services.similarity_inspection_service import (
    SimilarityInspectionService,
    SimilarityInspectionUnavailableError,
)

router = APIRouter(tags=["similarity-inspection"])


def get_service(
    request: Request, session: Annotated[Session, Depends(get_db)]
) -> SimilarityInspectionService:
    return SimilarityInspectionService(session, request.app.state.semantic_index)


ServiceDependency = Annotated[SimilarityInspectionService, Depends(get_service)]


def get_merge_service(
    session: Annotated[Session, Depends(get_db)],
) -> MemeMergeService:
    return MemeMergeService(session)


MergeServiceDependency = Annotated[MemeMergeService, Depends(get_merge_service)]


@router.post("/api/similarity-inspection", response_model=SimilarityInspectionResponse)
def inspect_similarity(
    payload: SimilarityInspectionRequest, service: ServiceDependency
) -> SimilarityInspectionResponse:
    try:
        result = service.inspect(**payload.model_dump())
    except SimilarityInspectionUnavailableError as error:
        raise HTTPException(503, str(error)) from error
    pairs = result.pop("pairs")
    return SimilarityInspectionResponse(
        pairs=[
            SimilarityPairResponse(
                meme_a=meme_to_response(pair.meme_a),
                meme_b=meme_to_response(pair.meme_b),
                score=pair.score,
                weak_relation_exists=pair.weak_relation_exists,
            )
            for pair in pairs
        ],
        **result,
    )


@router.post(
    "/api/meme-similarity-ignores", response_model=SimilarityIgnoreResponse
)
def create_similarity_ignore(
    payload: SimilarityIgnoreRequest, service: ServiceDependency
) -> SimilarityIgnoreResponse:
    try:
        record = service.create_ignore(payload.meme_a_id, payload.meme_b_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except IntegrityError as error:
        raise HTTPException(409, "Similarity ignore could not be created") from error
    return SimilarityIgnoreResponse(
        meme_a_id=record.meme_a_id, meme_b_id=record.meme_b_id
    )


@router.delete(
    "/api/meme-similarity-ignores/{meme_a_id}/{meme_b_id}", status_code=204
)
def delete_similarity_ignore(
    meme_a_id: int, meme_b_id: int, service: ServiceDependency
) -> Response:
    try:
        deleted = service.delete_ignore(meme_a_id, meme_b_id)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if not deleted:
        raise HTTPException(404, "Similarity ignore does not exist")
    return Response(status_code=204)


@router.post("/api/memes/{target_meme_id}/merge", response_model=MemeResponse)
def merge_memes(
    target_meme_id: int,
    payload: MemeMergeRequest,
    service: MergeServiceDependency,
) -> MemeResponse:
    try:
        return meme_to_response(service.merge(target_meme_id, payload.source_meme_id))
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except MemeMergeError as error:
        raise HTTPException(422, str(error)) from error
    except IntegrityError as error:
        raise HTTPException(409, "Meme merge could not be completed safely") from error
