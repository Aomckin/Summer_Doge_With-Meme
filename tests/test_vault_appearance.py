"""v2.0 Phase C：Per-Vault Appearance 测试（持久化、预设、背景资产与回退）。"""
import asyncio
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main_module
from app.database import Base, get_db
from app.vault_themes import THEME_PRESETS, profile_default_appearance
from tests.vault_helpers import ensure_default_vault


def png_bytes(width: int = 4, height: int = 4) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), (10, 20, 30)).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def api_context(tmp_path: Path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    default_vault = ensure_default_vault(session)

    app = main_module.create_app(
        images_dir=tmp_path / "images",
        thumbnails_dir=tmp_path / "thumbnails",
        import_archives_dir=tmp_path / "import_archives",
        export_archives_dir=tmp_path / "export_archives",
    )
    app.dependency_overrides[get_db] = lambda: session
    yield app, session, default_vault, tmp_path
    app.dependency_overrides.pop(get_db, None)
    session.close()
    engine.dispose()


def request(app, method: str, path: str, **kwargs):
    async def call() -> object:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(call())


def make_anime_vault(app) -> int:
    response = request(
        app, "POST", "/api/vaults",
        json={"name": "二次元", "slug": "anime", "profile": "anime"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_profile_default_theme_applied_on_creation(api_context):
    app, _session, _default, _tmp = api_context
    anime_id = make_anime_vault(app)
    body = request(app, "GET", f"/api/vaults/{anime_id}").json()
    assert body["appearance"]["presetId"] == "dreamy"
    assert body["appearance"] == profile_default_appearance("anime")
    # meme 仓保持自己的默认主题：两仓主题天然不同
    meme_body = request(app, "GET", "/api/vaults/1").json()
    assert meme_body["appearance"]["presetId"] == "midnight"
    assert meme_body["appearance"] != body["appearance"]


def test_custom_appearance_persists_and_validates(api_context):
    app, session, _default, _tmp = api_context
    anime_id = make_anime_vault(app)

    payload = {"accentColor": "#8fd6ff", "backgroundBlur": 24, "presetId": "glass"}
    patched = request(
        app, "PATCH", f"/api/vaults/{anime_id}/appearance", json={"appearance": payload}
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["appearance"]["accentColor"] == "#8fd6ff"
    assert body["appearance"]["backgroundBlur"] == 24

    # 重新读取确认已持久化到数据库
    again = request(app, "GET", f"/api/vaults/{anime_id}").json()
    assert again["appearance"]["accentColor"] == "#8fd6ff"

    # 非法取值一律 422
    for bad in (
        {"accentColor": "red"},
        {"backgroundBlur": 99},
        {"nonsense": 1},
        {"backgroundUploadFile": "../evil.png"},
    ):
        response = request(
            app, "PATCH", f"/api/vaults/{anime_id}/appearance",
            json={"appearance": bad},
        )
        assert response.status_code == 422, bad

    # 非法提交不破坏既有配置
    assert request(app, "GET", f"/api/vaults/{anime_id}").json()["appearance"]["accentColor"] == "#8fd6ff"


def test_background_upload_serve_and_delete(api_context):
    app, session, _default, tmp_path = api_context
    anime_id = make_anime_vault(app)

    # 上传独立背景图（与业务 Asset 分离）
    patched = request(
        app,
        "PATCH",
        f"/api/vaults/{anime_id}/background-image",
        files={"file": ("bg.png", png_bytes(32, 32), "image/png")},
    )
    assert patched.status_code == 200
    body = patched.json()
    url = body["background_image_url"]
    assert url and url.startswith(f"/api/vaults/{anime_id}/background-image?v=")
    assert "backgroundAssetId" not in body["appearance"]

    # 可访问且内容一致
    served = request(app, "GET", url)
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png"

    # 删除背景：文件与外观引用一并清除
    deleted = request(app, "DELETE", f"/api/vaults/{anime_id}/background-image")
    assert deleted.status_code == 200
    assert deleted.json()["background_image_url"] is None
    assert request(app, "GET", url).status_code == 404
    assert not list((tmp_path / "backgrounds" / f"vault-{anime_id}").glob("*")) if (tmp_path / "backgrounds" / f"vault-{anime_id}").exists() else True

    # 非法图片 415
    assert request(
        app,
        "PATCH",
        f"/api/vaults/{anime_id}/background-image",
        files={"file": ("bg.txt", b"not an image", "text/plain")},
    ).status_code == 415


def test_background_upload_is_persistent_and_replaces_previous(api_context):
    app, session, _default, tmp_path = api_context
    anime_id = make_anime_vault(app)
    first = request(
        app,
        "PATCH",
        f"/api/vaults/{anime_id}/background-image",
        files={"file": ("a.png", png_bytes(8, 8), "image/png")},
    ).json()
    second = request(
        app,
        "PATCH",
        f"/api/vaults/{anime_id}/background-image",
        files={"file": ("b.png", png_bytes(16, 16), "image/png")},
    ).json()
    # URL 带版本参数：替换背景后 URL 变化，浏览器立即拉取新图（无需刷新页面）
    assert second["background_image_url"] != first["background_image_url"]
    assert "?v=background-" in second["background_image_url"]

    # 同一固定路径，旧文件被替换（目录里只保留当前背景）
    files = list((tmp_path / "backgrounds" / f"vault-{anime_id}").glob("*"))
    assert len(files) == 1
    # 配置持久化：重新读取仍在
    reread = request(app, "GET", f"/api/vaults/{anime_id}").json()["background_image_url"]
    assert reread is not None and reread == second["background_image_url"]


def test_vault_deletion_cleans_background_files(api_context):
    app, session, _default, tmp_path = api_context
    anime_id = make_anime_vault(app)
    request(
        app,
        "PATCH",
        f"/api/vaults/{anime_id}/background-image",
        files={"file": ("a.png", png_bytes(8, 8), "image/png")},
    )
    assert (tmp_path / "backgrounds" / f"vault-{anime_id}").exists()
    assert request(app, "DELETE", f"/api/vaults/{anime_id}?force=true").status_code == 204
    assert not (tmp_path / "backgrounds" / f"vault-{anime_id}").exists()


def test_theme_preset_values_match_frontend_contract():
    """后端预设值必须覆盖前端 AppearanceSettings 的全部数值键。"""
    for preset_id, settings in THEME_PRESETS.items():
        assert settings["accentColor"].startswith("#")
        assert len(settings) == 12, preset_id
