import json

import httpx
import pytest

from app.ai.client import (
    AIConfigurationError,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AIUpstreamError,
    OpenAIResponsesClient,
)


def response_payload() -> dict[str, object]:
    return {
        "model": "gpt-5.6-luna-2026-07-01",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(
                            {
                                "description": "一只猫正在表达震惊。",
                                "tags": [
                                    {"name": "reaction", "confidence": 0.93}
                                ],
                            },
                            ensure_ascii=False,
                        ),
                    }
                ],
            }
        ],
    }


def test_client_reads_environment_and_sends_structured_image_request() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, json=response_payload())

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = OpenAIResponsesClient.from_env(
            {
                "OPENAI_API_KEY": "secret-key",
                "OPENAI_MODEL": "gpt-5.6-luna",
                "OPENAI_BASE_URL": "https://example.test/v1/",
                "AI_TIMEOUT_SECONDS": "12",
            },
            http_client=http_client,
        )
        result = client.analyze_image(
            image_bytes=b"image",
            mime_type="image/png",
            existing_tags=["funny", "reaction"],
        )

    request = captured["request"]
    payload = captured["payload"]
    assert isinstance(request, httpx.Request)
    assert isinstance(payload, dict)
    assert str(request.url) == "https://example.test/v1/responses"
    assert request.headers["authorization"] == "Bearer secret-key"
    assert payload["model"] == "gpt-5.6-luna"
    assert payload["store"] is False
    assert payload["text"]["format"]["type"] == "json_schema"
    user_content = payload["input"][1]["content"]
    assert "funny, reaction" in user_content[0]["text"]
    assert user_content[1]["type"] == "input_image"
    assert user_content[1]["image_url"].startswith("data:image/png;base64,")
    assert result.model_name == "gpt-5.6-luna-2026-07-01"
    assert result.description == "一只猫正在表达震惊。"
    assert result.tags[0].name == "reaction"
    assert result.tags[0].confidence == 0.93


def test_client_requires_api_key() -> None:
    with pytest.raises(AIConfigurationError, match="OPENAI_API_KEY"):
        OpenAIResponsesClient.from_env({})


def test_client_maps_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = OpenAIResponsesClient(
            api_key="secret",
            http_client=http_client,
        )
        with pytest.raises(AIRequestTimeoutError, match="timed out"):
            client.analyze_image(
                image_bytes=b"image",
                mime_type="image/png",
                existing_tags=[],
            )


def test_client_rejects_invalid_structured_response() -> None:
    transport = httpx.MockTransport(
        lambda _: httpx.Response(
            200,
            json={"model": "gpt-5.6-luna", "output": []},
        )
    )
    with httpx.Client(transport=transport) as http_client:
        client = OpenAIResponsesClient(
            api_key="secret",
            http_client=http_client,
        )
        with pytest.raises(AIInvalidResponseError, match="structured output"):
            client.analyze_image(
                image_bytes=b"image",
                mime_type="image/png",
                existing_tags=[],
            )


def test_client_maps_upstream_http_error_without_exposing_response_body() -> None:
    transport = httpx.MockTransport(
        lambda _: httpx.Response(
            429,
            json={"error": {"message": "secret upstream detail"}},
        )
    )
    with httpx.Client(transport=transport) as http_client:
        client = OpenAIResponsesClient(
            api_key="secret",
            http_client=http_client,
        )
        with pytest.raises(
            AIUpstreamError,
            match="AI service returned HTTP 429",
        ) as caught:
            client.analyze_image(
                image_bytes=b"image",
                mime_type="image/png",
                existing_tags=[],
            )

    assert "secret upstream detail" not in str(caught.value)
