"""Vault 业务编排：创建、更新、删除与默认仓库解析。"""
from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from app.config import DEFAULT_MAX_FILE_SIZE_MB
from app.models.vault import Vault
from app.vault_profiles import (
    DEFAULT_PROFILE,
    LEGACY_TYPE_TO_PROFILE,
    PROFILE_NAMES,
    capabilities_for,
)
from app.vault_themes import normalize_appearance_payload, resolve_appearance
from app.repositories.vault_repository import VaultRepository
from app.storage.vault_storage import VaultStorageError, VaultStorageService


class VaultNotFoundError(LookupError):
    pass


class VaultSlugConflictError(ValueError):
    pass


class VaultNotEmptyError(RuntimeError):
    """Vault 仍持有 Meme；删除需要调用方显式 force。"""

    def __init__(self, vault_id: int, meme_count: int) -> None:
        super().__init__(
            f"Vault {vault_id} still contains {meme_count} memes; pass force to delete"
        )
        self.meme_count = meme_count


class VaultProtectedError(RuntimeError):
    """默认 meme Vault 是旧接口兼容层的基础，不允许删除。"""


# slug 用于 URL 与目录名：小写字母/数字开头，仅含小写字母、数字与连字符。
SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_NAME_LENGTH = 255
MAX_DESCRIPTION_LENGTH = 2000
MAX_ICON_LENGTH = 50
VAULT_TYPES = frozenset({"meme", "image", "photo", "game", "generic"})
DEFAULT_VAULT_SLUG = "meme"


