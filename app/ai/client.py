import base64
import json
import os
import time
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
class AITemplateCandidate:
    id: int
    name: str
    description: str | None
    reference_image_bytes: bytes | None = None
    reference_image_mime_type: str | None = None
    visual_similarity: float | None = None


@dataclass(frozen=True)
class AIImageResult:
    model_name: str
    title: str
    description: str
    tags: tuple[AITagSuggestion, ...]
    template_id: int | None = None


@dataclass(frozen=True)
class AIInputImage:
    image_bytes: bytes
    mime_type: str
    position: int


@dataclass(frozen=True)
class AICaptionResult:
    model_name: str
    captions: tuple[str, ...]


class AIClient(Protocol):
    def analyze_images(self, *, images: Sequence[AIInputImage], existing_tags: Sequence[str], existing_templates: Sequence[AITemplateCandidate]) -> AIImageResult: ...
    def analyze_image(
        self,
        *,
        image_bytes: bytes,
        mime_type: str,
        existing_tags: Sequence[str],
        existing_templates: Sequence[AITemplateCandidate],
    ) -> AIImageResult: ...
    def generate_captions(
        self,
        *,
        images: Sequence[AIInputImage],
        title: str,
        description: str | None,
        tags: Sequence[str],
        template: str | None,
        scene: str | None,
        tone: str | None,
        length: str | None,
        count: int,
    ) -> AICaptionResult: ...
    def rewrite_caption(
        self,
        *,
        images: Sequence[AIInputImage],
        title: str,
        description: str | None,
        tags: Sequence[str],
        template: str | None,
        content: str,
        action: str,
        scene: str | None,
        tone: str | None,
        length: str | None,
    ) -> AICaptionResult: ...


SYSTEM_PROMPT = (
    "你是 Meme 图片整理助手。生成一个简短的简体中文建议标题、图片描述，"
    "并推荐适合检索的短标签。标题应概括图片主体或笑点，"
    "不得包含“标题：”前缀、文件名或包裹引号。"
    "输入图片属于同一个完整 Meme 的一组有序图片；必须按顺序理解全部图片，"
    "只生成一份组级描述、标签和模板判断。"
    "必须优先复用用户已有标签；只有已有标签无法准确表达关键信息时才建议新标签。"
    "标签默认使用简体中文。仅当外语词本身是交流中常用的专用表达"
    "（如“AI”“Be like:”“nigger”）、外语二次元梗或固定梗名"
    "（如“Ciallo~”），或者外语比中文更能准确表达 Meme 含义时，"
    "才保留原外语标签。标签总数必须为 2 至 8 个，名称应简短且不得重复；"
    "固定外语表达应保留其惯用拼写和标点。"
    "模板只能从用户提供的已有模板候选中选择 template_id；不得创建或命名新模板，"
    "不得返回候选列表之外的 ID；不确定或没有合适模板时必须返回 null。"
)


ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255,
        },
        "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
        },
        "tags": {
            "type": "array",
            "minItems": 2,
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
        "template_id": {
            "type": ["integer", "null"],
        },
    },
    "required": ["title", "description", "tags", "template_id"],
    "additionalProperties": False,
}

CAPTION_SYSTEM_PROMPT = (
    "你是中文 Meme 文案创作助手。根据用户提供的完整有序图片组和资料生成"
    "可直接用于 Meme 的简体中文文案。文案要自然、具体、有梗，不要解释创作过程，"
    "不要添加序号、引号或“文案：”前缀。严格遵循场景、语气和长度条件。"
)


def _caption_schema(count: int) -> dict[str, object]:
    return {
        "type": "object",
        "properties": {
            "captions": {
                "type": "array",
                "minItems": count,
                "maxItems": count,
                "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000,
                },
            },
        },
        "required": ["captions"],
        "additionalProperties": False,
    }


