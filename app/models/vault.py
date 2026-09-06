from datetime import UTC, datetime

from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.meme import Meme


def utc_now() -> datetime:
    return datetime.now(UTC)


class Vault(Base):
    # 一个 Vault 是一组相互隔离的图片资产（Meme）的顶层容器。
    __tablename__ = "vaults"

    id: Mapped[int] = mapped_column(primary_key=True)
    # name 用于前端显示；slug 用于 URL、API 和文件目录，创建后不应频繁修改。
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    # type 是 v2.0.1 之前的旧字段，仅作兼容保留；领域档案以 profile 为准。
    type: Mapped[str] = mapped_column(String(50), default="generic")
    # profile 决定 Vault 的 UI 词汇、Capability 与 Typed Metadata 结构。
    profile: Mapped[str] = mapped_column(String(50), default="generic", index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 第一阶段图标使用 emoji 字符串，不建立图标上传系统。
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # storage_path 为空表示沿用旧版共享目录（data/images、data/thumbnails），
    # 只有默认 meme Vault 使用；新建 Vault 使用 data/vaults/{slug}/ 独立目录。
    storage_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # config 保存 JSON 文本，预留 embedding/capabilities 等每仓库配置。
    config: Mapped[str | None] = mapped_column(Text, nullable=True)
    # appearance_json 保存每仓库视觉主题（VaultAppearance）；NULL 表示使用 Profile 默认预设。
    appearance_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 仓库内资产序号计数器：create 时在事务内原子 +1 并取回旧值作为新序号。
    next_asset_no: Mapped[int] = mapped_column(default=1)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    memes: Mapped[list["Meme"]] = relationship(back_populates="vault")
