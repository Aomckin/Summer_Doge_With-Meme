import sys

import numpy as np


def normalize_vector(vector: object, *, dimension: int = 1024) -> np.ndarray:
    values = np.asarray(vector, dtype=np.float32)
    if values.ndim != 1 or values.size != dimension:
        raise ValueError(f"Embedding vector must have dimension {dimension}")
    if not np.isfinite(values).all():
        raise ValueError("Embedding vector contains NaN or Infinity")
    norm = float(np.linalg.norm(values))
    if not np.isfinite(norm) or norm <= 0:
        raise ValueError("Embedding vector must have a finite non-zero L2 norm")
    normalized = np.ascontiguousarray(values / norm, dtype="<f4")
    return normalized


def serialize_vector(vector: object, *, dimension: int = 1024) -> bytes:
    return normalize_vector(vector, dimension=dimension).tobytes(order="C")


def deserialize_vector(blob: bytes, *, dimension: int = 1024) -> np.ndarray:
    if len(blob) != dimension * 4:
        raise ValueError(
            f"Embedding BLOB must be exactly {dimension * 4} bytes, got {len(blob)}"
        )
    values = np.frombuffer(blob, dtype="<f4")
    if not np.isfinite(values).all():
        raise ValueError("Embedding BLOB contains NaN or Infinity")
    return values.copy() if sys.byteorder != "little" else values
