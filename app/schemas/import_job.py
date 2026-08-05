from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ImportJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    original_filename: str
    status: str
    total_entries: int
    image_entries: int
    processed_count: int
    success_count: int
    skipped_count: int
    failed_count: int
    chunk_size: int
    tags: list[str] = Field(default_factory=list)
    template_id: int | None
    source: str | None
    current_filename: str | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class ImportJobItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entry_index: int
    filename: str
    status: str
    meme_id: int | None
    error_message: str | None
    created_at: datetime


class ImportJobItemPage(BaseModel):
    items: list[ImportJobItemResponse]
    total: int
    offset: int
    limit: int
