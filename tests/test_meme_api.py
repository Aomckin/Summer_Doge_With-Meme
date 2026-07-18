import asyncio
from importlib import import_module
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.services.meme_service import MemeService
from app.storage.image_storage import ImageStorage


def load_api_components():
    api_module = import_module("app.api.memes")
    if not hasattr(api_module, "router"):
        pytest.skip("Meme Router has not been implemented")
    main_module = import_module("app.main")
    return api_module, main_module


def make_image_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (320, 240), color="blue").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def api_context(tmp_path: Path):
    api_module, main_module = load_api_components()
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    service = MemeService(session, storage)
    main_module.app.dependency_overrides[api_module.get_meme_service] = lambda: service

    yield main_module.app, session, storage

    main_module.app.dependency_overrides.clear()
    session.close()


def request(app, method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def test_meme_router_exists() -> None:
    api_module = import_module("app.api.memes")

    assert hasattr(api_module, "router"), "Meme Router is missing"
    assert hasattr(api_module, "get_meme_service"), "Service dependency is missing"


def test_meme_routes_are_registered_in_openapi(api_context) -> None:
    app, _, _ = api_context

    response = request(app, "GET", "/openapi.json")
    paths = response.json()["paths"]

    assert "/api/memes" in paths
    assert "/api/memes/{meme_id}" in paths
    assert set(paths["/api/memes"]) == {"get", "post"}
    assert set(paths["/api/memes/{meme_id}"]) == {"get", "patch", "delete"}


def test_meme_api_crud_flow(api_context) -> None:
    app, _, _ = api_context
    upload = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("example.png", make_image_bytes(), "image/png")},
        data={"title": "API 测试", "description": "完整闭环", "source": "test"},
    )

    assert upload.status_code == 201
    meme_id = upload.json()["id"]

    listing = request(app, "GET", "/api/memes", params={"offset": 0, "limit": 10})
    detail = request(app, "GET", f"/api/memes/{meme_id}")
    update = request(
        app,
        "PATCH",
        f"/api/memes/{meme_id}",
        json={"title": "更新后的标题"},
    )
    deletion = request(app, "DELETE", f"/api/memes/{meme_id}")
    missing = request(app, "GET", f"/api/memes/{meme_id}")

    assert [item["id"] for item in listing.json()] == [meme_id]
    assert detail.json()["title"] == "API 测试"
    assert update.status_code == 200
    assert update.json()["title"] == "更新后的标题"
    assert deletion.status_code == 204
    assert deletion.content == b""
    assert missing.status_code == 404


def test_upload_rejects_non_image(api_context) -> None:
    app, _, storage = api_context

    response = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("notes.txt", b"not an image", "text/plain")},
        data={"title": "非法文件"},
    )

    assert response.status_code == 415
    assert "valid image" in response.json()["detail"]
    assert list(storage.images_dir.iterdir()) == []


def test_upload_duplicate_image_returns_conflict(api_context) -> None:
    app, _, storage = api_context
    content = make_image_bytes()
    upload = {
        "files": {"file": ("same.png", content, "image/png")},
        "data": {"title": "重复测试"},
    }

    first = request(app, "POST", "/api/memes", **upload)
    second = request(app, "POST", "/api/memes", **upload)

    assert first.status_code == 201
    assert second.status_code == 409
    assert len(list(storage.images_dir.iterdir())) == 1
    assert len(list(storage.thumbnails_dir.iterdir())) == 1


def test_unknown_meme_returns_not_found(api_context) -> None:
    app, _, _ = api_context

    response = request(app, "GET", "/api/memes/999")

    assert response.status_code == 404
    assert "999" in response.json()["detail"]
