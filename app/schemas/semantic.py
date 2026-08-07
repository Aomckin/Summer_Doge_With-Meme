from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.meme import MemeResponse


class SemanticSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    tags: list[str] = Field(default_factory=list)
    page: int = Field(default=1, ge=1)
    page_size: Literal[24, 48, 96] = 48

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("query must contain at least 2 characters")
        return normalized


class ScoredMeme(BaseModel):
    meme: MemeResponse
    score: float


class SemanticSearchResponse(BaseModel):
    items: list[ScoredMeme]
    total: int
    page: int
    page_size: int
    total_pages: int
    indexed_count: int
    missing_count: int
    model_id: str


class SimilarMemeResponse(BaseModel):
    items: list[ScoredMeme]


class SemanticIndexStatusResponse(BaseModel):
    total_memes: int
    ready_count: int
    missing_count: int
    stale_count: int
    failed_count: int
    incompatible_count: int
    active_model_id: str | None
    dimension: int
    running_job: dict[str, object] | None


class MemeEmbeddingStatusResponse(BaseModel):
    meme_id: int
    status: Literal["ready", "stale", "failed"]
    model_id: str = Field(validation_alias="model_id_snapshot")
    dimension: int
    embedding_kind: str
    indexed_image_count: int
    total_image_count: int
    text_tokens: int
    image_tokens: int
    total_tokens: int
    last_error: str | None
    indexed_at: datetime | None
