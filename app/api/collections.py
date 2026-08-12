from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.mappers import meme_to_response
from app.database import get_db
from app.schemas.collection import (
    CollectionCreate,
    CollectionDetailResponse,
    CollectionItemResponse,
    CollectionMemeAdd,
    CollectionSummaryResponse,
    CollectionUpdate,
    MemeCollectionsResponse,
    MemeCollectionsUpdate,
)
from app.models.collection import Collection
from app.services.collection_service import (
    CollectionNotFoundError,
    CollectionService,
    MemeNotFoundError,
)


router = APIRouter(tags=["collections"])


def get_collection_service(
    session: Annotated[Session, Depends(get_db)],
) -> CollectionService:
    return CollectionService(session)


ServiceDependency = Annotated[CollectionService, Depends(get_collection_service)]


def _translate(error: Exception) -> None:
    if isinstance(error, (CollectionNotFoundError, MemeNotFoundError)):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, ValueError):
        raise HTTPException(status_code=422, detail=str(error)) from error
    raise error


def _summary(collection: Collection, meme_count: int) -> CollectionSummaryResponse:
    return CollectionSummaryResponse(
        id=collection.id,
        name=collection.name,
        description=collection.description,
        meme_count=meme_count,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
    )


def _detail(collection: Collection) -> CollectionDetailResponse:
    return CollectionDetailResponse(
        **_summary(collection, len(collection.items)).model_dump(),
        items=[
            CollectionItemResponse(
                position=item.position,
                added_at=item.added_at,
                meme=meme_to_response(item.meme),
            )
            for item in collection.items
        ],
    )


@router.post("/api/collections", response_model=CollectionSummaryResponse, status_code=201)
def create_collection(payload: CollectionCreate, service: ServiceDependency) -> CollectionSummaryResponse:
    try:
        return _summary(service.create(payload.name, payload.description), 0)
    except ValueError as error:
        _translate(error)


@router.get("/api/collections", response_model=list[CollectionSummaryResponse])
def list_collections(service: ServiceDependency) -> list[CollectionSummaryResponse]:
    return [_summary(collection, count) for collection, count in service.list()]


@router.get("/api/collections/{collection_id}", response_model=CollectionDetailResponse)
def get_collection(collection_id: int, service: ServiceDependency) -> CollectionDetailResponse:
    try:
        return _detail(service.get(collection_id, with_items=True))
    except CollectionNotFoundError as error:
        _translate(error)


@router.patch("/api/collections/{collection_id}", response_model=CollectionSummaryResponse)
def update_collection(
    collection_id: int,
    payload: CollectionUpdate,
    service: ServiceDependency,
) -> CollectionSummaryResponse:
    try:
        collection = service.update(collection_id, payload.model_dump(exclude_unset=True))
        return _summary(collection, service.count_items(collection_id))
    except (CollectionNotFoundError, ValueError) as error:
        _translate(error)


@router.delete("/api/collections/{collection_id}", status_code=204)
def delete_collection(collection_id: int, service: ServiceDependency) -> Response:
    try:
        service.delete(collection_id)
    except CollectionNotFoundError as error:
        _translate(error)
    return Response(status_code=204)


@router.post("/api/collections/{collection_id}/memes", status_code=204)
def add_collection_meme(
    collection_id: int,
    payload: CollectionMemeAdd,
    service: ServiceDependency,
) -> Response:
    try:
        service.add_meme(collection_id, payload.meme_id)
    except (CollectionNotFoundError, MemeNotFoundError) as error:
        _translate(error)
    return Response(status_code=204)


@router.delete("/api/collections/{collection_id}/memes/{meme_id}", status_code=204)
def remove_collection_meme(
    collection_id: int,
    meme_id: int,
    service: ServiceDependency,
) -> Response:
    try:
        service.remove_meme(collection_id, meme_id)
    except (CollectionNotFoundError, MemeNotFoundError) as error:
        _translate(error)
    return Response(status_code=204)


@router.get("/api/memes/{meme_id}/collections", response_model=MemeCollectionsResponse)
def get_meme_collections(meme_id: int, service: ServiceDependency) -> MemeCollectionsResponse:
    try:
        return MemeCollectionsResponse(collection_ids=service.memberships(meme_id))
    except MemeNotFoundError as error:
        _translate(error)


@router.put("/api/memes/{meme_id}/collections", response_model=MemeCollectionsResponse)
def replace_meme_collections(
    meme_id: int,
    payload: MemeCollectionsUpdate,
    service: ServiceDependency,
) -> MemeCollectionsResponse:
    try:
        return MemeCollectionsResponse(
            collection_ids=service.replace_memberships(meme_id, payload.collection_ids)
        )
    except (CollectionNotFoundError, MemeNotFoundError) as error:
        _translate(error)
