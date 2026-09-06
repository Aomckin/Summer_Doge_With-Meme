"""v2.0.1 Vault Profile 验收测试：能力开关、Typed Metadata、上传管线与过滤。"""
import asyncio
from io import BytesIO
from pathlib import Path
import struct
import zlib

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main_module
from app.database import Base, get_db, upgrade_vault_isolation
from app.models.vault import Vault
from app.vault_profiles import (
    PROFILE_CAPABILITIES,
    normalize_profile_metadata,
    orientation_for_size,
)
from tests.vault_helpers import ensure_default_vault


def png_bytes(width: int = 4, height: int = 4) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), (10, 20, 30)).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def api_context(tmp_path: Path):
    from sqlalchemy.pool import StaticPool

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


def test_vault_response_exposes_profile_and_capabilities(api_context):
    app, session, default_vault, _tmp = api_context
    anime_id = make_anime_vault(app)

    vaults = {vault["slug"]: vault for vault in request(app, "GET", "/api/vaults").json()}
    assert vaults["meme"]["profile"] == "meme"
    assert vaults["meme"]["capabilities"]["templates"] is True
    assert "artworkMetadata" not in vaults["meme"]["capabilities"]
    assert vaults["anime"]["profile"] == "anime"
    assert vaults["anime"]["capabilities"]["artworkMetadata"] is True
    assert "templates" not in vaults["anime"]["capabilities"]

    # generic 是兜底 Profile：只有通用能力
    generic_id = request(
        app, "POST", "/api/vaults", json={"name": "通用", "slug": "stuff", "profile": "generic"}
    ).json()["id"]
    vaults = {vault["slug"]: vault for vault in request(app, "GET", "/api/vaults").json()}
    assert vaults["stuff"]["profile"] == "generic"
    assert vaults["stuff"]["capabilities"] == {}

    # 非法 profile 被拒绝
    assert request(
        app, "POST", "/api/vaults", json={"name": "x", "slug": "x", "profile": "nonsense"}
    ).status_code == 422

    # profile 可切换，能力随之变化
    switched = request(app, "PATCH", f"/api/vaults/{generic_id}", json={"profile": "anime"}).json()
    assert switched["profile"] == "anime"
    assert switched["capabilities"]["favorite"] is True


def test_anime_upload_pipeline_prefills_orientation(api_context):
    app, session, default_vault, _tmp = api_context
    anime_id = make_anime_vault(app)

    portrait = request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("tall.png", png_bytes(800, 1200), "image/png")},
        data={"title": "tall"},
    ).json()
    assert portrait["profile_metadata"] == {
        "profile": "anime",
        "data": {"orientation": "portrait"},
    }

    landscape = request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("wide.png", png_bytes(1200, 800), "image/png")},
        data={"title": "wide"},
    ).json()
    assert landscape["profile_metadata"]["data"]["orientation"] == "landscape"

    # meme Vault（无 Typed Metadata）上传不产生元数据
    legacy = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("a.png", png_bytes(), "image/png")},
        data={"title": "a"},
    ).json()
    assert legacy["profile_metadata"] is None


def test_typed_metadata_edit_validation_and_capability_gate(api_context):
    app, session, default_vault, _tmp = api_context
    anime_id = make_anime_vault(app)
    meme_id = request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("a.png", png_bytes(800, 1200), "image/png")},
        data={"title": "a"},
    ).json()["id"]

    # 手工编辑领域字段
    edited = request(
        app,
        "PATCH",
        f"/api/vaults/{anime_id}/memes/{meme_id}/metadata",
        json={"data": {
            "work": "Project SEKAI",
            "characters": ["初音未来"],
            "artist": "someone",
            "favorite_level": 3,
        }},
    )
    assert edited.status_code == 200
    assert edited.json()["profile_metadata"]["data"]["work"] == "Project SEKAI"

    # 未知字段 / 非法取值 / 越界
    assert request(
        app, "PATCH", f"/api/vaults/{anime_id}/memes/{meme_id}/metadata",
        json={"data": {"haha": 1}},
    ).status_code == 422
    assert request(
        app, "PATCH", f"/api/vaults/{anime_id}/memes/{meme_id}/metadata",
        json={"data": {"orientation": "diagonal"}},
    ).status_code == 422
    assert request(
        app, "PATCH", f"/api/vaults/{anime_id}/memes/{meme_id}/metadata",
        json={"data": {"favorite_level": 9}},
    ).status_code == 422

    # 无 Typed Metadata 的 Profile（generic）拒绝元数据编辑
    generic_id = request(
        app, "POST", "/api/vaults", json={"name": "通用", "slug": "stuff"}
    ).json()["id"]
    generic_meme = request(
        app,
        "POST",
        f"/api/vaults/{generic_id}/memes",
        files={"file": ("a.png", png_bytes(), "image/png")},
        data={"title": "a"},
    ).json()["id"]
    assert request(
        app, "PATCH", f"/api/vaults/{generic_id}/memes/{generic_meme}/metadata",
        json={"data": {"work": "x"}},
    ).status_code == 422

    # 校验器单测：字段约束
    with pytest.raises(ValueError):
        normalize_profile_metadata("meme", {"work": "x"})


