# 数据库基础设施层：创建 Engine、Session，并管理每次请求的数据库会话。
from collections.abc import Generator

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATABASE_URL, DATA_DIR


# SQLite 第一次连接前，父目录必须已经存在。
DATA_DIR.mkdir(parents=True, exist_ok=True)

# SQLite 默认限制连接只能在创建它的线程使用；FastAPI 会跨线程处理同步路由，
# 所以本地 SQLite 需要关闭该检查。换成其他数据库时不传这个专用参数。
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

# Engine 管理底层数据库连接；SessionLocal 是“创建一次工作会话”的工厂。
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# 所有 ORM 模型都继承同一个 Base，它保存“有哪些表、有哪些字段”的元数据。
class Base(DeclarativeBase):
    pass


def create_tables() -> None:
    # 必须先导入模型，SQLAlchemy 才会把这些类登记到 Base.metadata。
    # noqa 告诉代码检查器：这些导入虽然没有直接调用，但绝不是多余的。
    from app.models import ai_analysis  # noqa: F401
    from app.models import ai_settings  # noqa: F401
    from app.models import meme  # noqa: F401
    from app.models import tag  # noqa: F401
    from app.models import template  # noqa: F401

    # create_all 只创建不存在的表，不会删除现有表或数据。
    Base.metadata.create_all(bind=engine)
    run_startup_migrations(engine)


def run_startup_migrations(bind: Engine = engine) -> None:
    """Add v0.3.3 columns to existing SQLite databases without rebuilding tables."""
    if bind.dialect.name != "sqlite":
        return

    inspector = inspect(bind)
    upgrades = (
        ("memes", "template_id", "ALTER TABLE memes ADD COLUMN template_id INTEGER"),
        (
            "meme_ai_analyses",
            "suggested_template_id",
            "ALTER TABLE meme_ai_analyses ADD COLUMN suggested_template_id INTEGER",
        ),
        ("templates", "reference_stored_filename", "ALTER TABLE templates ADD COLUMN reference_stored_filename VARCHAR(255)"),
        ("templates", "reference_thumbnail_filename", "ALTER TABLE templates ADD COLUMN reference_thumbnail_filename VARCHAR(255)"),
        ("templates", "reference_mime_type", "ALTER TABLE templates ADD COLUMN reference_mime_type VARCHAR(100)"),
        ("templates", "reference_file_size", "ALTER TABLE templates ADD COLUMN reference_file_size INTEGER"),
        ("templates", "reference_width", "ALTER TABLE templates ADD COLUMN reference_width INTEGER"),
        ("templates", "reference_height", "ALTER TABLE templates ADD COLUMN reference_height INTEGER"),
        ("templates", "reference_file_hash", "ALTER TABLE templates ADD COLUMN reference_file_hash VARCHAR(64)"),
        ("templates", "reference_embedding_json", "ALTER TABLE templates ADD COLUMN reference_embedding_json TEXT"),
        ("templates", "reference_embedding_model_id", "ALTER TABLE templates ADD COLUMN reference_embedding_model_id VARCHAR(200)"),
        ("ai_models", "supports_image_embedding", "ALTER TABLE ai_models ADD COLUMN supports_image_embedding BOOLEAN NOT NULL DEFAULT 0"),
        ("ai_models", "is_embedding_active", "ALTER TABLE ai_models ADD COLUMN is_embedding_active BOOLEAN NOT NULL DEFAULT 0"),
    )
    with bind.begin() as connection:
        for table_name, column_name, statement in upgrades:
            if not inspector.has_table(table_name):
                continue
            columns = {
                column["name"] for column in inspector.get_columns(table_name)
            }
            if column_name not in columns:
                connection.execute(text(statement))


def get_db() -> Generator[Session, None, None]:
    # FastAPI 的 yield 依赖：yield 前准备资源，请求结束后执行 finally 清理。
    db = SessionLocal()
    try:
        yield db
    finally:
        # 即使路由抛出异常，也必须归还数据库连接。
        db.close()
