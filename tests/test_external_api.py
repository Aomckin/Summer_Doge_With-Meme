import asyncio
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.memes import get_meme_service
from app.api.semantic import get_service as get_semantic_service
from app.database import Base
from app.main import app
from app.models.meme import Meme
from app.services.meme_service import MemeService
from app.services.semantic_search_service import MemeEmbeddingUnavailableError
from app.storage.image_storage import ImageStorage


def image_bytes(image_format: str) -> bytes:
    output = BytesIO()
    if image_format == "GIF":
        frames = [Image.new("RGB", (18, 12), color) for color in ("red", "blue")]
        frames[0].save(
            output,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            loop=0,
            duration=80,
        )
    else:
        Image.new("RGB", (18, 12), "purple").save(output, format=image_format)
    return output.getvalue()


def request(method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


@pytest.fixture
def external_context(tmp_path: Path):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    service = MemeService(session, storage)
    app.dependency_overrides[get_meme_service] = lambda: service

    yield session, storage, service

    app.dependency_overrides.clear()
    session.close()
    engine.dispose()


@pytest.mark.parametrize(
    ("image_format", "filename", "mime_type"),
    [
        ("JPEG", "example.jpg", "image/jpeg"),
        ("PNG", "example.png", "image/png"),
        ("WEBP", "example.webp", "image/webp"),
        ("GIF", "example.gif", "image/gif"),
    ],
)
def test_random_result_links_to_original_image_with_exact_mime_and_bytes(
    external_context, image_format: str, filename: str, mime_type: str
) -> None:
    content = image_bytes(image_format)
    created = request(
        "POST",
        "/api/memes",
        files={"file": (filename, content, mime_type)},
        data={"title": image_format},
    ).json()

    random_response = request("GET", "/api/memes/random")

    assert random_response.status_code == 200
    payload = random_response.json()
    assert payload["id"] == created["id"]
    assert payload["original_filename"] == filename
    assert payload["mime_type"] == mime_type
    assert payload["image_url"] == f"/api/memes/{created['id']}/image"

    image_response = request("GET", payload["image_url"])
    assert image_response.status_code == 200
    assert image_response.headers["content-type"] == mime_type
    assert image_response.content == content


def test_public_api_payload_uses_origin_relative_urls(external_context) -> None:
    created = request(
        "POST",
        "/api/memes",
        files={"file": ("public.png", image_bytes("PNG"), "image/png")},
        data={"title": "public"},
    ).json()
    external = request("GET", "/api/memes/random").json()

    urls = [
        created["image_url"],
        created["thumbnail_url"],
        *(image["image_url"] for image in created["images"]),
        *(image["thumbnail_url"] for image in created["images"]),
        external["image_url"],
    ]
    for url in (url for url in urls if url is not None):
        assert url.startswith("/")
        assert "localhost" not in url
        assert "127.0.0.1" not in url


def test_random_skips_record_with_missing_files(external_context, monkeypatch) -> None:
    _, storage, service = external_context
    missing = service.create_meme(
        "missing.png", image_bytes("PNG"), title="missing"
    )
    available = service.create_meme(
        "available.jpg", image_bytes("JPEG"), title="available"
    )
    storage.original_path(missing.file_path).unlink()
    candidates = iter((missing, available))
    monkeypatch.setattr(
        service.repository, "get_random", lambda **kwargs: next(candidates)
    )

    assert service.get_random_meme().id == available.id


def test_image_endpoint_maps_invalid_id_missing_file_and_bad_metadata(
    external_context,
) -> None:
    session, storage, service = external_context
    assert request("GET", "/api/memes/999/image").status_code == 404
    assert request("GET", "/api/memes/not-an-id/image").status_code == 422

    missing = service.create_meme(
        "missing.png", image_bytes("PNG"), title="missing"
    )
    storage.original_path(missing.file_path).unlink()
    missing_response = request("GET", f"/api/memes/{missing.id}/image")
    assert missing_response.status_code == 410
    assert str(storage.images_dir) not in missing_response.text

    invalid = service.create_meme(
        "invalid.jpg", image_bytes("JPEG"), title="invalid"
    )
    invalid.mime_type = "application/octet-stream"
    invalid.images[0].mime_type = "application/octet-stream"
    session.commit()
    invalid_response = request("GET", f"/api/memes/{invalid.id}/image")
    assert invalid_response.status_code == 409
    assert invalid_response.json()["detail"] == "Meme image metadata is invalid"


class FakeSemanticService:
    def __init__(self, hit=None, error: Exception | None = None) -> None:
        self.hit = hit
        self.error = error
        self.queries: list[str] = []

    def search_random_top_five(self, *, query: str):
        self.queries.append(query)
        if self.error is not None:
            raise self.error
        return self.hit


def test_semantic_top_five_random_returns_existing_dto_and_external_image_url(
    external_context,
) -> None:
    _, _, meme_service = external_context
    meme = meme_service.create_meme(
        "semantic.webp", image_bytes("WEBP"), title="semantic"
    )
    fake = FakeSemanticService((meme, 0.873))
    app.dependency_overrides[get_semantic_service] = lambda: fake

    response = request(
        "GET", "/api/memes/semantic", params={"q": "无语地看着对方", "limit": 1}
    )

    assert response.status_code == 200
    assert response.json()["meme"]["id"] == meme.id
    assert response.json()["meme"]["image_url"] == f"/api/memes/{meme.id}/image"
    assert response.json()["score"] == pytest.approx(0.873)
    assert fake.queries == ["无语地看着对方"]


def test_semantic_top_five_random_validates_query_limit_empty_result_and_index_state(
    external_context,
) -> None:
    fake = FakeSemanticService()
    app.dependency_overrides[get_semantic_service] = lambda: fake

    assert request(
        "GET", "/api/memes/semantic", params={"q": "   "}
    ).status_code == 400
    assert request(
        "GET", "/api/memes/semantic", params={"q": "无语", "limit": 2}
    ).status_code == 422
    assert request(
        "GET", "/api/memes/semantic", params={"q": "无语"}
    ).status_code == 404
    assert fake.queries == ["无语"]

    unavailable = FakeSemanticService(
        error=MemeEmbeddingUnavailableError("No ready semantic embeddings are available")
    )
    app.dependency_overrides[get_semantic_service] = lambda: unavailable
    response = request("GET", "/api/memes/semantic", params={"q": "无语"})
    assert response.status_code == 503
    assert "No ready semantic embeddings" in response.json()["detail"]
