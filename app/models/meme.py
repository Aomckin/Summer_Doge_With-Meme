# ORM 模型描述 Python 对象如何映射到数据库表；它不是 API 请求/响应格式。
from datetime import UTC, datetime

from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.ext.associationproxy import AssociationProxy, association_proxy
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# 这些类型只帮助编辑器理解注解；运行时不导入，可避免 Meme 与 Tag 循环导入。
if TYPE_CHECKING:
    from app.models.ai_analysis import MemeAIAnalysis
    from app.models.caption import Caption
    from app.models.tag import MemeTag, Tag
    from app.models.template import Template
    from app.models.meme_image import MemeImage


def utc_now() -> datetime:
    # 数据统一保存为 UTC，避免服务器位于不同时区时产生歧义。
    return datetime.now(UTC)


class Meme(Base):
    # 一个 Meme 对象对应 memes 表中的一行。
    __tablename__ = "memes"

    # 基础信息。
    id: Mapped[int] = mapped_column(primary_key=True)
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

    # SHA-256 哈希唯一，可在写入数据库时阻止同一图片被重复收录。
    file_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
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
    template: Mapped["Template | None"] = relationship(back_populates="memes")

    # association_proxy 让调用方可以写 meme.tags，而不必手动穿过 meme.tag_links。
    tags: AssociationProxy[list["Tag"]] = association_proxy("tag_links", "tag")


# 运行时登记关联模型，确保只导入 Meme 后 SQLAlchemy 也能解析关系并建新表。
