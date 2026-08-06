from typing import Annotated, Literal
from pathlib import Path

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
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
import json
from tempfile import NamedTemporaryFile
from zipfile import ZIP_STORED, ZipFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.client import (
    AIClient,
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
)
from app.config import IMAGES_URL_PREFIX, THUMBNAILS_URL_PREFIX
from app.database import get_db
from app.models.meme import Meme
from app.models.ai_analysis import MemeAIAnalysis
from app.repositories.ai_analysis_repository import AIAnalysisRepository
from app.schemas.ai_analysis import AIAnalysisConfirm, AIAnalysisResponse
from app.schemas.meme import ImageOrderRequest, MemeImageResponse, MemePageResponse, MemeRelationRequest, MemeResponse, MemeUpdate, TagResponse
from app.schemas.template import TemplateResponse
from app.services.meme_service import (
    AIAnalysisAlreadyConfirmedError,
    AIAnalysisNotFoundError,
    MemeFileMissingError,
    MemeNotFoundError,
    MemeService,
    NoMemesAvailableError,
)
from app.storage.image_storage import ImageStorage, ImageTooLargeError, InvalidImageError
from app.utils.download_names import safe_download_filename, safe_extension, sanitize_stem, unique_archive_name


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


def get_ai_client(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> AIClient:
    from app.services.ai_settings_service import AISettingsService

    try:
        return AISettingsService(
            session,
            request.app.state.ai_settings_key_file,
        ).build_active_client()
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


AIClientDependency = Annotated[AIClient, Depends(get_ai_client)]


def _parse_tags(value: str | None) -> list[str]:
    # multipart 表单里的标签用英文逗号分隔，同时忽略空白项。
    if value is None:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def _parse_template_id(value: str | None) -> int | None:
    normalized = (value or "").strip()
    if not normalized:
        return None
    try:
        template_id = int(normalized)
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail="template_id must be an integer",
        ) from error
    if template_id < 1:
        raise HTTPException(
            status_code=422,
            detail="template_id must be a positive integer",
        )
    return template_id


def _to_meme_response(meme: Meme) -> MemeResponse:
    """把内部 ORM 对象统一转换为不会泄露服务器路径的公开响应。"""
    image_records = list(meme.images)
    cover = image_records[0] if image_records else meme
    image_name = ImageStorage.filename_from_reference(cover.file_path)
    thumbnail_name = (
        ImageStorage.filename_from_reference(cover.thumbnail_path)
        if cover.thumbnail_path is not None
        else None
    )
    images = [
        MemeImageResponse(
            id=item.id, original_filename=item.original_filename,
            stored_filename=item.stored_filename,
            image_url=f"{IMAGES_URL_PREFIX}/{ImageStorage.filename_from_reference(item.file_path)}",
            thumbnail_url=(f"{THUMBNAILS_URL_PREFIX}/{ImageStorage.filename_from_reference(item.thumbnail_path)}" if item.thumbnail_path else None),
            mime_type=item.mime_type, file_size=item.file_size, width=item.width,
            height=item.height, file_hash=item.file_hash, position=item.position,
            created_at=item.created_at,
        ) for item in image_records
    ]
    return MemeResponse(
        id=meme.id,
        title=meme.title,
        description=meme.description,
        source=meme.source,
        original_filename=cover.original_filename,
        stored_filename=cover.stored_filename,
        image_url=f"{IMAGES_URL_PREFIX}/{image_name}",
        thumbnail_url=(
            f"{THUMBNAILS_URL_PREFIX}/{thumbnail_name}"
            if thumbnail_name is not None
            else None
        ),
        mime_type=cover.mime_type,
        file_size=cover.file_size,
        width=cover.width,
        height=cover.height,
        file_hash=cover.file_hash,
        created_at=meme.created_at,
        updated_at=meme.updated_at,
        tags=[TagResponse.model_validate(tag) for tag in meme.tags],
        template=(
            TemplateResponse.model_validate(meme.template)
            if meme.template is not None
            else None
        ),
        images=images,
        image_count=len(images),
    )


