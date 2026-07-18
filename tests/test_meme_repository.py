from importlib import import_module

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.meme import Meme


def load_repository_class():
    module = import_module("app.repositories.meme_repository")
    assert hasattr(module, "MemeRepository"), "MemeRepository is missing"
    return module.MemeRepository


def create_session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def build_meme(number: int) -> Meme:
    return Meme(
        title=f"Meme {number}",
        description=None,
        original_filename=f"original-{number}.png",
        stored_filename=f"stored-{number}.png",
        file_path=f"data/images/stored-{number}.png",
        thumbnail_path=None,
        mime_type="image/png",
        file_size=number * 100,
        width=640,
        height=480,
        file_hash=f"repository-test-hash-{number}",
        source="test",
    )


def test_create_and_get_meme_by_id() -> None:
    repository_class = load_repository_class()
    session = create_session()
    repository = repository_class(session)

    try:
        created = repository.create(build_meme(1))
        found = repository.get_by_id(created.id)

        assert created.id is not None
        assert found is created
        assert found.title == "Meme 1"
    finally:
        session.close()


def test_list_memes_supports_offset_and_limit() -> None:
    repository_class = load_repository_class()
    session = create_session()
    repository = repository_class(session)

    try:
        for number in range(1, 4):
            repository.create(build_meme(number))

        memes = repository.list(offset=1, limit=1)

        assert [meme.title for meme in memes] == ["Meme 2"]
    finally:
        session.close()


def test_update_meme_fields() -> None:
    repository_class = load_repository_class()
    session = create_session()
    repository = repository_class(session)

    try:
        meme = repository.create(build_meme(1))

        updated = repository.update(
            meme,
            {"title": "更新后的标题", "description": "更新后的描述"},
        )

        assert updated.title == "更新后的标题"
        assert updated.description == "更新后的描述"
        assert repository.get_by_id(meme.id) is updated
    finally:
        session.close()


def test_delete_meme() -> None:
    repository_class = load_repository_class()
    session = create_session()
    repository = repository_class(session)

    try:
        meme = repository.create(build_meme(1))
        meme_id = meme.id

        repository.delete(meme)

        assert repository.get_by_id(meme_id) is None
    finally:
        session.close()
