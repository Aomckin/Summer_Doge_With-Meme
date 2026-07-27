from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class MemeAIAnalysis(Base):
    __tablename__ = "meme_ai_analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    meme_id: Mapped[int] = mapped_column(
        ForeignKey("memes.id", ondelete="CASCADE"),
        index=True,
    )
    model_name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    suggestions_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    meme: Mapped["Meme"] = relationship(back_populates="ai_analyses")
