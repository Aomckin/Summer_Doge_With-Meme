# Pydantic Schema 负责 API 边界的数据校验与序列化，不直接执行数据库操作。
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.template import TemplateResponse


class TagResponse(BaseModel):
    # from_attributes=True 允许直接从 SQLAlchemy ORM 对象读取同名属性。
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str
    description: str | None
    created_at: datetime
    usage_count: int = 0


class TagRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TagMergeRequest(BaseModel):
    target_tag_id: int = Field(gt=0)


class TagCleanupRequest(BaseModel):
    confirm: bool


class TagCleanupResponse(BaseModel):
    deleted_count: int
    deleted_tags: list[str]


class MemeCreate(BaseModel):
    # 创建请求只包含用户填写的元数据；文件尺寸、哈希等由后端计算。
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    source: str | None = Field(default=None, max_length=500)


class MemeUpdate(BaseModel):
    # PATCH 是“部分修改”，所以每个字段默认都可以不传。
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    source: str | None = Field(default=None, max_length=500)
    tags: list[str] | None = None
    template_id: int | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "MemeUpdate":
        # model_fields_set 能区分“客户端没传字段”和“客户端明确传了 null”。
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("Title cannot be null")
        return self


class MemeResponse(MemeCreate):
    # 响应在用户元数据之外，还返回系统生成的文件与数据库信息。
    model_config = ConfigDict(from_attributes=True)

    id: int
    original_filename: str
    stored_filename: str
    image_url: str
    thumbnail_url: str | None
    mime_type: str
    file_size: int
    width: int
    height: int
    file_hash: str
    created_at: datetime
    updated_at: datetime
    tags: list[TagResponse] = Field(default_factory=list)
    template: TemplateResponse | None = None
    images: list["MemeImageResponse"] = Field(default_factory=list)
    image_count: int = 1


class MemeImageResponse(BaseModel):
    id: int
    original_filename: str
    stored_filename: str
    image_url: str
    thumbnail_url: str | None
    mime_type: str
    file_size: int
    width: int
    height: int
    file_hash: str
    position: int
    created_at: datetime


class ImageOrderRequest(BaseModel):
    image_ids: list[int] = Field(min_length=1)


class MemeRelationRequest(BaseModel):
    meme_ids: list[int]
