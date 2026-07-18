from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str
    description: str | None
    created_at: datetime


class MemeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    source: str | None = Field(default=None, max_length=500)


class MemeUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    source: str | None = Field(default=None, max_length=500)
    tags: list[str] | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "MemeUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("Title cannot be null")
        return self


class MemeResponse(MemeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    original_filename: str
    stored_filename: str
    file_path: str
    thumbnail_path: str | None
    mime_type: str
    file_size: int
    width: int
    height: int
    file_hash: str
    created_at: datetime
    updated_at: datetime
    tags: list[TagResponse] = Field(default_factory=list)
