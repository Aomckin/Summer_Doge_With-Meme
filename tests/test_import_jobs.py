from io import BytesIO
from pathlib import Path
from threading import Event
from zipfile import ZIP_DEFLATED, ZipFile

from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.import_job import ImportJob, ImportJobItem
from app.models.meme import Meme
from app.services.import_job_service import ImportJobManager, ImportJobService
from app.services import import_job_service as import_module
from app.storage.image_storage import ImageStorage


def image_bytes(color: tuple[int, int, int]) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (24, 24), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def make_context(tmp_path: Path):
    tmp_path.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    archives = tmp_path / "archives"
    service = ImportJobService(session, storage, archives)
    return factory, session, storage, service


def write_zip(path: Path, members: list[tuple[str, bytes]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        for name, content in members:
            archive.writestr(name, content)


def create_job(service: ImportJobService, archive: Path, *, chunk_size: int = 100):
    return service.create_job(
        original_filename="memes.zip",
        archive_path=archive,
        tags=["reaction"],
        template_id=None,
        source="archive-test",
        chunk_size=chunk_size,
    )


def test_zip_import_creates_independent_memes_in_three_chunks(tmp_path: Path) -> None:
    _, session, _, service = make_context(tmp_path)
    archive = service.archives_dir / "250.zip"
    members = []
    for index in range(250):
        # Different dimensions make every encoded image hash unique.
        buffer = BytesIO()
        Image.new("RGB", (24 + index, 8), color=(index % 255, 20, 30)).save(
            buffer, format="PNG"
        )
        members.append((f"folder/{index}.png", buffer.getvalue()))
    write_zip(archive, members)
    job = create_job(service, archive, chunk_size=100)

    service.run(job.id)

    session.expire_all()
    completed = session.get(ImportJob, job.id)
    assert completed is not None
    assert completed.status == "completed"
    assert (completed.processed_count, completed.success_count) == (250, 250)
    assert session.scalar(select(func.count()).select_from(Meme)) == 250
    assert session.scalar(select(func.count()).select_from(ImportJobItem)) == 250
    assert not archive.exists()


def test_import_ignores_junk_and_isolates_duplicate_corrupt_and_unsafe_items(
    tmp_path: Path,
) -> None:
    _, session, storage, service = make_context(tmp_path)
    duplicate = image_bytes((1, 2, 3))
    archive = service.archives_dir / "mixed.zip"
    write_zip(
        archive,
        [
            ("folder/", b""),
            ("__MACOSX/._x.png", b"junk"),
            (".hidden.png", b"junk"),
            ("folder/.DS_Store", b"junk"),
            ("folder/Thumbs.db", b"junk"),
            ("notes.txt", b"not an image"),
            ("nested.zip", b"not a nested archive"),
            ("one.png", duplicate),
            ("duplicate.png", duplicate),
            ("broken.png", b"broken"),
            ("../escape.png", image_bytes((4, 5, 6))),
            ("C:/absolute.png", image_bytes((7, 8, 9))),
            ("ok.png", image_bytes((10, 11, 12))),
        ],
    )
    job = create_job(service, archive)

    service.run(job.id)

    session.expire_all()
    completed = session.get(ImportJob, job.id)
    assert completed is not None
    assert completed.total_entries == 13
    assert completed.image_entries == 6
    assert (completed.success_count, completed.skipped_count, completed.failed_count) == (
        2,
        1,
        3,
    )
    items = list(session.scalars(select(ImportJobItem).order_by(ImportJobItem.entry_index)))
    assert [item.status for item in items] == [
        "success",
        "skipped",
        "failed",
        "failed",
        "failed",
        "success",
    ]
    assert not (tmp_path / "escape.png").exists()
    assert len(list(storage.images_dir.iterdir())) == 2
    assert len(list(storage.thumbnails_dir.iterdir())) == 2
    # Failed imports retain the source archive for retry-failed.
    assert archive.exists()


def test_cancelled_job_stops_before_new_member_and_removes_archive(tmp_path: Path) -> None:
    _, session, storage, service = make_context(tmp_path)
    archive = service.archives_dir / "cancel.zip"
    write_zip(archive, [("one.png", image_bytes((1, 1, 1)))])
    job = create_job(service, archive)
    cancelled = Event()
    cancelled.set()

    service.run(job.id, cancelled)

    session.expire_all()
    result = session.get(ImportJob, job.id)
    assert result is not None and result.status == "cancelled"
    assert result.processed_count == 0
    assert list(storage.images_dir.iterdir()) == []
    assert not archive.exists()


def test_startup_marks_running_jobs_interrupted(tmp_path: Path) -> None:
    factory, session, _, service = make_context(tmp_path)
    archive = service.archives_dir / "restart.zip"
    write_zip(archive, [("one.png", image_bytes((1, 2, 3)))])
    job = create_job(service, archive)
    job.status = "running"
    session.commit()
    manager = ImportJobManager(
        factory, service.storage.images_dir, service.storage.thumbnails_dir, service.archives_dir
    )
    partial = service.archives_dir / "abandoned.part"
    partial.write_bytes(b"partial")

    manager.recover_interrupted()

    session.expire_all()
    result = session.get(ImportJob, job.id)
    assert result is not None and result.status == "interrupted"
    assert archive.exists()
    assert not partial.exists()
    manager.shutdown()


def test_archive_limits_reject_member_count_total_size_and_ratio(
    tmp_path: Path, monkeypatch
) -> None:
    cases = [
        ("MAX_ARCHIVE_ENTRIES", 1, [("a.txt", b"a"), ("b.txt", b"b")]),
        ("MAX_TOTAL_UNCOMPRESSED_SIZE", 3, [("a.png", b"1234")]),
        ("MAX_COMPRESSION_RATIO", 1, [("a.png", b"0" * 10_000)]),
    ]
    for index, (setting, limit, members) in enumerate(cases):
        _, session, storage, service = make_context(tmp_path / str(index))
        archive = service.archives_dir / "limited.zip"
        write_zip(archive, members)
        job = create_job(service, archive)
        with monkeypatch.context() as scoped:
            scoped.setattr(import_module, setting, limit)
            service.run(job.id)

        session.expire_all()
        result = session.get(ImportJob, job.id)
        assert result is not None and result.status == "failed"
        assert result.error_message
        assert session.scalar(select(func.count()).select_from(Meme)) == 0
        assert list(storage.images_dir.iterdir()) == []
        assert not archive.exists()


def test_retry_failed_reprocesses_only_failed_members(tmp_path: Path, monkeypatch) -> None:
    _, session, storage, service = make_context(tmp_path)
    archive = service.archives_dir / "retry.zip"
    write_zip(
        archive,
        [("first.png", image_bytes((1, 2, 3))), ("second.png", image_bytes((4, 5, 6)))],
    )
    job = create_job(service, archive)
    original_validate = storage.validate
    calls = 0

    def fail_once(content: bytes):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("temporary decode failure")
        return original_validate(content)

    monkeypatch.setattr(storage, "validate", fail_once)
    service.run(job.id)
    session.expire_all()
    first_result = session.get(ImportJob, job.id)
    assert first_result is not None
    assert (first_result.success_count, first_result.failed_count) == (1, 1)
    monkeypatch.setattr(storage, "validate", original_validate)

    service.retry_failed(job.id)
    service.run(job.id)

    session.expire_all()
    result = session.get(ImportJob, job.id)
    assert result is not None
    assert (result.processed_count, result.success_count, result.failed_count) == (2, 2, 0)
    assert session.scalar(select(func.count()).select_from(Meme)) == 2
    assert not archive.exists()


def test_batch_commit_failure_rolls_back_records_and_cleans_files(tmp_path: Path) -> None:
    _, session, storage, service = make_context(tmp_path)
    archive = service.archives_dir / "commit-failure.zip"
    write_zip(archive, [("one.png", image_bytes((9, 8, 7)))])
    job = create_job(service, archive)
    real_commit = session.commit
    commits = 0

    def fail_batch_commit() -> None:
        nonlocal commits
        commits += 1
        if commits == 3:  # running state, archive scan, then first data batch
            raise RuntimeError("simulated database failure")
        real_commit()

    session.commit = fail_batch_commit  # type: ignore[method-assign]
    service.run(job.id)

    session.expire_all()
    result = session.get(ImportJob, job.id)
    assert result is not None
    assert (result.success_count, result.failed_count) == (0, 1)
    assert session.scalar(select(func.count()).select_from(Meme)) == 0
    assert list(storage.images_dir.iterdir()) == []
    assert list(storage.thumbnails_dir.iterdir()) == []
    item = session.scalar(select(ImportJobItem).where(ImportJobItem.job_id == job.id))
    assert item is not None and "batch commit failed" in (item.error_message or "").lower()


def test_cancel_finishes_current_member_then_stops_before_next(tmp_path: Path, monkeypatch) -> None:
    _, session, storage, service = make_context(tmp_path)
    archive = service.archives_dir / "cancel-midway.zip"
    write_zip(
        archive,
        [("one.png", image_bytes((1, 1, 1))), ("two.png", image_bytes((2, 2, 2)))],
    )
    job = create_job(service, archive)
    event = Event()
    original_validate = storage.validate

    def request_cancel(content: bytes):
        result = original_validate(content)
        event.set()
        return result

    monkeypatch.setattr(storage, "validate", request_cancel)
    service.run(job.id, event)

    session.expire_all()
    result = session.get(ImportJob, job.id)
    assert result is not None and result.status == "cancelled"
    assert (result.processed_count, result.success_count) == (1, 1)
    assert session.scalar(select(func.count()).select_from(Meme)) == 1
    assert not archive.exists()
