from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.meme import MemeResponse, MemeUpdate
from app.services.meme_service import (
    MemeFileMissingError,
    MemeNotFoundError,
    MemeService,
    NoMemesAvailableError,
)
from app.storage.image_storage import ImageTooLargeError, InvalidImageError


router = APIRouter(prefix="/api/memes", tags=["memes"])


def get_meme_service(session: Annotated[Session, Depends(get_db)]) -> MemeService:
    return MemeService(session)


ServiceDependency = Annotated[MemeService, Depends(get_meme_service)]


def _parse_tags(value: str | None) -> list[str]:
    if value is None:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


@router.post("", response_model=MemeResponse, status_code=201)
async def upload_meme(
    service: ServiceDependency,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(min_length=1, max_length=255)],
    description: Annotated[str | None, Form()] = None,
    source: Annotated[str | None, Form(max_length=500)] = None,
    tags: Annotated[str | None, Form()] = None,
) -> MemeResponse:
    content = await file.read()
    try:
        meme = service.create_meme(
            file.filename or "upload",
            content,
            title=title,
            description=description,
            source=source,
            tags=_parse_tags(tags),
        )
    except ImageTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except InvalidImageError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Image already exists") from error

    return MemeResponse.model_validate(meme)


@router.get("", response_model=list[MemeResponse])
def list_memes(
    service: ServiceDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    tags: Annotated[list[str] | None, Query()] = None,
) -> list[MemeResponse]:
    return [
        MemeResponse.model_validate(meme)
        for meme in service.list_memes(offset=offset, limit=limit, tags=tags)
    ]


@router.get("/random", response_model=MemeResponse)
def get_random_meme(
    service: ServiceDependency,
    tags: Annotated[list[str] | None, Query()] = None,
) -> MemeResponse:
    try:
        meme = service.get_random_meme(tags=tags)
    except NoMemesAvailableError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    return MemeResponse.model_validate(meme)


@router.get("/{meme_id}", response_model=MemeResponse)
def get_meme(meme_id: int, service: ServiceDependency) -> MemeResponse:
    try:
        meme = service.get_meme(meme_id)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    return MemeResponse.model_validate(meme)


@router.patch("/{meme_id}", response_model=MemeResponse)
def update_meme(
    meme_id: int,
    payload: MemeUpdate,
    service: ServiceDependency,
) -> MemeResponse:
    try:
        meme = service.update_meme(
            meme_id,
            payload.model_dump(exclude_unset=True),
        )
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return MemeResponse.model_validate(meme)


@router.delete("/{meme_id}", status_code=204)
def delete_meme(meme_id: int, service: ServiceDependency) -> Response:
    try:
        service.delete_meme(meme_id)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    return Response(status_code=204)
