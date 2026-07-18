from collections.abc import Mapping, Sequence

from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.repositories.meme_repository import MemeRepository
from app.repositories.tag_repository import TagRepository
from app.storage.image_storage import ImageStorage


EDITABLE_FIELDS = {"title", "description", "source", "tags"}
TAGS_NOT_PROVIDED = object()


class MemeNotFoundError(LookupError):
    pass


class MemeFileMissingError(FileNotFoundError):
    pass


class NoMemesAvailableError(LookupError):
    pass


class MemeService:
    def __init__(self, session: Session, storage: ImageStorage | None = None) -> None:
        self.session = session
        self.repository = MemeRepository(session)
        self.tag_repository = TagRepository(session)
        self.storage = storage or ImageStorage()

    def create_meme(
        self,
        original_filename: str,
        content: bytes,
        *,
        title: str,
        description: str | None = None,
        source: str | None = None,
        tags: Sequence[str] = (),
    ) -> Meme:
        stored = self.storage.save(original_filename, content)
        meme = Meme(
            title=title,
            description=description,
            original_filename=stored.original_filename,
            stored_filename=stored.stored_filename,
            file_path=str(stored.file_path),
            thumbnail_path=str(stored.thumbnail_path),
            mime_type=stored.mime_type,
            file_size=stored.file_size,
            width=stored.width,
            height=stored.height,
            file_hash=stored.file_hash,
            source=source,
        )

        try:
            self.repository.create(meme)
            self.tag_repository.replace_meme_tags(meme, tags)
            self.session.commit()
        except Exception:
            self.session.rollback()
            self.storage.delete(stored.file_path, stored.thumbnail_path)
            raise

        return meme

    def get_meme(self, meme_id: int) -> Meme:
        meme = self.repository.get_by_id(meme_id)
        if meme is None:
            raise MemeNotFoundError(f"Meme {meme_id} does not exist")

        self._ensure_files_exist(meme)
        return meme

    def list_memes(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        tags: Sequence[str] | None = None,
    ) -> list[Meme]:
        return self.repository.list(offset=offset, limit=limit, tags=tags)

    def update_meme(
        self,
        meme_id: int,
        changes: Mapping[str, object],
    ) -> Meme:
        data = dict(changes)
        unknown_fields = set(data) - EDITABLE_FIELDS
        if unknown_fields:
            names = ", ".join(sorted(unknown_fields))
            raise ValueError(f"Fields cannot be updated: {names}")

        tag_names = data.pop("tags", TAGS_NOT_PROVIDED)
        meme = self.get_meme(meme_id)
        try:
            updated = self.repository.update(meme, data)
            if tag_names is not TAGS_NOT_PROVIDED:
                self.tag_repository.replace_meme_tags(meme, tag_names or [])
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        return updated

    def list_tags(self):
        return self.tag_repository.list()

    def get_random_meme(self, *, tags: Sequence[str] | None = None) -> Meme:
        meme = self.repository.get_random(tags=tags)
        if meme is None:
            raise NoMemesAvailableError("No Meme matches the requested range")
        self._ensure_files_exist(meme)
        return meme

    def delete_meme(self, meme_id: int) -> None:
        meme = self.get_meme(meme_id)
        file_path = meme.file_path
        thumbnail_path = meme.thumbnail_path

        try:
            self.repository.delete(meme)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        self.storage.delete(file_path, thumbnail_path)

    def _ensure_files_exist(self, meme: Meme) -> None:
        if not self.storage.exists(meme.file_path, meme.thumbnail_path):
            raise MemeFileMissingError(f"Image file is missing for Meme {meme.id}")
