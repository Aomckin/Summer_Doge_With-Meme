"""v2.0.3 仓库内独立资产序号测试：跨仓独立、删除不复用、ZIP 连续分配。"""
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from PIL import Image
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.meme import Meme
from app.models.vault import Vault
from app.services.import_job_service import ImportJobService
from app.services.meme_service import MemeService
from app.storage.image_storage import ImageStorage
from tests.vault_helpers import ensure_default_vault


def png_bytes(size: int = 4, seed: int = 0) -> bytes:
    # seed 让每张图内容不同，绕开同仓 hash 去重（序号测试关注的是编号分配）。
    output = BytesIO()
    Image.new("RGB", (size, size), (seed % 256, 20, 30)).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def vault_context(tmp_path: Path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    meme_vault = ensure_default_vault(session)
    anime = Vault(name="Anime", slug="anime", type="generic", profile="anime")
    session.add(anime)
    session.commit()
    session.refresh(anime)
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    yield session, meme_vault, anime, storage, tmp_path
    session.close()
    engine.dispose()


def test_per_vault_numbering_starts_at_one_and_is_independent(vault_context):
    session, meme_vault, anime_vault, storage, _tmp = vault_context
    meme_service = MemeService(session, storage)
    anime_service = MemeService(session, storage)

    meme_a = meme_service.create_meme("a.png", png_bytes(seed=1), vault_id=meme_vault.id, title="A")
    anime_b = anime_service.create_meme("b.png", png_bytes(seed=2), vault_id=anime_vault.id, title="B")
    meme_c = meme_service.create_meme("c.png", png_bytes(seed=3), vault_id=meme_vault.id, title="C")
    anime_d = anime_service.create_meme("d.png", png_bytes(seed=4), vault_id=anime_vault.id, title="D")

    # Meme 第一张 #1，Anime 第一张也是 #1
    assert (meme_a.vault_asset_no, meme_c.vault_asset_no) == (1, 2)
    assert (anime_b.vault_asset_no, anime_d.vault_asset_no) == (1, 2)
    # 两仓的 #1 可以同时存在
    assert meme_a.vault_asset_no == anime_b.vault_asset_no == 1


def test_duplicate_vault_asset_no_rejected_within_vault(vault_context):
    session, meme_vault, anime_vault, storage, _tmp = vault_context
    meme_service = MemeService(session, storage)
    meme_service.create_meme("a.png", png_bytes(seed=1), vault_id=meme_vault.id, title="A")

    # 同 Vault 直接构造重复序号 → 数据库唯一约束拒绝
    session.add(Meme(
        vault_id=meme_vault.id,
        vault_asset_no=1,
        title="dup", original_filename="x.png", stored_filename="dup-x.png",
        file_path="x.png", thumbnail_path=None, mime_type="image/png",
        file_size=1, width=1, height=1, file_hash="dup-hash-1",
    ))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()

    # 不同 Vault 可以有相同序号
    session.add(Meme(
        vault_id=anime_vault.id,
        vault_asset_no=1,
        title="cross", original_filename="y.png", stored_filename="cross-y.png",
        file_path="y.png", thumbnail_path=None, mime_type="image/png",
        file_size=1, width=1, height=1, file_hash="cross-hash-1",
    ))
    session.commit()


def test_deleted_number_is_not_reused(vault_context):
    session, meme_vault, anime_vault, storage, _tmp = vault_context
    anime_service = MemeService(session, storage)
    first = anime_service.create_meme("1.png", png_bytes(seed=11), vault_id=anime_vault.id, title="1")
    second = anime_service.create_meme("2.png", png_bytes(seed=12), vault_id=anime_vault.id, title="2")
    assert (first.vault_asset_no, second.vault_asset_no) == (1, 2)

    # 删除 Anime #2
    anime_service.delete_meme(second.id, vault_id=anime_vault.id)

    # 下一张是 #3，而不是复用 #2
    third = anime_service.create_meme("3.png", png_bytes(seed=13), vault_id=anime_vault.id, title="3")
    assert third.vault_asset_no == 3


def test_zip_import_assigns_continuous_numbers(vault_context):
    session, meme_vault, anime_vault, storage, tmp_path = vault_context
    total = 100

    # ImportJob 以 archives_dir 内的文件名定位归档：直接把 ZIP 写进 archives 目录。
    archives_dir = tmp_path / "archives"
    archives_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archives_dir / "batch.zip"
    with ZipFile(archive_path, "w") as archive:
        for index in range(total):
            archive.writestr(f"img-{index:03d}.png", png_bytes(seed=index + 1))

    service = ImportJobService(session, storage, tmp_path / "archives")
    job = service.create_job(
        vault_id=anime_vault.id,
        original_filename="batch.zip",
        archive_path=archive_path,
        tags=[],
        template_id=None,
        source=None,
        chunk_size=100,
    )
    service.run(job.id)

    numbers = [
        row[0]
        for row in session.execute(
            text(
                "SELECT m.vault_asset_no FROM import_job_items i "
                "JOIN memes m ON m.id = i.meme_id "
                "WHERE i.job_id = :job_id AND i.status = 'success' "
                "ORDER BY m.vault_asset_no"
            ),
            {"job_id": job.id},
        )
    ]
    # 连续且无重复：#1..#100
    assert numbers == list(range(1, total + 1))
    # 计数器推进到 101
    assert session.get(Vault, anime_vault.id).next_asset_no == total + 1


def test_migration_backfills_numbers_by_id_order(tmp_path: Path):
    """旧数据迁移：每个 Vault 按现有 id 顺序回填 1..N，next_asset_no = max + 1。"""
    engine = create_engine(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE vaults (id INTEGER PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100) UNIQUE, "
            "type VARCHAR(50), description TEXT, icon VARCHAR(50), storage_path VARCHAR(255), "
            "config TEXT, created_at DATETIME, updated_at DATETIME)"
        ))
        connection.execute(text(
            "CREATE TABLE memes (id INTEGER PRIMARY KEY, title VARCHAR(255), description TEXT, "
            "original_filename VARCHAR(255), stored_filename VARCHAR(255) UNIQUE, file_path VARCHAR(500), "
            "thumbnail_path VARCHAR(500), mime_type VARCHAR(100), file_size INTEGER, width INTEGER, "
            "height INTEGER, file_hash VARCHAR(64) UNIQUE, source VARCHAR(500), template_id INTEGER, "
            "created_at DATETIME, updated_at DATETIME)"
        ))
        connection.execute(text(
            "INSERT INTO vaults (name, slug, type, created_at, updated_at) "
            "VALUES ('Meme', 'meme', 'meme', '2026-01-01', '2026-01-01')"
        ))
        connection.execute(text(
            "INSERT INTO vaults (name, slug, type, created_at, updated_at) "
            "VALUES ('Anime', 'anime', 'image', '2026-01-01', '2026-01-01')"
        ))
        for index in range(3):
            connection.execute(text(
                "INSERT INTO memes (title, original_filename, stored_filename, file_path, mime_type, "
                f"file_size, width, height, file_hash, created_at, updated_at) VALUES ("
                f"'m{index}', 'o', 's{index}', 'p', 'image/png', 1, 1, 1, 'h{index}', '2026-01-01', '2026-01-01')"
            ))
        # 旧数据没有 vault_id —— 由 v2.0.0 迁移先回填

    import app.models  # noqa: F401
    from app.database import run_startup_migrations, upgrade_vault_isolation

    run_startup_migrations(engine)
    upgrade_vault_isolation(engine)

    with engine.connect() as connection:
        numbers = dict(connection.execute(
            text("SELECT id, vault_asset_no FROM memes ORDER BY id")
        ).fetchall())
        next_numbers = dict(connection.execute(
            text("SELECT slug, next_asset_no FROM vaults")
        ).fetchall())
    engine.dispose()
    # 全部旧数据在 meme Vault：按 id 顺序 1、2、3
    assert list(numbers.values()) == [1, 2, 3]
    assert next_numbers["meme"] == 4
    assert next_numbers["anime"] == 1
