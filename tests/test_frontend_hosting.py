import asyncio
from pathlib import Path

from httpx import ASGITransport, AsyncClient, Response

from app.main import create_app


def get(app, path: str) -> Response:
    async def request() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path)

    return asyncio.run(request())


def test_frontend_is_mounted_last_when_index_exists(tmp_path: Path) -> None:
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    (frontend_dir / "index.html").write_text(
        "<!doctype html><title>Meme Vault</title>",
        encoding="utf-8",
    )
    images_dir = tmp_path / "images"
    thumbnails_dir = tmp_path / "thumbnails"

    app = create_app(images_dir, thumbnails_dir, frontend_dir)
    route_paths = [
        route.path for route in app.routes if hasattr(route, "path")
    ]

    assert get(app, "/").status_code == 200
    assert "Meme Vault" in get(app, "/").text
    assert route_paths[-1] == ""
    assert route_paths.index("") > route_paths.index("/api/health")
    assert route_paths.index("") > route_paths.index("/media/images")
    assert route_paths.index("") > route_paths.index("/media/thumbnails")
    assert route_paths.index("") > route_paths.index("/docs")


def test_frontend_is_not_mounted_without_index(tmp_path: Path) -> None:
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    (frontend_dir / "asset.js").write_text("console.log('asset')", encoding="utf-8")

    app = create_app(
        tmp_path / "images",
        tmp_path / "thumbnails",
        frontend_dir,
    )
    route_paths = [
        route.path for route in app.routes if hasattr(route, "path")
    ]

    assert "" not in route_paths
    assert get(app, "/").status_code == 404
    assert get(app, "/api/health").json() == {"status": "ok"}
    assert get(app, "/docs").status_code == 200


def test_mobile_ingest_has_a_clean_route_when_built(tmp_path: Path) -> None:
    frontend_dir = tmp_path / "frontend"
    mobile_dir = frontend_dir / "mobile"
    mobile_dir.mkdir(parents=True)
    (frontend_dir / "index.html").write_text(
        "<!doctype html><title>Meme Vault</title>",
        encoding="utf-8",
    )
    (mobile_dir / "index.html").write_text(
        "<!doctype html><title>Mobile Ingest</title>",
        encoding="utf-8",
    )

    app = create_app(tmp_path / "images", tmp_path / "thumbnails", frontend_dir)

    response = get(app, "/mobile")
    assert response.status_code == 200
    assert "Mobile Ingest" in response.text
    route_paths = [route.path for route in app.routes if hasattr(route, "path")]
    assert route_paths.index("/mobile") < route_paths.index("")


def test_frontend_mount_does_not_shadow_api_or_media(tmp_path: Path) -> None:
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    (frontend_dir / "index.html").write_text(
        "<!doctype html><title>Meme Vault</title>",
        encoding="utf-8",
    )
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    (images_dir / "sample.png").write_bytes(b"image-content")

    app = create_app(images_dir, tmp_path / "thumbnails", frontend_dir)

    assert get(app, "/api/health").json() == {"status": "ok"}
    assert get(app, "/media/images/sample.png").content == b"image-content"
    assert get(app, "/docs").status_code == 200
