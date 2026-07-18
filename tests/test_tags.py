import asyncio
from importlib import import_module, util
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.services.meme_service import MemeService
from app.storage.image_storage import ImageStorage


def load_tag_components():
    if any(
        util.find_spec(name) is None
        for name in (
            "app.models.tag",
            "app.repositories.tag_repository",
            "app.api.tags",
        )
    ):
        pytest.skip("Tag components have not been implemented")
    model_module = import_module("app.models.tag")
    repository_module = import_module("app.repositories.tag_repository")
    api_module = import_module("app.api.tags")
    if not all(
        [
            hasattr(model_module, "Tag"),
            hasattr(model_module, "MemeTag"),
            hasattr(repository_module, "TagRepository"),
            hasattr(api_module, "router"),
        ]
    ):
        pytest.skip("Tag components have not been implemented")
    return model_module, repository_module, api_module


def make_image_bytes(color: str) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (160, 120), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def request(app, method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


@pytest.fixture
def tag_context(tmp_path: Path):
    model_module, _, tag_api = load_tag_components()
    meme_api = import_module("app.api.memes")
    main = import_module("app.main")
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    service = MemeService(session, storage)
    main.app.dependency_overrides[meme_api.get_meme_service] = lambda: service
    main.app.dependency_overrides[tag_api.get_meme_service] = lambda: service

    yield main.app, session, model_module

    main.app.dependency_overrides.clear()
    session.close()


def test_tag_components_exist() -> None:
    assert util.find_spec("app.models.tag") is not None, "Tag model is missing"
    assert util.find_spec("app.repositories.tag_repository") is not None, (
        "TagRepository is missing"
    )
    assert util.find_spec("app.api.tags") is not None, "Tag Router is missing"
    model_module = import_module("app.models.tag")
    repository_module = import_module("app.repositories.tag_repository")
    api_module = import_module("app.api.tags")

    assert hasattr(model_module, "Tag"), "Tag model is missing"
    assert hasattr(model_module, "MemeTag"), "MemeTag model is missing"
    assert hasattr(repository_module, "TagRepository"), "TagRepository is missing"
    assert hasattr(api_module, "router"), "Tag Router is missing"


def test_upload_reuses_tags_and_exposes_tag_list(tag_context) -> None:
    app, session, model_module = tag_context

    first = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("first.png", make_image_bytes("red"), "image/png")},
        data={"title": "第一张", "tags": " Funny, CAT, funny "},
    )
    second = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("second.png", make_image_bytes("green"), "image/png")},
        data={"title": "第二张", "tags": "cat"},
    )
    tags = request(app, "GET", "/api/tags")

    assert first.status_code == 201
    assert second.status_code == 201
    assert [tag["name"] for tag in first.json()["tags"]] == ["funny", "cat"]
    assert session.scalar(select(func.count()).select_from(model_module.Tag)) == 2
    assert [tag["name"] for tag in tags.json()] == ["cat", "funny"]


def test_filter_and_update_meme_tags(tag_context) -> None:
    app, _, _ = tag_context
    first = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("first.png", make_image_bytes("blue"), "image/png")},
        data={"title": "蓝色", "tags": "funny,cat"},
    ).json()
    request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("second.png", make_image_bytes("yellow"), "image/png")},
        data={"title": "黄色", "tags": "funny"},
    )

    filtered = request(
        app,
        "GET",
        "/api/memes",
        params=[("tags", "funny"), ("tags", "cat")],
    )
    updated = request(
        app,
        "PATCH",
        f"/api/memes/{first['id']}",
        json={"tags": ["reaction"]},
    )

    assert [meme["id"] for meme in filtered.json()] == [first["id"]]
    assert [tag["name"] for tag in updated.json()["tags"]] == ["reaction"]
