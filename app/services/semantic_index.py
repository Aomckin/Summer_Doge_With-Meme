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


# 每个 Vault 保留一份惰性矩阵；超过上限时按 LRU 淘汰，避免常驻内存随仓库数无限增长。
MAX_VAULT_ENTRIES = 8


class _VaultEntry:
    __slots__ = ("key", "generation", "meme_ids", "matrix")

    def __init__(self) -> None:
        self.key: tuple[int, str, int, str] | None = None
        self.generation = -1
        self.meme_ids = np.empty(0, dtype=np.int64)
        self.matrix = np.empty((0, 0), dtype=np.float32)


class SemanticIndex:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory
        self._lock = Lock()
        self._entries: OrderedDict[int, _VaultEntry] = OrderedDict()

    def generation(self, vault_id: int) -> int:
        with self.session_factory() as session:
            return MemeEmbeddingRepository(session).generation(vault_id)

    def _load(self, vault_id: int, entry: _VaultEntry, key: tuple[int, str, int, str]) -> None:
        record_id, model_id, dimension, kind = key
        with self.session_factory() as session:
            records = MemeEmbeddingRepository(session).compatible_ready(
                vault_id=vault_id,
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
        entry.meme_ids = ids
        entry.matrix = matrix
        entry.key = key
        entry.generation = self.generation(vault_id)

    def _ensure(self, vault_id: int, key: tuple[int, str, int, str]) -> _VaultEntry:
        generation = self.generation(vault_id)
        entry = self._entries.get(vault_id)
        if entry is not None and entry.key == key and entry.generation == generation:
            self._entries.move_to_end(vault_id)
            return entry
        with self._lock:
            entry = self._entries.get(vault_id)
            if entry is not None and entry.key == key and entry.generation == generation:
                self._entries.move_to_end(vault_id)
                return entry
            fresh = entry if entry is not None else _VaultEntry()
            self._load(vault_id, fresh, key)
            self._entries[vault_id] = fresh
            self._entries.move_to_end(vault_id)
            while len(self._entries) > MAX_VAULT_ENTRIES:
                self._entries.popitem(last=False)
            return fresh

    def search(
        self,
        vector: np.ndarray,
        *,
        vault_id: int,
        model_record_id: int,
        model_id: str,
        dimension: int,
        allowed_ids: set[int] | None = None,
        exclude_id: int | None = None,
    ) -> list[SearchHit]:
        key = (model_record_id, model_id, dimension, EMBEDDING_KIND)
        while True:
            entry = self._ensure(vault_id, key)
            with self._lock:
                current = self._entries.get(vault_id)
                if (
                    current is not None
                    and current is entry
                    and current.generation == self.generation(vault_id)
                ):
                    meme_ids = entry.meme_ids
                    matrix = entry.matrix
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
