from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.template import TemplateResponse


class AITagSuggestionResponse(BaseModel):
    name: str
    confidence: float = Field(ge=0, le=1)
    existing: bool


class AIAnalysisResponse(BaseModel):
    id: int
    meme_id: int
    model_name: str
    description: str
    suggestions: list[AITagSuggestionResponse]
    created_at: datetime
    confirmed_at: datetime | None
    suggested_template: TemplateResponse | None


class AIAnalysisConfirm(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=8)
    apply_description: bool = False
    template_id: int | None = None
    apply_template: bool = False