class _HTTPAIClient:
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
            raise AIConfigurationError(
                "OPENAI_API_KEY or provider API Key is not configured"
            )
        if not isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise AIConfigurationError("AI timeout must be greater than zero")
        if max_retries < 0 or max_retries > 5:
            raise AIConfigurationError("AI max retries must be between 0 and 5")
        if not isfinite(retry_delay_seconds) or retry_delay_seconds < 0:
            raise AIConfigurationError("AI retry delay cannot be negative")

        self.api_key = api_key
        self.model = model.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_delay_seconds = retry_delay_seconds
        self.http_client = http_client

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, payload: dict[str, object]) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                if self.http_client is not None:
                    response = self.http_client.post(
                        f"{self.base_url}{path}",
                        headers=self._headers(),
                        json=payload,
                        timeout=self.timeout_seconds,
                    )
                else:
                    with httpx.Client() as client:
                        response = client.post(
                            f"{self.base_url}{path}",
                            headers=self._headers(),
                            json=payload,
                            timeout=self.timeout_seconds,
                        )
            except httpx.TimeoutException as error:
                last_error = error
                if attempt >= self.max_retries:
                    raise AIRequestTimeoutError("AI request timed out") from error
            except httpx.RequestError as error:
                last_error = error
                if attempt >= self.max_retries:
                    raise AIUpstreamError("AI service is unavailable") from error
            else:
                if not response.is_error:
                    return response
                if (
                    response.status_code != 429
                    and response.status_code < 500
                ) or attempt >= self.max_retries:
                    raise AIUpstreamError(
                        f"AI service returned HTTP {response.status_code}"
                    )
            if self.retry_delay_seconds:
                time.sleep(self.retry_delay_seconds * (attempt + 1))
        raise AIUpstreamError("AI service is unavailable") from last_error

    @staticmethod
    def _caption_context(
        *,
        title: str,
        description: str | None,
        tags: Sequence[str],
        template: str | None,
        scene: str | None,
        tone: str | None,
        length: str | None,
    ) -> str:
        length_names = {"short": "短", "medium": "中", "long": "长"}
        return "\n".join(
            (
                f"标题：{title}",
                f"描述：{description or '（无）'}",
                f"标签：{', '.join(tags) if tags else '（无）'}",
                f"模板：{template or '（无）'}",
                f"使用场景：{scene or '（不限）'}",
                f"语气：{tone or '（不限）'}",
                f"长度：{length_names.get(length or '', '不限')}",
            )
        )

    @staticmethod
    def _parse_caption_result(
        response_payload: object,
        output_text: str,
    ) -> AICaptionResult:
        try:
            parsed = json.loads(output_text)
            if not isinstance(parsed, dict):
                raise TypeError
            captions = parsed["captions"]
            if (
                not isinstance(captions, list)
                or not all(isinstance(item, str) for item in captions)
            ):
                raise TypeError
            model_name = (
                str(response_payload.get("model") or "").strip()
                if isinstance(response_payload, dict)
                else ""
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise AIInvalidResponseError(
                "AI service returned an invalid caption response"
            ) from error
        return AICaptionResult(
            model_name=model_name,
            captions=tuple(captions),
        )

    def _parse_result(
        self,
        response_payload: object,
        output_text: str,
    ) -> AIImageResult:
        try:
            result = json.loads(output_text)
            raw_title = result["title"]
            if not isinstance(raw_title, str):
                raise ValueError
            title = raw_title.strip()
            description = result["description"].strip()
            raw_tags = result["tags"]
            template_id = result["template_id"]
            if (
                not title
                or len(title) > 255
                or not description
                or not isinstance(raw_tags, list)
            ):
                raise ValueError
            if template_id is not None and (
                isinstance(template_id, bool) or not isinstance(template_id, int)
            ):
                raise ValueError
            tags = tuple(
                AITagSuggestion(
                    name=str(item["name"]),
                    confidence=float(item["confidence"]),
                )
                for item in raw_tags
            )
            if not 2 <= len(tags) <= 8:
                raise ValueError
            if not isinstance(response_payload, dict):
                raise ValueError
            model_name = str(response_payload.get("model") or self.model)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise AIInvalidResponseError(
                "AI service returned an invalid response"
            ) from error
        return AIImageResult(
            model_name=model_name,
            title=title,
            description=description,
            tags=tags,
            template_id=template_id,
        )

    @staticmethod
    def _template_prompt(
        existing_templates: Sequence[AITemplateCandidate],
    ) -> str:
        candidates = list(existing_templates[:200])
        if not candidates:
            return "当前没有已有模板候选，template_id 必须为 null。"
        lines = ["已有模板候选（只能选择下列 ID）："]
        for candidate in candidates:
            description = (candidate.description or "无描述").strip()[:200]
            lines.append(
                f"ID: {candidate.id}\n名称: {candidate.name}\n描述: {description}"
            )
        return "\n\n".join(lines)

    @staticmethod
    def _template_images(existing_templates: Sequence[AITemplateCandidate], response_api: bool) -> list[dict[str, object]]:
        parts: list[dict[str, object]] = []
        for candidate in existing_templates:
            if candidate.reference_image_bytes is None or candidate.reference_image_mime_type is None:
                continue
            data = base64.b64encode(candidate.reference_image_bytes).decode("ascii")
            if response_api:
                parts.extend([{"type": "input_text", "text": f"视觉参考模板 ID: {candidate.id}"}, {"type": "input_image", "image_url": f"data:{candidate.reference_image_mime_type};base64,{data}", "detail": "low"}])
            else:
                parts.extend([{"type": "text", "text": f"视觉参考模板 ID: {candidate.id}"}, {"type": "image_url", "image_url": {"url": f"data:{candidate.reference_image_mime_type};base64,{data}"}}])
        return parts


class OpenAIResponsesClient(_HTTPAIClient):
    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_OPENAI_MODEL,
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        timeout_seconds: float = DEFAULT_AI_TIMEOUT_SECONDS,
        max_retries: int = 0,
        retry_delay_seconds: float = 1.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            model=model.strip() or DEFAULT_OPENAI_MODEL,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            retry_delay_seconds=retry_delay_seconds,
            http_client=http_client,
        )

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

    def analyze_images(
        self,
        *,
        images: Sequence[AIInputImage],
        existing_tags: Sequence[str],
        existing_templates: Sequence[AITemplateCandidate] = (),
    ) -> AIImageResult:
        if not images:
            raise AIInvalidResponseError("At least one Meme image is required")
        image_parts: list[dict[str, object]] = []
        for image in sorted(images, key=lambda item: item.position):
            if len(images) > 1:
                image_parts.append({"type": "input_text", "text": f"完整 Meme 的第 {image.position + 1} 张图片："})
            image_parts.extend([
                {"type": "input_image", "image_url": f"data:{image.mime_type};base64,{base64.b64encode(image.image_bytes).decode('ascii')}", "detail": "auto"},
            ])
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
                            "text": SYSTEM_PROMPT,
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
                            "type": "input_text",
                            "text": self._template_prompt(existing_templates),
                        },
                        *self._template_images(existing_templates, True),
                        *image_parts,
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

        response = self._post("/responses", payload)
        return self._parse_response(response)

    def analyze_image(self, *, image_bytes: bytes, mime_type: str, existing_tags: Sequence[str], existing_templates: Sequence[AITemplateCandidate] = ()) -> AIImageResult:
        return self.analyze_images(images=[AIInputImage(image_bytes, mime_type, 0)], existing_tags=existing_tags, existing_templates=existing_templates)

    def generate_captions(
        self,
        *,
        images: Sequence[AIInputImage],
        title: str,
        description: str | None,
        tags: Sequence[str],
        template: str | None,
        scene: str | None,
        tone: str | None,
        length: str | None,
        count: int,
    ) -> AICaptionResult:
        return self._caption_request(
            images=images,
            instruction=f"请生成 {count} 条彼此不同的候选文案。",
            context=self._caption_context(
                title=title,
                description=description,
                tags=tags,
                template=template,
                scene=scene,
                tone=tone,
                length=length,
            ),
            count=count,
        )

    def rewrite_caption(
        self,
        *,
        images: Sequence[AIInputImage],
        title: str,
        description: str | None,
        tags: Sequence[str],
        template: str | None,
        content: str,
        action: str,
        scene: str | None,
        tone: str | None,
        length: str | None,
    ) -> AICaptionResult:
        actions = {
            "polish": "润色",
            "shorten": "缩短",
            "expand": "扩写",
            "retone": "换一种语气",
        }
        return self._caption_request(
            images=images,
            instruction=(
                f"请对草稿执行“{actions[action]}”，只返回 1 条改写结果。\n"
                f"原草稿：{content}"
            ),
            context=self._caption_context(
                title=title,
                description=description,
                tags=tags,
                template=template,
                scene=scene,
                tone=tone,
                length=length,
            ),
            count=1,
        )

    def _caption_request(
        self,
        *,
        images: Sequence[AIInputImage],
        instruction: str,
        context: str,
        count: int,
    ) -> AICaptionResult:
        if not images:
            raise AIInvalidResponseError("At least one Meme image is required")
        image_parts: list[dict[str, object]] = []
        for image in sorted(images, key=lambda item: item.position):
            if len(images) > 1:
                image_parts.append(
                    {
                        "type": "input_text",
                        "text": f"完整 Meme 的第 {image.position + 1} 张图片：",
                    }
                )
            image_parts.append(
                {
                    "type": "input_image",
                    "image_url": (
                        f"data:{image.mime_type};base64,"
                        f"{base64.b64encode(image.image_bytes).decode('ascii')}"
                    ),
                    "detail": "auto",
                }
            )
        response = self._post(
            "/responses",
            {
                "model": self.model,
                "store": False,
                "input": [
                    {
                        "role": "system",
                        "content": [
                            {"type": "input_text", "text": CAPTION_SYSTEM_PROMPT}
                        ],
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": context},
                            {"type": "input_text", "text": instruction},
                            *image_parts,
                        ],
                    },
                ],
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "meme_caption_candidates",
                        "strict": True,
                        "schema": _caption_schema(count),
                    }
                },
            },
        )
        try:
            payload = response.json()
            output_text = self._extract_output_text(payload)
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise AIInvalidResponseError(
                "AI service returned an invalid caption response"
            ) from error
        return self._parse_caption_result(payload, output_text)

    def _parse_response(self, response: httpx.Response) -> AIImageResult:
        try:
            response_payload = response.json()
            output_text = self._extract_output_text(response_payload)
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise AIInvalidResponseError(
                "AI service returned an invalid response"
            ) from error
        return self._parse_result(response_payload, output_text)

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


