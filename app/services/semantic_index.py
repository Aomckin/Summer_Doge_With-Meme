from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from time import monotonic
import numpy as np
from sqlalchemy.orm import Session, sessionmaker

from app.repositories.meme_embedding_repository import MemeEmbeddingRepository
from app.services.embedding_config import EMBEDDING_KIND
from app.services.embedding_vectors import deserialize_vector


@dataclass(frozen=True)
class SearchHit:
    meme_id: int
    score: float


class SemanticIndex:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory
        self._lock = Lock()
        self._key: tuple[int, str, int, str] | None = None
        self._meme_ids = np.empty(0, dtype=np.int64)
        self._matrix = np.empty((0, 0), dtype=np.float32)
        self._generation = 0

    @property
    def generation(self) -> int:
        with self.session_factory() as session:
            return MemeEmbeddingRepository(session).generation()

    def _ensure(self, key: tuple[int, str, int, str]) -> None:
        generation = self.generation
        if self._key == key and self._generation == generation:
            return
        with self._lock:
            generation = self.generation
            if self._key == key and self._generation == generation:
                return
            record_id, model_id, dimension, kind = key
            with self.session_factory() as session:
                records = MemeEmbeddingRepository(session).compatible_ready(
                    model_record_id=record_id,
                    model_id=model_id,
                    dimension=dimension,
                    kind=kind,
                )
                ids = np.asarray([record.meme_id for record in records], dtype=np.int64)
                matrix = (
                    np.vstack(
                        [
                            deserialize_vector(record.vector_blob or b"", dimension=dimension)
                            for record in records
                        ]
                    ).astype(np.float32, copy=False)
                    if records
                    else np.empty((0, dimension), dtype=np.float32)
                )
            self._meme_ids = ids
            self._matrix = matrix
            self._key = key
            self._generation = generation

    def search(
        self,
        vector: np.ndarray,
        *,
        model_record_id: int,
        model_id: str,
        dimension: int,
        allowed_ids: set[int] | None = None,
        exclude_id: int | None = None,
    ) -> list[SearchHit]:
        key = (model_record_id, model_id, dimension, EMBEDDING_KIND)
        while True:
            self._ensure(key)
            with self._lock:
                if self._key == key and self._generation == self.generation:
                    meme_ids = self._meme_ids
                    matrix = self._matrix
                    break
        if meme_ids.size == 0:
            return []
        mask = np.ones(meme_ids.shape[0], dtype=bool)
        if allowed_ids is not None:
            mask &= np.isin(meme_ids, np.fromiter(allowed_ids, dtype=np.int64))
        if exclude_id is not None:
            mask &= meme_ids != exclude_id
        ids = meme_ids[mask]
        scores = matrix[mask] @ vector
        ordered = np.lexsort((ids, -scores))
        return [SearchHit(int(ids[i]), float(scores[i])) for i in ordered]


class SemanticSearchResultCache:
    def __init__(self, *, ttl_seconds: float = 600, max_entries: int = 50) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._values: OrderedDict[tuple[object, ...], tuple[float, list[SearchHit]]] = OrderedDict()
        self._lock = Lock()

    def get(self, key: tuple[object, ...]) -> list[SearchHit] | None:
        now = monotonic()
        with self._lock:
            value = self._values.pop(key, None)
            if value is None:
                return None
            created, hits = value
            if now - created > self.ttl_seconds:
                return None
            self._values[key] = value
            return list(hits)

    def put(self, key: tuple[object, ...], hits: list[SearchHit]) -> None:
        with self._lock:
            self._values.pop(key, None)
            self._values[key] = (monotonic(), list(hits))
            while len(self._values) > self.max_entries:
                self._values.popitem(last=False)
