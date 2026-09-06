"""Typed Metadata：每个 Asset（Meme）在其 Vault Profile 下的一行扩展元数据。"""
from datetime import UTC, datetime

from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class AssetMetadata(Base):
    # 一行 JSON 承载 Profile 专属字段（anime/photo/game_score），
    # 结构由 app.vault_profiles 的字段约束校验，不把类型字段塞进 memes 主表。
    __tablename__ = "asset_metadata"

    meme_id: Mapped[int] = mapped_column(
        ForeignKey("memes.id", ondelete="CASCADE"), primary_key=True
    )
    profile: Mapped[str] = mapped_column(String(50))
    data: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    meme: Mapped["Meme"] = relationship(back_populates="asset_metadata")
