"""Multi-Vault API 测试：CRUD、删除保护、跨 Vault 访问边界与 Vault 媒体服务。"""
import asyncio
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main_module
from app.database import Base, get_db
from tests.vault_helpers import ensure_default_vault


def png_bytes(size: int = 4) -> bytes:
    output = BytesIO()
    Image.new("RGB", (size, size), (10, 20, 30)).save(output, format="PNG")
    return output.getvalue()


def large_png_bytes(target_mb: int = 11) -> bytes:
    """构造一张体积约 target_mb MB 的有效 PNG（不可压缩随机像素）。"""
    import os
    import struct
    import zlib

    width, height = 2048, 1900
    row_payload = os.urandom(width * 3)
    raw = (bytes([0]) + row_payload) * height
    signature = bytes([0x89]) + b"PNG" + bytes([0x0D, 0x0A, 0x1A, 0x0A])
    png = bytearray(signature)

    def chunk(tag: bytes, data: bytes) -> None:
        png.extend(struct.pack(">I", len(data)))
        png.extend(tag)
        png.extend(data)
        png.extend(struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    chunk(b"IDAT", zlib.compress(raw, level=0))
    chunk(b"IEND", b"")
    assert len(png) >= target_mb * 1024 * 1024
    return bytes(png)


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


def test_vault_crud_round_trip(api_context):
    app, session, default_vault, _tmp = api_context

    response = request(app, "GET", "/api/vaults")
    assert response.status_code == 200
    assert [(vault["slug"], vault["meme_count"]) for vault in response.json()] == [
        ("meme", 0)
    ]

    response = request(
        app,
        "POST",
        "/api/vaults",
        json={"name": "二次元收藏", "slug": "anime", "type": "image", "icon": "🌸"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["slug"] == "anime"
    assert body["storage_path"] == "vaults/anime"
    anime_id = body["id"]

    response = request(app, "POST", "/api/vaults", json={"name": "重复", "slug": "anime"})
    assert response.status_code == 409

    response = request(app, "POST", "/api/vaults", json={"name": "保留", "slug": "meme"})
    assert response.status_code == 409

    response = request(app, "POST", "/api/vaults", json={"name": "坏 slug", "slug": "Bad_Slug"})
    assert response.status_code == 422

    response = request(
        app, "PATCH", f"/api/vaults/{anime_id}", json={"name": "Anime", "icon": "🎴"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Anime"

    response = request(app, "GET", f"/api/vaults/{anime_id}")
    assert response.status_code == 200
    assert response.json()["meme_count"] == 0


def test_upload_list_and_delete_are_vault_scoped(api_context):
    app, session, default_vault, tmp_path = api_context
    created = request(
        app, "POST", "/api/vaults", json={"name": "Anime", "slug": "anime"}
    ).json()
    anime_id = created["id"]

    meme_response = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("a.png", png_bytes(4), "image/png")},
        data={"title": "Meme 侧 A"},
    )
    assert meme_response.status_code == 201
    meme_a_id = meme_response.json()["id"]

    anime_response = request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("b.png", png_bytes(8), "image/png")},
        data={"title": "Anime 侧 B"},
    )
    assert anime_response.status_code == 201
    anime_b = anime_response.json()
    assert anime_b["image_url"].startswith("/media/vaults/anime/images/")

    # 列表互相隔离
    assert [meme["id"] for meme in request(app, "GET", "/api/memes").json()] == [meme_a_id]
    vault_list = request(app, "GET", f"/api/vaults/{anime_id}/memes").json()
    assert [meme["id"] for meme in vault_list] == [anime_b["id"]]
    assert request(app, "GET", "/api/memes/page").json()["total"] == 1
    assert request(app, "GET", f"/api/vaults/{anime_id}/memes/page").json()["total"] == 1

    # 随机只在各自 Vault 内
    assert request(app, "GET", "/api/memes/library-random").json()["id"] == meme_a_id
    assert request(app, "GET", f"/api/vaults/{anime_id}/memes/random").json()["id"] == anime_b["id"]

    # 跨 Vault 访问与删除一律 404
    assert request(app, "GET", f"/api/vaults/{anime_id}/memes/{meme_a_id}").status_code == 404
    assert request(app, "DELETE", f"/api/vaults/{anime_id}/memes/{meme_a_id}").status_code == 404
    from app.models.meme import Meme

    assert session.get(Meme, meme_a_id) is not None

    # Vault 媒体路由可访问，且不接受路径穿越
    media = request(app, "GET", anime_b["image_url"])
    assert media.status_code == 200
    assert media.headers["content-type"] == "image/png"
    traversal = request(app, "GET", "/media/vaults/anime/images/..%2F..%2Fsecret.png")
    assert traversal.status_code == 404


def test_vault_delete_protection_and_cleanup(api_context):
    app, session, default_vault, tmp_path = api_context
    anime_id = request(
        app, "POST", "/api/vaults", json={"name": "Anime", "slug": "anime"}
    ).json()["id"]

    # 默认 Vault 受保护
    assert request(app, "DELETE", f"/api/vaults/{default_vault.id}").status_code == 409

    anime_media = request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("b.png", png_bytes(8), "image/png")},
        data={"title": "B"},
    ).json()

    # 非空 Vault 拒绝直接删除
    assert request(app, "DELETE", f"/api/vaults/{anime_id}").status_code == 409

    response = request(app, "DELETE", f"/api/vaults/{anime_id}?force=true")
    assert response.status_code == 204
    assert request(app, "GET", f"/api/vaults/{anime_id}").status_code == 404
    # 独立目录树被清理
    assert not (tmp_path / "vaults" / "anime").exists()
    # meme Vault 数据不受影响
    assert request(app, "GET", "/api/vaults").json()[0]["slug"] == "meme"
    assert anime_media["image_url"]


