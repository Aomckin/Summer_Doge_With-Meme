from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import DEFAULT_MAX_FILE_SIZE_MB
from app.vault_profiles import DEFAULT_PROFILE, PROFILE_NAMES, capabilities_for


class VaultCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=100)
    # type 是旧字段，保留以兼容既有客户端；领域档案以 profile 为准。
    type: str | None = Field(default=None, max_length=50)
    profile: str = Field(default=DEFAULT_PROFILE)
    description: str | None = Field(default=None, max_length=2000)
    icon: str | None = Field(default=None, max_length=50)

    @field_validator("profile")
    @classmethod
    def _validate_profile(cls, value: str) -> str:
        if value not in PROFILE_NAMES:
            raise ValueError(f"profile must be one of {sorted(PROFILE_NAMES)}")
        return value
    # 单图大小上限（MB）；保存进 Vault.config，由 VaultStorageService 解析。
    max_file_size_mb: int = Field(
        default=DEFAULT_MAX_FILE_SIZE_MB, ge=1, le=1024
    )


class VaultUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    icon: str | None = Field(default=None, max_length=50)
    max_file_size_mb: int | None = Field(default=None, ge=1, le=1024)
    profile: str | None = Field(default=None)

    @field_validator("profile")
    @classmethod
    def _validate_update_profile(cls, value: str | None) -> str | None:
        if value is not None and value not in PROFILE_NAMES:
            raise ValueError(f"profile must be one of {sorted(PROFILE_NAMES)}")
        return value


class VaultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    type: str
    description: str | None
    icon: str | None
    storage_path: str | None
    created_at: datetime
    updated_at: datetime
    meme_count: int = 0
    max_file_size_mb: int = DEFAULT_MAX_FILE_SIZE_MB
    profile: str = DEFAULT_PROFILE
    capabilities: dict[str, bool] = Field(default_factory=dict)
    # 已解析的视觉主题（自定义优先，其次 Profile 默认预设）与背景图 URL。
    appearance: dict[str, object] = Field(default_factory=dict)
    background_image_url: str | None = None

    @classmethod
    def from_vault(
        cls,
        vault: object,
        meme_count: int,
        appearance: dict[str, object] | None = None,
        background_image_url: str | None = None,
    ) -> "VaultResponse":
        import json

        try:
            config = json.loads(vault.config or "{}")
            max_file_size_mb = int(config["max_file_size_mb"])
        except (ValueError, TypeError, KeyError, OSError):
            max_file_size_mb = DEFAULT_MAX_FILE_SIZE_MB
        return cls(
            id=vault.id,
            name=vault.name,
            slug=vault.slug,
            type=vault.type,
            description=vault.description,
            icon=vault.icon,
            storage_path=vault.storage_path,
            created_at=vault.created_at,
            updated_at=vault.updated_at,
            meme_count=meme_count,
            max_file_size_mb=max_file_size_mb,
            profile=vault.profile or DEFAULT_PROFILE,
            capabilities=capabilities_for(vault.profile or DEFAULT_PROFILE),
            appearance=appearance if appearance is not None else {},
            background_image_url=background_image_url,
        )
