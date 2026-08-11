from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TagCandidate(BaseModel):
    """One Luna metadata candidate; legacy tag-only JSONL remains valid."""

    model_config = ConfigDict(extra="forbid", strict=True)

    meme_id: int = Field(gt=0)
    suggested_title: str | None = Field(default=None, max_length=255)
    suggested_description: str | None = Field(default=None, max_length=2000)
    add_tags: list[str]
    remove_tags: list[str]
    suggested_template_name: str | None = Field(default=None, max_length=100)
    confidence: float | dict[str, float | None] | None = None
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("add_tags", "remove_tags")
    @classmethod
    def validate_tags(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            name = value.strip().lower()
            if not name:
                raise ValueError("tag names cannot be blank")
            if len(name) > 100:
                raise ValueError("tag names cannot exceed 100 characters")
            if name in normalized:
                raise ValueError(f"duplicate tag: {name}")
            normalized.append(name)
        return normalized

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        reason = value.strip()
        if not reason:
            raise ValueError("reason cannot be blank")
        return reason

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, value: float | dict[str, float | None] | None):
        values = [value] if isinstance(value, (int, float)) else list((value or {}).values())
        if any(item is not None and not 0 <= float(item) <= 1 for item in values):
            raise ValueError("confidence values must be between 0 and 1")
        return value

    @field_validator("suggested_title", "suggested_description", "suggested_template_name")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text or None

    @model_validator(mode="after")
    def validate_disjoint_changes(self) -> "TagCandidate":
        overlap = set(self.add_tags) & set(self.remove_tags)
        if overlap:
            raise ValueError(
                "tags cannot be both added and removed: " + ", ".join(sorted(overlap))
            )
        return self
