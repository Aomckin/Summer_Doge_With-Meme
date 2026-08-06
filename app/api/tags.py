from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.meme import (
    TagCleanupRequest,
    TagCleanupResponse,
    TagMergeRequest,
    TagRenameRequest,
    TagResponse,
)
from app.services.tag_service import (
    TagInUseError,
    TagNameConflictError,
    TagNotFoundError,
    TagService,
)


router = APIRouter(prefix="/api/tags", tags=["tags"])
TagSort = Literal["name_asc", "name_desc", "usage_asc", "usage_desc"]


def get_tag_service(
    session: Annotated[Session, Depends(get_db)],
) -> TagService:
    return TagService(session)


ServiceDependency = Annotated[TagService, Depends(get_tag_service)]


def _response(tag: object) -> TagResponse:
    return TagResponse.model_validate(tag)


def _translate_error(error: Exception) -> None:
    if isinstance(error, TagNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, (TagNameConflictError, TagInUseError)):
        raise HTTPException(status_code=409, detail=str(error)) from error
    if isinstance(error, ValueError):
        raise HTTPException(status_code=422, detail=str(error)) from error
    raise error


@router.get("", response_model=list[TagResponse])
def list_tags(
    service: ServiceDependency,
    include_empty: bool = False,
    q: Annotated[str | None, Query(max_length=100)] = None,
    sort: TagSort = "name_asc",
) -> list[TagResponse]:
    return [
        _response(tag)
        for tag in service.list_tags(
            include_empty=include_empty,
            q=q,
            sort=sort,
        )
    ]


@router.post("/cleanup-empty", response_model=TagCleanupResponse)
def cleanup_empty_tags(
    payload: TagCleanupRequest,
    service: ServiceDependency,
) -> TagCleanupResponse:
    try:
        names = service.cleanup_empty(confirm=payload.confirm)
    except ValueError as error:
        _translate_error(error)
    return TagCleanupResponse(deleted_count=len(names), deleted_tags=names)


@router.patch("/{tag_id}", response_model=TagResponse)
def rename_tag(
    tag_id: int,
    payload: TagRenameRequest,
    service: ServiceDependency,
) -> TagResponse:
    try:
        tag = service.rename_tag(tag_id, payload.name)
    except (TagNotFoundError, TagNameConflictError, ValueError) as error:
        _translate_error(error)
    return _response(tag)


@router.post("/{source_tag_id}/merge", response_model=TagResponse)
def merge_tags(
    source_tag_id: int,
    payload: TagMergeRequest,
    service: ServiceDependency,
) -> TagResponse:
    try:
        tag = service.merge_tags(source_tag_id, payload.target_tag_id)
    except (TagNotFoundError, ValueError) as error:
        _translate_error(error)
    return _response(tag)


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, service: ServiceDependency) -> Response:
    try:
        service.delete_tag(tag_id)
    except (TagNotFoundError, TagInUseError) as error:
        _translate_error(error)
    return Response(status_code=204)
