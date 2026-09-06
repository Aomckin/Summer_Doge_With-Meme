# ORM 模型描述 Python 对象如何映射到数据库表；它不是 API 请求/响应格式。
from datetime import UTC, datetime

from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.ext.associationproxy import AssociationProxy, association_proxy
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# 这些类型只帮助编辑器理解注解；运行时不导入，可避免 Meme 与 Tag 循环导入。
if TYPE_CHECKING:
    from app.models.collection import CollectionItem
    from app.models.ai_analysis import MemeAIAnalysis
    from app.models.asset_metadata import AssetMetadata
    from app.models.caption import Caption
    from app.models.tag import MemeTag, Tag
    from app.models.template import Template
    from app.models.meme_image import MemeImage
    from app.models.vault import Vault


def utc_now() -> datetime:
    # 数据统一保存为 UTC，避免服务器位于不同时区时产生歧义。
    return datetime.now(UTC)


class Meme(Base):
    # 一个 Meme 对象对应 memes 表中的一行。
    __tablename__ = "memes"
    # 去重范围是“同一个 Vault 内”；同一图片允许同时存在于不同 Vault。
    # file_hash 保留普通索引供查询，唯一性由 (vault_id, file_hash) 复合唯一索引保证；
    # 使用命名唯一索引与启动迁移中的 CREATE UNIQUE INDEX IF NOT EXISTS 保持同名。
    __table_args__ = (
        Index("uq_memes_vault_file_hash", "vault_id", "file_hash", unique=True),
        # 每仓独立资产序号：从 1 开始、删除不复用；分配由 Vault 计数器在事务内完成。
        Index("uq_memes_vault_asset_no", "vault_id", "vault_asset_no", unique=True),
    )

    # 基础信息。
    id: Mapped[int] = mapped_column(primary_key=True)
    vault_id: Mapped[int] = mapped_column(ForeignKey("vaults.id"), index=True)
    # 仓库内人类可读序号；id 仍是内部稳定资源标识，vault_asset_no 仅用于展示。
    vault_asset_no: Mapped[int | None] = mapped_column()
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 文件元数据。数据库只保存路径和属性，不保存图片二进制本体。
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_filename: Mapped[str] = mapped_column(String(255), unique=True)
    file_path: Mapped[str] = mapped_column(String(500))
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(100))
    file_size: Mapped[int]
    width: Mapped[int]
    height: Mapped[int]

    # SHA-256 哈希在 Vault 内唯一，用于阻止同一图片在当前仓库被重复收录。
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # default 在首次写入时生效；onupdate 在记录被修改时刷新时间。
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    # tag_links 是带 source/confidence 的关联记录；删除 Meme 时一并删除关联。
    tag_links: Mapped[list["MemeTag"]] = relationship(
        back_populates="meme",
        cascade="all, delete-orphan",
    )
    ai_analyses: Mapped[list["MemeAIAnalysis"]] = relationship(
        back_populates="meme",
        cascade="all, delete-orphan",
    )
    captions: Mapped[list["Caption"]] = relationship(
        back_populates="meme",
        cascade="all, delete-orphan",
    )
    images: Mapped[list["MemeImage"]] = relationship(
        back_populates="meme",
        cascade="all, delete-orphan",
        order_by="MemeImage.position",
    )
    collection_items: Mapped[list["CollectionItem"]] = relationship(
        back_populates="meme",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    template: Mapped["Template | None"] = relationship(back_populates="memes")
    # selectin 批量加载所属 Vault，mapper 需要它决定媒体 URL 前缀。
    vault: Mapped["Vault"] = relationship(back_populates="memes", lazy="selectin")
    # Typed Metadata：一行 Profile 专属扩展字段（anime/photo/game_score）。
    asset_metadata: Mapped["AssetMetadata | None"] = relationship(
        back_populates="meme",
        uselist=False,
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # association_proxy 让调用方可以写 meme.tags，而不必手动穿过 meme.tag_links。
    tags: AssociationProxy[list["Tag"]] = association_proxy("tag_links", "tag")


# 运行时登记关联模型，确保只导入 Meme 后 SQLAlchemy 也能解析关系并建新表。
