import asyncio
import json
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
from app.utils.download_names import safe_download_filename, sanitize_stem, unique_archive_name


def image_bytes(color: str) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (30, 20), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def request(app, method: str, path: str, **kwargs):
    async def send():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(send())


def context(tmp_path: Path):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    app = create_app(tmp_path / "images", tmp_path / "thumbs", export_archives_dir=tmp_path / "exports")
    app.dependency_overrides[get_db] = lambda: session
    return app, session


def upload(app, title: str, color: str = "red") -> dict:
    response = request(app, "POST", "/api/memes", files={"file": ("原图.png", image_bytes(color), "image/png")}, data={"title": title})
    assert response.status_code == 201
    return response.json()


def test_safe_download_names_remove_traversal_reserved_and_duplicates() -> None:
    assert sanitize_stem("CON", "fallback") == "_CON"
    assert "/" not in sanitize_stem("../危险/名称", "fallback")
    assert safe_download_filename("  ", "meme-7", ".png") == "meme-7.png"
    used: set[str] = set()
    assert unique_archive_name("../a/同名.png", used) == "a/同名.png"
    assert unique_archive_name("a/同名.png", used) == "a/同名_2.png"


def test_single_and_specific_image_download_return_original_attachment(tmp_path: Path) -> None:
    app, _ = context(tmp_path)
    created = upload(app, "中文 标题 / 特殊")
    response = request(app, "GET", f"/api/memes/{created['id']}/download")
    image = request(app, "GET", f"/api/memes/{created['id']}/images/{created['images'][0]['id']}/download")
    wrong = request(app, "GET", f"/api/memes/{created['id']}/images/999/download")
    assert response.content == image_bytes("red")
    assert response.headers["content-type"] == "image/png"
    assert "attachment" in response.headers["content-disposition"]
    assert "filename*=" in response.headers["content-disposition"]
    assert image.content == response.content
    assert wrong.status_code == 404


def test_composite_download_has_ordered_stored_images_and_manifest(tmp_path: Path) -> None:
    app, _ = context(tmp_path)
    created = upload(app, "组合/标题")
    appended = request(
        app, "POST", f"/api/memes/{created['id']}/images",
        files={"file": ("第二 张.png", image_bytes("blue"), "image/png")},
    ).json()
    response = request(app, "GET", f"/api/memes/{created['id']}/download")
    assert response.status_code == 200
    with ZipFile(BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert names[:2] == ["01_原图.png", "02_第二 张.png"]
        assert archive.getinfo(names[0]).compress_type == ZIP_STORED
        assert archive.read(names[0]) == image_bytes("red")
        assert archive.read(names[1]) == image_bytes("blue")
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["meme_id"] == created["id"]
    assert [item["id"] for item in manifest["images"]] == [item["id"] for item in appended["images"]]


def test_specific_download_reports_missing_file_as_gone(tmp_path: Path) -> None:
    app, session = context(tmp_path)
    created = upload(app, "missing")
    from app.models.meme_image import MemeImage
    image = session.get(MemeImage, created["images"][0]["id"])
    (tmp_path / "images" / image.file_path).unlink()
    response = request(app, "GET", f"/api/memes/{created['id']}/images/{image.id}/download")
    assert response.status_code == 410
