from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.client import (
    AIClient,
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
    OpenAIResponsesClient,
)
from app.config import IMAGES_URL_PREFIX, THUMBNAILS_URL_PREFIX
from app.database import get_db
from app.models.meme import Meme
from app.models.ai_analysis import MemeAIAnalysis
from app.repositories.ai_analysis_repository import AIAnalysisRepository
from app.schemas.ai_analysis import AIAnalysisConfirm, AIAnalysisResponse
from app.schemas.meme import MemeResponse, MemeUpdate, TagResponse
from app.services.meme_service import (
    AIAnalysisAlreadyConfirmedError,
    AIAnalysisNotFoundError,
    MemeFileMissingError,
    MemeNotFoundError,
    MemeService,
    NoMemesAvailableError,
)
from app.storage.image_storage import ImageStorage, ImageTooLargeError, InvalidImageError


# API 层只处理 HTTP 输入输出：解析请求、调用 Service、转换异常和响应。
# prefix 会加在本文件所有路由前；tags 只用于自动生成的接口文档分组。
router = APIRouter(prefix="/api/memes", tags=["memes"])


def get_meme_service(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> MemeService:
    # FastAPI 先通过 get_db 提供一次请求专用的 Session，再组装 Service。
    storage = ImageStorage(
        request.app.state.images_dir,
        request.app.state.thumbnails_dir,
    )
    return MemeService(session, storage)


# 把较长的依赖声明起别名，下面每个接口都能直接写 service: ServiceDependency。
ServiceDependency = Annotated[MemeService, Depends(get_meme_service)]


def get_ai_client() -> AIClient:
    try:
        return OpenAIResponsesClient.from_env()
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


AIClientDependency = Annotated[AIClient, Depends(get_ai_client)]


def _parse_tags(value: str | None) -> list[str]:
    # multipart 表单里的标签用英文逗号分隔，同时忽略空白项。
    if value is None:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def _to_meme_response(meme: Meme) -> MemeResponse:
    """把内部 ORM 对象统一转换为不会泄露服务器路径的公开响应。"""
    image_name = ImageStorage.filename_from_reference(meme.file_path)
    thumbnail_name = (
        ImageStorage.filename_from_reference(meme.thumbnail_path)
        if meme.thumbnail_path is not None
        else None
    )
    return MemeResponse(
        id=meme.id,
        title=meme.title,
        description=meme.description,
        source=meme.source,
        original_filename=meme.original_filename,
        stored_filename=meme.stored_filename,
        image_url=f"{IMAGES_URL_PREFIX}/{image_name}",
        thumbnail_url=(
            f"{THUMBNAILS_URL_PREFIX}/{thumbnail_name}"
            if thumbnail_name is not None
            else None
        ),
        mime_type=meme.mime_type,
        file_size=meme.file_size,
        width=meme.width,
        height=meme.height,
        file_hash=meme.file_hash,
        created_at=meme.created_at,
        updated_at=meme.updated_at,
        tags=[TagResponse.model_validate(tag) for tag in meme.tags],
    )


def _to_ai_analysis_response(
    analysis: MemeAIAnalysis,
) -> AIAnalysisResponse:
    return AIAnalysisResponse(
        id=analysis.id,
        meme_id=analysis.meme_id,
        model_name=analysis.model_name,
        description=analysis.description,
        suggestions=AIAnalysisRepository.load_suggestions(analysis),
        created_at=analysis.created_at,
        confirmed_at=analysis.confirmed_at,
    )


@router.post("", response_model=MemeResponse, status_code=201)
async def upload_meme(
    service: ServiceDependency,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(min_length=1, max_length=255)],
    description: Annotated[str | None, Form()] = None,
    source: Annotated[str | None, Form(max_length=500)] = None,
    tags: Annotated[str | None, Form()] = None,
) -> MemeResponse:
    # UploadFile.read() 是异步读取，避免在接口函数里直接操作底层临时文件。
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
        # 业务/存储异常在边界处转换为明确的 HTTP 状态码。
        raise HTTPException(status_code=413, detail=str(error)) from error
    except InvalidImageError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Image already exists") from error

    return _to_meme_response(meme)


@router.get("", response_model=list[MemeResponse])
def list_memes(
    service: ServiceDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    tags: Annotated[list[str] | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> list[MemeResponse]:
    # q 搜标题和描述；同名 tags 可重复，并与 q、分页组合使用。
    return [
        _to_meme_response(meme)
        for meme in service.list_memes(offset=offset, limit=limit, tags=tags, q=q)
    ]


# 固定路径 /random 放在 /{meme_id} 前，避免被当成一个动态 ID。
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
        # 410 表示记录曾存在，但其对应文件已经不可用。
        raise HTTPException(status_code=410, detail=str(error)) from error
    return _to_meme_response(meme)


@router.post("/{meme_id}/analyze", response_model=AIAnalysisResponse)
def analyze_meme(
    meme_id: int,
    service: ServiceDependency,
    ai_client: AIClientDependency,
) -> AIAnalysisResponse:
    try:
        analysis = service.analyze_meme(meme_id, ai_client)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except AIRequestTimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
    except (AIUpstreamError, AIInvalidResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return _to_ai_analysis_response(analysis)


@router.post(
    "/{meme_id}/analyses/{analysis_id}/confirm",
    response_model=MemeResponse,
)
def confirm_ai_analysis(
    meme_id: int,
    analysis_id: int,
    payload: AIAnalysisConfirm,
    service: ServiceDependency,
) -> MemeResponse:
    try:
        meme = service.confirm_ai_analysis(
            meme_id,
            analysis_id,
            tags=payload.tags,
            apply_description=payload.apply_description,
        )
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except AIAnalysisNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except AIAnalysisAlreadyConfirmedError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _to_meme_response(meme)


@router.get("/{meme_id}", response_model=MemeResponse)
def get_meme(meme_id: int, service: ServiceDependency) -> MemeResponse:
    try:
        meme = service.get_meme(meme_id)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    return _to_meme_response(meme)


@router.patch("/{meme_id}", response_model=MemeResponse)
def update_meme(
    meme_id: int,
    payload: MemeUpdate,
    service: ServiceDependency,
) -> MemeResponse:
    try:
        meme = service.update_meme(
            meme_id,
            # exclude_unset=True 只传用户真正提交的字段，未提交字段保持原值。
            payload.model_dump(exclude_unset=True),
        )
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _to_meme_response(meme)


@router.delete("/{meme_id}", status_code=204)
def delete_meme(meme_id: int, service: ServiceDependency) -> Response:
    try:
        service.delete_meme(meme_id)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    # 204 的含义是操作成功且响应体为空。
    return Response(status_code=204)
