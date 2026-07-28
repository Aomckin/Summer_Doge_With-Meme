from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.ai.client import (
    AIImageResult,
    AIInvalidResponseError,
    AITagSuggestion,
    AITemplateCandidate,
)
from app.database import Base
from app.models.ai_analysis import MemeAIAnalysis
from app.models.tag import MemeTag, Tag
from app.models.template import Template
from app.services.meme_service import (
    AIAnalysisAlreadyConfirmedError,
    MemeService,
)
from app.storage.image_storage import ImageStorage


class FakeAIClient:
    def __init__(self, result: AIImageResult) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    def analyze_image(
        self,
        *,
        image_bytes: bytes,
        mime_type: str,
        existing_tags: list[str],
        existing_templates: list[AITemplateCandidate],
    ) -> AIImageResult:
        self.calls.append(
            {
                "image_bytes": image_bytes,
                "mime_type": mime_type,
                "existing_tags": existing_tags,
                "existing_templates": existing_templates,
            }
        )
        return self.result


def make_image_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (320, 240), color="purple").save(buffer, format="PNG")
    return buffer.getvalue()


def create_service(tmp_path: Path) -> tuple[MemeService, Session]:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    return MemeService(session, storage), session


def ai_result() -> AIImageResult:
    return AIImageResult(
        model_name="gpt-5.6-luna-snapshot",
        description="  一张适合作为反应图的紫色图片。  ",
        tags=(
            AITagSuggestion("reaction", 0.91),
            AITagSuggestion(" FUNNY ", 1.4),
            AITagSuggestion("funny", 0.2),
            AITagSuggestion("purple", 0.82),
            AITagSuggestion("new-three", 0.73),
            AITagSuggestion("new-four", 0.64),
        ),
    )


def test_analysis_records_model_and_suggestions_without_applying_them(
    tmp_path: Path,
) -> None:
    service, session = create_service(tmp_path)
    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="AI 测试",
            description="用户描述",
            tags=["funny"],
        )
        client = FakeAIClient(ai_result())

        analysis = service.analyze_meme(meme.id, client)
        suggestions = service.ai_analysis_repository.load_suggestions(analysis)

        assert client.calls[0]["mime_type"] == "image/png"
        assert client.calls[0]["existing_tags"] == ["funny"]
        assert analysis.model_name == "gpt-5.6-luna-snapshot"
        assert analysis.description == "一张适合作为反应图的紫色图片。"
        assert suggestions == [
            {"name": "funny", "confidence": 1.0, "existing": True},
            {"name": "reaction", "confidence": 0.91, "existing": False},
            {"name": "purple", "confidence": 0.82, "existing": False},
            {"name": "new-three", "confidence": 0.73, "existing": False},
            {"name": "new-four", "confidence": 0.64, "existing": False},
        ]
        assert meme.description == "用户描述"
        assert [tag.name for tag in meme.tags] == ["funny"]
        assert session.scalar(select(func.count()).select_from(Tag)) == 1
        assert session.scalar(select(func.count()).select_from(MemeTag)) == 1
        assert session.get(MemeAIAnalysis, analysis.id) is analysis
    finally:
        session.close()


def test_analysis_requires_at_least_two_unique_suggestions(
    tmp_path: Path,
) -> None:
    service, session = create_service(tmp_path)
    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="AI 测试",
        )
        result = AIImageResult(
            model_name="gpt-5.6-luna-snapshot",
            description="一张紫色图片。",
            tags=(
                AITagSuggestion("震惊", 0.9),
                AITagSuggestion(" 震惊 ", 0.8),
            ),
        )

        with pytest.raises(AIInvalidResponseError, match="2 and 8"):
            service.analyze_meme(meme.id, FakeAIClient(result))
    finally:
        session.close()


def test_confirmation_adds_ai_tags_and_optionally_applies_description(
    tmp_path: Path,
) -> None:
    service, session = create_service(tmp_path)
    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="AI 测试",
            description=None,
            tags=["funny"],
        )
        analysis = service.analyze_meme(meme.id, FakeAIClient(ai_result()))

        updated = service.confirm_ai_analysis(
            meme.id,
            analysis.id,
            tags=["funny", "reaction"],
            apply_description=True,
        )

        links = {link.tag.name: link for link in updated.tag_links}
        assert updated.description == "一张适合作为反应图的紫色图片。"
        assert links["funny"].source == "user"
        assert links["funny"].confidence is None
        assert links["reaction"].source == "ai"
        assert links["reaction"].confidence == 0.91
        assert analysis.confirmed_at is not None
        with pytest.raises(AIAnalysisAlreadyConfirmedError):
            service.confirm_ai_analysis(
                meme.id,
                analysis.id,
                tags=[],
                apply_description=False,
            )
    finally:
        session.close()


def test_confirmation_rejects_tag_not_present_in_analysis(tmp_path: Path) -> None:
    service, session = create_service(tmp_path)
    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="AI 测试",
        )
        analysis = service.analyze_meme(meme.id, FakeAIClient(ai_result()))

        with pytest.raises(ValueError, match="not suggested"):
            service.confirm_ai_analysis(
                meme.id,
                analysis.id,
                tags=["invented-by-client"],
                apply_description=False,
            )
    finally:
        session.close()


def test_ai_template_match_is_validated_and_applied_only_on_confirmation(
    tmp_path: Path,
) -> None:
    service, session = create_service(tmp_path)
    try:
        doge = Template(name="Doge", description="经典柴犬")
        wojak = Template(name="Wojak")
        session.add_all([doge, wojak])
        session.commit()
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="AI 模板测试",
        )
        result = AIImageResult(
            model_name="fake",
            description="描述",
            tags=(
                AITagSuggestion("反应图", 0.9),
                AITagSuggestion("柴犬", 0.8),
            ),
            template_id=doge.id,
        )
        client = FakeAIClient(result)

        analysis = service.analyze_meme(meme.id, client)

        assert [
            candidate.id
            for candidate in client.calls[0]["existing_templates"]
        ] == [doge.id, wojak.id]
        assert analysis.suggested_template_id == doge.id
        assert meme.template_id is None

        updated = service.confirm_ai_analysis(
            meme.id,
            analysis.id,
            tags=[],
            apply_description=False,
            template_id=wojak.id,
            apply_template=True,
        )
        assert updated.template_id == wojak.id
    finally:
        session.close()


def test_ai_template_match_rejects_id_outside_candidates(tmp_path: Path) -> None:
    service, session = create_service(tmp_path)
    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="AI 模板测试",
        )
        result = AIImageResult(
            model_name="fake",
            description="描述",
            tags=(
                AITagSuggestion("反应图", 0.9),
                AITagSuggestion("震惊", 0.8),
            ),
            template_id=999,
        )
        with pytest.raises(AIInvalidResponseError, match="candidates"):
            service.analyze_meme(meme.id, FakeAIClient(result))
    finally:
        session.close()
