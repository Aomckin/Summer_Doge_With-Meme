import base64
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import isfinite
from typing import Protocol

import httpx

from app.ai.client import (
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
)


@dataclass(frozen=True)
class ImageEmbeddingResult:
    model_id: str
    vector: tuple[float, ...]


@dataclass(frozen=True)
class MultimodalEmbeddingItem:
    type: str
    vector: tuple[float, ...]


@dataclass(frozen=True)
class MultimodalEmbeddingResult:
    model_id: str
    embeddings: tuple[MultimodalEmbeddingItem, ...]


class ImageEmbeddingClient(Protocol):
    def embed_image(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> ImageEmbeddingResult: ...


class DashScopeEmbeddingClient:
    ENDPOINT = (
        "/services/embeddings/"
        "multimodal-embedding/multimodal-embedding"
    )

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str,
        timeout_seconds: float,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise AIConfigurationError("Embedding API Key is not configured")
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.http_client = http_client

    def embed_image(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> ImageEmbeddingResult:
        data_uri = (
            f"data:{mime_type};base64,"
            f"{base64.b64encode(image_bytes).decode('ascii')}"
        )
        result = self.embed_multimodal(
            [{"image": data_uri}],
            dimension=1024,
            enable_fusion=False,
        )
        if len(result.embeddings) != 1:
            raise AIInvalidResponseError(
                "Embedding service must return exactly one embedding "
                "for a single image"
            )
        item = result.embeddings[0]
        if item.type not in {"image", "vl"}:
            raise AIInvalidResponseError(
                "Embedding service must return type image or vl "
                "for a single image"
            )
        return ImageEmbeddingResult(result.model_id, item.vector)

    def embed_multimodal(
        self,
        contents: Sequence[Mapping[str, object]],
        dimension: int = 1024,
        enable_fusion: bool = True,
    ) -> MultimodalEmbeddingResult:
        if not contents:
            raise ValueError("Embedding contents cannot be empty")
        payload: dict[str, object] = {
            "model": self.model,
            "input": {"contents": [dict(item) for item in contents]},
        }
        parameters: dict[str, object] = {}
        if self._supports_dimension():
            parameters["dimension"] = dimension
        if self.model == "qwen3-vl-embedding" and enable_fusion:
            parameters["enable_fusion"] = True
        if parameters:
            payload["parameters"] = parameters

        response = self._post(payload)
        return self._parse_response(response)

    def _post(self, payload: dict[str, object]) -> httpx.Response:
        url = f"{self.base_url}{self.ENDPOINT}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        try:
            if self.http_client is not None:
                response = self.http_client.post(
                    url,
                    headers=headers,
                    json=payload,
                    timeout=self.timeout_seconds,
                )
            else:
                with httpx.Client() as client:
                    response = client.post(
                        url,
                        headers=headers,
                        json=payload,
                        timeout=self.timeout_seconds,
                    )
        except httpx.TimeoutException as error:
            raise AIRequestTimeoutError(
                "Embedding request timed out"
            ) from error
        except httpx.RequestError as error:
            raise AIUpstreamError(
                "Embedding service is unavailable"
            ) from error
        if response.is_error:
            raise AIUpstreamError(self._upstream_error(response))
        return response

    def _parse_response(
        self,
        response: httpx.Response,
    ) -> MultimodalEmbeddingResult:
        try:
            payload = response.json()
            raw_embeddings = payload["output"]["embeddings"]
            if not isinstance(raw_embeddings, list):
                raise TypeError
            embeddings = tuple(
                self._parse_embedding(item) for item in raw_embeddings
            )
        except (KeyError, TypeError, ValueError) as error:
            raise AIInvalidResponseError(
                "Embedding service returned an invalid vector"
            ) from error
        return MultimodalEmbeddingResult(self.model, embeddings)

    def _parse_embedding(self, item: object) -> MultimodalEmbeddingItem:
        if not isinstance(item, dict):
            raise TypeError
        embedding_type = item.get("type")
        if embedding_type is None and self.model == "multimodal-embedding-v1":
            embedding_type = "image"
        if not isinstance(embedding_type, str) or not embedding_type.strip():
            raise TypeError
        raw_vector = item["embedding"]
        if not isinstance(raw_vector, list):
            raise TypeError
        vector = tuple(float(value) for value in raw_vector)
        if not vector or not all(isfinite(value) for value in vector):
            raise ValueError
        return MultimodalEmbeddingItem(embedding_type.strip(), vector)

    def _supports_dimension(self) -> bool:
        return not (
            self.model == "multimodal-embedding-v1"
            or self.model.startswith("tongyi-embedding-vision")
        )

    @staticmethod
    def _upstream_error(response: httpx.Response) -> str:
        details: list[str] = []
        try:
            payload = response.json()
        except ValueError:
            text = response.text.strip()
            if text:
                details.append(text[:1000])
        else:
            if isinstance(payload, dict):
                for key in ("code", "message", "request_id"):
                    value = payload.get(key)
                    if value is not None and str(value).strip():
                        details.append(f"{key}={str(value).strip()}")
        suffix = f": {'; '.join(details)}" if details else ""
        return f"Embedding service returned HTTP {response.status_code}{suffix}"
