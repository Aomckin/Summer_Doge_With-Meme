import asyncio
from importlib import import_module
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.ai.client import (
    AIImageResult,
    AIRequestTimeoutError,
    AITagSuggestion,
    AIUpstreamError,
)
from app.database import Base, get_db
from app.models.ai_analysis import MemeAIAnalysis
from app.models.meme import Meme
from app.models.tag import MemeTag
from app.storage.image_storage import ImageStorage


class FakeAIClient:
    def __init__(self, result: AIImageResult | Exception) -> None:
        self.result = result

    def analyze_image(self, **_: object) -> AIImageResult:
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def fake_ai_result() -> AIImageResult:
    return AIImageResult(
        model_name="gpt-5.6-luna-test",
        description="AI 生成的图片描述",
        tags=(
            AITagSuggestion("funny", 0.94),
            AITagSuggestion("reaction", 0.88),
        ),
    )


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
    assert "/api/memes/{meme_id}/analyze" in paths
    assert "/api/memes/{meme_id}/analyses/{analysis_id}/confirm" in paths
    assert set(paths["/api/memes"]) == {"get", "post"}
    assert set(paths["/api/memes/{meme_id}"]) == {"get", "patch", "delete"}


def test_ai_analysis_requires_confirmation_before_applying_tags(
    api_context,
) -> None:
    app, session, _ = api_context
    api_module, _ = load_api_components()
    app.dependency_overrides[api_module.get_ai_client] = lambda: FakeAIClient(
        fake_ai_result()
    )
    upload = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("example.png", make_image_bytes(), "image/png")},
        data={
            "title": "AI API 测试",
            "description": "用户描述",
            "tags": "funny",
        },
    )
    meme_id = upload.json()["id"]

    analysis_response = request(
        app,
        "POST",
        f"/api/memes/{meme_id}/analyze",
    )
    unchanged = request(app, "GET", f"/api/memes/{meme_id}")

    assert analysis_response.status_code == 200
    analysis = analysis_response.json()
    assert analysis["model_name"] == "gpt-5.6-luna-test"
    assert analysis["description"] == "AI 生成的图片描述"
    assert analysis["suggestions"] == [
        {"name": "funny", "confidence": 0.94, "existing": True},
        {"name": "reaction", "confidence": 0.88, "existing": False},
    ]
    assert unchanged.json()["description"] == "用户描述"
    assert [tag["name"] for tag in unchanged.json()["tags"]] == ["funny"]

    confirmed = request(
        app,
        "POST",
        f"/api/memes/{meme_id}/analyses/{analysis['id']}/confirm",
        json={"tags": ["funny", "reaction"], "apply_description": True},
    )
    repeated = request(
        app,
        "POST",
        f"/api/memes/{meme_id}/analyses/{analysis['id']}/confirm",
        json={"tags": [], "apply_description": False},
    )

    assert confirmed.status_code == 200
    assert confirmed.json()["description"] == "AI 生成的图片描述"
    assert [tag["name"] for tag in confirmed.json()["tags"]] == [
        "funny",
        "reaction",
    ]
    links = {
        link.tag.name: link
        for link in session.scalars(select(MemeTag)).all()
    }
    assert links["funny"].source == "user"
    assert links["reaction"].source == "ai"
    assert links["reaction"].confidence == 0.88
    stored_analysis = session.get(MemeAIAnalysis, analysis["id"])
    assert stored_analysis is not None
    assert stored_analysis.confirmed_at is not None
    assert repeated.status_code == 409


def test_ai_analysis_maps_configuration_timeout_and_invalid_confirmation(
    api_context,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _, _ = api_context
    api_module, _ = load_api_components()
    upload = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("example.png", make_image_bytes(), "image/png")},
        data={"title": "AI 错误测试"},
    )
    meme_id = upload.json()["id"]

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    unconfigured = request(app, "POST", f"/api/memes/{meme_id}/analyze")

    app.dependency_overrides[api_module.get_ai_client] = lambda: FakeAIClient(
        AIRequestTimeoutError("AI request timed out")
    )
    timeout = request(app, "POST", f"/api/memes/{meme_id}/analyze")

    app.dependency_overrides[api_module.get_ai_client] = lambda: FakeAIClient(
        AIUpstreamError("AI service is unavailable")
    )
    upstream = request(app, "POST", f"/api/memes/{meme_id}/analyze")

    app.dependency_overrides[api_module.get_ai_client] = lambda: FakeAIClient(
        fake_ai_result()
    )
    analysis = request(
        app,
        "POST",
        f"/api/memes/{meme_id}/analyze",
    ).json()
    invalid = request(
        app,
        "POST",
        f"/api/memes/{meme_id}/analyses/{analysis['id']}/confirm",
        json={"tags": ["not-suggested"], "apply_description": False},
    )

    assert unconfigured.status_code == 503
    assert "OPENAI_API_KEY" in unconfigured.json()["detail"]
    assert timeout.status_code == 504
    assert upstream.status_code == 502
    assert invalid.status_code == 422
    assert "not suggested" in invalid.json()["detail"]


