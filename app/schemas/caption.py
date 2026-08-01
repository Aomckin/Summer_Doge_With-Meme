from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CaptionLength = Literal["short", "medium", "long"]
CaptionSource = Literal["manual", "ai"]
RewriteAction = Literal["polish", "shorten", "expand", "retone"]


class CaptionMetadata(BaseModel):
    scene: str | None = Field(default=None, max_length=100)
    tone: str | None = Field(default=None, max_length=100)
    length: CaptionLength | None = None

    @field_validator("scene", "tone")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        normalized = (value or "").strip()
        return normalized or None


class CaptionCreate(CaptionMetadata):
    content: str = Field(min_length=1, max_length=2000)
    source: CaptionSource = "manual"

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("content cannot be blank")
        return normalized


class CaptionUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    scene: str | None = Field(default=None, max_length=100)
    tone: str | None = Field(default=None, max_length=100)
    length: CaptionLength | None = None

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("content cannot be blank")
        return normalized

    @field_validator("scene", "tone")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        normalized = (value or "").strip()
        return normalized or None

    @model_validator(mode="after")
    def require_change(self) -> "CaptionUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if "content" in self.model_fields_set and self.content is None:
            raise ValueError("content cannot be null")
        return self


class CaptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meme_id: int
    content: str
    scene: str | None
    tone: str | None
    length: CaptionLength | None
    source: CaptionSource
    created_at: datetime
    updated_at: datetime


class CaptionGenerateRequest(CaptionMetadata):
    count: Literal[3, 5, 8] = 5


class CaptionRewriteRequest(CaptionMetadata):
    content: str = Field(min_length=1, max_length=2000)
    action: RewriteAction

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("draft cannot be blank")
        return normalized


class CaptionCandidatesResponse(BaseModel):
    model_name: str
    captions: list[str]
