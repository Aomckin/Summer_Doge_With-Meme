from datetime import timedelta
from io import BytesIO
from pathlib import Path
from threading import Event
from zipfile import ZIP_STORED, ZipFile

import pytest
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.export_job import ExportJob, ExportJobItem
from app.models.template import Template
from app.services.export_job_service import (
    DISK_SAFETY_BYTES, ExportJobManager, ExportJobService, InsufficientExportSpaceError, utc_now,
)
from app.services.meme_service import MemeService
from app.storage.image_storage import ImageStorage


def image_bytes(index: int) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (20 + index, 12), color=(index % 255, 30, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


def context(tmp_path: Path):
    tmp_path.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{(tmp_path / 'db.sqlite').as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbs")
    service = ExportJobService(session, storage, tmp_path / "exports")
    return factory, session, storage, service


def seed(session, storage, count: int = 4):
    meme_service = MemeService(session, storage)
    template = Template(name="Doge/模板", description=None)
    session.add(template); session.commit()
    memes = []
    for index in range(count):
        memes.append(meme_service.create_meme(
            f"same.png", image_bytes(index), title=f"标题 {index}",
            description="match" if index % 2 == 0 else "other",
            tags=["doge", "reaction"] if index == 0 else (["doge"] if index % 2 == 0 else ["other"]),
            template_id=template.id if index < 2 else None,
        ))
    return memes, template


def create(service: ExportJobService, **overrides):
    values = dict(scope="all", query=None, tags=[], template_id=None, organization="flat", include_manifest=True, archive_name="导出/包")
    values.update(overrides)
    return service.create_job(**values)


def test_all_and_filtered_export_use_complete_server_query_and_stored_zip(tmp_path: Path) -> None:
    _, session, storage, service = context(tmp_path)
    memes, _ = seed(session, storage, 30)
    all_job = create(service)
    service.run(all_job.id)
    filtered = create(service, scope="filtered", query="match", tags=["doge"], organization="flat")
    service.run(filtered.id)
    session.expire_all()
    assert session.get(ExportJob, all_job.id).total_memes == 30
    filtered_job = session.get(ExportJob, filtered.id)
    assert filtered_job.total_memes == 15
    with ZipFile(service.archives_dir / filtered_job.archive_path) as archive:
        images = [name for name in archive.namelist() if name != "manifest.json"]
        assert len(images) == 15
        assert all(archive.getinfo(name).compress_type == ZIP_STORED for name in archive.namelist())
        assert archive.read(images[0]) == storage.original_path(memes[0].file_path).read_bytes()


def test_template_and_tag_organization_paths_and_size_estimate(tmp_path: Path) -> None:
    _, session, storage, service = context(tmp_path)
    memes, template = seed(session, storage)
    template_job = create(service, scope="filtered", template_id=template.id, organization="template")
    service.run(template_job.id)
    tag_job = create(service, organization="tag")
    flat_job = create(service, organization="flat")
    assert tag_job.total_images == flat_job.total_images + 1
    assert tag_job.estimated_bytes > flat_job.estimated_bytes
    with ZipFile(service.archives_dir / session.get(ExportJob, template_job.id).archive_path) as archive:
        assert any(name.startswith("templates/Doge_模板/") for name in archive.namelist())


def test_missing_file_completes_with_errors_and_delete_cleans_archive(tmp_path: Path) -> None:
    _, session, storage, service = context(tmp_path)
    memes, _ = seed(session, storage)
    storage.original_path(memes[1].file_path).unlink()
    job = create(service)
    service.run(job.id)
    session.expire_all()
    result = session.get(ExportJob, job.id)
    assert result.status == "completed_with_errors" and result.failed_count == 1
    assert service.download_path(job.id)[0].is_file()
    service.delete(job.id)
    assert session.get(ExportJob, job.id) is None
    assert list(service.archives_dir.glob("*.zip")) == []


def test_job_uses_creation_snapshot_when_meme_is_deleted_before_worker_runs(tmp_path: Path) -> None:
    _, session, storage, service = context(tmp_path)
    memes, _ = seed(session, storage, 2)
    job = create(service)
    MemeService(session, storage).delete_meme(memes[0].id)
    service.run(job.id)
    session.expire_all()
    result = session.get(ExportJob, job.id)
    assert result.total_memes == 2
    assert result.processed_memes == 2
    assert result.status == "completed_with_errors"
    assert result.failed_count == 1


def test_cancel_restart_expiry_and_disk_protection(tmp_path: Path, monkeypatch) -> None:
    factory, session, storage, service = context(tmp_path)
    seed(session, storage)
    job = create(service)
    event = Event(); event.set()
    service.run(job.id, event)
    assert session.get(ExportJob, job.id).status == "cancelled"
    assert list(service.archives_dir.glob("*.part")) == []

    interrupted = create(service); interrupted.status = "running"; session.commit()
    part = service.archives_dir / "old.part"; part.write_bytes(b"x")
    manager = ExportJobManager(factory, storage.images_dir, storage.thumbnails_dir, service.archives_dir)
    manager.startup(); session.expire_all()
    assert session.get(ExportJob, interrupted.id).status == "interrupted"
    assert not part.exists()
    manager.shutdown()

    ready = create(service); service.run(ready.id); session.expire_all()
    result = session.get(ExportJob, ready.id); result.expires_at = utc_now() - timedelta(seconds=1); session.commit()
    service.cleanup_expired(); session.expire_all()
    assert session.get(ExportJob, ready.id).status == "expired"

    usage = type("Usage", (), {"free": DISK_SAFETY_BYTES - 1})()
    monkeypatch.setattr("app.services.export_job_service.shutil.disk_usage", lambda _: usage)
    with pytest.raises(InsufficientExportSpaceError): create(service)
