from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TagCandidate(BaseModel):
    """One locally reviewed tag delta from a batch candidates.jsonl file."""

    model_config = ConfigDict(extra="forbid", strict=True)

    meme_id: int = Field(gt=0)
    add_tags: list[str]
    remove_tags: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
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

    @model_validator(mode="after")
    def validate_disjoint_changes(self) -> "TagCandidate":
        overlap = set(self.add_tags) & set(self.remove_tags)
        if overlap:
            raise ValueError(
                "tags cannot be both added and removed: " + ", ".join(sorted(overlap))
            )
        return self
