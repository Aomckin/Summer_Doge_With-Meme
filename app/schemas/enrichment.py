from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SuggestionSource = Literal["luna", "provider", "manual_import"]
SuggestionStatus = Literal[
    "pending", "partially_accepted", "accepted", "rejected", "applied",
    "stale", "failed", "superseded",
]


class EnrichmentCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    meme_id: int = Field(gt=0)
    suggested_title: str | None = Field(default=None, max_length=255)
    suggested_description: str | None = Field(default=None, max_length=2000)
    add_tags: list[str] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)
    suggested_template_id: int | None = Field(default=None, gt=0)
    suggested_template_name: str | None = Field(default=None, max_length=100)
    confidence: dict[str, float | None] | None = None
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("suggested_title", "suggested_description", "suggested_template_name", "reason")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("add_tags", "remove_tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for raw in values:
            value = raw.strip().lower()
            if not value or len(value) > 100:
                raise ValueError("tag names must contain 1 to 100 characters")
            if value not in normalized:
                normalized.append(value)
        return normalized

    @model_validator(mode="after")
    def disjoint_tags(self) -> "EnrichmentCandidate":
        overlap = set(self.add_tags) & set(self.remove_tags)
        if overlap:
            raise ValueError("tags cannot be both added and removed: " + ", ".join(sorted(overlap)))
        if self.suggested_template_id is not None and self.suggested_template_name is not None:
            raise ValueError("use either suggested_template_id or suggested_template_name")
        return self

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, value: dict[str, float | None] | None):
        if value is None:
            return None
        allowed = {"title", "description", "tags", "template"}
        if set(value) - allowed:
            raise ValueError("unsupported confidence field")
        if any(item is not None and not 0 <= item <= 1 for item in value.values()):
            raise ValueError("confidence values must be between 0 and 1")
        return value


class EnrichmentSuggestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meme_id: int
    source: str
    provider_id: int | None
    model_record_id: int | None
    model_id_snapshot: str | None
    job_id: int | None
    suggested_title: str | None
    suggested_description: str | None
    suggested_template_id: int | None
    add_tags: list[str]
    remove_tags: list[str]
    confidence: dict[str, float | None]
    reason: str | None
    status: str
    source_hash: str
    stale: bool
    applied_fields: list[str]
    created_at: datetime
    reviewed_at: datetime | None
    applied_at: datetime | None


class EnrichmentSuggestionPage(BaseModel):
    items: list[EnrichmentSuggestionResponse]
    total: int
    offset: int
    limit: int


class EnrichmentApplyRequest(BaseModel):
    fields: list[Literal["title", "description", "add_tags", "remove_tags", "template"]]
    allow_stale: bool = False

    @field_validator("fields")
    @classmethod
    def unique_nonempty(cls, fields: list[str]) -> list[str]:
        values = list(dict.fromkeys(fields))
        if not values:
            raise ValueError("at least one field must be selected")
        return values


class EnrichmentJobCreate(BaseModel):
    scope: Literal[
        "all", "filtered", "missing_description", "missing_tags", "missing_template",
        "filename_title", "never_analyzed", "stale_suggestions", "id_range",
    ] = "all"
    query: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list)
    start_meme_id: int | None = Field(default=None, gt=0)
    end_meme_id: int | None = Field(default=None, gt=0)
    analyze_title: bool = True
    analyze_description: bool = True
    analyze_tags: bool = True
    analyze_template: bool = True
    max_workers: Literal[1, 2, 4, 8] = 2

    @model_validator(mode="after")
    def has_field(self) -> "EnrichmentJobCreate":
        if not any((self.analyze_title, self.analyze_description, self.analyze_tags, self.analyze_template)):
            raise ValueError("at least one metadata field must be selected")
        if self.scope == "id_range":
            if self.start_meme_id is None or self.end_meme_id is None:
                raise ValueError("start_meme_id and end_meme_id are required for id_range")
            if self.start_meme_id > self.end_meme_id:
                raise ValueError("start_meme_id must be less than or equal to end_meme_id")
        return self


class EnrichmentJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    scope: str
    start_meme_id: int | None
    end_meme_id: int | None
    provider_id: int | None
    model_record_id: int | None
    model_id_snapshot: str
    analyze_title: bool
    analyze_description: bool
    analyze_tags: bool
    analyze_template: bool
    total_count: int
    processed_count: int
    success_count: int
    skipped_count: int
    failed_count: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    max_workers: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class EnrichmentJobEstimate(BaseModel):
    total_count: int
    estimated_requests: int


class EnrichmentJobItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    meme_id: int
    status: str
    attempt_count: int
    suggestion_id: int | None
    error_message: str | None
    response_summary: str | None
    input_tokens: int
    output_tokens: int
    total_tokens: int
    started_at: datetime | None
    completed_at: datetime | None


class EnrichmentJobItemPage(BaseModel):
    items: list[EnrichmentJobItemResponse]
    total: int
    offset: int
    limit: int
