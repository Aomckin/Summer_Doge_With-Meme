from pathlib import Path
import sqlite3

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


def make_session(database_path: Path) -> Session:
    resolved = database_path.resolve()
    engine = create_engine(
        f"sqlite:///{resolved.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: object, _record: object) -> None:
        if isinstance(dbapi_connection, sqlite3.Connection):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

    return sessionmaker(bind=engine, expire_on_commit=False)()


def close_session(session: Session) -> None:
    bind = session.get_bind()
    session.close()
    if isinstance(bind, Engine):
        bind.dispose()
