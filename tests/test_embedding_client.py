import base64
import json

import httpx
import pytest
import httpx

from app.ai.client import AIInvalidResponseError, AIUpstreamError
from app.ai.embedding_client import DashScopeEmbeddingClient


ENDPOINT = (
    "/api/v1/services/embeddings/"
    "multimodal-embedding/multimodal-embedding"
)


def client(
    http_client: httpx.Client,
    model: str = "qwen3-vl-embedding",
) -> DashScopeEmbeddingClient:
    return DashScopeEmbeddingClient(
        api_key="token",
        model=model,
        base_url="https://dashscope.aliyuncs.com/api/v1",
        timeout_seconds=10,
        http_client=http_client,
    )


def embedding_response(
    *embeddings: tuple[str, list[float]],
) -> dict[str, object]:
    return {
        "output": {
            "embeddings": [
                {"type": embedding_type, "embedding": vector}
                for embedding_type, vector in embeddings
            ]
        }
    }


def test_qwen3_independent_image_uses_data_uri_and_accepts_vl_type() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json=embedding_response(("vl", [0.5, 0.25])),
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        result = client(http_client).embed_image(b"png-bytes", "image/png")

    assert captured["path"] == ENDPOINT
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["model"] == "qwen3-vl-embedding"
    assert payload["input"] == {
        "contents": [
            {
                "image": (
                    "data:image/png;base64,"
                    + base64.b64encode(b"png-bytes").decode("ascii")
                )
            }
        ]
    }
    assert payload["parameters"]["dimension"] == 1024
    assert payload["parameters"].get("enable_fusion") is not True
    assert result.model_id == "qwen3-vl-embedding"
    assert result.vector == (0.5, 0.25)


def test_legacy_tongyi_image_response_type_remains_supported() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json=embedding_response(("image", [0.1, 0.2])),
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        result = client(
            http_client,
            model="tongyi-embedding-vision-plus",
        ).embed_image(b"legacy", "image/jpeg")

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["model"] == "tongyi-embedding-vision-plus"
    assert "dimension" not in payload.get("parameters", {})
    assert result.vector == (0.1, 0.2)


def test_embed_multimodal_enables_fusion_for_future_indexing() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json=embedding_response(("fused", [0.3, 0.4])),
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        result = client(http_client).embed_multimodal(
            [{"text": "描述"}, {"image": "data:image/png;base64,cG5n"}],
        )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["parameters"] == {
        "dimension": 1024,
        "enable_fusion": True,
    }
    assert result.embeddings[0].type == "fused"
    assert result.embeddings[0].vector == (0.3, 0.4)


@pytest.mark.parametrize(
    "payload",
    [
        {"output": {"embeddings": []}},
        embedding_response(("vl", [0.1]), ("vl", [0.2])),
    ],
    ids=["empty", "multiple"],
)
def test_single_image_rejects_non_single_embedding_response(
    payload: dict[str, object],
) -> None:
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=payload)
        )
    ) as http_client:
        with pytest.raises(AIInvalidResponseError, match="exactly one"):
            client(http_client).embed_image(b"png", "image/png")


def test_single_image_rejects_unexpected_embedding_type() -> None:
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json=embedding_response(("text", [0.1])),
            )
        )
    ) as http_client:
        with pytest.raises(AIInvalidResponseError, match="image or vl"):
            client(http_client).embed_image(b"png", "image/png")


def test_dashscope_upstream_error_preserves_code_message_and_request_id() -> None:
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                400,
                json={
                    "code": "InvalidParameter",
                    "message": "dimension is invalid",
                    "request_id": "req-123",
                },
            )
        )
    ) as http_client:
        with pytest.raises(AIUpstreamError) as caught:
            client(http_client).embed_image(b"png", "image/png")

    message = str(caught.value)
    assert "HTTP 400" in message
    assert "InvalidParameter" in message
    assert "dimension is invalid" in message
    assert "req-123" in message


def test_dashscope_embedding_client_rejects_invalid_vector() -> None:
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json=embedding_response(("vl", [])),
            )
        )
    ) as http_client:
        with pytest.raises(AIInvalidResponseError, match="invalid vector"):
            client(http_client).embed_image(b"png", "image/png")


def test_qwen3_fused_payload_usage_and_request_id() -> None:
    captured = {}
    vector = [0.25] * 1024

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, json={
            **embedding_response(("fusion", vector)),
            "usage": {"input_tokens": 11, "image_tokens": 22, "total_tokens": 33},
            "request_id": "req-fusion",
        })

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        result = client(http_client).embed_fused(
            [{"text": "scene"}, {"image": "data:image/png;base64,cG5n"}],
            dimension=1024,
            instruct="document instruction",
        )
    assert captured["payload"]["parameters"] == {
        "dimension": 1024, "enable_fusion": True, "instruct": "document instruction"
    }
    assert result.input_tokens == 11
    assert result.image_tokens == 22
    assert result.total_tokens == 33
    assert result.request_id == "req-fusion"


def test_embedding_retry_429_and_non_retryable_400(monkeypatch) -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json=embedding_response(("fusion", [0.1] * 1024)))

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        retrying = DashScopeEmbeddingClient(
            api_key="token", model="qwen3-vl-embedding", base_url="https://example.test",
            timeout_seconds=1, max_retries=1, retry_delay_seconds=0, http_client=http_client,
        )
        retrying.embed_fused([{"text": "query"}])
    assert calls == 2

    calls = 0
    with httpx.Client(transport=httpx.MockTransport(
        lambda _: (globals(), httpx.Response(400, json={"code": "bad"}))[1]
    )) as http_client:
        non_retrying = DashScopeEmbeddingClient(
            api_key="token", model="qwen3-vl-embedding", base_url="https://example.test",
            timeout_seconds=1, max_retries=3, retry_delay_seconds=0, http_client=http_client,
        )
        with pytest.raises(AIUpstreamError, match="HTTP 400"):
            non_retrying.embed_fused([{"text": "query"}])
