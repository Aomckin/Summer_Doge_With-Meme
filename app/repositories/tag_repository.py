from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.models.tag import MemeTag, Tag


class TagRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    @staticmethod
    def normalize_name(name: str) -> str:
        return name.strip().lower()

    def get_or_create(self, name: str, *, category: str = "custom") -> Tag:
        normalized = self.normalize_name(name)
        if not normalized:
            raise ValueError("Tag name cannot be empty")

        tag = self.session.scalar(select(Tag).where(Tag.name == normalized))
        if tag is None:
            tag = Tag(name=normalized, category=category)
            self.session.add(tag)
            self.session.flush()
        return tag

    def replace_meme_tags(
        self,
        meme: Meme,
        names: Sequence[str],
        *,
        source: str = "user",
    ) -> list[Tag]:
        normalized_names = list(
            dict.fromkeys(
                normalized
                for name in names
                if (normalized := self.normalize_name(name))
            )
        )
        meme.tag_links.clear()
        for name in normalized_names:
            meme.tag_links.append(
                MemeTag(tag=self.get_or_create(name), source=source)
            )
        self.session.flush()
        return list(meme.tags)

    def list(self) -> list[Tag]:
        return list(self.session.scalars(select(Tag).order_by(Tag.name)))
