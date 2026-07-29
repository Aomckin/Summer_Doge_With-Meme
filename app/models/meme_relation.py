from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MemeRelation(Base):
    __tablename__ = "meme_relations"
    __table_args__ = (
        UniqueConstraint("meme_a_id", "meme_b_id"),
        CheckConstraint("meme_a_id < meme_b_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meme_a_id: Mapped[int] = mapped_column(ForeignKey("memes.id", ondelete="CASCADE"), index=True)
    meme_b_id: Mapped[int] = mapped_column(ForeignKey("memes.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
