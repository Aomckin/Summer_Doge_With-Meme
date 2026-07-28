from datetime import UTC, datetime
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class AIProvider(Base):
    __tablename__ = "ai_providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    protocol: Mapped[str] = mapped_column(String(40))
    base_url: Mapped[str] = mapped_column(String(500))
    api_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_hint: Mapped[str | None] = mapped_column(String(20), nullable=True)
    timeout_seconds: Mapped[float] = mapped_column(Float, default=30.0)
    max_retries: Mapped[int] = mapped_column(Integer, default=1)
    retry_delay_seconds: Mapped[float] = mapped_column(Float, default=1.0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    models: Mapped[list["AIModel"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class AIModel(Base):
    __tablename__ = "ai_models"
    __table_args__ = (
        UniqueConstraint("provider_id", "model_id", name="uq_provider_model"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="CASCADE"),
        index=True,
    )
    model_id: Mapped[str] = mapped_column(String(200))
    display_name: Mapped[str] = mapped_column(String(200))
    supports_vision: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_image_embedding: Mapped[bool] = mapped_column(
        Boolean, default=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_embedding_active: Mapped[bool] = mapped_column(
        Boolean, default=False, index=True
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

    provider: Mapped[AIProvider] = relationship(back_populates="models")
