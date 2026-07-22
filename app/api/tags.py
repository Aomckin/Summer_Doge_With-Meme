from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.memes import get_meme_service
from app.schemas.meme import TagResponse
from app.services.meme_service import MemeService


# 标签接口复用 Meme API 的 Service 依赖组装方式，保证数据库会话规则一致。
router = APIRouter(prefix="/api/tags", tags=["tags"])
ServiceDependency = Annotated[MemeService, Depends(get_meme_service)]


@router.get("", response_model=list[TagResponse])
def list_tags(service: ServiceDependency) -> list[TagResponse]:
    # ORM Tag 逐个转换为公开 Schema，响应中只包含接口承诺的字段。
    return [TagResponse.model_validate(tag) for tag in service.list_tags()]
