from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.meme import MemeResponse


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_changes(self) -> "CollectionUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Collection name cannot be null")
        return self


class CollectionMemeAdd(BaseModel):
    meme_id: int = Field(ge=1)


class MemeCollectionsUpdate(BaseModel):
    collection_ids: list[int] = Field(max_length=500)

    @model_validator(mode="after")
    def validate_ids(self) -> "MemeCollectionsUpdate":
        if any(value < 1 for value in self.collection_ids):
            raise ValueError("Collection IDs must be positive")
        if len(set(self.collection_ids)) != len(self.collection_ids):
            raise ValueError("Collection IDs must be unique")
        return self


class MemeCollectionsResponse(BaseModel):
    collection_ids: list[int]


class CollectionSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    meme_count: int
    created_at: datetime
    updated_at: datetime


class CollectionItemResponse(BaseModel):
    position: int
    added_at: datetime
    meme: MemeResponse


class CollectionDetailResponse(CollectionSummaryResponse):
    items: list[CollectionItemResponse]
