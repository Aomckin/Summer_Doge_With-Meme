from sqlalchemy import create_engine, inspect, text

from app.database import run_startup_migrations


def test_old_sqlite_database_is_upgraded_idempotently(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE memes ("
                "id INTEGER PRIMARY KEY, title VARCHAR(255) NOT NULL)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE meme_ai_analyses ("
                "id INTEGER PRIMARY KEY, meme_id INTEGER NOT NULL)"
            )
        )
        connection.execute(
            text("INSERT INTO memes (id, title) VALUES (1, 'legacy')")
        )

    run_startup_migrations(engine)
    run_startup_migrations(engine)

    inspector = inspect(engine)
    assert "template_id" in {
        column["name"] for column in inspector.get_columns("memes")
    }
    assert "suggested_template_id" in {
        column["name"]
        for column in inspector.get_columns("meme_ai_analyses")
    }
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT title FROM memes WHERE id = 1")
        ).scalar_one() == "legacy"


def test_old_sqlite_database_adds_reference_image_and_embedding_columns(
    tmp_path,
) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'old-reference.db'}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE templates ("
                "id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE ai_models ("
                "id INTEGER PRIMARY KEY, model_id VARCHAR(200) NOT NULL)"
            )
        )
        connection.execute(text("INSERT INTO templates (id, name) VALUES (1, 'Doge')"))

    run_startup_migrations(engine)
    run_startup_migrations(engine)

    inspector = inspect(engine)
    template_columns = {
        column["name"] for column in inspector.get_columns("templates")
    }
    assert {
        "reference_stored_filename",
        "reference_thumbnail_filename",
        "reference_mime_type",
        "reference_file_size",
        "reference_width",
        "reference_height",
        "reference_file_hash",
        "reference_embedding_json",
        "reference_embedding_model_id",
    } <= template_columns
    model_columns = {
        column["name"] for column in inspector.get_columns("ai_models")
    }
    assert {"supports_image_embedding", "is_embedding_active"} <= model_columns
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT name FROM templates WHERE id = 1")
        ).scalar_one() == "Doge"


def test_non_sqlite_database_skips_sqlite_migrations() -> None:
    class Dialect:
        name = "postgresql"

    class FakeEngine:
        dialect = Dialect()

    run_startup_migrations(FakeEngine())  # type: ignore[arg-type]