def test_ai_analysis_reports_missing_meme_and_image(api_context) -> None:
    app, _, storage = api_context
    api_module, _ = load_api_components()
    app.dependency_overrides[api_module.get_ai_client] = lambda: FakeAIClient(
        fake_ai_result()
    )

    missing_meme = request(app, "POST", "/api/memes/999/analyze")
    upload = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("example.png", make_image_bytes(), "image/png")},
        data={"title": "缺图分析"},
    ).json()
    storage.delete(upload["stored_filename"], None)
    missing_image = request(
        app,
        "POST",
        f"/api/memes/{upload['id']}/analyze",
    )

    assert missing_meme.status_code == 404
    assert missing_image.status_code == 410


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


def upload_api_meme(app, title: str, color: str) -> dict[str, object]:
    response = request(
        app,
        "POST",
        "/api/memes",
        files={
            "file": (
                f"{title}.png",
                make_image_bytes(color),
                "image/png",
            )
        },
        data={"title": title},
    )
    assert response.status_code == 201
    return response.json()


def test_composite_image_api_crud_order_and_cover_projection(api_context) -> None:
    app, _, storage = api_context
    first = upload_api_meme(app, "第一张", "red")
    meme_id = first["id"]

    appended = request(
        app,
        "POST",
        f"/api/memes/{meme_id}/images",
        files={"file": ("second.png", make_image_bytes("blue"), "image/png")},
    )

    assert appended.status_code == 200
    body = appended.json()
    assert body["image_count"] == 2
    assert [image["position"] for image in body["images"]] == [0, 1]
    assert body["image_url"] == body["images"][0]["image_url"]
    assert body["thumbnail_url"] == body["images"][0]["thumbnail_url"]

    duplicate = request(
        app,
        "POST",
        f"/api/memes/{meme_id}/images",
        files={"file": ("copy.png", make_image_bytes("blue"), "image/png")},
    )
    assert duplicate.status_code == 409
    assert len(list(storage.images_dir.iterdir())) == 2
    assert len(list(storage.thumbnails_dir.iterdir())) == 2

    image_ids = [image["id"] for image in body["images"]]
    invalid_order = request(
        app,
        "PATCH",
        f"/api/memes/{meme_id}/images/order",
        json={"image_ids": [image_ids[0], image_ids[0]]},
    )
    assert invalid_order.status_code == 422

    reordered = request(
        app,
        "PATCH",
        f"/api/memes/{meme_id}/images/order",
        json={"image_ids": list(reversed(image_ids))},
    )
    assert reordered.status_code == 200
    reordered_body = reordered.json()
    assert [image["id"] for image in reordered_body["images"]] == list(
        reversed(image_ids)
    )
    assert reordered_body["image_url"] == reordered_body["images"][0]["image_url"]

    deleted = request(
        app,
        "DELETE",
        f"/api/memes/{meme_id}/images/{image_ids[0]}",
    )
    assert deleted.status_code == 200
    assert deleted.json()["image_count"] == 1
    assert deleted.json()["images"][0]["position"] == 0

    final_delete = request(
        app,
        "DELETE",
        f"/api/memes/{meme_id}/images/{image_ids[1]}",
    )
    assert final_delete.status_code == 422
    assert "last image" in final_delete.json()["detail"]


