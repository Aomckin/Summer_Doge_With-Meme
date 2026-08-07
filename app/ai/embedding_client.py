import base64
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
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


@dataclass(frozen=True)
class FusedEmbeddingResult:
    model_id: str
    vector: tuple[float, ...]
    input_tokens: int
    image_tokens: int
    total_tokens: int
    request_id: str | None


class ImageEmbeddingClient(Protocol):
    def embed_image(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> ImageEmbeddingResult: ...


class MultimodalEmbeddingClient(Protocol):
    def embed_fused(
        self,
        contents: Sequence[Mapping[str, object]],
        *,
        dimension: int = 1024,
        instruct: str | None = None,
    ) -> FusedEmbeddingResult: ...


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
        max_retries: int = 0,
        retry_delay_seconds: float = 1.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise AIConfigurationError("Embedding API Key is not configured")
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_delay_seconds = retry_delay_seconds
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

    def embed_fused(
        self,
        contents: Sequence[Mapping[str, object]],
        *,
        dimension: int = 1024,
        instruct: str | None = None,
    ) -> FusedEmbeddingResult:
        if self.model != "qwen3-vl-embedding":
            raise AIConfigurationError(
                "Meme semantic indexing currently requires qwen3-vl-embedding"
            )
        response = self._request(
            contents, dimension=dimension, enable_fusion=True, instruct=instruct
        )
        parsed = self._parse_response(response)
        if len(parsed.embeddings) != 1:
            raise AIInvalidResponseError(
                "Fusion embedding service must return exactly one embedding"
            )
        item = parsed.embeddings[0]
        if item.type != "fusion" or len(item.vector) != dimension:
            raise AIInvalidResponseError(
                f"Fusion embedding must have type fusion and dimension {dimension}"
            )
        payload = response.json()
        usage = payload.get("usage") if isinstance(payload, dict) else None
        if not isinstance(usage, dict):
            usage = {}
        input_tokens = self._usage_int(usage, "input_tokens", "text_tokens")
        image_tokens = self._usage_int(usage, "image_tokens")
        total_tokens = self._usage_int(usage, "total_tokens")
        if total_tokens == 0:
            total_tokens = input_tokens + image_tokens
        request_id = None
        if isinstance(payload, dict):
            raw_request_id = payload.get("request_id")
            if raw_request_id is not None and str(raw_request_id).strip():
                request_id = str(raw_request_id).strip()
        request_id = request_id or response.headers.get("x-request-id")
        return FusedEmbeddingResult(
            model_id=parsed.model_id,
            vector=item.vector,
            input_tokens=input_tokens,
            image_tokens=image_tokens,
            total_tokens=total_tokens,
            request_id=request_id,
        )

    def embed_multimodal(
        self,
        contents: Sequence[Mapping[str, object]],
        dimension: int = 1024,
        enable_fusion: bool = True,
    ) -> MultimodalEmbeddingResult:
        response = self._request(
            contents, dimension=dimension, enable_fusion=enable_fusion
        )
        return self._parse_response(response)

    def _request(
        self,
        contents: Sequence[Mapping[str, object]],
        *,
        dimension: int,
        enable_fusion: bool,
        instruct: str | None = None,
    ) -> httpx.Response:
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
        if instruct:
            parameters["instruct"] = instruct
        if parameters:
            payload["parameters"] = parameters

        return self._post(payload)

    def _post(self, payload: dict[str, object]) -> httpx.Response:
        url = f"{self.base_url}{self.ENDPOINT}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            response: httpx.Response | None = None
            try:
                if self.http_client is not None:
                    response = self.http_client.post(
                        url, headers=headers, json=payload, timeout=self.timeout_seconds
                    )
                else:
                    with httpx.Client() as client:
                        response = client.post(
                            url, headers=headers, json=payload, timeout=self.timeout_seconds
                        )
            except httpx.TimeoutException as error:
                last_error = error
                if attempt >= self.max_retries:
                    raise AIRequestTimeoutError("Embedding request timed out") from error
            except httpx.RequestError as error:
                last_error = error
                if attempt >= self.max_retries:
                    raise AIUpstreamError("Embedding service is unavailable") from error
            else:
                if not response.is_error:
                    return response
                retryable = response.status_code == 429 or response.status_code >= 500
                if not retryable or attempt >= self.max_retries:
                    raise AIUpstreamError(self._upstream_error(response))
            delay = self._retry_delay(response, attempt)
            if delay > 0:
                time.sleep(delay)
        raise AIUpstreamError("Embedding service is unavailable") from last_error

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

    def _retry_delay(self, response: httpx.Response | None, attempt: int) -> float:
        if response is not None:
            raw = response.headers.get("retry-after", "").strip()
            try:
                retry_after = float(raw)
            except ValueError:
                retry_after = -1
            if 0 <= retry_after <= 60:
                return retry_after
            if raw:
                try:
                    retry_at = parsedate_to_datetime(raw)
                    if retry_at.tzinfo is None:
                        retry_at = retry_at.replace(tzinfo=UTC)
                    retry_after = (retry_at - datetime.now(UTC)).total_seconds()
                except (TypeError, ValueError, OverflowError):
                    retry_after = -1
                if 0 <= retry_after <= 60:
                    return retry_after
        return min(60.0, self.retry_delay_seconds * (2**attempt))

    @staticmethod
    def _usage_int(usage: Mapping[str, object], *keys: str) -> int:
        for key in keys:
            value = usage.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                return value
        return 0

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
