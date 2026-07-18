import asyncio
from datetime import UTC, datetime
from importlib import import_module, util

from sqlalchemy import inspect


def load_meme_components():
    assert util.find_spec("app.models") is not None, "Models package is missing"
    assert util.find_spec("app.models.meme") is not None, "Meme model is missing"
    assert util.find_spec("app.schemas") is not None, "Schemas package is missing"
    assert util.find_spec("app.schemas.meme") is not None, "Meme schemas are missing"

    return (
        import_module("app.models.meme"),
        import_module("app.schemas.meme"),
        import_module("app.database"),
    )


def test_meme_table_is_created_on_app_startup() -> None:
    _, _, database = load_meme_components()
    main = import_module("app.main")

    async def run_lifespan() -> None:
        async with main.app.router.lifespan_context(main.app):
            pass

    asyncio.run(run_lifespan())

    assert inspect(database.engine).has_table("memes")


def test_meme_record_can_be_written_and_read() -> None:
    model_module, _, database = load_meme_components()
    database.create_tables()
    session = database.SessionLocal()

    meme = model_module.Meme(
        title="测试 Meme",
        description="用于验证模型读写",
        original_filename="original.png",
        stored_filename="stored.png",
        file_path="data/images/stored.png",
        thumbnail_path="data/thumbnails/stored.png",
        mime_type="image/png",
        file_size=1024,
        width=640,
        height=480,
        file_hash="model-test-sha256",
        source="test",
    )

    try:
        session.add(meme)
        session.flush()
        meme_id = meme.id

        session.expunge_all()
        saved_meme = session.get(model_module.Meme, meme_id)

        assert saved_meme is not None
        assert saved_meme.title == "测试 Meme"
        assert saved_meme.file_hash == "model-test-sha256"
        assert saved_meme.created_at is not None
        assert saved_meme.updated_at is not None
    finally:
        session.rollback()
        session.close()


def test_meme_schemas_validate_input_and_orm_output() -> None:
    model_module, schema_module, _ = load_meme_components()
    now = datetime.now(UTC)
    create_data = schema_module.MemeCreate(
        title="Schema 测试",
        description="请求数据",
        source="test",
    )
    meme = model_module.Meme(
        id=1,
        **create_data.model_dump(),
        original_filename="original.webp",
        stored_filename="stored.webp",
        file_path="data/images/stored.webp",
        thumbnail_path=None,
        mime_type="image/webp",
        file_size=2048,
        width=800,
        height=600,
        file_hash="schema-test-sha256",
        created_at=now,
        updated_at=now,
    )

    response = schema_module.MemeResponse.model_validate(meme)

    assert response.id == 1
    assert response.title == "Schema 测试"
    assert response.thumbnail_path is None
    assert response.created_at is not None
