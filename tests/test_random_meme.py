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
from app.database import Base
from app.main import app
from app.services.meme_service import MemeService
from app.storage.image_storage import ImageStorage


def make_image_bytes(color: str) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (120, 90), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def request(method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


@pytest.fixture
def random_context(tmp_path: Path):
    if not hasattr(MemeService, "get_random_meme"):
        pytest.skip("Random Meme has not been implemented")
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

    yield session

    app.dependency_overrides.clear()
    session.close()


def test_random_meme_components_exist() -> None:
    assert hasattr(MemeService, "get_random_meme"), "Random service method is missing"


def test_random_meme_returns_clear_error_for_empty_database(random_context) -> None:
    response = request("GET", "/api/memes/random")

    assert response.status_code == 404
    assert "No Meme" in response.json()["detail"]


def test_random_meme_can_be_limited_by_tags(random_context) -> None:
    cat = request(
        "POST",
        "/api/memes",
        files={"file": ("cat.png", make_image_bytes("pink"), "image/png")},
        data={"title": "猫", "tags": "cat,funny"},
    ).json()
    request(
        "POST",
        "/api/memes",
        files={"file": ("dog.png", make_image_bytes("brown"), "image/png")},
        data={"title": "狗", "tags": "dog,funny"},
    )

    response = request(
        "GET",
        "/api/memes/random",
        params=[("tags", "cat"), ("tags", "funny")],
    )

    assert response.status_code == 200
    assert response.json()["id"] == cat["id"]
    assert [tag["name"] for tag in response.json()["tags"]] == ["cat", "funny"]