def test_meme_response_uses_first_image_as_authoritative_cover(api_context) -> None:
    app, session, _ = api_context
    created = upload_api_meme(app, "封面权威来源", "red")
    meme = session.get(Meme, created["id"])
    assert meme is not None
    meme.original_filename = "drift.png"
    meme.stored_filename = "drift.png"
    meme.file_path = "drift.png"
    meme.thumbnail_path = "drift-thumb.png"
    meme.mime_type = "image/gif"
    meme.file_size = 1
    meme.width = 1
    meme.height = 1
    meme.file_hash = "drift-hash"
    session.commit()

    response = request(app, "GET", f"/api/memes/{created['id']}")

    assert response.status_code == 200
    body = response.json()
    cover = body["images"][0]
    assert body["original_filename"] == cover["original_filename"]
    assert body["stored_filename"] == cover["stored_filename"]
    assert body["image_url"] == cover["image_url"]
    assert body["thumbnail_url"] == cover["thumbnail_url"]
    assert body["mime_type"] == cover["mime_type"]
    assert body["file_size"] == cover["file_size"]
    assert body["width"] == cover["width"]
    assert body["height"] == cover["height"]
    assert body["file_hash"] == cover["file_hash"]


def test_composite_endpoints_report_missing_group_file_as_gone(
    api_context,
) -> None:
    app, _, storage = api_context
    primary = upload_api_meme(app, "缺少次图", "red")
    peer = upload_api_meme(app, "关联对象", "green")
    appended = request(
        app,
        "POST",
        f"/api/memes/{primary['id']}/images",
        files={"file": ("second.png", make_image_bytes("blue"), "image/png")},
    ).json()
    relation = request(
        app,
        "POST",
        f"/api/memes/{primary['id']}/relations",
        json={"meme_ids": [peer["id"]]},
    )
    assert relation.status_code == 200
    missing = appended["images"][1]
    storage.delete(missing["image_url"], missing["thumbnail_url"])

    responses = [
        request(
            app,
            "POST",
            f"/api/memes/{primary['id']}/images",
            files={
                "file": ("third.png", make_image_bytes("purple"), "image/png")
            },
        ),
        request(
            app,
            "PATCH",
            f"/api/memes/{primary['id']}/images/order",
            json={
                "image_ids": [image["id"] for image in appended["images"]]
            },
        ),
        request(
            app,
            "DELETE",
            f"/api/memes/{primary['id']}/images/{appended['images'][0]['id']}",
        ),
        request(app, "GET", f"/api/memes/{primary['id']}/relations"),
        request(
            app,
            "POST",
            f"/api/memes/{primary['id']}/relations",
            json={"meme_ids": [peer["id"]]},
        ),
        request(
            app,
            "DELETE",
            f"/api/memes/{primary['id']}/relations/{peer['id']}",
        ),
    ]

    assert [response.status_code for response in responses] == [410] * len(
        responses
    )


def test_relation_api_is_bidirectional_non_transitive_and_removable(
    api_context,
) -> None:
    app, _, _ = api_context
    first = upload_api_meme(app, "甲", "red")
    second = upload_api_meme(app, "乙", "blue")
    third = upload_api_meme(app, "丙", "green")

    added_first = request(
        app,
        "POST",
        f"/api/memes/{first['id']}/relations",
        json={"meme_ids": [second["id"], second["id"]]},
    )
    added_second = request(
        app,
        "POST",
        f"/api/memes/{second['id']}/relations",
        json={"meme_ids": [third["id"]]},
    )

    assert added_first.status_code == 200
    assert [item["id"] for item in added_first.json()] == [second["id"]]
    assert {item["id"] for item in added_second.json()} == {
        first["id"],
        third["id"],
    }
    assert [
        item["id"]
        for item in request(
            app,
            "GET",
            f"/api/memes/{first['id']}/relations",
        ).json()
    ] == [second["id"]]
    assert [
        item["id"]
        for item in request(
            app,
            "GET",
            f"/api/memes/{third['id']}/relations",
        ).json()
    ] == [second["id"]]

    invalid_batch = request(
        app,
        "POST",
        f"/api/memes/{first['id']}/relations",
        json={"meme_ids": [third["id"], 999]},
    )
    assert invalid_batch.status_code == 422
    assert [
        item["id"]
        for item in request(
            app,
            "GET",
            f"/api/memes/{first['id']}/relations",
        ).json()
    ] == [second["id"]]

    removed = request(
        app,
        "DELETE",
        f"/api/memes/{second['id']}/relations/{first['id']}",
    )
    assert removed.status_code == 204
    assert request(
        app,
        "GET",
        f"/api/memes/{first['id']}/relations",
    ).json() == []
