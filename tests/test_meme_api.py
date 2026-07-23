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

from app.database import Base, get_db
from app.models.meme import Meme
from app.storage.image_storage import ImageStorage


def load_api_components():
    api_module = import_module("app.api.memes")
    if not hasattr(api_module, "router"):
        pytest.skip("Meme Router has not been implemented")
    main_module = import_module("app.main")
    return api_module, main_module


def make_image_bytes(color: str = "blue") -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (320, 240), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def api_context(tmp_path: Path):
    _, main_module = load_api_components()
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    images_dir = tmp_path / "images"
    thumbnails_dir = tmp_path / "thumbnails"
    app = main_module.create_app(images_dir, thumbnails_dir)
    storage = ImageStorage(images_dir, thumbnails_dir)
    app.dependency_overrides[get_db] = lambda: session

    yield app, session, storage

    app.dependency_overrides.clear()
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


def test_create_app_creates_and_shares_media_directories(tmp_path: Path) -> None:
    main_module = import_module("app.main")
    images_dir = tmp_path / "nested" / "images"
    thumbnails_dir = tmp_path / "nested" / "thumbnails"

    app = main_module.create_app(images_dir, thumbnails_dir)
    mounts = {
        route.path: route.app
        for route in app.routes
        if getattr(route, "path", "").startswith("/media/")
    }

    assert images_dir.is_dir()
    assert thumbnails_dir.is_dir()
    assert app.state.images_dir == images_dir.resolve()
    assert app.state.thumbnails_dir == thumbnails_dir.resolve()
    assert Path(mounts["/media/images"].directory) == app.state.images_dir
    assert Path(mounts["/media/thumbnails"].directory) == app.state.thumbnails_dir


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


def test_upload_returns_browser_media_urls_without_local_paths(api_context) -> None:
    app, session, _ = api_context
    content = make_image_bytes()

    response = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("url-test.png", content, "image/png")},
        data={"title": "URL test"},
    )

    body = response.json()
    stored = session.get(Meme, body["id"])

    assert response.status_code == 201
    assert "file_path" not in body
    assert "thumbnail_path" not in body
    assert body["image_url"].startswith("/media/images/")
    assert body["thumbnail_url"].startswith("/media/thumbnails/")
    assert request(app, "GET", body["image_url"]).content == content
    assert (
        request(app, "GET", body["thumbnail_url"]).headers["content-type"]
        == "image/png"
    )
    assert stored is not None
    assert stored.file_path == stored.stored_filename
    assert stored.thumbnail_path == body["thumbnail_url"].rsplit("/", 1)[-1]


def test_list_memes_combines_keyword_tags_and_pagination(api_context) -> None:
    app, _, _ = api_context
    uploads = [
        ("dog.png", "Dog only", None, "funny", "red"),
        ("title-cat.png", "Funny Cat", None, "funny", "green"),
        ("description-cat.png", "Reaction", "A cat reaction", "serious", "yellow"),
    ]
    for filename, title, description, tags, color in uploads:
        response = request(
            app,
            "POST",
            "/api/memes",
            files={"file": (filename, make_image_bytes(color), "image/png")},
            data={
                "title": title,
                "description": description or "",
                "tags": tags,
            },
        )
        assert response.status_code == 201

    response = request(
        app,
        "GET",
        "/api/memes",
        params=[("q", "cat"), ("tags", "funny"), ("offset", "0"), ("limit", "1")],
    )

    assert response.status_code == 200
    assert len(response.json()) == 1
    result = response.json()[0]
    assert "cat" in (result["title"] + " " + (result["description"] or "")).lower()
    assert [tag["name"] for tag in result["tags"]] == ["funny"]


def test_delete_removes_database_record_when_media_is_missing(api_context) -> None:
    app, session, storage = api_context
    uploaded = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("missing.png", make_image_bytes(), "image/png")},
        data={"title": "缺图删除"},
    ).json()
    meme = session.get(Meme, uploaded["id"])
    assert meme is not None
    meme_id = meme.id
    storage.delete(meme.file_path, meme.thumbnail_path)

    deletion = request(app, "DELETE", f"/api/memes/{meme_id}")

    assert deletion.status_code == 204
    assert session.get(Meme, meme_id) is None


def test_unknown_meme_returns_not_found(api_context) -> None:
    app, _, _ = api_context

    response = request(app, "GET", "/api/memes/999")

    assert response.status_code == 404
    assert "999" in response.json()["detail"]
