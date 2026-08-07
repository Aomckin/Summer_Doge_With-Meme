from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EmbeddingJobCreate(BaseModel):
    scope: Literal["missing_or_stale", "failed", "all"] = "missing_or_stale"
    max_workers: int = Field(default=4, ge=1, le=8)


class EmbeddingJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    scope: str
    model_record_id: int
    model_id_snapshot: str
    dimension: int
    max_workers: int
    total_count: int
    processed_count: int
    success_count: int
    skipped_count: int
    failed_count: int
    text_tokens: int
    image_tokens: int
    total_tokens: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class EmbeddingJobItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    meme_id: int
    source_hash: str
    status: str
    attempt_count: int
    text_tokens: int
    image_tokens: int
    total_tokens: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class EmbeddingJobItemPage(BaseModel):
    items: list[EmbeddingJobItemResponse]
    total: int
    offset: int
    limit: int
