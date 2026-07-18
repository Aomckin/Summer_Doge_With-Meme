from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.memes import get_meme_service
from app.schemas.meme import TagResponse
from app.services.meme_service import MemeService


router = APIRouter(prefix="/api/tags", tags=["tags"])
ServiceDependency = Annotated[MemeService, Depends(get_meme_service)]


@router.get("", response_model=list[TagResponse])
def list_tags(service: ServiceDependency) -> list[TagResponse]:
    return [TagResponse.model_validate(tag) for tag in service.list_tags()]
