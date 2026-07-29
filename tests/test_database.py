from importlib import import_module, util
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base, run_startup_migrations
from app.models.meme import Meme
from app.models.meme_image import MemeImage
from app.models.meme_relation import MemeRelation
from app.models.tag import MemeTag, Tag  # noqa: F401


def load_database_module():
    assert util.find_spec("app.database") is not None, "Database module is missing"
    return import_module("app.database")


def test_sqlite_database_file_can_be_created() -> None:
    database = load_database_module()

    with database.engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar_one() == 1

    assert Path(database.engine.url.database).is_file()


def test_session_can_be_created_and_closed() -> None:
    database = load_database_module()

    session = database.SessionLocal()
    assert session.execute(text("SELECT 1")).scalar_one() == 1
    session.close()


def test_database_dependency_closes_its_session() -> None:
    database = load_database_module()
    dependency = database.get_db()

    session = next(dependency)
    session.execute(text("SELECT 1"))
    assert database.engine.pool.checkedout() == 1

    dependency.close()

    assert database.engine.pool.checkedout() == 0


def test_legacy_meme_image_backfill_is_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO memes (
                    title, description, original_filename, stored_filename,
                    file_path, thumbnail_path, mime_type, file_size, width,
                    height, file_hash, source, template_id, created_at, updated_at
                ) VALUES (
                    '旧 Meme', NULL, 'legacy.png', 'legacy.png',
                    'legacy.png', 'legacy-thumb.png', 'image/png', 123, 10,
                    20, 'legacy-hash', NULL, NULL,
                    '2026-07-29 00:00:00', '2026-07-29 00:00:00'
                )
                """
            )
        )

    run_startup_migrations(engine)
    run_startup_migrations(engine)

    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT meme_id, file_hash, position FROM meme_images ORDER BY id"
            )
        ).all()
    assert rows == [(1, "legacy-hash", 0)]


def test_sqlite_foreign_keys_are_enabled_and_raw_delete_cascades() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        memes = []
        for index in (1, 2):
            meme = Meme(
                title=f"Meme {index}",
                description=None,
                original_filename=f"{index}.png",
                stored_filename=f"{index}.png",
                file_path=f"{index}.png",
                thumbnail_path=f"{index}-thumb.png",
                mime_type="image/png",
                file_size=index,
                width=1,
                height=1,
                file_hash=f"meme-hash-{index}",
                source=None,
            )
            meme.images.append(
                MemeImage(
                    original_filename=f"{index}.png",
                    stored_filename=f"image-{index}.png",
                    file_path=f"{index}.png",
                    thumbnail_path=f"{index}-thumb.png",
                    mime_type="image/png",
                    file_size=index,
                    width=1,
                    height=1,
                    file_hash=f"image-hash-{index}",
                    position=0,
                )
            )
            memes.append(meme)
        session.add_all(memes)
        session.flush()
        first_id, second_id = memes[0].id, memes[1].id
        session.add(
            MemeRelation(
                meme_a_id=min(first_id, second_id),
                meme_b_id=max(first_id, second_id),
            )
        )
        session.commit()

    with engine.begin() as connection:
        assert connection.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
        connection.execute(
            text("DELETE FROM memes WHERE id = :meme_id"),
            {"meme_id": first_id},
        )
        assert connection.execute(
            text("SELECT COUNT(*) FROM meme_images WHERE meme_id = :meme_id"),
            {"meme_id": first_id},
        ).scalar_one() == 0
        assert connection.execute(
            text(
                """
                SELECT COUNT(*) FROM meme_relations
                WHERE meme_a_id = :meme_id OR meme_b_id = :meme_id
                """
            ),
            {"meme_id": first_id},
        ).scalar_one() == 0
