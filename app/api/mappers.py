from app.config import IMAGES_URL_PREFIX, THUMBNAILS_URL_PREFIX
from app.models.meme import Meme
from app.schemas.meme import MemeImageResponse, MemeResponse, TagResponse
from app.schemas.template import TemplateResponse
from app.storage.image_storage import ImageStorage


def meme_to_response(meme: Meme) -> MemeResponse:
    image_records = list(meme.images)
    cover = image_records[0] if image_records else meme
    images = [
        MemeImageResponse(
            id=item.id,
            original_filename=item.original_filename,
            stored_filename=item.stored_filename,
            image_url=f"{IMAGES_URL_PREFIX}/{ImageStorage.filename_from_reference(item.file_path)}",
            thumbnail_url=(
                f"{THUMBNAILS_URL_PREFIX}/{ImageStorage.filename_from_reference(item.thumbnail_path)}"
                if item.thumbnail_path else None
            ),
            mime_type=item.mime_type,
            file_size=item.file_size,
            width=item.width,
            height=item.height,
            file_hash=item.file_hash,
            position=item.position,
            created_at=item.created_at,
        )
        for item in image_records
    ]
    image_name = ImageStorage.filename_from_reference(cover.file_path)
    thumbnail_name = (
        ImageStorage.filename_from_reference(cover.thumbnail_path)
        if cover.thumbnail_path is not None else None
    )
    return MemeResponse(
        id=meme.id,
        title=meme.title,
        description=meme.description,
        source=meme.source,
        original_filename=cover.original_filename,
        stored_filename=cover.stored_filename,
        image_url=f"{IMAGES_URL_PREFIX}/{image_name}",
        thumbnail_url=(
            f"{THUMBNAILS_URL_PREFIX}/{thumbnail_name}" if thumbnail_name else None
        ),
        mime_type=cover.mime_type,
        file_size=cover.file_size,
        width=cover.width,
        height=cover.height,
        file_hash=cover.file_hash,
        created_at=meme.created_at,
        updated_at=meme.updated_at,
        tags=[TagResponse.model_validate(tag) for tag in meme.tags],
        template=(
            TemplateResponse.model_validate(meme.template)
            if meme.template is not None else None
        ),
        images=images,
        image_count=len(images),
    )
