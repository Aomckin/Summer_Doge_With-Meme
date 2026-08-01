from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.caption import Caption


class CaptionRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_for_meme(self, meme_id: int) -> list[Caption]:
        statement = (
            select(Caption)
            .where(Caption.meme_id == meme_id)
            .order_by(Caption.updated_at.desc(), Caption.id.desc())
        )
        return list(self.session.scalars(statement))

    def get_for_meme(self, meme_id: int, caption_id: int) -> Caption | None:
        statement = select(Caption).where(
            Caption.id == caption_id,
            Caption.meme_id == meme_id,
        )
        return self.session.scalar(statement)

    def create(self, caption: Caption) -> Caption:
        self.session.add(caption)
        self.session.flush()
        self.session.refresh(caption)
        return caption

    def update(
        self,
        caption: Caption,
        changes: Mapping[str, object],
    ) -> Caption:
        for field, value in changes.items():
            setattr(caption, field, value)
        self.session.flush()
        self.session.refresh(caption)
        return caption

    def delete(self, caption: Caption) -> None:
        self.session.delete(caption)
        self.session.flush()
