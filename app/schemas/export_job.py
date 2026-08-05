from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ExportJobCreate(BaseModel):
    scope: Literal["all", "filtered"] = "all"
    query: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list)
    template_id: int | None = Field(default=None, ge=1)
    organization: Literal["flat", "template", "tag"] = "flat"
    include_manifest: bool = True
    archive_name: str = Field(default="meme-vault-export", max_length=255)

    @model_validator(mode="after")
    def normalize_scope(self):
        if not self.include_manifest:
            raise ValueError("manifest.json is required in v0.5.4")
        if self.scope == "all":
            self.query = None
            self.tags = []
            self.template_id = None
        self.tags = list(dict.fromkeys(tag.strip().lower() for tag in self.tags if tag.strip()))
        return self


class ExportJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    scope: str
    query: str | None
    tags: list[str]
    template_id: int | None
    organization: str
    include_manifest: bool
    archive_name: str
    total_memes: int
    total_images: int
    processed_memes: int
    processed_images: int
    success_count: int
    skipped_count: int
    failed_count: int
    estimated_bytes: int
    archive_size: int | None
    current_meme_id: int | None
    current_filename: str | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    expires_at: datetime | None


class ExportJobItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    meme_id: int
    image_id: int
    status: str
    archive_filename: str | None
    file_size: int
    error_message: str | None
    created_at: datetime


class ExportJobItemPage(BaseModel):
    items: list[ExportJobItemResponse]
    total: int
    offset: int
    limit: int
