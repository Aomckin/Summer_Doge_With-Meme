from collections.abc import Mapping, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.collection import Collection, CollectionItem
from app.models.meme import Meme
from app.models.tag import MemeTag


class CollectionRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, collection: Collection) -> Collection:
        self.session.add(collection)
        self.session.flush()
        self.session.refresh(collection)
        return collection

    def get(self, collection_id: int, *, with_items: bool = False) -> Collection | None:
        statement = select(Collection).where(Collection.id == collection_id)
        if with_items:
            statement = statement.options(
                selectinload(Collection.items)
                .selectinload(CollectionItem.meme)
                .selectinload(Meme.images),
                selectinload(Collection.items)
                .selectinload(CollectionItem.meme)
                .selectinload(Meme.tag_links)
                .selectinload(MemeTag.tag),
                selectinload(Collection.items)
                .selectinload(CollectionItem.meme)
                .selectinload(Meme.template),
            )
        return self.session.scalar(statement)

    def list_with_counts(self) -> list[tuple[Collection, int]]:
        statement = (
            select(Collection, func.count(CollectionItem.id))
            .outerjoin(CollectionItem)
            .group_by(Collection.id)
            .order_by(Collection.id)
        )
        return [(collection, int(count)) for collection, count in self.session.execute(statement)]

    def update(self, collection: Collection, changes: Mapping[str, object]) -> Collection:
        for field, value in changes.items():
            setattr(collection, field, value)
        self.session.flush()
        self.session.refresh(collection)
        return collection

    def delete(self, collection: Collection) -> None:
        self.session.delete(collection)
        self.session.flush()

    def get_item(self, collection_id: int, meme_id: int) -> CollectionItem | None:
        return self.session.scalar(
            select(CollectionItem).where(
                CollectionItem.collection_id == collection_id,
                CollectionItem.meme_id == meme_id,
            )
        )

    def next_position(self, collection_id: int) -> int:
        maximum = self.session.scalar(
            select(func.max(CollectionItem.position)).where(
                CollectionItem.collection_id == collection_id
            )
        )
        return int(maximum) + 1 if maximum is not None else 0

    def count_items(self, collection_id: int) -> int:
        return int(
            self.session.scalar(
                select(func.count(CollectionItem.id)).where(
                    CollectionItem.collection_id == collection_id
                )
            )
            or 0
        )

    def add_item(self, collection_id: int, meme_id: int) -> CollectionItem:
        item = CollectionItem(
            collection_id=collection_id,
            meme_id=meme_id,
            position=self.next_position(collection_id),
        )
        self.session.add(item)
        self.session.flush()
        return item

    def delete_item(self, item: CollectionItem) -> None:
        self.session.delete(item)
        self.session.flush()

    def collection_ids_for_meme(self, meme_id: int) -> list[int]:
        return list(
            self.session.scalars(
                select(CollectionItem.collection_id)
                .where(CollectionItem.meme_id == meme_id)
                .order_by(CollectionItem.collection_id)
            )
        )

    def existing_collection_ids(self, collection_ids: Sequence[int]) -> set[int]:
        if not collection_ids:
            return set()
        return set(
            self.session.scalars(
                select(Collection.id).where(Collection.id.in_(collection_ids))
            )
        )
