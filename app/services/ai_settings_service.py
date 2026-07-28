import time
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.client import (
    AIClient,
    AIConfigurationError,
    AIRequestTimeoutError,
    AIUpstreamError,
    OpenAICompatibleChatClient,
    OpenAIResponsesClient,
)
from app.ai.embedding_client import DashScopeEmbeddingClient, ImageEmbeddingClient
from app.ai.presets import PROVIDER_PRESETS, get_preset
from app.ai.secrets import APIKeyCipher
from app.models.ai_settings import AIModel, AIProvider
from app.repositories.ai_settings_repository import AISettingsRepository


class AISettingsNotFoundError(LookupError):
    pass


class AISettingsConflictError(RuntimeError):
    pass


class AISettingsValidationError(ValueError):
    pass


class AISettingsService:
    def __init__(
        self,
        session: Session,
        key_file: Path,
        *,
        environ: dict[str, str] | None = None,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.session = session
        self.repository = AISettingsRepository(session)
        self.cipher = APIKeyCipher(key_file, environ=environ)
        self.environ = environ
        self.http_client = http_client

    def list_providers(self) -> list[AIProvider]:
        return self.repository.list_providers()

    def list_models(self) -> list[AIModel]:
        return self.repository.list_models()

    def create_provider(self, values: Mapping[str, object]) -> AIProvider:
        data = dict(values)
        preset_id = str(data.pop("preset_id", "") or "")
        api_key = data.pop("api_key", None)
        data["name"] = self._required_text(data.get("name"), "名称")
        data["base_url"] = self._valid_base_url(data.get("base_url"))
        if api_key:
            data.update(self._encrypted_key(str(api_key)))
        provider = self.repository.create_provider(**data)

        preset = get_preset(preset_id) if preset_id else None
        if preset is not None:
            for model in preset["models"]:
                assert isinstance(model, dict)
                self.repository.create_model(
                    provider_id=provider.id,
                    model_id=model["model_id"],
                    display_name=model["display_name"],
                    supports_vision=model["supports_vision"],
                    supports_image_embedding=model.get("supports_image_embedding", False),
                    enabled=True,
                    is_active=False,
                )
        self._commit()
        return provider

    def update_provider(
        self,
        provider_id: int,
        values: Mapping[str, object],
    ) -> AIProvider:
        provider = self._provider(provider_id)
        data = dict(values)
        if "name" in data:
            data["name"] = self._required_text(data["name"], "名称")
        if "base_url" in data:
            data["base_url"] = self._valid_base_url(data["base_url"])
        if "api_key" in data:
            api_key = data.pop("api_key")
            if api_key is None:
                provider.api_key_ciphertext = None
                provider.api_key_hint = None
            elif not str(api_key).strip():
                raise AISettingsValidationError(
                    "API Key 不能为空；不修改时请省略，清除时请发送 null"
                )
            else:
                for key, value in self._encrypted_key(str(api_key)).items():
                    setattr(provider, key, value)
        for key, value in data.items():
            setattr(provider, key, value)
        if not provider.enabled:
            for model in provider.models:
                model.is_active = False
        self._commit()
        return provider

    def delete_provider(self, provider_id: int) -> None:
        provider = self._provider(provider_id)
        self.session.delete(provider)
        self._commit()

    def create_model(self, values: Mapping[str, object]) -> AIModel:
        data = dict(values)
        provider = self._provider(int(data["provider_id"]))
        data["model_id"] = self._required_text(data.get("model_id"), "模型标识")
        data["display_name"] = self._required_text(
            data.get("display_name"),
            "模型名称",
        )
        activate = bool(data.pop("is_active", False))
        model = self.repository.create_model(**data, is_active=False)
        if activate:
            self._activate(model, provider)
        self._commit()
        return model

    def update_model(
        self,
        model_id: int,
        values: Mapping[str, object],
    ) -> AIModel:
        model = self._model(model_id)
        data = dict(values)
        activate = data.pop("is_active", None)
        activate_embedding = data.pop("is_embedding_active", None)
        for key in ("model_id", "display_name"):
            if key in data:
                data[key] = self._required_text(data[key], key)
        for key, value in data.items():
            setattr(model, key, value)
        if activate is True:
            self._activate(model, model.provider)
        elif activate is False:
            model.is_active = False
        elif model.is_active and (
            not model.enabled
            or not model.supports_vision
            or not model.provider.enabled
        ):
            model.is_active = False
        if activate_embedding is True:
            self._activate_embedding(model, model.provider)
        elif activate_embedding is False:
            model.is_embedding_active = False
        elif model.is_embedding_active and (
            not model.enabled
            or not model.supports_image_embedding
            or not model.provider.enabled
        ):
            model.is_embedding_active = False
        self._commit()
        return model

    def delete_model(self, model_id: int) -> None:
        model = self._model(model_id)
        self.session.delete(model)
        self._commit()

    def test_provider(self, provider_id: int) -> list[str]:
        provider = self._provider(provider_id)
        return self._fetch_model_ids(provider)

    def refresh_models(self, provider_id: int) -> list[AIModel]:
        provider = self._provider(provider_id)
        model_ids = self._fetch_model_ids(provider)
        for external_id in model_ids:
            if self.repository.get_model_by_external_id(
                provider.id,
                external_id,
            ):
                continue
            self.repository.create_model(
                provider_id=provider.id,
                model_id=external_id,
                display_name=external_id,
                supports_vision=self._known_vision_model(
                    provider,
                    external_id,
                ),
                supports_image_embedding=False,
                enabled=False,
                is_active=False,
            )
        self._commit()
        return self.repository.list_models()

    def build_active_client(self) -> AIClient:
        model = self.repository.active_model()
        if model is None:
            return OpenAIResponsesClient.from_env(self.environ)
        provider = model.provider
        if not provider.enabled or not model.enabled or not model.supports_vision:
            raise AIConfigurationError(
                "当前启用的模型不能用于图片分析，请检查 API 设置"
            )
        if not provider.api_key_ciphertext:
            raise AIConfigurationError(
                f"厂商 {provider.name} 尚未配置 API Key"
            )
        api_key = self.cipher.decrypt(provider.api_key_ciphertext)
        options = {
            "api_key": api_key,
            "model": model.model_id,
            "base_url": provider.base_url,
            "timeout_seconds": provider.timeout_seconds,
            "max_retries": provider.max_retries,
            "retry_delay_seconds": provider.retry_delay_seconds,
        }
        if provider.protocol == "openai_responses":
            return OpenAIResponsesClient(**options)
        if provider.protocol == "openai_chat_completions":
            return OpenAICompatibleChatClient(**options)
        raise AIConfigurationError(
            f"不支持的厂商协议：{provider.protocol}"
        )

    def build_active_embedding_client(self) -> ImageEmbeddingClient:
        model = self.repository.active_embedding_model()
        if model is None:
            raise AIConfigurationError("尚未配置模板视觉检索模型")
        provider = model.provider
        if not provider.enabled or not model.enabled or not model.supports_image_embedding:
            raise AIConfigurationError("当前模型不能用于模板视觉检索")
        if not provider.api_key_ciphertext:
            raise AIConfigurationError(f"厂商 {provider.name} 尚未配置 API Key")
        if provider.protocol != "dashscope_multimodal_embedding":
            raise AIConfigurationError(f"不支持的图像向量协议：{provider.protocol}")
        return DashScopeEmbeddingClient(
            api_key=self.cipher.decrypt(provider.api_key_ciphertext),
            model=model.model_id,
            base_url=provider.base_url,
            timeout_seconds=provider.timeout_seconds,
            http_client=self.http_client,
        )

    def _fetch_model_ids(self, provider: AIProvider) -> list[str]:
        if not provider.api_key_ciphertext:
            raise AISettingsValidationError("请先配置 API Key")
        api_key = self.cipher.decrypt(provider.api_key_ciphertext)
        last_error: Exception | None = None
        for attempt in range(provider.max_retries + 1):
            try:
                if self.http_client is not None:
                    response = self.http_client.get(
                        f"{provider.base_url.rstrip('/')}/models",
                        headers={"Authorization": f"Bearer {api_key}"},
                        timeout=provider.timeout_seconds,
                    )
                else:
                    with httpx.Client() as client:
                        response = client.get(
                            f"{provider.base_url.rstrip('/')}/models",
                            headers={"Authorization": f"Bearer {api_key}"},
                            timeout=provider.timeout_seconds,
                        )
            except httpx.TimeoutException as error:
                last_error = error
                if attempt >= provider.max_retries:
                    raise AIRequestTimeoutError(
                        "连接测试超时"
                    ) from error
            except httpx.RequestError as error:
                last_error = error
                if attempt >= provider.max_retries:
                    raise AIUpstreamError(
                        "无法连接模型厂商"
                    ) from error
            else:
                if not response.is_error:
                    return self._parse_model_ids(response)
                if (
                    response.status_code != 429
                    and response.status_code < 500
                ) or attempt >= provider.max_retries:
                    raise AIUpstreamError(
                        f"模型厂商返回 HTTP {response.status_code}"
                    )
            if provider.retry_delay_seconds:
                time.sleep(provider.retry_delay_seconds * (attempt + 1))
        raise AIUpstreamError("无法连接模型厂商") from last_error

    @staticmethod
    def _parse_model_ids(response: httpx.Response) -> list[str]:
        try:
            payload = response.json()
            items = payload["data"]
            model_ids = [
                str(item["id"]).strip()
                for item in items
                if isinstance(item, dict) and str(item.get("id", "")).strip()
            ]
        except (KeyError, TypeError, ValueError) as error:
            raise AIUpstreamError("模型厂商返回了无效的模型列表") from error
        return sorted(set(model_ids))

    @staticmethod
    def _known_vision_model(provider: AIProvider, model_id: str) -> bool:
        for preset in PROVIDER_PRESETS:
            if (
                preset["protocol"] != provider.protocol
                or preset["base_url"] != provider.base_url
            ):
                continue
            for model in preset["models"]:
                if model["model_id"] == model_id:
                    return bool(model["supports_vision"])
        lowered = model_id.lower()
        return (
            lowered.startswith(("gpt-5", "gpt-4.1", "gpt-4o"))
            or lowered.startswith(("qwen3.7-", "qwen3.6-", "qwen3.5-"))
            or "-vl" in lowered
        )

    def _activate(self, model: AIModel, provider: AIProvider) -> None:
        if not provider.enabled:
            raise AISettingsValidationError("请先启用该模型厂商")
        if not model.enabled:
            raise AISettingsValidationError("请先启用该模型")
        if not model.supports_vision:
            raise AISettingsValidationError(
                "该模型未标记为支持视觉，不能用于图片分析"
            )
        self.repository.clear_active_models()
        model.is_active = True

    def _activate_embedding(self, model: AIModel, provider: AIProvider) -> None:
        if not provider.enabled or not model.enabled:
            raise AISettingsValidationError("请先启用该模型厂商和模型")
        if not model.supports_image_embedding:
            raise AISettingsValidationError("该模型不支持图像向量")
        self.repository.clear_active_embedding_models()
        model.is_embedding_active = True

    def _provider(self, provider_id: int) -> AIProvider:
        provider = self.repository.get_provider(provider_id)
        if provider is None:
            raise AISettingsNotFoundError(
                f"模型厂商 {provider_id} 不存在"
            )
        return provider

    def _model(self, model_id: int) -> AIModel:
        model = self.repository.get_model(model_id)
        if model is None:
            raise AISettingsNotFoundError(f"模型 {model_id} 不存在")
        return model

    def _encrypted_key(self, value: str) -> dict[str, str]:
        key = value.strip()
        if not key:
            raise AISettingsValidationError("API Key 不能为空")
        hint = f"••••{key[-4:]}" if len(key) >= 4 else "••••"
        return {
            "api_key_ciphertext": self.cipher.encrypt(key),
            "api_key_hint": hint,
        }

    @staticmethod
    def _required_text(value: object, field: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise AISettingsValidationError(f"{field}不能为空")
        return text

    @staticmethod
    def _valid_base_url(value: object) -> str:
        url = str(value or "").strip().rstrip("/")
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise AISettingsValidationError(
                "基础 URL 必须是有效的 HTTP(S) 地址，且不能包含认证、查询或片段"
            )
        return url

    def _commit(self) -> None:
        try:
            self.session.commit()
        except IntegrityError as error:
            self.session.rollback()
            raise AISettingsConflictError(
                "名称或模型标识已存在"
            ) from error