def _to_ai_analysis_response(
    analysis: MemeAIAnalysis,
    service: MemeService,
) -> AIAnalysisResponse:
    suggested_template = (
        service.template_repository.get_by_id(analysis.suggested_template_id)
        if analysis.suggested_template_id is not None
        else None
    )
    return AIAnalysisResponse(
        id=analysis.id,
        meme_id=analysis.meme_id,
        model_name=analysis.model_name,
        suggested_title=analysis.suggested_title,
        description=analysis.description,
        suggestions=AIAnalysisRepository.load_suggestions(analysis),
        created_at=analysis.created_at,
        confirmed_at=analysis.confirmed_at,
        suggested_template=(
            TemplateResponse.model_validate(suggested_template)
            if suggested_template is not None
            else None
        ),
    )


@router.post("", response_model=MemeResponse, status_code=201)
async def upload_meme(
    service: ServiceDependency,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(min_length=1, max_length=255)],
    description: Annotated[str | None, Form()] = None,
    source: Annotated[str | None, Form(max_length=500)] = None,
    tags: Annotated[str | None, Form()] = None,
    template_id: Annotated[str | None, Form()] = None,
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
            template_id=_parse_template_id(template_id),
        )
    except ImageTooLargeError as error:
        # 业务/存储异常在边界处转换为明确的 HTTP 状态码。
        raise HTTPException(status_code=413, detail=str(error)) from error
    except InvalidImageError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Image already exists") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

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


