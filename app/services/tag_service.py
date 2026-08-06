from sqlalchemy.orm import Session

from app.models.tag import Tag
from app.repositories.tag_repository import TagRepository, TagWithUsage


class TagNotFoundError(LookupError):
    pass


class TagNameConflictError(ValueError):
    pass


class TagInUseError(RuntimeError):
    def __init__(self, tag_id: int, usage_count: int) -> None:
        self.usage_count = usage_count
        super().__init__(
            f"Tag {tag_id} is currently used by {usage_count} Meme(s) and cannot be deleted"
        )


class TagService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repository = TagRepository(session)

    def list_tags(
        self,
        *,
        include_empty: bool = False,
        q: str | None = None,
        sort: str = "name_asc",
    ) -> list[TagWithUsage]:
        return self.repository.list_with_usage(
            include_empty=include_empty,
            q=q,
            sort=sort,
        )

    def _get_tag(self, tag_id: int) -> Tag:
        tag = self.repository.get_by_id(tag_id)
        if tag is None:
            raise TagNotFoundError(f"Tag {tag_id} does not exist")
        return tag

    def _normalize_name(self, name: str) -> str:
        normalized = self.repository.normalize_name(name)
        if not normalized:
            raise ValueError("Tag name cannot be empty")
        if len(normalized) > 100:
            raise ValueError("Tag name cannot exceed 100 characters")
        return normalized

    def _with_usage(self, tag: Tag) -> TagWithUsage:
        return TagWithUsage.from_tag(tag, self.repository.usage_count(tag.id))

    def rename_tag(self, tag_id: int, name: str) -> TagWithUsage:
        tag = self._get_tag(tag_id)
        normalized = self._normalize_name(name)
        conflict = self.repository.get_by_name(normalized)
        if conflict is not None and conflict.id != tag.id:
            raise TagNameConflictError(
                f'Tag name "{normalized}" already exists; use the merge function instead'
            )
        try:
            updated = self.repository.rename(tag, normalized)
            result = self._with_usage(updated)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return result

    def merge_tags(self, source_tag_id: int, target_tag_id: int) -> TagWithUsage:
        if source_tag_id == target_tag_id:
            raise ValueError("A tag cannot be merged into itself")
        source = self._get_tag(source_tag_id)
        target = self._get_tag(target_tag_id)
        try:
            merged = self.repository.merge(source, target)
            result = self._with_usage(merged)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return result

    def delete_tag(self, tag_id: int) -> None:
        tag = self._get_tag(tag_id)
        count = self.repository.usage_count(tag.id)
        if count:
            raise TagInUseError(tag.id, count)
        try:
            if not self.repository.delete_empty(tag):
                raise TagInUseError(tag.id, self.repository.usage_count(tag.id))
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

    def cleanup_empty(self, *, confirm: bool) -> list[str]:
        if confirm is not True:
            raise ValueError("confirm must be true to delete empty tags")
        try:
            deleted = self.repository.cleanup_empty()
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return deleted
