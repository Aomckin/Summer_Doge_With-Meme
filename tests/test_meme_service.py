from hashlib import sha256
from importlib import import_module
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.meme import Meme
from app.storage.image_storage import ImageStorage


def load_service_module():
    module = import_module("app.services.meme_service")
    assert hasattr(module, "MemeService"), "MemeService is missing"
    assert hasattr(module, "MemeNotFoundError"), "MemeNotFoundError is missing"
    assert hasattr(module, "MemeFileMissingError"), "MemeFileMissingError is missing"
    return module


def make_image_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (640, 480), color="orange").save(buffer, format="PNG")
    return buffer.getvalue()


def create_session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def create_service(tmp_path: Path):
    module = load_service_module()
    session = create_session()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    service = module.MemeService(session, storage)
    return module, service, session, storage


def test_create_meme_saves_files_and_database_record(tmp_path: Path) -> None:
    _, service, session, _ = create_service(tmp_path)

    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="创建测试",
            description="Service 创建流程",
            source="test",
        )

        assert meme.id is not None
        assert Path(meme.file_path).is_file()
        assert Path(meme.thumbnail_path).is_file()
        assert session.get(Meme, meme.id) is meme
    finally:
        session.close()


def test_query_list_and_update_meme(tmp_path: Path) -> None:
    _, service, session, _ = create_service(tmp_path)

    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="原始标题",
        )

        assert service.get_meme(meme.id) is meme
        assert service.list_memes() == [meme]

        updated = service.update_meme(
            meme.id,
            {"title": "更新标题", "description": "更新描述"},
        )

        assert updated.title == "更新标题"
        assert updated.description == "更新描述"
    finally:
        session.close()


def test_delete_meme_removes_record_and_files(tmp_path: Path) -> None:
    _, service, session, _ = create_service(tmp_path)

    try:
        meme = service.create_meme("delete.png", make_image_bytes(), title="删除测试")
        meme_id = meme.id
        file_path = Path(meme.file_path)
        thumbnail_path = Path(meme.thumbnail_path)

        service.delete_meme(meme_id)

        assert session.get(Meme, meme_id) is None
        assert not file_path.exists()
        assert not thumbnail_path.exists()
    finally:
        session.close()


def test_create_meme_removes_saved_files_when_database_write_fails(
    tmp_path: Path,
) -> None:
    _, service, session, storage = create_service(tmp_path)
    content = make_image_bytes()
    existing = Meme(
        title="已有记录",
        description=None,
        original_filename="existing.png",
        stored_filename="existing.png",
        file_path="missing/existing.png",
        thumbnail_path=None,
        mime_type="image/png",
        file_size=len(content),
        width=640,
        height=480,
        file_hash=sha256(content).hexdigest(),
        source=None,
    )
    session.add(existing)
    session.commit()

    try:
        with pytest.raises(IntegrityError):
            service.create_meme("duplicate.png", content, title="重复图片")

        assert list(storage.images_dir.iterdir()) == []
        assert list(storage.thumbnails_dir.iterdir()) == []
        assert session.scalar(select(func.count()).select_from(Meme)) == 1
    finally:
        session.close()


def test_get_meme_reports_missing_image_file(tmp_path: Path) -> None:
    module, service, session, storage = create_service(tmp_path)
    missing = Meme(
        title="文件缺失",
        description=None,
        original_filename="missing.png",
        stored_filename="missing.png",
        file_path=str(storage.images_dir / "missing.png"),
        thumbnail_path=str(storage.thumbnails_dir / "missing.png"),
        mime_type="image/png",
        file_size=1,
        width=1,
        height=1,
        file_hash="missing-file-test-hash",
        source=None,
    )
    session.add(missing)
    session.commit()

    try:
        with pytest.raises(module.MemeFileMissingError, match="missing"):
            service.get_meme(missing.id)
    finally:
        session.close()


def test_get_meme_reports_unknown_id(tmp_path: Path) -> None:
    module, service, session, _ = create_service(tmp_path)

    try:
        with pytest.raises(module.MemeNotFoundError, match="999"):
            service.get_meme(999)
    finally:
        session.close()
