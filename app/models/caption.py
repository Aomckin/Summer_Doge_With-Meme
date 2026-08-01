from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class Caption(Base):
    __tablename__ = "captions"
    __table_args__ = (
        CheckConstraint(
            "length IS NULL OR length IN ('short', 'medium', 'long')",
            name="ck_captions_length",
        ),
        CheckConstraint(
            "source IN ('manual', 'ai')",
            name="ck_captions_source",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meme_id: Mapped[int] = mapped_column(
        ForeignKey("memes.id", ondelete="CASCADE"),
        index=True,
    )
    content: Mapped[str] = mapped_column(Text)
    scene: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    length: Mapped[str | None] = mapped_column(String(10), nullable=True)
    source: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    meme: Mapped["Meme"] = relationship(back_populates="captions")
