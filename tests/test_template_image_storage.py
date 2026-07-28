from io import BytesIO

import pytest
from PIL import Image

from app.storage.image_storage import InvalidImageError
from app.storage.template_image_storage import TemplateImageStorage


def png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (800, 400), color="navy").save(buffer, format="PNG")
    return buffer.getvalue()


def test_template_image_storage_keeps_files_in_its_own_roots(tmp_path) -> None:
    storage = TemplateImageStorage(tmp_path / "template-images", tmp_path / "template-thumbnails")

    stored = storage.save("reference.png", png_bytes())

    assert stored.file_path.parent == (tmp_path / "template-images")
    assert stored.thumbnail_path.parent == (tmp_path / "template-thumbnails")
    assert storage.read_original(stored.file_path) == png_bytes()
    assert storage.exists(stored.file_path, stored.thumbnail_path)


def test_template_image_storage_rejects_invalid_files(tmp_path) -> None:
    storage = TemplateImageStorage(tmp_path / "images", tmp_path / "thumbnails")

    with pytest.raises(InvalidImageError):
        storage.save("not-image.txt", b"not an image")
