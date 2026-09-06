"""Vault 数据访问：只做查询与 flush，事务由上层 Service 控制。"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import DEFAULT_VAULT_SLUG
from app.models.meme import Meme
from app.models.vault import Vault


class VaultRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, vault: Vault) -> Vault:
        self.session.add(vault)
        self.session.flush()
        self.session.refresh(vault)
        return vault

    def get_by_id(self, vault_id: int) -> Vault | None:
        return self.session.get(Vault, vault_id)

    def get_by_slug(self, slug: str) -> Vault | None:
        return self.session.scalar(select(Vault).where(Vault.slug == slug))

    def get_default(self) -> Vault | None:
        return self.get_by_slug(DEFAULT_VAULT_SLUG)

    def slug_exists(self, slug: str) -> bool:
        return (
            self.session.scalar(
                select(func.count()).select_from(Vault).where(Vault.slug == slug)
            )
            or 0
        ) > 0

    def list_all(self) -> list[tuple[Vault, int]]:
        """返回全部 Vault 及其 Meme 数量，按创建顺序排序。"""
        rows = self.session.execute(
            select(Vault, func.count(Meme.id))
            .outerjoin(Meme, Meme.vault_id == Vault.id)
            .group_by(Vault.id)
            .order_by(Vault.id)
        ).all()
        return [(vault, int(count or 0)) for vault, count in rows]

    def count_memes(self, vault_id: int) -> int:
        return int(
            self.session.scalar(
                select(func.count()).select_from(Meme).where(Meme.vault_id == vault_id)
            )
            or 0
        )

    def meme_ids(self, vault_id: int) -> list[int]:
        return list(
            self.session.scalars(select(Meme.id).where(Meme.vault_id == vault_id))
        )

    def delete(self, vault: Vault) -> None:
        self.session.delete(vault)
        self.session.flush()
