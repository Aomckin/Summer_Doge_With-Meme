from __future__ import annotations

from collections.abc import Mapping, Sequence

from sqlalchemy.orm import Session

from app.models.collection import Collection
from app.repositories.collection_repository import CollectionRepository
from app.repositories.meme_repository import MemeRepository


class CollectionNotFoundError(LookupError):
    pass


class MemeNotFoundError(LookupError):
    pass


class CollectionService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repository = CollectionRepository(session)
        self.memes = MemeRepository(session)

    @staticmethod
    def normalize_name(value: object) -> str:
        name = str(value).strip()
        if not name:
            raise ValueError("Collection name cannot be empty")
        if len(name) > 100:
            raise ValueError("Collection name cannot exceed 100 characters")
        return name

    @staticmethod
    def normalize_description(value: object) -> str | None:
        if value is None:
            return None
        description = str(value).strip()
        if len(description) > 500:
            raise ValueError("Collection description cannot exceed 500 characters")
        return description or None

    def create(self, name: str, description: str | None = None) -> Collection:
        try:
            collection = self.repository.create(Collection(
                name=self.normalize_name(name),
                description=self.normalize_description(description),
            ))
            self.session.commit()
            return collection
        except Exception:
            self.session.rollback()
            raise

    def list(self) -> list[tuple[Collection, int]]:
        return self.repository.list_with_counts()

    def count_items(self, collection_id: int) -> int:
        return self.repository.count_items(collection_id)

    def get(self, collection_id: int, *, with_items: bool = False) -> Collection:
        collection = self.repository.get(collection_id, with_items=with_items)
        if collection is None:
            raise CollectionNotFoundError(f"Collection {collection_id} does not exist")
        return collection

    def update(self, collection_id: int, changes: Mapping[str, object]) -> Collection:
        collection = self.get(collection_id)
        data = dict(changes)
        if "name" in data:
            data["name"] = self.normalize_name(data["name"])
        if "description" in data:
            data["description"] = self.normalize_description(data["description"])
        try:
            updated = self.repository.update(collection, data)
            self.session.commit()
            return updated
        except Exception:
            self.session.rollback()
            raise

    def delete(self, collection_id: int) -> None:
        collection = self.get(collection_id)
        try:
            self.repository.delete(collection)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

    def add_meme(self, collection_id: int, meme_id: int) -> None:
        self.get(collection_id)
        if self.memes.get_by_id(meme_id) is None:
            raise MemeNotFoundError(f"Meme {meme_id} does not exist")
        if self.repository.get_item(collection_id, meme_id) is not None:
            return
        try:
            self.repository.add_item(collection_id, meme_id)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

    def remove_meme(self, collection_id: int, meme_id: int) -> None:
        self.get(collection_id)
        item = self.repository.get_item(collection_id, meme_id)
        if item is None:
            raise MemeNotFoundError(
                f"Meme {meme_id} is not in Collection {collection_id}"
            )
        try:
            self.repository.delete_item(item)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

    def memberships(self, meme_id: int) -> list[int]:
        if self.memes.get_by_id(meme_id) is None:
            raise MemeNotFoundError(f"Meme {meme_id} does not exist")
        return self.repository.collection_ids_for_meme(meme_id)

    def replace_memberships(self, meme_id: int, collection_ids: Sequence[int]) -> list[int]:
        if self.memes.get_by_id(meme_id) is None:
            raise MemeNotFoundError(f"Meme {meme_id} does not exist")
        requested = set(collection_ids)
        existing = self.repository.existing_collection_ids(collection_ids)
        missing = sorted(requested - existing)
        if missing:
            raise CollectionNotFoundError(f"Collection {missing[0]} does not exist")
        current = set(self.repository.collection_ids_for_meme(meme_id))
        try:
            for collection_id in sorted(current - requested):
                item = self.repository.get_item(collection_id, meme_id)
                if item is not None:
                    self.repository.delete_item(item)
            for collection_id in sorted(requested - current):
                self.repository.add_item(collection_id, meme_id)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return sorted(requested)
