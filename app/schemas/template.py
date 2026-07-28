from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "TemplateUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Template name cannot be null")
        return self


class TemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    reference_image_url: str | None = None
    reference_thumbnail_url: str | None = None
    reference_mime_type: str | None = None
    reference_width: int | None = None
    reference_height: int | None = None
    created_at: datetime
    updated_at: datetime
