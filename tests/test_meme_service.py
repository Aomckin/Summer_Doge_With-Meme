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
from app.models.meme_image import MemeImage
from app.models.meme_relation import MemeRelation
from app.storage.image_storage import ImageStorage


def load_service_module():
    module = import_module("app.services.meme_service")
    assert hasattr(module, "MemeService"), "MemeService is missing"
    assert hasattr(module, "MemeNotFoundError"), "MemeNotFoundError is missing"
    assert hasattr(module, "MemeFileMissingError"), "MemeFileMissingError is missing"
    return module


def make_image_bytes(color: str = "orange") -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (640, 480), color=color).save(buffer, format="PNG")
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
    _, service, session, storage = create_service(tmp_path)

    try:
        meme = service.create_meme(
            "example.png",
            make_image_bytes(),
            title="创建测试",
            description="Service 创建流程",
            source="test",
        )

        assert meme.id is not None
        assert meme.file_path == meme.stored_filename
        assert "/" not in meme.file_path
        assert "\\" not in meme.file_path
        assert meme.thumbnail_path is not None
        assert "/" not in meme.thumbnail_path
        assert "\\" not in meme.thumbnail_path
        assert (storage.images_dir / meme.file_path).is_file()
        assert (storage.thumbnails_dir / meme.thumbnail_path).is_file()
        assert session.get(Meme, meme.id) is meme
        assert [(image.position, image.file_hash) for image in meme.images] == [
            (0, meme.file_hash)
        ]
    finally:
        session.close()


def test_append_and_reorder_images_changes_cover(tmp_path: Path) -> None:
    _, service, session, _ = create_service(tmp_path)
    try:
        meme = service.create_meme("first.png", make_image_bytes(), title="复合")
        second_bytes = BytesIO()
        Image.new("RGB", (320, 240), color="blue").save(second_bytes, format="PNG")
        updated = service.append_image(meme.id, "second.png", second_bytes.getvalue())
        reordered = service.reorder_images(
            meme.id, [updated.images[1].id, updated.images[0].id]
        )
        assert [image.position for image in reordered.images] == [0, 1]
        assert reordered.file_hash == reordered.images[0].file_hash
    finally:
        session.close()


def test_delete_image_removes_files_and_reindexes_remaining_images(
    tmp_path: Path,
) -> None:
    _, service, session, storage = create_service(tmp_path)
    try:
        meme = service.create_meme("first.png", make_image_bytes(), title="复合")
        service.append_image(meme.id, "second.png", make_image_bytes("blue"))
        updated = service.append_image(
            meme.id,
            "third.png",
            make_image_bytes("green"),
        )
        deleted = updated.images[1]
        expected_ids = [updated.images[0].id, updated.images[2].id]
        deleted_file = storage.images_dir / deleted.file_path
        deleted_thumbnail = storage.thumbnails_dir / deleted.thumbnail_path

        result = service.delete_image(meme.id, deleted.id)

        assert [image.id for image in result.images] == expected_ids
        assert [image.position for image in result.images] == [0, 1]
        assert session.get(MemeImage, deleted.id) is None
        assert not deleted_file.exists()
        assert not deleted_thumbnail.exists()
    finally:
        session.close()


def test_delete_cover_promotes_next_image_and_rejects_deleting_last(
    tmp_path: Path,
) -> None:
    _, service, session, _ = create_service(tmp_path)
    try:
        meme = service.create_meme("first.png", make_image_bytes(), title="复合")
        service.append_image(
            meme.id,
            "second.png",
            make_image_bytes("blue"),
        )
        updated = service.append_image(
            meme.id,
            "third.png",
            make_image_bytes("green"),
        )
        reordered = service.reorder_images(
            meme.id,
            [updated.images[0].id, updated.images[2].id, updated.images[1].id],
        )
        promoted_hash = reordered.images[1].file_hash

        result = service.delete_image(meme.id, reordered.images[0].id)

        assert len(result.images) == 2
        assert [image.position for image in result.images] == [0, 1]
        assert result.file_hash == promoted_hash
        result = service.delete_image(meme.id, result.images[1].id)
        with pytest.raises(ValueError, match="last image"):
            service.delete_image(meme.id, result.images[0].id)
    finally:
        session.close()


def test_invalid_reorder_is_atomic(tmp_path: Path) -> None:
    _, service, session, _ = create_service(tmp_path)
    try:
        meme = service.create_meme("first.png", make_image_bytes(), title="复合")
        updated = service.append_image(
            meme.id,
            "second.png",
            make_image_bytes("blue"),
        )
        original_ids = [image.id for image in updated.images]
        original_cover_hash = updated.file_hash

        with pytest.raises(ValueError, match="every meme image"):
            service.reorder_images(meme.id, [original_ids[0], original_ids[0]])

        session.expire_all()
        unchanged = service.get_meme(meme.id)
        assert [image.id for image in unchanged.images] == original_ids
        assert unchanged.file_hash == original_cover_hash
    finally:
        session.close()


