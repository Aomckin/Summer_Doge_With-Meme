import asyncio
from pathlib import Path

import httpx
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.ai.client import OpenAICompatibleChatClient
from app.database import Base, get_db
from app.main import create_app
from app.models.ai_settings import AIModel, AIProvider
from app.services.ai_settings_service import AISettingsService


def request(app, method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def settings_context(tmp_path: Path):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    key_file = tmp_path / "settings.key"
    app = create_app(
        tmp_path / "images",
        tmp_path / "thumbnails",
        tmp_path / "frontend",
        key_file,
    )
    app.dependency_overrides[get_db] = lambda: session
    return app, session, key_file


def qwen_provider_payload() -> dict[str, object]:
    return {
        "preset_id": "qwen",
        "name": "Qwen",
        "protocol": "openai_chat_completions",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key": "sk-test-secret-1234",
        "timeout_seconds": 45,
        "max_retries": 2,
        "retry_delay_seconds": 0,
        "enabled": True,
    }


def test_presets_include_openai_qwen_and_text_only_deepseek(
    tmp_path: Path,
) -> None:
    app, session, _ = settings_context(tmp_path)

    response = request(app, "GET", "/api/ai-settings/presets")

    assert response.status_code == 200
    presets = {item["id"]: item for item in response.json()}
    assert set(presets) == {"openai", "qwen", "deepseek"}
    assert presets["openai"]["base_url"] == "https://api.openai.com/v1"
    assert any(
        model["supports_vision"] for model in presets["qwen"]["models"]
    )
    assert not any(
        model["supports_vision"] for model in presets["deepseek"]["models"]
    )
    session.close()


def test_provider_api_encrypts_key_and_never_returns_plaintext(
    tmp_path: Path,
) -> None:
    app, session, key_file = settings_context(tmp_path)

    created = request(
        app,
        "POST",
        "/api/ai-settings/providers",
        json=qwen_provider_payload(),
    )
    listed = request(app, "GET", "/api/ai-settings/providers")

    assert created.status_code == 201
    body = created.json()
    assert body["has_api_key"] is True
    assert body["api_key_hint"] == "••••1234"
    assert "api_key" not in body
    assert "secret" not in created.text
    assert len(listed.json()) == 1
    assert listed.json()[0]["id"] == body["id"]
    assert listed.json()[0]["api_key_hint"] == "••••1234"

    provider = session.scalar(select(AIProvider))
    assert provider is not None
    assert provider.api_key_ciphertext
    assert "sk-test-secret" not in provider.api_key_ciphertext
    assert key_file.is_file()
    assert (
        Fernet(key_file.read_bytes().strip())
        .decrypt(provider.api_key_ciphertext.encode("ascii"))
        .decode("utf-8")
        == "sk-test-secret-1234"
    )
    models = session.scalars(
        select(AIModel).where(AIModel.provider_id == provider.id)
    ).all()
    assert {model.model_id for model in models} == {
        "qwen3.7-plus",
        "qwen3.6-plus",
        "qwen3.6-flash",
    }
    session.close()


def test_provider_patch_preserves_key_unless_null_is_sent(
    tmp_path: Path,
) -> None:
    app, session, _ = settings_context(tmp_path)
    provider_id = request(
        app,
        "POST",
        "/api/ai-settings/providers",
        json=qwen_provider_payload(),
    ).json()["id"]

    renamed = request(
        app,
        "PATCH",
        f"/api/ai-settings/providers/{provider_id}",
        json={"name": "Qwen 主账号"},
    )
    cleared = request(
        app,
        "PATCH",
        f"/api/ai-settings/providers/{provider_id}",
        json={"api_key": None},
    )

    assert renamed.json()["has_api_key"] is True
    assert cleared.json()["has_api_key"] is False
    assert cleared.json()["api_key_hint"] is None
    session.close()


def test_only_enabled_vision_model_can_be_activated(
    tmp_path: Path,
) -> None:
    app, session, key_file = settings_context(tmp_path)
    qwen_id = request(
        app,
        "POST",
        "/api/ai-settings/providers",
        json=qwen_provider_payload(),
    ).json()["id"]
    deepseek_payload = {
        **qwen_provider_payload(),
        "preset_id": "deepseek",
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
    }
    deepseek_id = request(
        app,
        "POST",
        "/api/ai-settings/providers",
        json=deepseek_payload,
    ).json()["id"]
    models = request(app, "GET", "/api/ai-settings/models").json()
    deepseek_model = next(
        item for item in models if item["provider_id"] == deepseek_id
    )
    qwen_model = next(
        item for item in models if item["provider_id"] == qwen_id
    )

    rejected = request(
        app,
        "PATCH",
        f"/api/ai-settings/models/{deepseek_model['id']}",
        json={"is_active": True},
    )
    activated = request(
        app,
        "PATCH",
        f"/api/ai-settings/models/{qwen_model['id']}",
        json={"is_active": True},
    )

    assert rejected.status_code == 422
    assert "视觉" in rejected.json()["detail"]
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True
    service = AISettingsService(session, key_file)
    client = service.build_active_client()
    assert isinstance(client, OpenAICompatibleChatClient)
    assert client.model == qwen_model["model_id"]
    assert client.api_key == "sk-test-secret-1234"

    disabled = request(
        app,
        "PATCH",
        f"/api/ai-settings/providers/{qwen_id}",
        json={"enabled": False},
    )
    models_after_disable = request(
        app,
        "GET",
        "/api/ai-settings/models",
    ).json()

    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert not any(item["is_active"] for item in models_after_disable)
    session.close()


def test_connection_test_and_refresh_import_new_models(
    tmp_path: Path,
) -> None:
    app, session, key_file = settings_context(tmp_path)
    provider_id = request(
        app,
        "POST",
        "/api/ai-settings/providers",
        json={
            **qwen_provider_payload(),
            "preset_id": None,
            "name": "Custom",
            "base_url": "https://models.example/v1",
        },
    ).json()["id"]

    def handler(request_: httpx.Request) -> httpx.Response:
        assert str(request_.url) == "https://models.example/v1/models"
        assert request_.headers["authorization"] == (
            "Bearer sk-test-secret-1234"
        )
        return httpx.Response(
            200,
            json={
                "object": "list",
                "data": [
                    {"id": "custom-vision", "object": "model"},
                    {"id": "custom-text", "object": "model"},
                ],
            },
        )

    from app.api import ai_settings as settings_api

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        service = AISettingsService(
            session,
            key_file,
            http_client=http_client,
        )
        app.dependency_overrides[
            settings_api.get_ai_settings_service
        ] = lambda: service
        tested = request(
            app,
            "POST",
            f"/api/ai-settings/providers/{provider_id}/test",
        )
        refreshed = request(
            app,
            "POST",
            f"/api/ai-settings/providers/{provider_id}/refresh-models",
        )

    assert tested.json() == {
        "ok": True,
        "message": "连接成功",
        "model_count": 2,
    }
    assert {item["model_id"] for item in refreshed.json()} == {
        "custom-text",
        "custom-vision",
    }
    assert not any(item["enabled"] for item in refreshed.json())
    session.close()
