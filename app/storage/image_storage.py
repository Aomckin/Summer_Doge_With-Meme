from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from app.config import DATA_DIR


# 这一层只负责“文件怎么落盘”，不接触数据库，也不决定 HTTP 状态码。
# 这样以后即使更换数据库或 API 框架，图片保存规则仍可以单独复用。
DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024
DEFAULT_THUMBNAIL_SIZE = (400, 400)

# Pillow 识别出的真实图片格式，对应最终扩展名和响应所需的 MIME 类型。
# 不信任用户上传的文件名后缀，可以避免把伪装成图片的文件直接保存下来。
FORMAT_DETAILS = {
    "JPEG": (".jpg", "image/jpeg"),
    "PNG": (".png", "image/png"),
    "WEBP": (".webp", "image/webp"),
    "GIF": (".gif", "image/gif"),
}


class InvalidImageError(ValueError):
    # 独立的异常类型让上层能把“无效图片”准确转换成 415 响应。
    pass


class ImageTooLargeError(ValueError):
    # 文件超限和图片损坏是两种问题，因此分开表达。
    pass


@dataclass(frozen=True)
class StoredImage:
    # save() 的不可变返回结果：把文件系统得到的信息完整交给业务层入库。
    original_filename: str
    stored_filename: str
    file_path: Path
    thumbnail_path: Path
    mime_type: str
    file_size: int
    width: int
    height: int
    file_hash: str


@dataclass(frozen=True)
class ValidatedImage:
    content: bytes
    image_format: str
    width: int
    height: int
    file_hash: str


