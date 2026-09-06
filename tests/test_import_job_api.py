import asyncio
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
from tests.vault_helpers import ensure_default_vault


class RecordingManager:
    def __init__(self) -> None:
        self.submitted: list[int] = []
        self.cancelled: list[int] = []

    def submit(self, job_id: int) -> None:
        self.submitted.append(job_id)

    def cancel(self, job_id: int) -> None:
        self.cancelled.append(job_id)


def zip_bytes() -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("one.png", b"not processed by the recording manager")
    return buffer.getvalue()


def request(app, method: str, path: str, **kwargs):
    async def send():
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def test_import_job_routes_create_poll_cancel_list_and_delete(tmp_path: Path) -> None:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    default_vault = ensure_default_vault(session)
    app = create_app(
        tmp_path / "images",
        tmp_path / "thumbnails",
        import_archives_dir=tmp_path / "archives",
    )
    manager = RecordingManager()
    app.state.import_job_manager = manager
    app.dependency_overrides[get_db] = lambda: session

    created = request(
        app,
        "POST",
        "/api/import-jobs",
        files={"archive": ("vault.zip", zip_bytes(), "application/zip")},
        data={
            "vault_id": str(default_vault.id),
            "tags": "funny, reaction",
            "source": "backup",
            "chunk_size": "100",
        },
    )
    assert created.status_code == 202
    job_id = created.json()["id"]
    assert manager.submitted == [job_id]
    assert created.json()["tags"] == ["funny", "reaction"]
    assert len(list((tmp_path / "archives").glob("*.zip"))) == 1

    polled = request(app, "GET", f"/api/import-jobs/{job_id}")
    items = request(app, "GET", f"/api/import-jobs/{job_id}/items?status=failed")
    cancelled = request(app, "POST", f"/api/import-jobs/{job_id}/cancel")
    assert polled.status_code == 200
    assert items.json() == {"items": [], "total": 0, "offset": 0, "limit": 100}
    assert cancelled.json()["status"] == "cancelling"
    assert manager.cancelled == [job_id]

    # Simulate the worker's terminal cancellation before deletion.
    job = session.get(__import__("app.models.import_job", fromlist=["ImportJob"]).ImportJob, job_id)
    job.status = "cancelled"
    session.commit()
    deleted = request(app, "DELETE", f"/api/import-jobs/{job_id}")
    assert deleted.status_code == 204
    assert list((tmp_path / "archives").glob("*.zip")) == []


def test_import_job_vault_id_form_field_targets_vault(tmp_path: Path) -> None:
    from app.models.vault import Vault

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    default_vault = ensure_default_vault(session)
    anime = Vault(name="Anime", slug="anime", type="image")
    session.add(anime)
    session.commit()
    session.refresh(anime)

    app = create_app(
        tmp_path / "images",
        tmp_path / "thumbnails",
        import_archives_dir=tmp_path / "archives",
    )
    app.state.import_job_manager = RecordingManager()
    app.dependency_overrides[get_db] = lambda: session

    created = request(
        app,
        "POST",
        "/api/import-jobs",
        files={"archive": ("vault.zip", zip_bytes(), "application/zip")},
        data={"vault_id": str(anime.id), "chunk_size": "100"},
    )
    assert created.status_code == 202
    job_id = created.json()["id"]
    job = session.get(
        __import__("app.models.import_job", fromlist=["ImportJob"]).ImportJob, job_id
    )
    assert job is not None
    # 前端在 anime 仓上传的 ZIP 必须落到 anime 仓，而不是默认 meme Vault。
    assert job.vault_id == anime.id
    assert job.vault_id != default_vault.id

    app.dependency_overrides.clear()
    session.close()
