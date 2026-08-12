from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.models.meme_similarity_ignore import MemeSimilarityIgnore


def canonical_pair(left_id: int, right_id: int) -> tuple[int, int]:
    if left_id == right_id:
        raise ValueError("A Meme cannot be ignored against itself")
    return min(left_id, right_id), max(left_id, right_id)


class SimilarityIgnoreRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def pairs_for_sources(self, meme_ids: set[int]) -> set[tuple[int, int]]:
        if not meme_ids:
            return set()
        rows = self.session.scalars(
            select(MemeSimilarityIgnore).where(
                or_(
                    MemeSimilarityIgnore.meme_a_id.in_(meme_ids),
                    MemeSimilarityIgnore.meme_b_id.in_(meme_ids),
                )
            )
        )
        return {(row.meme_a_id, row.meme_b_id) for row in rows}

    def create(self, left_id: int, right_id: int) -> MemeSimilarityIgnore:
        pair = canonical_pair(left_id, right_id)
        existing_ids = set(
            self.session.scalars(select(Meme.id).where(Meme.id.in_(pair)))
        )
        if len(existing_ids) != 2:
            raise LookupError("Both Meme records must exist")
        existing = self.session.scalar(
            select(MemeSimilarityIgnore).where(
                MemeSimilarityIgnore.meme_a_id == pair[0],
                MemeSimilarityIgnore.meme_b_id == pair[1],
            )
        )
        if existing is not None:
            return existing
        record = MemeSimilarityIgnore(meme_a_id=pair[0], meme_b_id=pair[1])
        self.session.add(record)
        self.session.flush()
        return record

    def delete(self, left_id: int, right_id: int) -> bool:
        pair = canonical_pair(left_id, right_id)
        record = self.session.scalar(
            select(MemeSimilarityIgnore).where(
                MemeSimilarityIgnore.meme_a_id == pair[0],
                MemeSimilarityIgnore.meme_b_id == pair[1],
            )
        )
        if record is None:
            return False
        self.session.delete(record)
        self.session.flush()
        return True
