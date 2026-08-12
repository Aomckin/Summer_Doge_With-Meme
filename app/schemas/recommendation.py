from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ChatRecommendationRequest(BaseModel):
    context: str = Field(min_length=1, max_length=4000)
    response_intent: str | None = Field(default=None, max_length=200)
    page: int = Field(default=1, ge=1)
    page_size: Literal[12] = 12

    @field_validator("context")
    @classmethod
    def normalize_context(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("context must not be empty")
        return normalized

    @field_validator("response_intent")
    @classmethod
    def normalize_response_intent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None