class VaultService:
    def __init__(
        self,
        session: Session,
        vault_storage: VaultStorageService | None = None,
    ) -> None:
        self.session = session
        self.repository = VaultRepository(session)
        self.vault_storage = vault_storage or VaultStorageService()

    def list_vaults(self) -> list[Vault]:
        return [vault for vault, _count in self.repository.list_all()]

    def get_vault(self, vault_id: int) -> Vault:
        vault = self.repository.get_by_id(vault_id)
        if vault is None:
            raise VaultNotFoundError(f"Vault {vault_id} does not exist")
        return vault

    def get_vault_by_slug(self, slug: str) -> Vault:
        vault = self.repository.get_by_slug(slug)
        if vault is None:
            raise VaultNotFoundError(f"Vault {slug!r} does not exist")
        return vault

    def get_default_vault(self) -> Vault:
        vault = self.repository.get_default()
        if vault is None:
            # 启动迁移保证默认 Vault 存在；到这里说明数据库被跳过迁移或人为破坏。
            raise VaultNotFoundError("Default meme Vault is missing; restart to migrate")
        return vault

    def create_vault(
        self,
        *,
        name: str,
        slug: str,
        type: str | None = None,
        profile: str = DEFAULT_PROFILE,
        description: str | None = None,
        icon: str | None = None,
        max_file_size_mb: int = DEFAULT_MAX_FILE_SIZE_MB,
    ) -> Vault:
        clean_name = name.strip()
        clean_slug = slug.strip()
        if not clean_name or len(clean_name) > MAX_NAME_LENGTH:
            raise ValueError(f"name must contain 1 to {MAX_NAME_LENGTH} characters")
        if not SLUG_PATTERN.match(clean_slug):
            raise ValueError(
                "slug must match ^[a-z0-9][a-z0-9-]{0,63}$ (lowercase letters, digits, hyphens)"
            )
        if clean_slug == DEFAULT_VAULT_SLUG:
            raise VaultSlugConflictError(f"slug {clean_slug!r} is reserved")
        if profile not in PROFILE_NAMES:
            raise ValueError(f"profile must be one of {sorted(PROFILE_NAMES)}")
        # type 是旧字段：未显式提供时按 profile 推导，保持响应兼容。
        if type is None:
            type = "meme" if profile == "meme" else (
                "photo" if profile == "photo" else (
                    "game" if profile == "game_score" else "generic"
                )
            )
        if type not in VAULT_TYPES:
            raise ValueError(f"type must be one of {sorted(VAULT_TYPES)}")
        if description is not None:
            description = description.strip() or None
            if description and len(description) > MAX_DESCRIPTION_LENGTH:
                raise ValueError(
                    f"description must contain at most {MAX_DESCRIPTION_LENGTH} characters"
                )
        if icon is not None:
            icon = icon.strip() or None
            if icon and len(icon) > MAX_ICON_LENGTH:
                raise ValueError(f"icon must contain at most {MAX_ICON_LENGTH} characters")
        if self.repository.slug_exists(clean_slug):
            raise VaultSlugConflictError(f"slug {clean_slug!r} already exists")

        if not isinstance(max_file_size_mb, int) or not 1 <= max_file_size_mb <= 1024:
            raise ValueError("max_file_size_mb must be an integer between 1 and 1024")

        # 非 legacy Vault 使用 data/vaults/{slug}/ 独立目录；storage_path 保存相对根。
        vault = Vault(
            name=clean_name,
            slug=clean_slug,
            type=type,
            profile=profile,
            description=description,
            icon=icon,
            storage_path=f"vaults/{clean_slug}",
            config=json.dumps({"max_file_size_mb": max_file_size_mb}),
        )
        try:
            created = self.repository.create(vault)
            # 目录创建在数据库行落定之后；目录失败则回滚记录。
            self.vault_storage.create_vault_dirs(created)
            self.session.commit()
        except VaultStorageError:
            self.session.rollback()
            raise
        except Exception:
            self.session.rollback()
            raise
        return created

    def update_vault(
        self,
        vault_id: int,
        changes: dict[str, object],
    ) -> Vault:
        vault = self.get_vault(vault_id)
        allowed = {"name", "description", "icon", "max_file_size_mb", "profile"}
        unknown = set(changes) - allowed
        if unknown:
            raise ValueError(f"Fields cannot be updated: {', '.join(sorted(unknown))}")
        if "name" in changes:
            name = str(changes["name"] or "").strip()
            if not name or len(name) > MAX_NAME_LENGTH:
                raise ValueError(f"name must contain 1 to {MAX_NAME_LENGTH} characters")
            changes["name"] = name
        if "description" in changes and changes["description"] is not None:
            description = str(changes["description"]).strip()
            if len(description) > MAX_DESCRIPTION_LENGTH:
                raise ValueError(
                    f"description must contain at most {MAX_DESCRIPTION_LENGTH} characters"
                )
            changes["description"] = description or None
        if "icon" in changes and changes["icon"] is not None:
            icon = str(changes["icon"]).strip()
            if len(icon) > MAX_ICON_LENGTH:
                raise ValueError(f"icon must contain at most {MAX_ICON_LENGTH} characters")
            changes["icon"] = icon or None
        # slug 与 storage_path 创建后不可修改；profile 切换会改变 UI 能力与元数据结构。
        if "profile" in changes and changes["profile"] is not None:
            profile = str(changes["profile"])
            if profile not in PROFILE_NAMES:
                raise ValueError(f"profile must be one of {sorted(PROFILE_NAMES)}")
            changes["profile"] = profile
            changes["type"] = LEGACY_TYPE_TO_PROFILE.get(profile, "generic")
        max_file_size_mb = changes.pop("max_file_size_mb", None)
        if max_file_size_mb is not None:
            if (
                isinstance(max_file_size_mb, bool)
                or not isinstance(max_file_size_mb, int)
                or not 1 <= max_file_size_mb <= 1024
            ):
                raise ValueError(
                    "max_file_size_mb must be an integer between 1 and 1024"
                )
            try:
                config = json.loads(vault.config or "{}")
            except ValueError:
                config = {}
            config["max_file_size_mb"] = max_file_size_mb
            changes["config"] = json.dumps(config)
        try:
            for field, value in changes.items():
                setattr(vault, field, value)
            self.session.flush()
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        self.session.refresh(vault)
        return vault

    def resolved_appearance(self, vault: Vault) -> dict[str, object]:
        """Vault 自定义主题优先，其次 Profile 默认预设。"""
        return resolve_appearance(vault.appearance_json, vault.profile or "generic")

    def update_appearance(self, vault_id: int, data: object) -> Vault:
        """整体替换 Vault 自定义主题；字段与取值由 vault_themes 校验。"""
        import json

        vault = self.get_vault(vault_id)
        cleaned = normalize_appearance_payload(data)
        try:
            vault.appearance_json = json.dumps(cleaned, ensure_ascii=False)
            self.session.flush()
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        self.session.refresh(vault)
        return vault

    def delete_vault(self, vault_id: int, *, force: bool = False) -> None:
        vault = self.get_vault(vault_id)
        if vault.slug == DEFAULT_VAULT_SLUG:
            raise VaultProtectedError("The default meme Vault cannot be deleted")

        meme_count = self.repository.count_memes(vault_id)
        if meme_count and not force:
            raise VaultNotEmptyError(vault_id, meme_count)

        try:
            if meme_count:
                # force 删除：先逐个走既有 Meme 删除链，保证关系、向量标记与
                # 文件清理逻辑复用同一实现，不在此处复制一套级联规则。
                from app.services.meme_service import MemeService

                meme_service = MemeService(
                    self.session, self.vault_storage.storage_for(vault)
                )
                for meme_id in self.repository.meme_ids(vault_id):
                    meme_service.delete_meme(meme_id)
            self.repository.delete(vault)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        # 数据库提交成功后才删除目录；目录失败不回滚数据库删除。
        self.vault_storage.delete_vault_dirs(vault)
        self.vault_storage.remove_background_dir(vault_id)


def resolve_vault_id(session: Session, vault_id: int | None) -> int:
    """把可空的 vault_id 解析为具体仓库；None 表示默认 meme Vault。

    旧 API 兼容层使用该入口；Repository 层永远拿到具体的 vault_id。
    """
    if vault_id is not None:
        return vault_id
    vault = VaultRepository(session).get_default()
    if vault is None:
        raise VaultNotFoundError("Default meme Vault is missing; restart to migrate")
    return vault.id
