"""Multi-Vault API：Vault CRUD、Vault 作用域资产端点与 Vault 媒体服务。"""
from typing import Annotated, Literal

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
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.client import (
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
)
from app.api.mappers import meme_to_response
from app.api.memes import _parse_tags, _parse_template_id
from app.api.tags import get_tag_service
from app.database import get_db
from app.schemas.meme import MemePageResponse, MemeResponse, MemeUpdate, TagResponse
from app.schemas.semantic import (
    ScoredMeme,
    SemanticSearchRequest,
    SemanticSearchResponse,
)
from app.schemas.vault import VaultCreate, VaultResponse, VaultUpdate
from app.services.meme_service import (
    MemeFileMissingError,
    MemeNotFoundError,
    MemeService,
    NoMemesAvailableError,
)
from app.services.semantic_search_service import (
    MemeEmbeddingUnavailableError,
    SemanticSearchService,
)
from app.services.asset_metadata_service import (
    ensure_profile_metadata,
    set_profile_metadata,
)
from app.services.tag_service import TagService
from app.services.vault_service import (
    VaultNotEmptyError,
    VaultNotFoundError,
    VaultProtectedError,
    VaultSlugConflictError,
    VaultService,
)
from app.storage.image_storage import (
    FORMAT_DETAILS,
    ImageStorage,
    ImageTooLargeError,
    InvalidImageError,
)
from app.storage.vault_storage import VaultStorageError, VaultStorageService


def get_semantic_service_for_vault(
    request: Request,
    session: Session,
    vault_id: int,
) -> SemanticSearchService:
    """按 Vault 解析存储目录的语义搜索服务（用于文件可用性检查）。"""
    from app.repositories.vault_repository import VaultRepository

    vault_storage: VaultStorageService = request.app.state.vault_storage
    vault = VaultRepository(session).get_by_id(vault_id)
    if vault is not None:
        storage = vault_storage.storage_for(vault)
    else:
        storage = ImageStorage(
            request.app.state.images_dir, request.app.state.thumbnails_dir
        )
    return SemanticSearchService(
        session,
        storage,
        request.app.state.ai_settings_key_file,
        request.app.state.semantic_index,
        request.app.state.semantic_search_cache,
    )


router = APIRouter(tags=["vaults"])


def _resolve_background_url(vault: object, vault_storage: VaultStorageService) -> str | None:
    """独立上传的背景图解析为专用 URL；文件缺失时返回 None（前端回退默认背景）。

    背景文件保存在 data/backgrounds/vault-{id}/，与业务 Asset 完全分离。
    """
    import json

    if not vault.appearance_json:
        return None
    try:
        data = json.loads(vault.appearance_json)
    except ValueError:
        return None
    filename = data.get("backgroundUploadFile") if isinstance(data, dict) else None
    if not isinstance(filename, str) or not filename:
        return None
    if not vault_storage.background_path(vault.id, filename).is_file():
        return None
    # 文件名随每次上传变化：作为缓存版本，替换背景后浏览器立即拉取新图。
    return f"/api/vaults/{vault.id}/background-image?v={filename}"


def _vault_response(service: VaultService, vault: object) -> VaultResponse:
    return VaultResponse.from_vault(
        vault,
        service.repository.count_memes(vault.id),
        appearance=service.resolved_appearance(vault),
        background_image_url=_resolve_background_url(vault, service.vault_storage),
    )


