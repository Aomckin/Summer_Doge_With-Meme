# 数据库基础设施层：创建 Engine、Session，并管理每次请求的数据库会话。
from collections.abc import Generator
from datetime import datetime, timezone
from pathlib import Path
from sqlite3 import Connection as SQLiteConnection
import sqlite3

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATA_DIR, DATABASE_URL, DEFAULT_VAULT_NAME, DEFAULT_VAULT_SLUG


# SQLite 第一次连接前，父目录必须已经存在。
DATA_DIR.mkdir(parents=True, exist_ok=True)

# SQLite 默认限制连接只能在创建它的线程使用；FastAPI 会跨线程处理同步路由，
# 所以本地 SQLite 需要关闭该检查。换成其他数据库时不传这个专用参数。
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

# Engine 管理底层数据库连接；SessionLocal 是“创建一次工作会话”的工厂。
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(Engine, "connect")
def enable_sqlite_foreign_keys(
    dbapi_connection: object,
    _connection_record: object,
) -> None:
    """Make SQLite enforce the foreign keys declared by the ORM models."""
    if not isinstance(dbapi_connection, SQLiteConnection):
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


# 所有 ORM 模型都继承同一个 Base，它保存“有哪些表、有哪些字段”的元数据。
class Base(DeclarativeBase):
    pass


def create_tables() -> None:
    # 必须先导入模型，SQLAlchemy 才会把这些类登记到 Base.metadata。
    # noqa 告诉代码检查器：这些导入虽然没有直接调用，但绝不是多余的。
    import app.models  # noqa: F401

    # create_all 只创建不存在的表，不会删除现有表或数据。
    Base.metadata.create_all(bind=engine)
    run_startup_migrations(engine)
    upgrade_vault_isolation(engine)


