from datetime import UTC, datetime

from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, Text
from sqlalchemy.ext.associationproxy import AssociationProxy, association_proxy
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.tag import MemeTag, Tag


def utc_now() -> datetime:
    return datetime.now(UTC)


class Meme(Base):
    __tablename__ = "memes"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_filename: Mapped[str] = mapped_column(String(255), unique=True)
    file_path: Mapped[str] = mapped_column(String(500))
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(100))
    file_size: Mapped[int]
    width: Mapped[int]
    height: Mapped[int]
    file_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )
    tag_links: Mapped[list["MemeTag"]] = relationship(
        back_populates="meme",
        cascade="all, delete-orphan",
    )
    tags: AssociationProxy[list["Tag"]] = association_proxy("tag_links", "tag")
