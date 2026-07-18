from collections.abc import Mapping, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.models.tag import MemeTag, Tag


class MemeRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, meme: Meme) -> Meme:
        self.session.add(meme)
        self.session.flush()
        self.session.refresh(meme)
        return meme

    def get_by_id(self, meme_id: int) -> Meme | None:
        return self.session.get(Meme, meme_id)

    def list(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        tags: Sequence[str] | None = None,
    ) -> list[Meme]:
        statement = select(Meme)
        normalized_tags = list(dict.fromkeys(tag.strip().lower() for tag in tags or [] if tag.strip()))
        if normalized_tags:
            statement = (
                statement.join(MemeTag)
                .join(Tag)
                .where(Tag.name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
        statement = statement.order_by(Meme.id).offset(offset).limit(limit)
        return list(self.session.scalars(statement))

    def update(self, meme: Meme, changes: Mapping[str, object]) -> Meme:
        for field, value in changes.items():
            setattr(meme, field, value)

        self.session.flush()
        self.session.refresh(meme)
        return meme

    def get_random(self, *, tags: Sequence[str] | None = None) -> Meme | None:
        statement = select(Meme)
        normalized_tags = list(
            dict.fromkeys(tag.strip().lower() for tag in tags or [] if tag.strip())
        )
        if normalized_tags:
            statement = (
                statement.join(MemeTag)
                .join(Tag)
                .where(Tag.name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
        statement = statement.order_by(func.random()).limit(1)
        return self.session.scalar(statement)

    def delete(self, meme: Meme) -> None:
        self.session.delete(meme)
        self.session.flush()