def test_profile_filters_orientation_favorite_and_metadata_search(api_context):
    app, session, default_vault, _tmp = api_context
    anime_id = make_anime_vault(app)
    tall_id = request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("tall.png", png_bytes(800, 1200), "image/png")},
        data={"title": "tall"},
    ).json()["id"]

    def patch_meta(data):
        return request(
            app, "PATCH", f"/api/vaults/{anime_id}/memes/{tall_id}/metadata",
            json={"data": data},
        )

    assert patch_meta({"work": "Project SEKAI", "favorite_level": 3}).status_code == 200
    request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("wide.png", png_bytes(1200, 800), "image/png")},
        data={"title": "wide"},
    )

    assert request(
        app, "GET", f"/api/vaults/{anime_id}/memes/page",
        params={"orientation": "portrait"},
    ).json()["total"] == 1
    assert request(
        app, "GET", f"/api/vaults/{anime_id}/memes/page",
        params={"orientation": "landscape"},
    ).json()["total"] == 1
    assert request(
        app, "GET", f"/api/vaults/{anime_id}/memes/page",
        params={"favorite": "true"},
    ).json()["total"] == 1

    # 元数据关键词与标题关键词共用一个 q：OR 语义
    assert request(
        app, "GET", f"/api/vaults/{anime_id}/memes/page", params={"q": "sekai"},
    ).json()["total"] == 1
    assert request(
        app, "GET", f"/api/vaults/{anime_id}/memes/page", params={"q": "wide"},
    ).json()["total"] == 1
    assert request(
        app, "GET", f"/api/vaults/{anime_id}/memes/page", params={"q": "nomatch"},
    ).json()["total"] == 0

    # meme Vault 的关键词搜索不受其它仓库元数据影响
    assert request(app, "GET", "/api/memes/page", params={"q": "sekai"}).json()["total"] == 0

    # 随机接口同样支持方向过滤
    random_portrait = request(
        app, "GET", f"/api/vaults/{anime_id}/memes/random",
        params={"orientation": "portrait"},
    ).json()
    assert random_portrait["id"] == tall_id


def test_legacy_type_backfills_profile(tmp_path: Path):
    """迁移：旧库 vaults.type 映射到 profile；meme 仓保持 meme。"""
    engine = create_engine(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE vaults (id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100) UNIQUE, "
            "type VARCHAR(50), description TEXT, icon VARCHAR(50), storage_path VARCHAR(255), "
            "config TEXT, created_at DATETIME, updated_at DATETIME)"
        ))
        connection.execute(text(
            "INSERT INTO vaults (name, slug, type, created_at, updated_at) "
            "VALUES ('Meme', 'meme', 'meme', '2026-01-01', '2026-01-01')"
        ))
        connection.execute(text(
            "INSERT INTO vaults (name, slug, type, created_at, updated_at) "
            "VALUES ('旧图片仓', 'old', 'image', '2026-01-01', '2026-01-01')"
        ))
    Base.metadata.create_all(engine)
    upgrade_vault_isolation(engine)
    with engine.connect() as connection:
        profiles = dict(connection.execute(text("SELECT slug, profile FROM vaults")).fetchall())
    engine.dispose()
    assert profiles["meme"] == "meme"
    # 旧 image 类型回填为 generic；用户可在界面切换为 anime
    assert profiles["old"] == "generic"


def test_orientation_helper():
    assert orientation_for_size(800, 1200) == "portrait"
    assert orientation_for_size(1200, 800) == "landscape"
    assert orientation_for_size(500, 500) == "square"


def test_profile_capability_matrix():
    """Capability 矩阵与任务书一致：Meme/Anime 共有核心能力，专属能力互不泄漏。"""
    meme = PROFILE_CAPABILITIES["meme"]
    anime = PROFILE_CAPABILITIES["anime"]
    generic = PROFILE_CAPABILITIES["generic"]
    assert meme["templates"] and meme["captions"] and "artworkMetadata" not in meme
    assert anime["artworkMetadata"] and anime["favorite"] and "templates" not in anime
    assert "captions" not in anime
    assert generic == {}
