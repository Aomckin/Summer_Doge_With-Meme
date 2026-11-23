from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import BinaryIO
from uuid import UUID
from zipfile import ZIP_STORED, ZipFile

from app.models.publisher import PostDraft
from app.schemas.publisher import PackageItem, PublishPackage, PublisherManifest
from app.services.post_service import PostService, PublisherInputError

MAX_PACKAGE_BYTES = 2 * 1024 ** 3
IMAGE_SUFFIXES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}


class PackageAssetError(RuntimeError):
    pass


@dataclass(frozen=True)
class PackageSnapshot:
    manifest: PublishPackage
    sources: list[Path]

    def write_directory(self, root: Path) -> None:
        (root / "assets").mkdir()
        for item, source in zip(self.manifest.items, self.sources, strict=True):
            with (root / item.asset).open("wb") as target:
                self._copy(item, source, target)
        (root / "manifest.json").write_text(self.manifest.model_dump_json(indent=2), encoding="utf-8")

    def write_zip(self, archive_path: Path) -> None:
        with ZipFile(archive_path, "w", compression=ZIP_STORED) as archive:
            for item, source in zip(self.manifest.items, self.sources, strict=True):
                with archive.open(item.asset, "w", force_zip64=True) as target:
                    self._copy(item, source, target)
            archive.writestr("manifest.json", self.manifest.model_dump_json(indent=2))

    @staticmethod
    def _copy(item: PackageItem, source: Path, target: BinaryIO) -> None:
        digest = sha256()
        total = 0
        try:
            with source.open("rb") as file:
                while chunk := file.read(1024 * 1024):
                    total += len(chunk)
                    if total > item.size:
                        break
                    digest.update(chunk)
                    target.write(chunk)
        except (FileNotFoundError, PermissionError) as error:
            raise PackageAssetError(f"第 {item.position + 1} 张图片已无法读取，请在草稿中替换它") from error
        if total != item.size or digest.hexdigest() != item.sha256:
            raise PackageAssetError(f"第 {item.position + 1} 张图片已变化，请在草稿中替换它")


def snapshot_package(
    service: PostService, post: PostDraft, request_id: UUID, plugin: PublisherManifest | None,
) -> PackageSnapshot:
    if not post.items:
        raise PublisherInputError("请先添加至少一张图片")
    if plugin is not None:
        if len(post.items) > 1 and "multiple_images" not in plugin.capabilities:
            raise PublisherInputError("此 Publisher 不支持多图", code="unsupported")
        if plugin.limits.max_images is not None and len(post.items) > plugin.limits.max_images:
            raise PublisherInputError(f"此 Publisher 最多支持 {plugin.limits.max_images} 张图片")
    entries, paths = [], []
    for resolved in service.resolve_items(post):
        item, image, path = resolved.item, resolved.image, resolved.path
        if image is None or path is None:
            raise PublisherInputError(f"第 {item.position + 1} 张图片缺失或无法读取，请先替换或移除")
        suffix = IMAGE_SUFFIXES.get(image.mime_type)
        if not suffix:
            raise PublisherInputError(f"第 {item.position + 1} 张图片的 MIME 类型不受支持")
        if plugin is not None:
            if image.mime_type == "image/gif" and "gif" not in plugin.capabilities:
                raise PublisherInputError("此 Publisher 不支持 GIF", code="unsupported")
            if plugin.limits.max_image_bytes is not None and image.file_size > plugin.limits.max_image_bytes:
                raise PublisherInputError(f"第 {item.position + 1} 张图片超过此 Publisher 的大小限制")
        entries.append(PackageItem(
            position=item.position, meme_id=item.meme_id, meme_image_id=item.meme_image_id,
            caption=item.caption, asset=f"assets/{item.position + 1:03d}{suffix}",
            mime_type=image.mime_type, size=image.file_size, width=image.width, height=image.height,
            sha256=image.file_hash,
        ))
        paths.append(path)
    total = sum(entry.size for entry in entries)
    if total > MAX_PACKAGE_BYTES or (plugin and plugin.limits.max_package_bytes and total > plugin.limits.max_package_bytes):
        raise PublisherInputError("发布包图片总大小超过限制")
    manifest = PublishPackage(
        request_id=request_id, post_id=post.id, revision=post.revision, title=post.title,
        intro_text=post.intro_text, outro_text=post.outro_text, items=entries,
    )
    return PackageSnapshot(manifest, paths)