def test_max_file_size_mb_round_trip_and_enforcement(api_context):
    app, session, default_vault, _tmp = api_context

    # 新建时指定自定义上限
    created = request(
        app,
        "POST",
        "/api/vaults",
        json={"name": "大图仓", "slug": "big", "max_file_size_mb": 1},
    ).json()
    assert created["max_file_size_mb"] == 1

    # PATCH 修改上限
    patched = request(
        app, "PATCH", f"/api/vaults/{created['id']}", json={"max_file_size_mb": 2}
    ).json()
    assert patched["max_file_size_mb"] == 2

    # 超过仓库自定义上限的图片被拒绝（413），而不是默认 100MB
    response = request(
        app,
        "POST",
        f"/api/vaults/{created['id']}/memes",
        files={"file": ("big.png", large_png_bytes(11), "image/png")},
        data={"title": "超大图"},
    )
    assert response.status_code == 413

    # 默认 Vault 未配置时使用新的 100MB 默认：11MB（旧 10MB 之上）可上传
    response = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("big.png", large_png_bytes(11), "image/png")},
        data={"title": "大图"},
    )
    assert response.status_code == 201


def test_job_creation_requires_explicit_vault_id(api_context):
    """v2.0 任务类接口：缺失 vault_id 必须 422，不得静默回退默认 meme Vault。"""
    app, session, default_vault, _tmp = api_context

    import zipfile
    from io import BytesIO as _BytesIO

    zip_buffer = _BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as archive:
        archive.writestr("one.png", b"placeholder")
    zip_content = zip_buffer.getvalue()

    response = request(
        app,
        "POST",
        "/api/import-jobs",
        files={"archive": ("a.zip", zip_content, "application/zip")},
        data={"chunk_size": "100"},
    )
    assert response.status_code == 422

    response = request(
        app,
        "POST",
        "/api/export-jobs",
        json={"scope": "all", "organization": "flat", "include_manifest": True, "archive_name": "x"},
    )
    assert response.status_code == 422

    response = request(
        app, "POST", "/api/embedding-jobs", json={"scope": "all", "max_workers": 4}
    )
    assert response.status_code == 422

    response = request(app, "POST", "/api/enrichment-jobs", json={"scope": "all"})
    assert response.status_code == 422

    # 数据库未被写入任何任务
    from sqlalchemy import text as _text

    for table in ("import_jobs", "export_jobs", "embedding_jobs", "enrichment_jobs"):
        count = session.execute(_text(f"SELECT count(*) FROM {table}")).scalar()  # noqa: S608
        assert count == 0


def test_same_hash_allowed_across_vaults_but_not_within(api_context):
    app, session, default_vault, _tmp = api_context
    anime_id = request(
        app, "POST", "/api/vaults", json={"name": "Anime", "slug": "anime"}
    ).json()["id"]
    content = png_bytes(6)

    first = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("a.png", content, "image/png")},
        data={"title": "A"},
    )
    assert first.status_code == 201

    cross = request(
        app,
        "POST",
        f"/api/vaults/{anime_id}/memes",
        files={"file": ("a.png", content, "image/png")},
        data={"title": "A in anime"},
    )
    assert cross.status_code == 201

    duplicate = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("a.png", content, "image/png")},
        data={"title": "A again"},
    )
    assert duplicate.status_code == 409

    # 数据层面：同 hash 只能存在于不同 Vault
    from sqlalchemy import text

    rows = session.execute(
        text("SELECT vault_id, count(*) FROM memes GROUP BY vault_id")
    ).all()
    counts = {vault_id: count for vault_id, count in rows}
    assert counts[default_vault.id] == 1
    assert counts[anime_id] == 1