@router.get("/page", response_model=MemePageResponse)
def list_meme_page(
    service: ServiceDependency,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: int = 24,
    tags: Annotated[list[str] | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    sort: Literal["default", "shuffle"] = "default",
    shuffle_seed: int | None = None,
) -> MemePageResponse:
    try:
        result = service.list_meme_page(
            page=page,
            page_size=page_size,
            tags=tags,
            q=q,
            sort=sort,
            shuffle_seed=shuffle_seed,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return MemePageResponse(
        items=[_to_meme_response(meme) for meme in result.items],
        total=result.total,
        page=result.page,
        page_size=result.page_size,
        total_pages=result.total_pages,
        sort=result.sort,
        shuffle_seed=result.shuffle_seed,
    )


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
    request: Request,
    service: ServiceDependency,
    ai_client: AIClientDependency,
) -> AIAnalysisResponse:
    try:
        from app.services.ai_settings_service import AISettingsService
        try:
            embedding_client = AISettingsService(service.session, request.app.state.ai_settings_key_file).build_active_embedding_client()
        except Exception:
            embedding_client = None
        analysis = service.analyze_meme(meme_id, ai_client, embedding_client)
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
    return _to_ai_analysis_response(analysis, service)


@router.get("/{meme_id}/download")
def download_meme(meme_id: int, request: Request, service: ServiceDependency):
    try:
        meme = service.get_meme(meme_id)
    except MemeNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(410, str(error)) from error
    images = list(meme.images)
    if len(images) == 1:
        image = images[0]
        filename = safe_download_filename(
            meme.title, f"meme-{meme.id}", safe_extension(image.original_filename, image.mime_type)
        )
        return FileResponse(
            service.storage.original_path(image.file_path), media_type=image.mime_type,
            filename=filename, content_disposition_type="attachment",
        )
    exports_dir = request.app.state.export_archives_dir
    exports_dir.mkdir(parents=True, exist_ok=True)
    temporary = NamedTemporaryFile(prefix=f"meme-{meme.id}-", suffix=".zip", dir=exports_dir, delete=False)
    temporary_path = Path(temporary.name)
    temporary.close()
    used: set[str] = set()
    manifest_images = []
    try:
        with ZipFile(temporary_path, "w", compression=ZIP_STORED, allowZip64=True) as archive:
            for image in sorted(images, key=lambda item: item.position):
                extension = safe_extension(image.original_filename, image.mime_type)
                stem = sanitize_stem(Path(image.original_filename).stem, f"image-{image.position + 1}")
                arcname = unique_archive_name(f"{image.position + 1:02d}_{stem}{extension}", used)
                archive.write(service.storage.original_path(image.file_path), arcname, compress_type=ZIP_STORED)
                manifest_images.append({
                    "id": image.id, "position": image.position,
                    "original_filename": image.original_filename, "archive_path": arcname,
                    "mime_type": image.mime_type, "file_size": image.file_size,
                    "sha256": image.file_hash,
                })
            manifest = {
                "meme_id": meme.id, "title": meme.title, "description": meme.description,
                "source": meme.source, "tags": [tag.name for tag in meme.tags],
                "template": meme.template.name if meme.template else None,
                "images": manifest_images,
            }
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"), compress_type=ZIP_STORED)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    filename = safe_download_filename(f"{meme.title}_meme_{meme.id}", f"meme-{meme.id}", ".zip")
    return FileResponse(
        temporary_path, media_type="application/zip", filename=filename,
        content_disposition_type="attachment", background=BackgroundTask(temporary_path.unlink, missing_ok=True),
    )


@router.get("/{meme_id}/images/{image_id}/download")
def download_meme_image(meme_id: int, image_id: int, service: ServiceDependency) -> FileResponse:
    meme = service.repository.get_by_id(meme_id)
    if meme is None:
        raise HTTPException(404, f"Meme {meme_id} does not exist")
    image = next((item for item in meme.images if item.id == image_id), None)
    if image is None:
        raise HTTPException(404, f"Image {image_id} does not belong to Meme {meme_id}")
    path = service.storage.original_path(image.file_path)
    if not path.is_file():
        raise HTTPException(410, "Original image is missing")
    extension = safe_extension(image.original_filename, image.mime_type)
    filename = safe_download_filename(Path(image.original_filename).stem, f"meme-{meme_id}-image-{image.id}", extension)
    return FileResponse(path, media_type=image.mime_type, filename=filename, content_disposition_type="attachment")


@router.post("/{meme_id}/images", response_model=MemeResponse)
async def append_meme_image(meme_id: int, service: ServiceDependency, file: Annotated[UploadFile, File()]) -> MemeResponse:
    try:
        return _to_meme_response(service.append_image(meme_id, file.filename or "upload", await file.read()))
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Image already exists") from error
    except ImageTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except InvalidImageError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error


@router.patch("/{meme_id}/images/order", response_model=MemeResponse)
def reorder_meme_images(meme_id: int, payload: ImageOrderRequest, service: ServiceDependency) -> MemeResponse:
    try:
        return _to_meme_response(service.reorder_images(meme_id, payload.image_ids))
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.delete("/{meme_id}/images/{image_id}", response_model=MemeResponse)
def delete_meme_image(meme_id: int, image_id: int, service: ServiceDependency) -> MemeResponse:
    try:
        return _to_meme_response(service.delete_image(meme_id, image_id))
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/{meme_id}/relations", response_model=list[MemeResponse])
def list_meme_relations(meme_id: int, service: ServiceDependency) -> list[MemeResponse]:
    try:
        return [_to_meme_response(meme) for meme in service.list_relations(meme_id)]
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error


@router.post("/{meme_id}/relations", response_model=list[MemeResponse])
def add_meme_relations(meme_id: int, payload: MemeRelationRequest, service: ServiceDependency) -> list[MemeResponse]:
    try:
        return [_to_meme_response(meme) for meme in service.add_relations(meme_id, payload.meme_ids)]
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.delete("/{meme_id}/relations/{related_meme_id}", status_code=204)
def delete_meme_relation(meme_id: int, related_meme_id: int, service: ServiceDependency) -> Response:
    try:
        service.remove_relation(meme_id, related_meme_id)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    return Response(status_code=204)


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
            apply_title=payload.apply_title,
            template_id=payload.template_id,
            apply_template=payload.apply_template,
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
