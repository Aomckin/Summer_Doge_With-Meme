import json

import httpx
import pytest

from app.ai.client import AIInvalidResponseError
from app.ai.embedding_client import DashScopeEmbeddingClient


def test_dashscope_embedding_client_posts_image_and_returns_vector() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/services/embeddings/multimodal-embedding/multimodal-embedding")
        assert request.headers["authorization"] == "Bearer token"
        payload = json.loads(request.content)
        assert payload["model"] == "multimodal-embedding-v1"
        assert payload["input"]["contents"][0]["image"].startswith("data:image/png;base64,")
        return httpx.Response(200, json={"output": {"embeddings": [{"embedding": [0.5, 0.25]}]}})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        result = DashScopeEmbeddingClient(
            api_key="token", model="multimodal-embedding-v1",
            base_url="https://dashscope.aliyuncs.com/api/v1", timeout_seconds=10,
            http_client=http_client,
        ).embed_image(b"png", "image/png")

    assert result.model_id == "multimodal-embedding-v1"
    assert result.vector == (0.5, 0.25)


def test_dashscope_embedding_client_rejects_invalid_vector() -> None:
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"output": {"embeddings": [{"embedding": []}]}}))) as http_client:
        client = DashScopeEmbeddingClient(api_key="token", model="m", base_url="https://api.example", timeout_seconds=10, http_client=http_client)
        with pytest.raises(AIInvalidResponseError):
            client.embed_image(b"png", "image/png")