class ImageStorage:
    def __init__(
        self,
        images_dir: Path = DATA_DIR / "images",
        thumbnails_dir: Path = DATA_DIR / "thumbnails",
        *,
        max_file_size: int = DEFAULT_MAX_FILE_SIZE,
        thumbnail_size: tuple[int, int] = DEFAULT_THUMBNAIL_SIZE,
    ) -> None:
        # resolve() 得到绝对路径，后面的安全边界检查会以它们作为“允许范围”。
        self.images_dir = images_dir.resolve()
        self.thumbnails_dir = thumbnails_dir.resolve()
        self.max_file_size = max_file_size
        self.thumbnail_size = thumbnail_size
        # parents=True 会连同缺失的上级目录一起创建；已存在时不会报错。
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)

    def save(self, original_filename: str, content: bytes) -> StoredImage:
        return self.save_validated(original_filename, self.validate(content))

    def validate(self, content: bytes) -> ValidatedImage:
        """Validate and hash without writing files or generating a thumbnail."""
        file_size = len(content)
        if file_size > self.max_file_size:
            raise ImageTooLargeError(
                f"Image exceeds the {self.max_file_size}-byte size limit"
            )

        # 格式、宽高都从文件内容读取，而不是相信客户端提交的信息。
        image_format, width, height = self._inspect_image(content)
        return ValidatedImage(
            content=content,
            image_format=image_format,
            width=width,
            height=height,
            file_hash=sha256(content).hexdigest(),
        )

    def save_validated(
        self, original_filename: str, validated: ValidatedImage
    ) -> StoredImage:
        content = validated.content
        file_size = len(content)
        image_format, width, height = (
            validated.image_format,
            validated.width,
            validated.height,
        )
        extension, mime_type = FORMAT_DETAILS[image_format]
        # 使用随机 UUID 作为磁盘文件名，既避免同名覆盖，也不暴露原文件名。
        file_id = uuid4().hex
        stored_filename = f"{file_id}{extension}"
        file_path = self.images_dir / stored_filename
        thumbnail_path = self.thumbnails_dir / f"{file_id}.png"

        file_path.write_bytes(content)
        try:
            self._create_thumbnail(content, thumbnail_path)
        except Exception:
            # 原图已写入而缩略图失败时要一起清理，避免留下“半套”文件。
            file_path.unlink(missing_ok=True)
            thumbnail_path.unlink(missing_ok=True)
            raise

        # 原文件名只作为展示元数据保留；去掉其中可能携带的目录部分。
        safe_original_filename = Path(original_filename.replace("\\", "/")).name
        return StoredImage(
            original_filename=safe_original_filename,
            stored_filename=stored_filename,
            file_path=file_path,
            thumbnail_path=thumbnail_path,
            mime_type=mime_type,
            file_size=file_size,
            width=width,
            height=height,
            # 内容哈希可用于判断两次上传的文件是否完全相同。
            file_hash=validated.file_hash,
        )

    def delete(
        self,
        file_path: str | Path,
        thumbnail_path: str | Path | None,
    ) -> None:
        # 删除前也要验证路径，防止调用者借由 ../ 删除存储目录外的文件。
        original = self._path_inside(file_path, self.images_dir)
        original.unlink(missing_ok=True)

        if thumbnail_path is not None:
            thumbnail = self._path_inside(thumbnail_path, self.thumbnails_dir)
            thumbnail.unlink(missing_ok=True)

    def exists(
        self,
        file_path: str | Path,
        thumbnail_path: str | Path | None,
    ) -> bool:
        # 一条 Meme 记录只有在原图（以及记录过的缩略图）都存在时才算完整。
        original = self._path_inside(file_path, self.images_dir)
        if not original.is_file():
            return False

        if thumbnail_path is None:
            return True

        thumbnail = self._path_inside(thumbnail_path, self.thumbnails_dir)
        return thumbnail.is_file()

    def read_original(self, file_path: str | Path) -> bytes:
        # AI 分析等读取流程复用与删除相同的目录边界检查。
        original = self._path_inside(file_path, self.images_dir)
        return original.read_bytes()

    def original_path(self, file_path: str | Path) -> Path:
        """Resolve an original image while enforcing the configured root."""
        return self._path_inside(file_path, self.images_dir)

    def read_thumbnail(self, file_path: str | Path) -> bytes:
        return self._path_inside(file_path, self.thumbnails_dir).read_bytes()

    def _inspect_image(self, content: bytes) -> tuple[str, int, int]:
        try:
            with Image.open(BytesIO(content)) as image:
                image_format = image.format
                width, height = image.size
                # verify() 校验文件结构，不需要把整张图片长期加载到内存中。
                image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError) as error:
            raise InvalidImageError("File is not a valid image") from error

        if image_format not in FORMAT_DETAILS:
            raise InvalidImageError(f"Unsupported image format: {image_format}")

        return image_format, width, height

    def _create_thumbnail(self, content: bytes, thumbnail_path: Path) -> None:
        with Image.open(BytesIO(content)) as image:
            # GIF 可能有多帧；缩略图统一取第一帧。
            image.seek(0)
            # thumbnail() 保持宽高比，并保证结果不超过设定的外框。
            image.thumbnail(self.thumbnail_size, Image.Resampling.LANCZOS)
            # 调色板或灰度透明模式先转 RGBA，保存 PNG 时更稳定。
            thumbnail = image.convert("RGBA") if image.mode in {"P", "LA"} else image
            thumbnail.save(thumbnail_path, format="PNG")

    @staticmethod
    def filename_from_reference(reference: str | Path) -> str:
        # 旧数据库可能保存 Windows 路径；先统一分隔符，才能跨平台提取文件名。
        normalized = str(reference).replace("\\", "/")
        filename = PurePosixPath(normalized).name
        if not filename:
            raise ValueError("File reference does not contain a filename")
        return filename

    @classmethod
    def _path_inside(cls, path: str | Path, root: Path) -> Path:
        candidate = Path(path)
        if candidate.is_absolute():
            resolved_candidate = candidate.resolve()
            try:
                # 当前存储目录内的绝对路径仍可直接使用，兼容尚未迁移的旧记录。
                resolved_candidate.relative_to(root)
            except ValueError:
                pass
            else:
                return resolved_candidate

        # 项目移动后，旧绝对路径已失效；只取文件名并在当前目录重新定位。
        resolved = (root / cls.filename_from_reference(path)).resolve()
        try:
            resolved.relative_to(root)
        except ValueError as error:
            raise ValueError("Path is outside configured storage") from error
        return resolved
