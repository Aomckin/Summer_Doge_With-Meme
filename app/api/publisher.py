from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import UUID4
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.publisher import (
    AttemptResponse, ItemAppend, PostContent, PostResponse, PostSummary, PostUpdate, PublisherInfo, PublisherLogin, PublishRequest,
)
from app.services.post_service import PostNotFound, PostService, PublisherConflict, PublisherInputError
from app.services.publisher_service import PublisherService


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api/publisher", tags=["publisher"], dependencies=[Depends(private_response)])
Database = Annotated[Session, Depends(get_db)]


def post_service(request: Request, session: Database) -> PostService:
    return PostService(session, request.app.state.vault_storage)


def publisher_service(request: Request) -> PublisherService:
    return request.app.state.publisher_service


Posts = Annotated[PostService, Depends(post_service)]
Publisher = Annotated[PublisherService, Depends(publisher_service)]


async def handle_publisher_error(_request: Request, error: Exception) -> Response:
    if isinstance(error, PostNotFound):
        status = 404
    elif isinstance(error, PublisherConflict):
        status = 409
    else:
        status = 422
    content = {"detail": str(error)}
    if isinstance(error, PublisherInputError) and error.code:
        content["error_code"] = error.code
    return JSONResponse(content, status_code=status, headers={"Cache-Control": "no-store"})


@router.get("/posts", response_model=list[PostSummary])
def list_posts(service: Posts) -> list[PostSummary]:
    return service.list_posts()


@router.post("/posts", response_model=PostResponse, status_code=201)
def create_post(payload: PostContent, service: Posts) -> PostResponse:
    return service.create(payload)


@router.get("/posts/{post_id}", response_model=PostResponse)
def read_post(post_id: int, service: Posts) -> PostResponse:
    return service.response(service.get(post_id))


@router.get("/posts/{post_id}/other-image-ids", response_model=list[int])
def other_post_image_ids(post_id: int, service: Posts) -> list[int]:
    return service.other_post_image_ids(post_id)


@router.put("/posts/{post_id}", response_model=PostResponse)
def update_post(post_id: int, payload: PostUpdate, service: Posts) -> PostResponse:
    return service.update(post_id, payload)


@router.post("/posts/{post_id}/items", response_model=PostResponse)
def append_items(post_id: int, payload: ItemAppend, service: Posts) -> PostResponse:
    return service.append(post_id, payload.items)


@router.post("/posts/{post_id}/copy", response_model=PostResponse, status_code=201)
def copy_post(post_id: int, service: Posts) -> PostResponse:
    return service.copy(post_id)


@router.post("/posts/{post_id}/move-to-top", response_model=PostSummary)
def move_post_to_top(post_id: int, service: Posts) -> PostSummary:
    return service.move_to_top(post_id)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: int, revision: Annotated[int, Query(gt=0)], service: Posts) -> Response:
    service.delete(post_id, revision)
    return Response(status_code=204)


@router.get("/plugins", response_model=list[PublisherInfo])
def list_plugins(service: Publisher, session: Database) -> list[PublisherInfo]:
    return service.plugins(session)


@router.post("/plugins/xiaoheihe/login", response_model=PublisherLogin, status_code=202)
def begin_xiaoheihe_login(service: Publisher) -> PublisherLogin:
    return service.xiaoheihe_login.start(service.registry.plugins.get("xiaoheihe"))


@router.get("/plugins/xiaoheihe/login/{attempt_id}", response_model=PublisherLogin)
def xiaoheihe_login_status(attempt_id: UUID4, service: Publisher) -> PublisherLogin:
    return service.xiaoheihe_login.status(attempt_id)


@router.get("/posts/{post_id}/attempts", response_model=list[AttemptResponse])
def list_attempts(
    post_id: int, service: Publisher, session: Database,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AttemptResponse]:
    return service.history(session, post_id, limit, offset)


@router.post("/posts/{post_id}/attempts", response_model=AttemptResponse, status_code=202)
def submit_attempt(
    post_id: int, payload: PublishRequest, service: Publisher, session: Database,
) -> AttemptResponse:
    return service.submit(session, post_id, payload)


@router.get("/attempts/{attempt_id}", response_model=AttemptResponse)
def read_attempt(attempt_id: UUID4, service: Publisher, session: Database) -> AttemptResponse:
    return service.find(session, attempt_id)


@router.get("/attempts/{attempt_id}/download")
def download_package(attempt_id: UUID4, service: Publisher, session: Database) -> FileResponse:
    try:
        path, filename = service.download(session, attempt_id)
    except FileNotFoundError as error:
        raise HTTPException(410, str(error)) from error
    return FileResponse(path, filename=filename, media_type="application/zip", headers={"Cache-Control": "no-store"})
