# 标签模型与 MemeTag 关联模型，共同实现 Meme 和 Tag 的多对多关系。
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class Tag(Base):
    # 标签本体独立保存，因此多个 Meme 可以复用同一条 Tag 记录。
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(50), default="custom")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    meme_links: Mapped[list["MemeTag"]] = relationship(
        back_populates="tag",
        cascade="all, delete-orphan",
    )


class MemeTag(Base):
    # 关联表的一行表示“某个 Meme 拥有某个 Tag”。两个外键共同组成主键，
    # 因而同一个标签无法被重复关联到同一个 Meme。
    __tablename__ = "meme_tags"

    meme_id: Mapped[int] = mapped_column(
        ForeignKey("memes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # source 区分用户标签与未来的 AI 标签；confidence 为 AI 置信度预留。
    source: Mapped[str] = mapped_column(String(20), default="user")
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    meme: Mapped["Meme"] = relationship(back_populates="tag_links")
    tag: Mapped[Tag] = relationship(back_populates="meme_links")
