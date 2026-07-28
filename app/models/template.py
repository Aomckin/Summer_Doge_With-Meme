from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_stored_filename: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    reference_thumbnail_filename: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    reference_mime_type: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )
    reference_file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_file_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    reference_embedding_json: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    reference_embedding_model_id: Mapped[str | None] = mapped_column(
        String(200), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )
    memes: Mapped[list["Meme"]] = relationship(back_populates="template")
