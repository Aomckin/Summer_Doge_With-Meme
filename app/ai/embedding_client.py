import base64
from dataclasses import dataclass
from math import isfinite
from typing import Protocol

import httpx

from app.ai.client import AIConfigurationError, AIInvalidResponseError, AIRequestTimeoutError, AIUpstreamError


@dataclass(frozen=True)
class ImageEmbeddingResult:
    model_id: str
    vector: tuple[float, ...]


class ImageEmbeddingClient(Protocol):
    def embed_image(self, image_bytes: bytes, mime_type: str) -> ImageEmbeddingResult: ...


class DashScopeEmbeddingClient:
    def __init__(self, *, api_key: str, model: str, base_url: str, timeout_seconds: float, http_client: httpx.Client | None = None) -> None:
        if not api_key.strip():
            raise AIConfigurationError("Embedding API Key is not configured")
        self.api_key, self.model = api_key, model
        self.base_url, self.timeout_seconds, self.http_client = base_url.rstrip("/"), timeout_seconds, http_client

    def embed_image(self, image_bytes: bytes, mime_type: str) -> ImageEmbeddingResult:
        payload = {"model": self.model, "input": {"contents": [{"image": f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"}]}}
        try:
            if self.http_client is not None:
                response = self.http_client.post(f"{self.base_url}/services/embeddings/multimodal-embedding/multimodal-embedding", headers={"Authorization": f"Bearer {self.api_key}"}, json=payload, timeout=self.timeout_seconds)
            else:
                with httpx.Client() as client:
                    response = client.post(f"{self.base_url}/services/embeddings/multimodal-embedding/multimodal-embedding", headers={"Authorization": f"Bearer {self.api_key}"}, json=payload, timeout=self.timeout_seconds)
        except httpx.TimeoutException as error:
            raise AIRequestTimeoutError("Embedding request timed out") from error
        except httpx.RequestError as error:
            raise AIUpstreamError("Embedding service is unavailable") from error
        if response.is_error:
            raise AIUpstreamError(f"Embedding service returned HTTP {response.status_code}")
        try:
            raw = response.json()["output"]["embeddings"][0]["embedding"]
            vector = tuple(float(value) for value in raw)
            if not vector or not all(isfinite(value) for value in vector):
                raise ValueError
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise AIInvalidResponseError("Embedding service returned an invalid vector") from error
        return ImageEmbeddingResult(self.model, vector)
