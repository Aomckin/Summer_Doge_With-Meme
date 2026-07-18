from importlib import import_module, util
from pathlib import Path

from sqlalchemy import text


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
