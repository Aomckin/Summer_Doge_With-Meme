"""Vault 级文件存储解析：唯一允许把 Vault 映射到磁盘目录的位置。

业务代码不得自行拼接 images/thumbnails 目录路径，必须经由本服务获取
ImageStorage 实例或媒体 URL 前缀，防止跨 Vault 文件访问。
"""
from pathlib import Path
import json
import shutil

from app.config import DATA_DIR, DEFAULT_MAX_FILE_SIZE_MB, IMAGES_DIR, THUMBNAILS_DIR
from app.models.vault import Vault
from app.storage.image_storage import ImageStorage


class VaultStorageError(ValueError):
    """Vault 存储配置无法解析为安全路径时抛出。"""


# 非 legacy Vault 的根目录位于 data/vaults/{slug}/。
VAULTS_ROOT_NAME = "vaults"


class VaultStorageService:
    def __init__(
        self,
        data_dir: Path = DATA_DIR,
        legacy_images_dir: Path = IMAGES_DIR,
        legacy_thumbnails_dir: Path = THUMBNAILS_DIR,
    ) -> None:
        self.data_dir = data_dir
        self.legacy_images_dir = legacy_images_dir
        self.legacy_thumbnails_dir = legacy_thumbnails_dir
        self._vaults_root = (data_dir / VAULTS_ROOT_NAME).resolve()

    @staticmethod
    def is_legacy(vault: Vault) -> bool:
        # storage_path 为空表示沿用 v2.0 之前的共享目录（仅默认 meme Vault）。
        return not (vault.storage_path or "").strip()

    def _slug_dir(self, vault: Vault) -> Path:
        slug = (vault.slug or "").strip()
        if not slug or slug != slug.lower() or "/" in slug or "\\" in slug or ".." in slug:
            raise VaultStorageError(f"Vault slug is not a safe directory name: {slug!r}")
        resolved = (self._vaults_root / slug).resolve()
        # 防止解析后的路径逃出 data/vaults 根目录。
        try:
            resolved.relative_to(self._vaults_root)
        except ValueError as error:
            raise VaultStorageError(f"Vault slug escapes storage root: {slug!r}") from error
        return resolved

    def images_dir(self, vault: Vault) -> Path:
        if self.is_legacy(vault):
            return self.legacy_images_dir.resolve()
        return self._slug_dir(vault) / "images"

    def thumbnails_dir(self, vault: Vault) -> Path:
        if self.is_legacy(vault):
            return self.legacy_thumbnails_dir.resolve()
        return self._slug_dir(vault) / "thumbnails"

    @staticmethod
    def max_file_size(vault: Vault) -> int:
        """Vault 单图大小上限（字节）；config 缺失或非法时回退全局默认。"""
        try:
            config = json.loads(vault.config or "{}")
            max_mb = int(config["max_file_size_mb"])
        except (ValueError, TypeError, KeyError, OSError):
            max_mb = DEFAULT_MAX_FILE_SIZE_MB
        if max_mb < 1:
            max_mb = DEFAULT_MAX_FILE_SIZE_MB
        return max_mb * 1024 * 1024

    def background_dir(self, vault_id: int) -> Path:
        """Vault 自主上传背景图的存储目录（独立于 assets，避免被仓库删除波及）。"""
        target = (self.data_dir / "backgrounds" / f"vault-{vault_id}").resolve()
        try:
            target.relative_to(self.data_dir)
        except ValueError as error:
            raise VaultStorageError("Background directory escapes data root") from error
        return target

    def background_path(self, vault_id: int, filename: str) -> Path:
        target = self.background_dir(vault_id) / filename
        try:
            target.relative_to(self.background_dir(vault_id))
        except ValueError as error:
            raise VaultStorageError("Background file escapes storage root") from error
        return target

    def remove_background_dir(self, vault_id: int) -> None:
        target = self.background_dir(vault_id)
        if target.is_dir():
            shutil.rmtree(target)

    def storage_for(self, vault: Vault) -> ImageStorage:
        """返回该 Vault 专属的 ImageStorage；legacy Vault 复用旧共享目录。"""
        return ImageStorage(
            self.images_dir(vault),
            self.thumbnails_dir(vault),
            max_file_size=self.max_file_size(vault),
        )

    def create_vault_dirs(self, vault: Vault) -> None:
        if self.is_legacy(vault):
            return
        self._slug_dir(vault).mkdir(parents=True, exist_ok=True)
        self.images_dir(vault).mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir(vault).mkdir(parents=True, exist_ok=True)

    def delete_vault_dirs(self, vault: Vault) -> None:
        """删除 Vault 的独立目录树；legacy 共享目录绝不允许从这里删除。"""
        if self.is_legacy(vault):
            return
        target = self._slug_dir(vault)
        # 双重确认目录确在 data/vaults 之下后才整体移除。
        target.relative_to(self._vaults_root)
        if target.is_dir():
            shutil.rmtree(target)


def media_prefix_for(vault: Vault) -> tuple[str, str]:
    """返回该 Vault 的 (原图前缀, 缩略图前缀) 媒体 URL。"""
    if VaultStorageService.is_legacy(vault):
        return "/media/images", "/media/thumbnails"
    return f"/media/vaults/{vault.slug}/images", f"/media/vaults/{vault.slug}/thumbnails"
