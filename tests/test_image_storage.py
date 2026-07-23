from hashlib import sha256
from importlib import import_module
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image


def load_storage_module():
    module = import_module("app.storage.image_storage")
    assert hasattr(module, "ImageStorage"), "ImageStorage is missing"
    assert hasattr(module, "InvalidImageError"), "InvalidImageError is missing"
    assert hasattr(module, "ImageTooLargeError"), "ImageTooLargeError is missing"
    return module


def make_image_bytes(image_format: str, size: tuple[int, int] = (800, 600)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", size, color="purple").save(buffer, format=image_format)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("image_format", "expected_mime"),
    [
        ("JPEG", "image/jpeg"),
        ("PNG", "image/png"),
        ("WEBP", "image/webp"),
        ("GIF", "image/gif"),
    ],
)
def test_save_supported_image_and_generate_thumbnail(
    tmp_path: Path,
    image_format: str,
    expected_mime: str,
) -> None:
    module = load_storage_module()
    images_dir = tmp_path / "images"
    thumbnails_dir = tmp_path / "thumbnails"
    storage = module.ImageStorage(images_dir, thumbnails_dir)
    content = make_image_bytes(image_format)

    result = storage.save("../../unsafe-name.jpg", content)

    assert result.original_filename == "unsafe-name.jpg"
    assert result.file_path.is_file()
    assert result.file_path.parent == images_dir.resolve()
    assert result.thumbnail_path.is_file()
    assert result.thumbnail_path.parent == thumbnails_dir.resolve()
    assert result.stored_filename not in {"unsafe-name.jpg", "../../unsafe-name.jpg"}
    assert result.mime_type == expected_mime
    assert result.file_size == len(content)
    assert (result.width, result.height) == (800, 600)
    assert result.file_hash == sha256(content).hexdigest()

    with Image.open(result.thumbnail_path) as thumbnail:
        assert thumbnail.width <= 400
        assert thumbnail.height <= 400


def test_reject_non_image_file(tmp_path: Path) -> None:
    module = load_storage_module()
    storage = module.ImageStorage(tmp_path / "images", tmp_path / "thumbnails")

    with pytest.raises(module.InvalidImageError, match="valid image"):
        storage.save("not-image.txt", b"this is not an image")

    assert list((tmp_path / "images").iterdir()) == []
    assert list((tmp_path / "thumbnails").iterdir()) == []


def test_reject_unsupported_image_format(tmp_path: Path) -> None:
    module = load_storage_module()
    storage = module.ImageStorage(tmp_path / "images", tmp_path / "thumbnails")

    with pytest.raises(module.InvalidImageError, match="Unsupported image format"):
        storage.save("image.bmp", make_image_bytes("BMP"))


def test_reject_image_over_size_limit(tmp_path: Path) -> None:
    module = load_storage_module()
    storage = module.ImageStorage(
        tmp_path / "images",
        tmp_path / "thumbnails",
        max_file_size=10,
    )

    with pytest.raises(module.ImageTooLargeError, match="size limit"):
        storage.save("large.png", make_image_bytes("PNG"))


def test_delete_original_and_thumbnail(tmp_path: Path) -> None:
    module = load_storage_module()
    storage = module.ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    result = storage.save("delete.png", make_image_bytes("PNG"))

    storage.delete(result.file_path, result.thumbnail_path)

    assert not result.file_path.exists()
    assert not result.thumbnail_path.exists()


def test_delete_does_not_touch_paths_outside_storage(tmp_path: Path) -> None:
    module = load_storage_module()
    storage = module.ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    outside = tmp_path / "other.png"
    outside.write_bytes(make_image_bytes("PNG"))

    storage.delete(outside, None)

    assert outside.is_file()


def test_legacy_windows_path_falls_back_to_current_storage(tmp_path: Path) -> None:
    module = load_storage_module()
    storage = module.ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    current_file = storage.images_dir / "legacy.png"
    current_file.write_bytes(make_image_bytes("PNG"))

    assert storage.exists(r"C:\old-project\data\images\legacy.png", None)

    storage.delete(r"C:\old-project\data\images\legacy.png", None)
    assert not current_file.exists()
