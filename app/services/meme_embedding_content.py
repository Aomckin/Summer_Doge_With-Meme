import base64
import json
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO

from PIL import Image, ImageOps

from app.models.meme import Meme
from app.services.embedding_config import (
    EMBEDDING_DIMENSION,
    EMBEDDING_KIND,
    MAX_INDEXED_IMAGES,
)
from app.storage.image_storage import ImageStorage


@dataclass(frozen=True)
class MemeEmbeddingContent:
    meme_id: int
    text: str
    contents: tuple[dict[str, object], ...]
    source_hash: str
    indexed_image_count: int
    total_image_count: int


class MemeEmbeddingContentBuilder:
    def __init__(self, storage: ImageStorage) -> None:
        self.storage = storage

    def build(
        self,
        meme: Meme,
        *,
        model_record_id: int,
        model_id_snapshot: str,
        dimension: int = EMBEDDING_DIMENSION,
        include_image_data: bool = True,
    ) -> MemeEmbeddingContent:
        images = sorted(meme.images, key=lambda image: image.position)
        selected = images[:MAX_INDEXED_IMAGES]
        tags = sorted(
            {tag.name.strip().lower() for tag in meme.tags if tag.name.strip()}
        )
        template_name = meme.template.name.strip() if meme.template else "未归类"
        text = "\n".join(
            (
                f"Title: {meme.title.strip()}",
                f"Description: {(meme.description or '').strip()}",
                f"Tags: {', '.join(tags)}",
                f"Template: {template_name}",
            )
        )
        hash_payload = {
            "embedding_kind": EMBEDDING_KIND,
            "model_record_id": model_record_id,
            "model_id_snapshot": model_id_snapshot,
            "dimension": dimension,
            "title": meme.title.strip(),
            "description": (meme.description or "").strip(),
            "tags": tags,
            "template": {
                "id": meme.template_id,
                "name": template_name,
            },
            "images": [
                {"position": image.position, "file_hash": image.file_hash}
                for image in selected
            ],
        }
        stable = json.dumps(
            hash_payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        contents: list[dict[str, object]] = [{"text": text}]
        if include_image_data:
            contents.extend(
                {"image": self._image_data_uri(image)} for image in selected
            )
        return MemeEmbeddingContent(
            meme_id=meme.id,
            text=text,
            contents=tuple(contents),
            source_hash=sha256(stable).hexdigest(),
            indexed_image_count=len(selected),
            total_image_count=len(images),
        )

    def _image_data_uri(self, image_record: object) -> str:
        thumbnail_path = getattr(image_record, "thumbnail_path")
        file_path = getattr(image_record, "file_path")
        raw: bytes
        if thumbnail_path:
            try:
                raw = self.storage.read_thumbnail(thumbnail_path)
            except FileNotFoundError:
                raw = self.storage.read_original(file_path)
        else:
            raw = self.storage.read_original(file_path)
        with Image.open(BytesIO(raw)) as source:
            source.seek(0)
            image = ImageOps.exif_transpose(source).copy()
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        has_alpha = "A" in image.getbands() or image.info.get("transparency") is not None
        if has_alpha:
            if "A" not in image.getbands():
                image = image.convert("RGBA")
            alpha = image.getchannel("A")
            has_alpha = alpha.getextrema()[0] < 255
        output = BytesIO()
        if has_alpha:
            image.convert("RGBA").save(output, format="PNG", optimize=True)
            mime_type = "image/png"
        else:
            image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
            mime_type = "image/jpeg"
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"
