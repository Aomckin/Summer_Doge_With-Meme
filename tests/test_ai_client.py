import json

import httpx
import pytest

from app.ai.client import (
    AIConfigurationError,
    AIInputImage,
    AIInvalidResponseError,
    AIRequestTimeoutError,
    AITemplateCandidate,
    AIUpstreamError,
    OpenAICompatibleChatClient,
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
                                    {"name": "反应图", "confidence": 0.93},
                                    {"name": "震惊", "confidence": 0.88},
                                ],
                                "template_id": None,
                            },
                            ensure_ascii=False,
                        ),
                    }
                ],
            }
        ],
    }


def chat_response_payload() -> dict[str, object]:
    return {
        "model": "qwen3.6-flash",
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "description": "一组有序反应图。",
                            "tags": [
                                {"name": "反应图", "confidence": 0.9},
                                {"name": "震惊", "confidence": 0.8},
                            ],
                            "template_id": None,
                        },
                        ensure_ascii=False,
                    )
                }
            }
        ],
    }


def test_responses_client_sends_complete_meme_images_in_position_order() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, json=response_payload())

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = OpenAIResponsesClient(
            api_key="secret",
            http_client=http_client,
        )
        client.analyze_images(
            images=[
                AIInputImage(b"second", "image/jpeg", 1),
                AIInputImage(b"first", "image/png", 0),
            ],
            existing_tags=[],
        )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert "一组有序" in payload["input"][0]["content"][0]["text"]
    content = payload["input"][1]["content"]
    meme_parts = content[2:]
    assert [part["type"] for part in meme_parts] == [
        "input_text",
        "input_image",
        "input_text",
        "input_image",
    ]
    assert "第 1 张" in meme_parts[0]["text"]
    assert meme_parts[1]["image_url"].endswith("Zmlyc3Q=")
    assert "第 2 张" in meme_parts[2]["text"]
    assert meme_parts[3]["image_url"].endswith("c2Vjb25k")


def test_chat_client_sends_complete_meme_images_in_position_order() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, json=chat_response_payload())

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = OpenAICompatibleChatClient(
            api_key="secret",
            model="qwen3.6-flash",
            base_url="https://example.test/v1",
            timeout_seconds=10,
            http_client=http_client,
        )
        client.analyze_images(
            images=[
                AIInputImage(b"second", "image/jpeg", 1),
                AIInputImage(b"first", "image/png", 0),
            ],
            existing_tags=[],
        )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert "一组有序" in payload["messages"][0]["content"]
    content = payload["messages"][1]["content"]
    meme_parts = content[2:]
    assert [part["type"] for part in meme_parts] == [
        "text",
        "image_url",
        "text",
        "image_url",
    ]
    assert "第 1 张" in meme_parts[0]["text"]
    assert meme_parts[1]["image_url"]["url"].endswith("Zmlyc3Q=")
    assert "第 2 张" in meme_parts[2]["text"]
    assert meme_parts[3]["image_url"]["url"].endswith("c2Vjb25k")


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
            existing_templates=[
                AITemplateCandidate(3, "Doge", "经典柴犬模板"),
            ],
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
    tag_schema = payload["text"]["format"]["schema"]["properties"]["tags"]
    assert tag_schema["minItems"] == 2
    assert tag_schema["maxItems"] == 8
    template_schema = payload["text"]["format"]["schema"]["properties"][
        "template_id"
    ]
    assert template_schema["type"] == ["integer", "null"]
    system_text = payload["input"][0]["content"][0]["text"]
    assert "标签默认使用简体中文" in system_text
    assert "2 至 8 个" in system_text
    assert all(
        example in system_text
        for example in ("AI", "Be like:", "nigger", "Ciallo~")
    )
    user_content = payload["input"][1]["content"]
    assert "funny, reaction" in user_content[0]["text"]
    assert "ID: 3" in user_content[1]["text"]
    assert "Doge" in user_content[1]["text"]
    assert user_content[2]["type"] == "input_image"
    assert user_content[2]["image_url"].startswith("data:image/png;base64,")
    assert result.model_name == "gpt-5.6-luna-2026-07-01"
    assert result.description == "一只猫正在表达震惊。"
    assert result.tags[0].name == "反应图"
    assert result.tags[0].confidence == 0.93
    assert len(result.tags) == 2
    assert result.template_id is None


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


def test_client_rejects_fewer_than_two_tags() -> None:
    payload = response_payload()
    payload["output"][0]["content"][0]["text"] = json.dumps(
        {
            "description": "一只猫正在表达震惊。",
            "tags": [{"name": "震惊", "confidence": 0.9}],
            "template_id": None,
        },
        ensure_ascii=False,
    )
    transport = httpx.MockTransport(
        lambda _: httpx.Response(200, json=payload)
    )
    with httpx.Client(transport=transport) as http_client:
        client = OpenAIResponsesClient(
            api_key="secret",
            http_client=http_client,
        )
        with pytest.raises(AIInvalidResponseError, match="invalid response"):
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


def test_chat_compatible_client_sends_image_and_parses_json() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "model": "qwen3.6-flash",
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "description": "一张惊讶反应图。",
                                    "tags": [
                                        {
                                            "name": "反应图",
                                            "confidence": 0.9,
                                        },
                                        {
                                            "name": "震惊",
                                            "confidence": 0.8,
                                        },
                                    ],
                                    "template_id": None,
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ],
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = OpenAICompatibleChatClient(
            api_key="secret",
            model="qwen3.6-flash",
            base_url="https://example.test/v1",
            timeout_seconds=10,
            http_client=http_client,
        )
        result = client.analyze_image(
            image_bytes=b"image",
            mime_type="image/png",
            existing_tags=["funny"],
        )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["response_format"] == {"type": "json_object"}
    assert "标签默认使用简体中文" in payload["messages"][0]["content"]
    assert "2 至 8 个" in payload["messages"][0]["content"]
    content = payload["messages"][1]["content"]
    assert "template_id 必须为 null" in content[1]["text"]
    assert content[2]["type"] == "image_url"
    assert content[2]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )
    assert result.model_name == "qwen3.6-flash"
    assert result.tags[0].name == "反应图"
    assert len(result.tags) == 2


def test_client_rejects_non_integer_template_id() -> None:
    payload = response_payload()
    payload["output"][0]["content"][0]["text"] = json.dumps(
        {
            "description": "描述",
            "tags": [
                {"name": "反应图", "confidence": 0.9},
                {"name": "震惊", "confidence": 0.8},
            ],
            "template_id": "3",
        },
        ensure_ascii=False,
    )
    transport = httpx.MockTransport(
        lambda _: httpx.Response(200, json=payload)
    )
    with httpx.Client(transport=transport) as http_client:
        client = OpenAIResponsesClient(
            api_key="secret",
            http_client=http_client,
        )
        with pytest.raises(AIInvalidResponseError, match="invalid response"):
            client.analyze_image(
                image_bytes=b"image",
                mime_type="image/png",
                existing_tags=[],
            )


def test_client_retries_retryable_status_only() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503)
        return httpx.Response(200, json=response_payload())

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = OpenAIResponsesClient(
            api_key="secret",
            max_retries=1,
            retry_delay_seconds=0,
            http_client=http_client,
        )
        client.analyze_image(
            image_bytes=b"image",
            mime_type="image/png",
            existing_tags=[],
        )

    assert calls == 2