def test_relations_are_bidirectional_direct_only_and_batch_validation_is_atomic(
    tmp_path: Path,
) -> None:
    module, service, session, _ = create_service(tmp_path)
    try:
        first = service.create_meme("first.png", make_image_bytes(), title="一")
        second = service.create_meme(
            "second.png",
            make_image_bytes("blue"),
            title="二",
        )
        third = service.create_meme(
            "third.png",
            make_image_bytes("green"),
            title="三",
        )

        service.add_relations(first.id, [second.id, second.id])
        service.add_relations(second.id, [third.id])

        assert [item.id for item in service.list_relations(first.id)] == [second.id]
        assert {item.id for item in service.list_relations(second.id)} == {
            first.id,
            third.id,
        }
        assert [item.id for item in service.list_relations(third.id)] == [second.id]
        assert session.scalar(select(func.count()).select_from(MemeRelation)) == 2

        with pytest.raises(ValueError, match="must exist"):
            service.add_relations(first.id, [third.id, 999])
        assert [item.id for item in service.list_relations(first.id)] == [second.id]

        with pytest.raises(ValueError, match="itself"):
            service.add_relations(first.id, [first.id])

        service.remove_relation(second.id, first.id)
        assert service.list_relations(first.id) == []
        with pytest.raises(module.MemeNotFoundError, match="does not exist"):
            service.remove_relation(first.id, second.id)
    finally:
        session.close()


def test_delete_composite_meme_removes_every_file_and_incident_relation(
    tmp_path: Path,
) -> None:
    _, service, session, storage = create_service(tmp_path)
    try:
        meme = service.create_meme("first.png", make_image_bytes(), title="复合")
        service.append_image(meme.id, "second.png", make_image_bytes("blue"))
        updated = service.append_image(
            meme.id,
            "third.png",
            make_image_bytes("green"),
        )
        peer = service.create_meme(
            "peer.png",
            make_image_bytes("purple"),
            title="关联项",
        )
        service.add_relations(updated.id, [peer.id])
        stored_paths = [
            (
                storage.images_dir / image.file_path,
                storage.thumbnails_dir / image.thumbnail_path,
            )
            for image in updated.images
        ]

        service.delete_meme(updated.id)

        assert session.get(Meme, updated.id) is None
        assert session.get(Meme, peer.id) is peer
        assert session.scalar(select(func.count()).select_from(MemeRelation)) == 0
        assert all(
            not original.exists() and not thumbnail.exists()
            for original, thumbnail in stored_paths
        )
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
    _, service, session, storage = create_service(tmp_path)

    try:
        meme = service.create_meme("delete.png", make_image_bytes(), title="删除测试")
        meme_id = meme.id
        file_path = storage.images_dir / meme.file_path
        thumbnail_path = storage.thumbnails_dir / meme.thumbnail_path

        service.delete_meme(meme_id)

        assert session.get(Meme, meme_id) is None
        assert not file_path.exists()
        assert not thumbnail_path.exists()
    finally:
        session.close()


def test_delete_meme_removes_record_when_files_are_missing(tmp_path: Path) -> None:
    _, service, session, _ = create_service(tmp_path)

    try:
        meme = service.create_meme(
            "missing.png",
            make_image_bytes(),
            title="缺图删除",
        )
        meme_id = meme.id
        service.storage.delete(meme.file_path, meme.thumbnail_path)

        service.delete_meme(meme_id)

        assert session.get(Meme, meme_id) is None
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


def test_get_meme_reports_missing_secondary_image_file(tmp_path: Path) -> None:
    module, service, session, storage = create_service(tmp_path)
    try:
        meme = service.create_meme("first.png", make_image_bytes(), title="缺图")
        updated = service.append_image(
            meme.id,
            "second.png",
            make_image_bytes("blue"),
        )
        secondary = updated.images[1]
        storage.delete(secondary.file_path, secondary.thumbnail_path)

        with pytest.raises(module.MemeFileMissingError, match="missing"):
            service.get_meme(meme.id)
    finally:
        session.close()


def test_get_meme_reports_unknown_id(tmp_path: Path) -> None:
    module, service, session, _ = create_service(tmp_path)

    try:
        with pytest.raises(module.MemeNotFoundError, match="999"):
            service.get_meme(999)
    finally:
        session.close()
