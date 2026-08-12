from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    items: Mapped[list["CollectionItem"]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="CollectionItem.position",
        passive_deletes=True,
    )


class CollectionItem(Base):
    __tablename__ = "collection_items"
    __table_args__ = (UniqueConstraint("collection_id", "meme_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), index=True
    )
    meme_id: Mapped[int] = mapped_column(
        ForeignKey("memes.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    collection: Mapped[Collection] = relationship(back_populates="items")
    meme: Mapped["Meme"] = relationship(back_populates="collection_items")
