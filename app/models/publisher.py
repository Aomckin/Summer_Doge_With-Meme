from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.meme_image import utc_now


class PostDraft(Base):
    __tablename__ = "post_drafts"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    intro_text: Mapped[str] = mapped_column(Text, default="")
    outro_text: Mapped[str] = mapped_column(Text, default="")
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    items: Mapped[list["PostItem"]] = relationship(
        order_by="PostItem.position", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin",
    )


class PostItem(Base):
    __tablename__ = "post_items"
    __table_args__ = (UniqueConstraint("post_id", "position"),)

    post_id: Mapped[int] = mapped_column(ForeignKey("post_drafts.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Copy the library identity, not its file. A deletion must leave the item and caption repairable.
    meme_id: Mapped[int]
    meme_image_id: Mapped[int]
    image_identity: Mapped[str] = mapped_column(String(255))
    position: Mapped[int]
    caption: Mapped[str] = mapped_column(Text)


class PublishAttempt(Base):
    __tablename__ = "publish_attempts"
    __table_args__ = (Index("ix_publish_attempts_post_plugin", "post_id", "plugin_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Keep history after a draft is deleted. Draft IDs are never reused.
    post_id: Mapped[int]
    revision: Mapped[int]
    plugin_id: Mapped[str | None] = mapped_column(String(80), index=True)
    plugin_version: Mapped[str | None] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(24))
    retry_of: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(24), default="queued")
    external_post_id: Mapped[str | None] = mapped_column(String(500))
    external_url: Mapped[str | None] = mapped_column(String(2000))
    error_code: Mapped[str | None] = mapped_column(String(80))
    error_message: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
