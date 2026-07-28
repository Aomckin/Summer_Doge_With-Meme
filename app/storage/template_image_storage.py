from pathlib import Path

from app.config import TEMPLATE_IMAGES_DIR, TEMPLATE_THUMBNAILS_DIR
from app.storage.image_storage import ImageStorage


class TemplateImageStorage(ImageStorage):
    """Validated local storage dedicated to a template's single reference image."""

    def __init__(
        self,
        images_dir: Path = TEMPLATE_IMAGES_DIR,
        thumbnails_dir: Path = TEMPLATE_THUMBNAILS_DIR,
        **kwargs: object,
    ) -> None:
        super().__init__(images_dir, thumbnails_dir, **kwargs)
