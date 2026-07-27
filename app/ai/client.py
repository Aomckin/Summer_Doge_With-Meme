import base64
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import isfinite
from typing import Protocol

import httpx


DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_AI_TIMEOUT_SECONDS = 30.0


class AIClientError(RuntimeError):
    pass


class AIConfigurationError(AIClientError):
    pass


class AIRequestTimeoutError(AIClientError):
    pass


class AIUpstreamError(AIClientError):
    pass


class AIInvalidResponseError(AIClientError):
    pass


@dataclass(frozen=True)
class AITagSuggestion:
    name: str
    confidence: float


@dataclass(frozen=True)
class AIImageResult:
    model_name: str
    description: str
    tags: tuple[AITagSuggestion, ...]


class AIClient(Protocol):
    def analyze_image(
        self,
        *,
        image_bytes: bytes,
        mime_type: str,
        existing_tags: Sequence[str],
    ) -> AIImageResult: ...


ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
        },
        "tags": {
            "type": "array",
            "maxItems": 8,
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 100,
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                    },
                },
                "required": ["name", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["description", "tags"],
    "additionalProperties": False,
}


class OpenAIResponsesClient:
    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_OPENAI_MODEL,
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        timeout_seconds: float = DEFAULT_AI_TIMEOUT_SECONDS,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise AIConfigurationError("OPENAI_API_KEY is not configured")
        if not isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise AIConfigurationError("AI_TIMEOUT_SECONDS must be greater than zero")

        self.api_key = api_key
        self.model = model.strip() or DEFAULT_OPENAI_MODEL
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.http_client = http_client

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        http_client: httpx.Client | None = None,
    ) -> "OpenAIResponsesClient":
        values = environ if environ is not None else os.environ
        timeout_value = values.get(
            "AI_TIMEOUT_SECONDS",
            str(DEFAULT_AI_TIMEOUT_SECONDS),
        )
        try:
            timeout_seconds = float(timeout_value)
        except ValueError as error:
            raise AIConfigurationError(
                "AI_TIMEOUT_SECONDS must be a number"
            ) from error

        return cls(
            api_key=values.get("OPENAI_API_KEY", ""),
            model=values.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
            base_url=values.get("OPENAI_BASE_URL", DEFAULT_OPENAI_BASE_URL),
            timeout_seconds=timeout_seconds,
            http_client=http_client,
        )

    def analyze_image(
        self,
        *,
        image_bytes: bytes,
        mime_type: str,
        existing_tags: Sequence[str],
    ) -> AIImageResult:
        image_data = base64.b64encode(image_bytes).decode("ascii")
        known_tags = ", ".join(existing_tags) if existing_tags else "（暂无已有标签）"
        payload = {
            "model": self.model,
            "store": False,
            "input": [
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "你是 Meme 图片整理助手。生成简体中文图片描述，并推荐"
                                "适合检索的短标签。必须优先复用用户已有标签；只有已有"
                                "标签无法表达关键信息时才建议新标签，且新标签最多 3 个。"
                                "标签使用简短的小写名称，不要输出重复项。"
                            ),
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": f"当前标签库：{known_tags}",
                        },
                        {
                            "type": "input_image",
                            "image_url": f"data:{mime_type};base64,{image_data}",
                            "detail": "auto",
                        },
                    ],
                },
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "meme_image_analysis",
                    "strict": True,
                    "schema": ANALYSIS_SCHEMA,
                }
            },
        }

        try:
            if self.http_client is not None:
                response = self.http_client.post(
                    f"{self.base_url}/responses",
                    headers=self._headers(),
                    json=payload,
                    timeout=self.timeout_seconds,
                )
            else:
                with httpx.Client() as client:
                    response = client.post(
                        f"{self.base_url}/responses",
                        headers=self._headers(),
                        json=payload,
                        timeout=self.timeout_seconds,
                    )
        except httpx.TimeoutException as error:
            raise AIRequestTimeoutError("AI request timed out") from error
        except httpx.RequestError as error:
            raise AIUpstreamError("AI service is unavailable") from error

        if response.is_error:
            raise AIUpstreamError(
                f"AI service returned HTTP {response.status_code}"
            )

        return self._parse_response(response)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _parse_response(self, response: httpx.Response) -> AIImageResult:
        try:
            response_payload = response.json()
            output_text = self._extract_output_text(response_payload)
            result = json.loads(output_text)
            description = result["description"].strip()
            raw_tags = result["tags"]
            if not description or not isinstance(raw_tags, list):
                raise ValueError
            tags = tuple(
                AITagSuggestion(
                    name=str(item["name"]),
                    confidence=float(item["confidence"]),
                )
                for item in raw_tags
            )
            model_name = str(response_payload.get("model") or self.model)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise AIInvalidResponseError(
                "AI service returned an invalid response"
            ) from error

        return AIImageResult(
            model_name=model_name,
            description=description,
            tags=tags,
        )

    @staticmethod
    def _extract_output_text(payload: object) -> str:
        if not isinstance(payload, dict):
            raise AIInvalidResponseError("AI service returned an invalid response")
        for output in payload.get("output", []):
            if not isinstance(output, dict) or output.get("type") != "message":
                continue
            for content in output.get("content", []):
                if (
                    isinstance(content, dict)
                    and content.get("type") == "output_text"
                    and isinstance(content.get("text"), str)
                ):
                    return content["text"]
        raise AIInvalidResponseError("AI service returned no structured output")