def run_startup_migrations(bind: Engine = engine) -> None:
    """Apply additive SQLite upgrades without rebuilding tables."""
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
        (
            "meme_ai_analyses",
            "suggested_title",
            "ALTER TABLE meme_ai_analyses ADD COLUMN suggested_title VARCHAR(255)",
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
        (
            "export_jobs",
            "snapshot_json",
            "ALTER TABLE export_jobs ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '[]'",
        ),
        (
            "meme_enrichment_suggestions",
            "review_source_hash",
            "ALTER TABLE meme_enrichment_suggestions ADD COLUMN review_source_hash VARCHAR(64)",
        ),
        (
            "enrichment_jobs",
            "start_meme_id",
            "ALTER TABLE enrichment_jobs ADD COLUMN start_meme_id INTEGER",
        ),
        (
            "enrichment_jobs",
            "end_meme_id",
            "ALTER TABLE enrichment_jobs ADD COLUMN end_meme_id INTEGER",
        ),
        (
            "enrichment_job_items",
            "response_summary",
            "ALTER TABLE enrichment_job_items ADD COLUMN response_summary TEXT",
        ),
        ("tags", "normalized_name", "ALTER TABLE tags ADD COLUMN normalized_name VARCHAR(100)"),
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
        if inspector.has_table("tags"):
            connection.execute(text("UPDATE tags SET normalized_name = lower(trim(name)) WHERE normalized_name IS NULL OR normalized_name = ''"))
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_tags_normalized_name ON tags (normalized_name)"))
        if inspector.has_table("memes") and inspector.has_table("meme_images"):
            connection.execute(text("""
                INSERT INTO meme_images (
                    meme_id, original_filename, stored_filename, file_path, thumbnail_path,
                    mime_type, file_size, width, height, file_hash, position, created_at
                )
                SELECT m.id, m.original_filename, m.stored_filename, m.file_path, m.thumbnail_path,
                    m.mime_type, m.file_size, m.width, m.height, m.file_hash, 0, m.created_at
                FROM memes AS m
                WHERE NOT EXISTS (
                    SELECT 1 FROM meme_images AS i WHERE i.meme_id = m.id
                )
            """))


def _backup_sqlite_file(bind: Engine) -> None:
    """在写入型升级前对文件型 SQLite 做一次性备份，失败不阻断启动。"""
    database_file = bind.url.database
    if not database_file:
        return
    source = Path(database_file)
    if not source.is_file():
        return
    backup_dir = source.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    target = backup_dir / f"pre-vault-migration-{stamp}.db"
    try:
        source_conn = sqlite3.connect(str(source))
        try:
            target_conn = sqlite3.connect(str(target))
            try:
                source_conn.backup(target_conn)
            finally:
                target_conn.close()
        finally:
            source_conn.close()
        # 只保留最近 3 份升级前备份。
        backups = sorted(backup_dir.glob("pre-vault-migration-*.db"))
        for stale in backups[:-3]:
            stale.unlink(missing_ok=True)
    except OSError:
        target.unlink(missing_ok=True)


def upgrade_vault_isolation(bind: Engine) -> None:
    """v2.0.0 Multi-Vault 升级：默认 Vault、vault_id 回填与 Vault 内 hash 唯一索引。

    单事务执行、可重复运行；新库由 ORM 直接建出目标结构，本函数不做任何写入。
    """
    if bind.dialect.name != "sqlite":
        return

    # (表名, ALTER 语句)。vault_id 不声明外键约束，避免升级期间的外键校验顺序问题；
    # 有效性由 Service 层保证。
    vault_columns = (
        ("memes", "ALTER TABLE memes ADD COLUMN vault_id INTEGER"),
        ("meme_images", "ALTER TABLE meme_images ADD COLUMN vault_id INTEGER"),
        ("import_jobs", "ALTER TABLE import_jobs ADD COLUMN vault_id INTEGER"),
        ("export_jobs", "ALTER TABLE export_jobs ADD COLUMN vault_id INTEGER"),
        ("embedding_jobs", "ALTER TABLE embedding_jobs ADD COLUMN vault_id INTEGER"),
        ("enrichment_jobs", "ALTER TABLE enrichment_jobs ADD COLUMN vault_id INTEGER"),
        ("semantic_index_state", "ALTER TABLE semantic_index_state ADD COLUMN vault_id INTEGER"),
    )
    inspector = inspect(bind)
    existing_tables = {
        name for name, _ in vault_columns if inspector.has_table(name)
    }
    # vaults 表由 ORM create_all 创建；没有它时（旧库未建表前）跳过本次升级。
    if not inspector.has_table("vaults"):
        return

    # v2.0.1 Vault Profile：profile 列 + 按 legacy type 回填。
    with bind.begin() as connection:
        vault_table_columns = {
            column["name"] for column in inspector.get_columns("vaults")
        }
        if "profile" not in vault_table_columns:
            connection.execute(text("ALTER TABLE vaults ADD COLUMN profile VARCHAR(50)"))
            connection.execute(text(
                "UPDATE vaults SET profile = CASE type "
                "WHEN 'meme' THEN 'meme' WHEN 'photo' THEN 'photo' WHEN 'game' THEN 'game_score' "
                "ELSE 'generic' END WHERE profile IS NULL"
            ))
            connection.execute(text(
                "UPDATE vaults SET profile = 'meme' WHERE slug = 'meme' AND (profile IS NULL OR profile = '')"
            ))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_vaults_profile ON vaults (profile)"))
        if "appearance_json" not in vault_table_columns:
            connection.execute(text("ALTER TABLE vaults ADD COLUMN appearance_json TEXT"))

    with bind.begin() as connection:
        pending = []
        tables_with_vault_id: set[str] = set()
        for table_name, statement in vault_columns:
            if table_name not in existing_tables:
                continue
            if "vault_id" in {
                column["name"] for column in inspector.get_columns(table_name)
            }:
                tables_with_vault_id.add(table_name)
            else:
                pending.append((table_name, statement))

        needs_backfill = bool(pending)
        if not needs_backfill:
            for table_name in tables_with_vault_id:
                has_null = connection.execute(
                    text(f"SELECT 1 FROM {table_name} WHERE vault_id IS NULL LIMIT 1")  # noqa: S608
                ).first()
                if has_null is not None:
                    needs_backfill = True
                    break

        if pending or needs_backfill:
            _backup_sqlite_file(bind)

        # 默认 meme Vault 必须始终存在（新库同样需要）；slug 唯一保证幂等。
        connection.execute(text(
            "INSERT INTO vaults (name, slug, type, description, storage_path, created_at, updated_at) "
            "SELECT :name, :slug, 'meme', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP "
            "WHERE NOT EXISTS (SELECT 1 FROM vaults WHERE slug = :slug)"
        ), {"name": DEFAULT_VAULT_NAME, "slug": DEFAULT_VAULT_SLUG})

        for _table_name, statement in pending:
            connection.execute(text(statement))
        tables_with_vault_id.update(table for table, _statement in pending)

        if pending or needs_backfill:
            # 全部既有数据归属默认 Vault；通过子查询定位，避免假设具体 ID。
            for table_name in tables_with_vault_id:
                connection.execute(text(
                    f"UPDATE {table_name} SET vault_id = "  # noqa: S608
                    "(SELECT id FROM vaults WHERE slug = :slug) WHERE vault_id IS NULL"
                ), {"slug": DEFAULT_VAULT_SLUG})
            # 旧 semantic_index_state 单行成为默认 Vault 的代次记录，不重置计数。
            if "semantic_index_state" in tables_with_vault_id:
                connection.execute(text(
                    "DELETE FROM semantic_index_state WHERE vault_id IS NULL AND id NOT IN ("
                    "SELECT MIN(id) FROM semantic_index_state WHERE vault_id IS NULL)"
                ))

        # v2.0.3 仓库内资产序号：memes.vault_asset_no + vaults.next_asset_no。
        # 必须在 vault_id 回填之后执行（旧库此时才有 vault_id 列）。
        meme_has_vault_id = "memes" in tables_with_vault_id
        if meme_has_vault_id:
            meme_columns = {column["name"] for column in inspector.get_columns("memes")}
            if "vault_asset_no" not in meme_columns:
                connection.execute(text("ALTER TABLE memes ADD COLUMN vault_asset_no INTEGER"))
                # 按现有 id 顺序为每个 Vault 独立生成 1..N（窗口函数，O(n)）。
                connection.execute(text(
                    "CREATE TEMP TABLE _vault_asset_no_backfill AS "
                    "SELECT id, ROW_NUMBER() OVER (PARTITION BY vault_id ORDER BY id) AS asset_no "
                    "FROM memes WHERE vault_asset_no IS NULL"
                ))
                connection.execute(text(
                    "UPDATE memes SET vault_asset_no = "
                    "(SELECT asset_no FROM _vault_asset_no_backfill WHERE _vault_asset_no_backfill.id = memes.id) "
                    "WHERE vault_asset_no IS NULL"
                ))
                connection.execute(text("DROP TABLE _vault_asset_no_backfill"))
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_memes_vault_asset_no ON memes (vault_id, vault_asset_no)"
            ))
        if "next_asset_no" not in vault_table_columns:
            connection.execute(text("ALTER TABLE vaults ADD COLUMN next_asset_no INTEGER"))
            connection.execute(text(
                "UPDATE vaults SET next_asset_no = "
                "COALESCE((SELECT MAX(vault_asset_no) FROM memes WHERE memes.vault_id = vaults.id), 0) + 1 "
                "WHERE next_asset_no IS NULL"
            ))

        # Vault 内 hash 唯一：替换旧的全局唯一索引。全部 IF NOT EXISTS，
        # 新库由 ORM 建出同样结构后这里不做任何修改。
        if "memes" in tables_with_vault_id:
            connection.execute(text("DROP INDEX IF EXISTS ix_memes_file_hash"))
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_memes_vault_file_hash ON memes (vault_id, file_hash)"
            ))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_memes_vault_id ON memes (vault_id)"))
        if "meme_images" in tables_with_vault_id:
            connection.execute(text("DROP INDEX IF EXISTS ix_meme_images_file_hash"))
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_meme_images_vault_file_hash "
                "ON meme_images (vault_id, file_hash)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_meme_images_vault_id ON meme_images (vault_id)"
            ))


def get_db() -> Generator[Session, None, None]:
    # FastAPI 的 yield 依赖：yield 前准备资源，请求结束后执行 finally 清理。
    db = SessionLocal()
    try:
        yield db
    finally:
        # 即使路由抛出异常，也必须归还数据库连接。
        db.close()