def get_vault_service(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> VaultService:
    vault_storage: VaultStorageService = request.app.state.vault_storage
    return VaultService(session, vault_storage)


VaultServiceDependency = Annotated[VaultService, Depends(get_vault_service)]


def get_vault_meme_service(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
    vault_id: int,
) -> MemeService:
    """Vault 作用域资产端点依赖：存储目录按目标 Vault 解析。"""
    vault_storage: VaultStorageService = request.app.state.vault_storage
    vault = VaultService(session, vault_storage).get_vault(vault_id)
    return MemeService(session, vault_storage.storage_for(vault))


VaultMemeServiceDependency = Annotated[MemeService, Depends(get_vault_meme_service)]


def _translate_vault_errors(error: Exception) -> HTTPException:
    if isinstance(error, VaultNotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, VaultSlugConflictError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, VaultNotEmptyError):
        return HTTPException(
            status_code=409,
            detail=str(error),
            headers={"X-Requires-Force": "true"},
        )
    if isinstance(error, VaultProtectedError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, VaultStorageError):
        return HTTPException(status_code=422, detail=str(error))
    return HTTPException(status_code=422, detail=str(error))


@router.get("/api/vaults", response_model=list[VaultResponse])
def list_vaults(service: VaultServiceDependency) -> list[VaultResponse]:
    return [_vault_response(service, vault) for vault, _count in service.repository.list_all()]


@router.post("/api/vaults", response_model=VaultResponse, status_code=201)
def create_vault(
    payload: VaultCreate,
    service: VaultServiceDependency,
) -> VaultResponse:
    try:
        vault = service.create_vault(**payload.model_dump())
    except (VaultSlugConflictError, ValueError) as error:
        raise _translate_vault_errors(error) from error
    return _vault_response(service, vault)


@router.get("/api/vaults/{vault_id}", response_model=VaultResponse)
def get_vault(vault_id: int, service: VaultServiceDependency) -> VaultResponse:
    try:
        vault = service.get_vault(vault_id)
    except VaultNotFoundError as error:
        raise _translate_vault_errors(error) from error
    return _vault_response(service, vault)


@router.patch("/api/vaults/{vault_id}", response_model=VaultResponse)
def update_vault(
    vault_id: int,
    payload: VaultUpdate,
    service: VaultServiceDependency,
) -> VaultResponse:
    try:
        vault = service.update_vault(
            vault_id, payload.model_dump(exclude_unset=True)
        )
    except (VaultNotFoundError, ValueError) as error:
        raise _translate_vault_errors(error) from error
    return _vault_response(service, vault)


class _VaultAppearancePayload(BaseModel):
    appearance: dict[str, object]


@router.patch("/api/vaults/{vault_id}/appearance", response_model=VaultResponse)
def update_vault_appearance(
    vault_id: int,
    payload: _VaultAppearancePayload,
    service: VaultServiceDependency,
) -> VaultResponse:
    """保存 Vault 视觉主题；字段与取值由 vault_themes 校验，非法取值 422。"""
    try:
        vault = service.update_appearance(vault_id, payload.appearance)
    except VaultNotFoundError as error:
        raise _translate_vault_errors(error) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _vault_response(service, vault)


# PIL 图像格式 → 文件扩展名（上传背景校验用）。
BACKGROUND_FORMAT_EXTENSIONS = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
    "GIF": ".gif",
}
BACKGROUND_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
MAX_BACKGROUND_IMAGE_BYTES = 25 * 1024 * 1024


def _load_vault_for_request(session: Session, request: Request, vault_id: int) -> object:
    vault = VaultService(session, request.app.state.vault_storage).get_vault(vault_id)
    return vault


@router.patch("/api/vaults/{vault_id}/background-image", response_model=VaultResponse)
async def upload_vault_background_image(
    vault_id: int,
    request: Request,
    service: VaultServiceDependency,
    file: Annotated[UploadFile, File()],
) -> VaultResponse:
    """上传本仓库专属背景图；与业务 Asset 完全分离，保存在 data/backgrounds/。"""
    from io import BytesIO

    from PIL import Image, UnidentifiedImageError

    content = await file.read()
    if len(content) > MAX_BACKGROUND_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="背景图片不能超过 25 MiB")
    if not content:
        raise HTTPException(status_code=415, detail="背景图片不能为空")
    try:
        with Image.open(BytesIO(content)) as image:
            image_format = image.format
    except (UnidentifiedImageError, OSError) as error:
        raise HTTPException(status_code=415, detail="仅支持 JPG、PNG、WebP 或 GIF 背景图片") from error
    extension = BACKGROUND_FORMAT_EXTENSIONS.get((image_format or "").upper(), None)
    if extension is None:
        raise HTTPException(status_code=415, detail="仅支持 JPG、PNG、WebP 或 GIF 背景图片")

    vault = service.get_vault(vault_id)
    vault_storage: VaultStorageService = request.app.state.vault_storage
    from uuid import uuid4

    filename = f"background-{uuid4().hex[:12]}{extension}"
    directory = vault_storage.background_dir(vault_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / filename).write_bytes(content)

    import json as _json

    try:
        merged = _json.loads(vault.appearance_json or "{}")
    except ValueError:
        merged = {}
    previous = merged.get("backgroundUploadFile") if isinstance(merged, dict) else None
    merged["backgroundUploadFile"] = filename
    merged.pop("presetId", None)
    vault.appearance_json = _json.dumps(merged, ensure_ascii=False)
    try:
        service.session.commit()
    except Exception:
        service.session.rollback()
        (directory / filename).unlink(missing_ok=True)
        raise
    # 提交成功后移除旧背景文件，保持每仓只保留当前背景。
    if isinstance(previous, str) and previous and previous != filename:
        vault_storage.background_path(vault_id, previous).unlink(missing_ok=True)
    service.session.refresh(vault)
    return _vault_response(service, vault)