class OpenAICompatibleChatClient(_HTTPAIClient):
    """OpenAI-compatible Chat Completions client used by Qwen and custom APIs."""

    def analyze_images(
        self,
        *,
        images: Sequence[AIInputImage],
        existing_tags: Sequence[str],
        existing_templates: Sequence[AITemplateCandidate] = (),
    ) -> AIImageResult:
        if not images:
            raise AIInvalidResponseError("At least one Meme image is required")
        image_parts: list[dict[str, object]] = []
        for image in sorted(images, key=lambda item: item.position):
            if len(images) > 1:
                image_parts.append({"type": "text", "text": f"完整 Meme 的第 {image.position + 1} 张图片："})
            image_parts.append({"type": "image_url", "image_url": {"url": f"data:{image.mime_type};base64,{base64.b64encode(image.image_bytes).decode('ascii')}"}})
        known_tags = ", ".join(existing_tags) if existing_tags else "（暂无）"
        payload: dict[str, object] = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"{SYSTEM_PROMPT} 必须只输出 JSON 对象，格式示例："
                        '{"title":"建议标题","description":"图片描述","tags":'
                        '[{"name":"反应图","confidence":0.9},'
                        '{"name":"震惊","confidence":0.8}],'
                        '"template_id":null}'
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"当前标签库：{known_tags}",
                        },
                        {
                            "type": "text",
                            "text": self._template_prompt(existing_templates),
                        },
                        *self._template_images(existing_templates, False),
                        *image_parts,
                    ],
                },
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": 1200,
        }
        response = self._post("/chat/completions", payload)
        try:
            response_payload = response.json()
            if not isinstance(response_payload, dict):
                raise TypeError
            choices = response_payload["choices"]
            output_text = choices[0]["message"]["content"]
            if not isinstance(output_text, str):
                raise TypeError
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise AIInvalidResponseError(
                "AI service returned no structured output"
            ) from error
        return self._parse_result(response_payload, output_text)

    def analyze_image(self, *, image_bytes: bytes, mime_type: str, existing_tags: Sequence[str], existing_templates: Sequence[AITemplateCandidate] = ()) -> AIImageResult:
        return self.analyze_images(images=[AIInputImage(image_bytes, mime_type, 0)], existing_tags=existing_tags, existing_templates=existing_templates)

    def generate_captions(
        self,
        *,
        images: Sequence[AIInputImage],
        title: str,
        description: str | None,
        tags: Sequence[str],
        template: str | None,
        scene: str | None,
        tone: str | None,
        length: str | None,
        count: int,
    ) -> AICaptionResult:
        return self._caption_request(
            images=images,
            instruction=f"请生成 {count} 条彼此不同的候选文案。",
            context=self._caption_context(
                title=title,
                description=description,
                tags=tags,
                template=template,
                scene=scene,
                tone=tone,
                length=length,
            ),
        )

    def rewrite_caption(
        self,
        *,
        images: Sequence[AIInputImage],
        title: str,
        description: str | None,
        tags: Sequence[str],
        template: str | None,
        content: str,
        action: str,
        scene: str | None,
        tone: str | None,
        length: str | None,
    ) -> AICaptionResult:
        actions = {
            "polish": "润色",
            "shorten": "缩短",
            "expand": "扩写",
            "retone": "换一种语气",
        }
        return self._caption_request(
            images=images,
            instruction=(
                f"请对草稿执行“{actions[action]}”，只返回 1 条改写结果。\n"
                f"原草稿：{content}"
            ),
            context=self._caption_context(
                title=title,
                description=description,
                tags=tags,
                template=template,
                scene=scene,
                tone=tone,
                length=length,
            ),
        )

    def _caption_request(
        self,
        *,
        images: Sequence[AIInputImage],
        instruction: str,
        context: str,
    ) -> AICaptionResult:
        if not images:
            raise AIInvalidResponseError("At least one Meme image is required")
        image_parts: list[dict[str, object]] = []
        for image in sorted(images, key=lambda item: item.position):
            if len(images) > 1:
                image_parts.append(
                    {
                        "type": "text",
                        "text": f"完整 Meme 的第 {image.position + 1} 张图片：",
                    }
                )
            image_parts.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": (
                            f"data:{image.mime_type};base64,"
                            f"{base64.b64encode(image.image_bytes).decode('ascii')}"
                        )
                    },
                }
            )
        response = self._post(
            "/chat/completions",
            {
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            f"{CAPTION_SYSTEM_PROMPT} 必须只输出 JSON 对象："
                            '{"captions":["候选文案"]}'
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": context},
                            {"type": "text", "text": instruction},
                            *image_parts,
                        ],
                    },
                ],
                "response_format": {"type": "json_object"},
                "max_tokens": 2400,
            },
        )
        try:
            payload = response.json()
            if not isinstance(payload, dict):
                raise TypeError
            output_text = payload["choices"][0]["message"]["content"]
            if not isinstance(output_text, str):
                raise TypeError
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise AIInvalidResponseError(
                "AI service returned an invalid caption response"
            ) from error
        return self._parse_caption_result(payload, output_text)
