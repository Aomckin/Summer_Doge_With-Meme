import asyncio
from io import BytesIO
from pathlib import Path

from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
from app.services.export_job_service import ExportJobService
from app.services.meme_service import MemeService
from app.storage.image_storage import ImageStorage


class Manager:
    def __init__(self): self.submitted = []; self.cancelled = []
    def submit(self, job_id): self.submitted.append(job_id)
    def cancel(self, job_id): self.cancelled.append(job_id)


def request(app, method, path, **kwargs):
    async def send():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(send())


def test_export_api_lifecycle_and_download_guards(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    images, thumbs, exports = tmp_path / "images", tmp_path / "thumbs", tmp_path / "exports"
    app = create_app(images, thumbs, export_archives_dir=exports)
    manager = Manager(); app.state.export_job_manager = manager
    app.dependency_overrides[get_db] = lambda: session
    buffer = BytesIO(); Image.new("RGB", (10, 10), "red").save(buffer, format="PNG")
    MemeService(session, ImageStorage(images, thumbs)).create_meme("one.png", buffer.getvalue(), title="一")

    created = request(app, "POST", "/api/export-jobs", json={
        "scope": "all", "organization": "flat", "include_manifest": True, "archive_name": "全部",
    })
    assert created.status_code == 202 and manager.submitted == [created.json()["id"]]
    job_id = created.json()["id"]
    assert request(app, "GET", f"/api/export-jobs/{job_id}/download").status_code == 409

    service = ExportJobService(session, ImageStorage(images, thumbs), exports)
    service.run(job_id)
    ready = request(app, "GET", f"/api/export-jobs/{job_id}")
    download = request(app, "GET", f"/api/export-jobs/{job_id}/download")
    items = request(app, "GET", f"/api/export-jobs/{job_id}/items?failed_only=false")
    assert ready.json()["status"] == "ready"
    assert download.status_code == 200 and download.content.startswith(b"PK")
    assert "attachment" in download.headers["content-disposition"]
    assert items.json()["total"] == 1
    assert request(app, "DELETE", f"/api/export-jobs/{job_id}").status_code == 204
    assert list(exports.glob("*.zip")) == []