@router.get("/api/vaults/{vault_id}/background-image", include_in_schema=False)
def get_vault_background_image(
    vault_id: int,
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    from fastapi.responses import FileResponse as _FileResponse

    vault = _load_vault_for_request(session, request, vault_id)
    vault_storage: VaultStorageService = request.app.state.vault_storage
    import json as _json

    try:
        data = _json.loads(vault.appearance_json or "{}")
    except ValueError:
        raise HTTPException(status_code=404, detail="Background not found") from None
    filename = data.get("backgroundUploadFile")
    if not isinstance(filename, str) or not filename:
        raise HTTPException(status_code=404, detail="Background not found")
    path = vault_storage.background_path(vault_id, filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Background not found")
    media_types = BACKGROUND_MEDIA_TYPES
    return _FileResponse(path, media_type=media_types.get(path.suffix.lower(), "application/octet-stream"))


@router.delete("/api/vaults/{vault_id}/background-image", response_model=VaultResponse)
def delete_vault_background_image(
    vault_id: int,
    request: Request,
    service: VaultServiceDependency,
) -> VaultResponse:
    """清除本仓库上传的背景图（文件与外观引用一并移除）。"""
    vault = service.get_vault(vault_id)
    vault_storage: VaultStorageService = request.app.state.vault_storage
    import json as _json

    try:
        data = _json.loads(vault.appearance_json or "{}")
    except ValueError:
        data = {}
    filename = data.get("backgroundUploadFile") if isinstance(data, dict) else None
    if isinstance(filename, str) and filename:
        vault_storage.background_path(vault_id, filename).unlink(missing_ok=True)
        data.pop("backgroundUploadFile", None)
        vault.appearance_json = _json.dumps(data, ensure_ascii=False) if data else None
        service.session.commit()
    service.session.refresh(vault)
    return _vault_response(service, vault)


@router.delete("/api/vaults/{vault_id}", status_code=204)
def delete_vault(
    vault_id: int,
    service: VaultServiceDependency,
    force: Annotated[bool, Query(description="非空 Vault 必须显式 force")] = False,
) -> Response:
    try:
        service.delete_vault(vault_id, force=force)
    except (VaultNotFoundError, VaultNotEmptyError, VaultProtectedError) as error:
        raise _translate_vault_errors(error) from error
    return Response(status_code=204)


@router.get("/api/vaults/{vault_id}/memes", response_model=list[MemeResponse])
def list_vault_memes(
    vault_id: int,
    service: VaultMemeServiceDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    tags: Annotated[list[str] | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    template_id: Annotated[int | None, Query(ge=1)] = None,
    gif_only: bool = False,
    orientation: Annotated[Literal["portrait", "landscape", "square"] | None, Query()] = None,
    favorite: bool = False,
) -> list[MemeResponse]:
    try:
        memes = service.list_memes(
            vault_id=vault_id,
            offset=offset,
            limit=limit,
            tags=tags,
            q=q,
            template_id=template_id,
            gif_only=gif_only,
            orientation=orientation,
            favorite=favorite,
            search_metadata=_vault_uses_metadata(service.session, vault_id),
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return [meme_to_response(meme) for meme in memes]


def _vault_uses_metadata(session: Session, vault_id: int) -> bool:
    """带 Typed Metadata 的 Profile：关键词搜索扩展到元数据字段。"""
    from app.repositories.vault_repository import VaultRepository
    from app.vault_profiles import supports_typed_metadata

    vault = VaultRepository(session).get_by_id(vault_id)
    return vault is not None and supports_typed_metadata(vault.profile or "generic")


@router.get("/api/vaults/{vault_id}/memes/page", response_model=MemePageResponse)
def list_vault_meme_page(
    vault_id: int,
    service: VaultMemeServiceDependency,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: int = 24,
    tags: Annotated[list[str] | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    template_id: Annotated[int | None, Query(ge=1)] = None,
    gif_only: bool = False,
    sort: Literal["default", "shuffle"] = "default",
    shuffle_seed: int | None = None,
    orientation: Annotated[Literal["portrait", "landscape", "square"] | None, Query()] = None,
    favorite: bool = False,
) -> MemePageResponse:
    try:
        result = service.list_meme_page(
            vault_id=vault_id,
            page=page,
            page_size=page_size,
            tags=tags,
            q=q,
            template_id=template_id,
            gif_only=gif_only,
            sort=sort,
            shuffle_seed=shuffle_seed,
            orientation=orientation,
            favorite=favorite,
            search_metadata=_vault_uses_metadata(service.session, vault_id),
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return MemePageResponse(
        items=[meme_to_response(meme) for meme in result.items],
        total=result.total,
        page=result.page,
        page_size=result.page_size,
        total_pages=result.total_pages,
        sort=result.sort,
        shuffle_seed=result.shuffle_seed,
    )


@router.post("/api/vaults/{vault_id}/memes", response_model=MemeResponse, status_code=201)
async def upload_vault_meme(
    vault_id: int,
    request: Request,
    service: VaultMemeServiceDependency,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(min_length=1, max_length=255)],
    description: Annotated[str | None, Form()] = None,
    source: Annotated[str | None, Form(max_length=500)] = None,
    tags: Annotated[str | None, Form()] = None,
    template_id: Annotated[str | None, Form()] = None,
) -> MemeResponse:
    content = await file.read()
    try:
        meme = service.create_meme(
            file.filename or "upload",
            content,
            vault_id=vault_id,
            title=title,
            description=description,
            source=source,
            tags=_parse_tags(tags),
            template_id=_parse_template_id(template_id),
        )
        # Profile 上传管线：anime 等带 Typed Metadata 的仓库自动预填方向等初始字段。
        vault = VaultService(service.session, request.app.state.vault_storage).get_vault(vault_id)
        ensure_profile_metadata(service.session, meme, vault.profile or "generic")
        service.session.commit()
        # 提交后刷新，让 selectin 关系（asset_metadata）反映新行。
        service.session.refresh(meme)
    except ImageTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except InvalidImageError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Image already exists") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return meme_to_response(meme)


@router.get("/api/vaults/{vault_id}/memes/random", response_model=MemeResponse)
def get_vault_random_meme(
    vault_id: int,
    service: VaultMemeServiceDependency,
    tags: Annotated[list[str] | None, Query()] = None,
    template_id: Annotated[int | None, Query(ge=1)] = None,
    gif_only: bool = False,
    orientation: Annotated[Literal["portrait", "landscape", "square"] | None, Query()] = None,
    favorite: bool = False,
) -> MemeResponse:
    try:
        meme = service.get_random_meme(
            vault_id=vault_id,
            tags=tags,
            template_id=template_id,
            gif_only=gif_only,
            orientation=orientation,
            favorite=favorite,
        )
    except NoMemesAvailableError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    return meme_to_response(meme)


@router.get("/api/vaults/{vault_id}/memes/{meme_id}", response_model=MemeResponse)
def get_vault_meme(
    vault_id: int,
    meme_id: int,
    service: VaultMemeServiceDependency,
) -> MemeResponse:
    try:
        meme = service.get_meme(meme_id, vault_id=vault_id)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    return meme_to_response(meme)


@router.patch("/api/vaults/{vault_id}/memes/{meme_id}", response_model=MemeResponse)
def update_vault_meme(
    vault_id: int,
    meme_id: int,
    payload: MemeUpdate,
    service: VaultMemeServiceDependency,
) -> MemeResponse:
    try:
        # 先确认归属，再走既有编辑链；MemeService 内部同样校验 vault。
        service.get_meme(meme_id, vault_id=vault_id)
        meme = service.update_meme(meme_id, payload.model_dump(exclude_unset=True))
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemeFileMissingError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return meme_to_response(meme)


@router.delete("/api/vaults/{vault_id}/memes/{meme_id}", status_code=204)
def delete_vault_meme(
    vault_id: int,
    meme_id: int,
    service: VaultMemeServiceDependency,
) -> Response:
    try:
        service.delete_meme(meme_id, vault_id=vault_id)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=204)


class _ProfileMetadataPayload(BaseModel):
    data: dict[str, object]


@router.patch("/api/vaults/{vault_id}/memes/{meme_id}/metadata", response_model=MemeResponse)
def update_vault_meme_metadata(
    vault_id: int,
    meme_id: int,
    payload: _ProfileMetadataPayload,
    request: Request,
    service: VaultMemeServiceDependency,
) -> MemeResponse:
    """手工编辑 Profile 专属元数据（anime：作品/角色/画师/收藏度/来源等）。"""
    from app.vault_profiles import supports_typed_metadata

    try:
        meme = service.get_meme(meme_id, vault_id=vault_id)
        vault = VaultService(service.session, request.app.state.vault_storage).get_vault(vault_id)
        profile = vault.profile or "generic"
        if not supports_typed_metadata(profile):
            raise HTTPException(
                status_code=422,
                detail=f"Profile {profile!r} does not support typed metadata",
            )
        set_profile_metadata(service.session, meme, profile, payload.data)
        service.session.commit()
        service.session.refresh(meme)
    except MemeNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return meme_to_response(meme)


@router.get("/api/vaults/{vault_id}/tags", response_model=list[TagResponse])
def list_vault_tags(
    vault_id: int,
    service: VaultServiceDependency,
    tag_service: Annotated[TagService, Depends(get_tag_service)],
    include_empty: bool = False,
    q: Annotated[str | None, Query(max_length=100)] = None,
    sort: Literal["name_asc", "name_desc", "usage_asc", "usage_desc"] = "name_asc",
) -> list[TagResponse]:
    try:
        service.get_vault(vault_id)
        rows = tag_service.list_tags(
            include_empty=include_empty, q=q, sort=sort, vault_id=vault_id
        )
    except VaultNotFoundError as error:
        raise _translate_vault_errors(error) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return [TagResponse.model_validate(row) for row in rows]


@router.post("/api/vaults/{vault_id}/semantic-search", response_model=SemanticSearchResponse)
def vault_semantic_search(
    vault_id: int,
    request: Request,
    service: VaultServiceDependency,
    payload: SemanticSearchRequest,
    session: Annotated[Session, Depends(get_db)],
) -> SemanticSearchResponse:
    try:
        service.get_vault(vault_id)
    except VaultNotFoundError as error:
        raise _translate_vault_errors(error) from error
    semantic_service = get_semantic_service_for_vault(request, session, vault_id)
    try:
        result = semantic_service.search(**payload.model_dump(), vault_id=vault_id)
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


# ---- Vault 媒体服务：动态目录，路径经 VaultStorageService 边界校验 ----


def _vault_media_response(
    request: Request,
    slug: str,
    kind: Literal["images", "thumbnails"],
    filename: str,
    session: Session,
) -> FileResponse:
    try:
        vault = VaultService(session, request.app.state.vault_storage).get_vault_by_slug(slug)
    except VaultNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    vault_storage: VaultStorageService = request.app.state.vault_storage
    root = (
        vault_storage.images_dir(vault)
        if kind == "images"
        else vault_storage.thumbnails_dir(vault)
    )
    try:
        candidate = (root / ImageStorage.filename_from_reference(filename)).resolve()
        candidate.relative_to(root)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Media not found") from error
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="Media not found")
    if kind == "thumbnails":
        return FileResponse(candidate, media_type="image/png")
    mime_map = {extension: mime for _, (extension, mime) in FORMAT_DETAILS.items()}
    media_type = mime_map.get(candidate.suffix.lower(), "application/octet-stream")
    return FileResponse(candidate, media_type=media_type)


@router.get("/media/vaults/{slug}/images/{filename}", include_in_schema=False)
def vault_media_image(
    slug: str,
    filename: str,
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    return _vault_media_response(request, slug, "images", filename, session)


@router.get("/media/vaults/{slug}/thumbnails/{filename}", include_in_schema=False)
def vault_media_thumbnail(
    slug: str,
    filename: str,
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    return _vault_media_response(request, slug, "thumbnails", filename, session)
