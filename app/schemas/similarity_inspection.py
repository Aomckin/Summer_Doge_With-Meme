from pydantic import BaseModel, Field, model_validator

from app.schemas.meme import MemeResponse


class SimilarityInspectionRequest(BaseModel):
    start_meme_id: int = Field(ge=1)
    end_meme_id: int = Field(ge=1)
    top_k: int = Field(default=5, ge=1, le=20)
    similarity_threshold: float = Field(default=0.85, ge=0, le=1)

    @model_validator(mode="after")
    def validate_range(self) -> "SimilarityInspectionRequest":
        if self.end_meme_id < self.start_meme_id:
            raise ValueError("end_meme_id must be greater than or equal to start_meme_id")
        if self.end_meme_id - self.start_meme_id + 1 > 1000:
            raise ValueError("Meme ID range cannot exceed 1000 IDs")
        return self


class SimilarityPairResponse(BaseModel):
    meme_a: MemeResponse
    meme_b: MemeResponse
    score: float
    weak_relation_exists: bool


class SimilarityInspectionResponse(BaseModel):
    requested_count: int
    ready_count: int
    missing_or_stale_count: int
    candidate_pair_count: int
    pairs: list[SimilarityPairResponse]


class SimilarityIgnoreRequest(BaseModel):
    meme_a_id: int = Field(ge=1)
    meme_b_id: int = Field(ge=1)


class SimilarityIgnoreResponse(BaseModel):
    meme_a_id: int
    meme_b_id: int


class MemeMergeRequest(BaseModel):
    source_meme_id: int = Field(ge=1)
