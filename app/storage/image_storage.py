from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from app.config import DATA_DIR


DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024
DEFAULT_THUMBNAIL_SIZE = (400, 400)

FORMAT_DETAILS = {
    "JPEG": (".jpg", "image/jpeg"),
    "PNG": (".png", "image/png"),
    "WEBP": (".webp", "image/webp"),
    "GIF": (".gif", "image/gif"),
}


class InvalidImageError(ValueError):
    pass


class ImageTooLargeError(ValueError):
    pass


@dataclass(frozen=True)
class StoredImage:
    original_filename: str
    stored_filename: str
    file_path: Path
    thumbnail_path: Path
    mime_type: str
    file_size: int
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
        self.images_dir = images_dir.resolve()
        self.thumbnails_dir = thumbnails_dir.resolve()
        self.max_file_size = max_file_size
        self.thumbnail_size = thumbnail_size
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)

    def save(self, original_filename: str, content: bytes) -> StoredImage:
        file_size = len(content)
        if file_size > self.max_file_size:
            raise ImageTooLargeError(
                f"Image exceeds the {self.max_file_size}-byte size limit"
            )

        image_format, width, height = self._inspect_image(content)
        extension, mime_type = FORMAT_DETAILS[image_format]
        file_id = uuid4().hex
        stored_filename = f"{file_id}{extension}"
        file_path = self.images_dir / stored_filename
        thumbnail_path = self.thumbnails_dir / f"{file_id}.png"

        file_path.write_bytes(content)
        try:
            self._create_thumbnail(content, thumbnail_path)
        except Exception:
            file_path.unlink(missing_ok=True)
            thumbnail_path.unlink(missing_ok=True)
            raise

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
            file_hash=sha256(content).hexdigest(),
        )

    def delete(
        self,
        file_path: str | Path,
        thumbnail_path: str | Path | None,
    ) -> None:
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
        original = self._path_inside(file_path, self.images_dir)
        if not original.is_file():
            return False

        if thumbnail_path is None:
            return True

        thumbnail = self._path_inside(thumbnail_path, self.thumbnails_dir)
        return thumbnail.is_file()

    def _inspect_image(self, content: bytes) -> tuple[str, int, int]:
        try:
            with Image.open(BytesIO(content)) as image:
                image_format = image.format
                width, height = image.size
                image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError) as error:
            raise InvalidImageError("File is not a valid image") from error

        if image_format not in FORMAT_DETAILS:
            raise InvalidImageError(f"Unsupported image format: {image_format}")

        return image_format, width, height

    def _create_thumbnail(self, content: bytes, thumbnail_path: Path) -> None:
        with Image.open(BytesIO(content)) as image:
            image.seek(0)
            image.thumbnail(self.thumbnail_size, Image.Resampling.LANCZOS)
            thumbnail = image.convert("RGBA") if image.mode in {"P", "LA"} else image
            thumbnail.save(thumbnail_path, format="PNG")

    @staticmethod
    def _path_inside(path: str | Path, root: Path) -> Path:
        resolved = Path(path).resolve()
        try:
            resolved.relative_to(root)
        except ValueError as error:
            raise ValueError("Path is outside configured storage") from error
        return resolved
