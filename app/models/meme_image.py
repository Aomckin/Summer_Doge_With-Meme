from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class MemeImage(Base):
    __tablename__ = "meme_images"
    __table_args__ = (
        UniqueConstraint("meme_id", "position"),
        # 同一图片允许跨 Vault 存在，去重只在 Vault 内生效；命名唯一索引与迁移 SQL 同名。
        Index("uq_meme_images_vault_file_hash", "vault_id", "file_hash", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # vault_id 与 meme.vault_id 冗余存储，用于 Vault 内 hash 复合唯一约束与隔离查询。
    vault_id: Mapped[int] = mapped_column(ForeignKey("vaults.id"), index=True)
    meme_id: Mapped[int] = mapped_column(ForeignKey("memes.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_filename: Mapped[str] = mapped_column(String(255), unique=True)
    file_path: Mapped[str] = mapped_column(String(500))
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(100))
    file_size: Mapped[int]
    width: Mapped[int]
    height: Mapped[int]
    # SHA-256 哈希在 Vault 内唯一，唯一性由 (vault_id, file_hash) 复合索引保证。
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    meme: Mapped["Meme"] = relationship(back_populates="images")
