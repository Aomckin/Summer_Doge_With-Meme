import asyncio
import json
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.ai.client import AIImageResult, AITagSuggestion, AIUpstreamError
from app.ai.embedding_client import ImageEmbeddingResult
from app.api.memes import get_ai_client
from app.api.templates import get_template_service
from app.database import Base, get_db
from app.main import create_app
from app.models.ai_analysis import MemeAIAnalysis
from app.models.meme import Meme
from app.models.template import Template
from app.repositories.template_repository import TemplateRepository
from app.services.meme_service import MemeService
from app.services.ai_settings_service import AISettingsService
from app.services.template_service import (
    TemplateNameConflictError,
    TemplateNotFoundError,
    TemplateService,
)
from app.storage.image_storage import ImageStorage
from app.storage.template_image_storage import TemplateImageStorage


def create_session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def image_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (64, 64), color="gold").save(buffer, format="PNG")
    return buffer.getvalue()


def request(app, method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def test_template_repository_crud_uses_flush_without_commit() -> None:
    session = create_session()
    repository = TemplateRepository(session)
    try:
        created = repository.create(Template(name="Doge", description="柴犬"))
        assert created.id is not None
        assert session.in_transaction()
        assert repository.get_by_id(created.id) is created
        assert repository.get_by_name(" doge ") is created
        second = repository.create(Template(name="Wojak"))
        assert repository.list() == [created, second]
        repository.update(created, {"description": "经典柴犬"})
        assert created.description == "经典柴犬"
        repository.delete(second)
        assert repository.get_by_id(second.id) is None
    finally:
        session.rollback()
        session.close()


def test_template_service_normalizes_and_rejects_conflicts() -> None:
    session = create_session()
    service = TemplateService(session)
    try:
        template = service.create_template("  Doge  ", "  经典柴犬  ")
        assert template.name == "Doge"
        assert template.description == "经典柴犬"
        with pytest.raises(TemplateNameConflictError):
            service.create_template("doge")
        updated = service.update_template(template.id, {"description": "   "})
        assert updated.description is None
        with pytest.raises(ValueError, match="empty"):
            service.create_template("   ")
        with pytest.raises(TemplateNotFoundError):
            service.get_template(999)
    finally:
        session.close()


def test_template_reference_uses_thumbnail_bytes_for_independent_embedding(
    tmp_path: Path,
) -> None:
    class FakeEmbeddingClient:
        def __init__(self) -> None:
            self.calls: list[tuple[bytes, str]] = []

        def embed_image(
            self,
            image_bytes: bytes,
            mime_type: str,
        ) -> ImageEmbeddingResult:
            self.calls.append((image_bytes, mime_type))
            return ImageEmbeddingResult("qwen3-vl-embedding", (0.1, 0.2))

    session = create_session()
    storage = TemplateImageStorage(
        tmp_path / "template-images",
        tmp_path / "template-thumbnails",
    )
    service = TemplateService(session, storage)
    embedding_client = FakeEmbeddingClient()
    try:
        template = service.create_template("Doge")

        updated = service.set_reference_image(
            template.id,
            "doge.png",
            image_bytes(),
            embedding_client,
        )

        embedded_bytes, embedded_mime = embedding_client.calls[0]
        assert embedded_mime == "image/png"
        assert embedded_bytes.startswith(b"\x89PNG\r\n\x1a\n")
        assert not isinstance(embedded_bytes, (str, Path))
        assert json.loads(updated.reference_embedding_json) == [0.1, 0.2]
        assert updated.reference_embedding_model_id == "qwen3-vl-embedding"
    finally:
        session.close()


def test_template_reference_cleans_new_files_when_embedding_fails(
    tmp_path: Path,
) -> None:
    class FailingEmbeddingClient:
        def embed_image(
            self,
            image_bytes: bytes,
            mime_type: str,
        ) -> ImageEmbeddingResult:
            raise AIUpstreamError("InvalidParameter: bad image")

    session = create_session()
    images = tmp_path / "template-images"
    thumbnails = tmp_path / "template-thumbnails"
    storage = TemplateImageStorage(images, thumbnails)
    service = TemplateService(session, storage)
    try:
        template = service.create_template("Doge")

        with pytest.raises(AIUpstreamError, match="InvalidParameter"):
            service.set_reference_image(
                template.id,
                "doge.png",
                image_bytes(),
                FailingEmbeddingClient(),
            )

        assert list(images.iterdir()) == []
        assert list(thumbnails.iterdir()) == []
        assert template.reference_stored_filename is None
        assert template.reference_embedding_json is None
    finally:
        session.close()


def test_atomic_template_creation_leaves_no_template_or_files_when_embedding_fails(
    tmp_path: Path,
) -> None:
    class FailingEmbeddingClient:
        def embed_image(
            self,
            image_bytes: bytes,
            mime_type: str,
        ) -> ImageEmbeddingResult:
            raise AIUpstreamError("InvalidParameter: bad image")

    session = create_session()
    images = tmp_path / "template-images"
    thumbnails = tmp_path / "template-thumbnails"
    service = TemplateService(
        session,
        TemplateImageStorage(images, thumbnails),
    )
    try:
        with pytest.raises(AIUpstreamError, match="InvalidParameter"):
            service.create_template_with_reference_image(
                "Doge",
                "classic",
                "doge.png",
                image_bytes(),
                FailingEmbeddingClient(),
            )

        assert service.list_templates() == []
        assert list(images.iterdir()) == []
        assert list(thumbnails.iterdir()) == []
    finally:
        session.close()


def test_atomic_template_api_returns_upstream_error_without_ghost_template(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingEmbeddingClient:
        def embed_image(
            self,
            image_bytes: bytes,
            mime_type: str,
        ) -> ImageEmbeddingResult:
            raise AIUpstreamError("InvalidParameter: bad image")

    session = create_session()
    images = tmp_path / "template-images"
    thumbnails = tmp_path / "template-thumbnails"
    service = TemplateService(
        session,
        TemplateImageStorage(images, thumbnails),
    )
    app = create_app(
        tmp_path / "images",
        tmp_path / "thumbnails",
        ai_settings_key_file=tmp_path / "ai.key",
    )
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_template_service] = lambda: service
    monkeypatch.setattr(
        AISettingsService,
        "build_active_embedding_client",
        lambda self: FailingEmbeddingClient(),
    )
    try:
        response = request(
            app,
            "POST",
            "/api/templates/with-reference-image",
            files={"file": ("doge.png", image_bytes(), "image/png")},
            data={"name": "Doge", "description": "classic"},
        )

        assert response.status_code == 502
        assert response.json()["detail"] == "InvalidParameter: bad image"
        assert service.list_templates() == []
        assert list(images.iterdir()) == []
        assert list(thumbnails.iterdir()) == []
    finally:
        app.dependency_overrides.clear()
        session.close()


def test_deleting_template_clears_meme_and_analysis_references(
    tmp_path: Path,
) -> None:
    session = create_session()
    template_service = TemplateService(session)
    meme_service = MemeService(
        session,
        ImageStorage(tmp_path / "images", tmp_path / "thumbnails"),
    )
    try:
        template = template_service.create_template("Doge")
        meme = meme_service.create_meme(
            "doge.png",
            image_bytes(),
            title="Doge",
            template_id=template.id,
        )
        analysis = MemeAIAnalysis(
            meme=meme,
            model_name="fake",
            description="desc",
            suggestions_json="[]",
            suggested_template_id=template.id,
        )
        session.add(analysis)
        session.commit()

        template_service.delete_template(template.id)
        session.refresh(meme)
        session.refresh(analysis)

        assert session.get(Template, template.id) is None
        assert session.get(Meme, meme.id) is meme
        assert meme.template_id is None
        assert analysis.suggested_template_id is None
    finally:
        session.close()


def test_template_api_and_meme_assignment_round_trip(tmp_path: Path) -> None:
    session = create_session()
    images = tmp_path / "images"
    thumbnails = tmp_path / "thumbnails"
    app = create_app(images, thumbnails)
    app.dependency_overrides[get_db] = lambda: session
    try:
        paths = request(app, "GET", "/openapi.json").json()["paths"]
        assert "/api/templates" in paths
        assert "/api/templates/{template_id}" in paths

        created = request(
            app,
            "POST",
            "/api/templates",
            json={"name": " Doge ", "description": "经典柴犬"},
        )
        assert created.status_code == 201
        template_id = created.json()["id"]
        assert request(
            app,
            "POST",
            "/api/templates",
            json={"name": "doge"},
        ).status_code == 409

        upload = request(
            app,
            "POST",
            "/api/memes",
            files={"file": ("doge.png", image_bytes(), "image/png")},
            data={"title": "Doge Meme", "template_id": str(template_id)},
        )
        assert upload.status_code == 201
        assert upload.json()["template"]["name"] == "Doge"
        meme_id = upload.json()["id"]

        cleared = request(
            app,
            "PATCH",
            f"/api/memes/{meme_id}",
            json={"template_id": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["template"] is None
        assert request(
            app,
            "PATCH",
            f"/api/memes/{meme_id}",
            json={"template_id": 999},
        ).status_code == 422

        assert request(
            app,
            "PATCH",
            f"/api/templates/{template_id}",
            json={"description": ""},
        ).json()["description"] is None
        assert request(
            app,
            "DELETE",
            f"/api/templates/{template_id}",
        ).status_code == 204
        assert request(
            app,
            "GET",
            f"/api/templates/{template_id}",
        ).status_code == 404
        assert request(app, "GET", f"/api/memes/{meme_id}").status_code == 200
    finally:
        app.dependency_overrides.clear()
        session.close()


def test_invalid_upload_template_leaves_no_files(tmp_path: Path) -> None:
    session = create_session()
    images = tmp_path / "images"
    thumbnails = tmp_path / "thumbnails"
    app = create_app(images, thumbnails)
    app.dependency_overrides[get_db] = lambda: session
    try:
        response = request(
            app,
            "POST",
            "/api/memes",
            files={"file": ("invalid.png", image_bytes(), "image/png")},
            data={"title": "Invalid", "template_id": "999"},
        )
        assert response.status_code == 422
        assert list(images.iterdir()) == []
        assert list(thumbnails.iterdir()) == []
    finally:
        app.dependency_overrides.clear()
        session.close()


def test_ai_template_suggestion_is_previewed_then_confirmed(tmp_path: Path) -> None:
    class FakeAIClient:
        def __init__(self, template_id: int) -> None:
            self.template_id = template_id

        def analyze_image(self, **_: object) -> AIImageResult:
            return AIImageResult(
                model_name="fake",
                title="看到需求时的我",
                description="AI 描述",
                tags=(
                    AITagSuggestion("反应图", 0.9),
                    AITagSuggestion("柴犬", 0.8),
                ),
                template_id=self.template_id,
            )

    session = create_session()
    images = tmp_path / "images"
    thumbnails = tmp_path / "thumbnails"
    app = create_app(images, thumbnails)
    app.dependency_overrides[get_db] = lambda: session
    try:
        template = Template(name="Doge", description="经典柴犬")
        session.add(template)
        session.commit()
        app.dependency_overrides[get_ai_client] = lambda: FakeAIClient(
            template.id
        )
        upload = request(
            app,
            "POST",
            "/api/memes",
            files={"file": ("doge.png", image_bytes(), "image/png")},
            data={"title": "Doge"},
        ).json()

        analysis = request(
            app,
            "POST",
            f"/api/memes/{upload['id']}/analyze",
        )
        assert analysis.status_code == 200
        assert analysis.json()["suggested_template"]["id"] == template.id
        assert session.get(Meme, upload["id"]).template_id is None

        confirmed = request(
            app,
            "POST",
            (
                f"/api/memes/{upload['id']}/analyses/"
                f"{analysis.json()['id']}/confirm"
            ),
            json={
                "tags": [],
                "apply_description": False,
                "template_id": template.id,
                "apply_template": True,
            },
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["template"]["name"] == "Doge"
    finally:
        app.dependency_overrides.clear()
        session.close()
