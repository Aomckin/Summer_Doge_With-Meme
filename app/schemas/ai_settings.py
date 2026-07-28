from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AIProtocol = Literal["openai_responses", "openai_chat_completions", "dashscope_multimodal_embedding"]


class PresetModelResponse(BaseModel):
    model_id: str
    display_name: str
    supports_vision: bool
    supports_image_embedding: bool = False


class ProviderPresetResponse(BaseModel):
    id: str
    name: str
    base_url: str
    protocol: AIProtocol
    description: str
    models: list[PresetModelResponse]


class ProviderCreate(BaseModel):
    preset_id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    protocol: AIProtocol
    base_url: str = Field(min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=1000)
    timeout_seconds: float = Field(default=30, gt=0, le=600)
    max_retries: int = Field(default=1, ge=0, le=5)
    retry_delay_seconds: float = Field(default=1, ge=0, le=60)
    enabled: bool = True


class ProviderUpdate(BaseModel):
    name: str = Field(default="", min_length=1, max_length=100)
    protocol: AIProtocol = "openai_responses"
    base_url: str = Field(default="", min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=1000)
    timeout_seconds: float = Field(default=30, gt=0, le=600)
    max_retries: int = Field(default=1, ge=0, le=5)
    retry_delay_seconds: float = Field(default=1, ge=0, le=60)
    enabled: bool = True


class ProviderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    protocol: str
    base_url: str
    has_api_key: bool
    api_key_hint: str | None
    timeout_seconds: float
    max_retries: int
    retry_delay_seconds: float
    enabled: bool
    created_at: datetime
    updated_at: datetime


class ModelCreate(BaseModel):
    provider_id: int
    model_id: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    supports_vision: bool = False
    supports_image_embedding: bool = False
    enabled: bool = True
    is_active: bool = False


class ModelUpdate(BaseModel):
    model_id: str = Field(default="", min_length=1, max_length=200)
    display_name: str = Field(default="", min_length=1, max_length=200)
    supports_vision: bool = False
    supports_image_embedding: bool = False
    is_embedding_active: bool = False
    enabled: bool = True
    is_active: bool = False


class ModelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider_id: int
    model_id: str
    display_name: str
    supports_vision: bool
    supports_image_embedding: bool
    enabled: bool
    is_active: bool
    is_embedding_active: bool
    created_at: datetime
    updated_at: datetime


class ConnectionTestResponse(BaseModel):
    ok: bool
    message: str
    model_count: int
