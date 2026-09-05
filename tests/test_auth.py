import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.api.memes import download_meme
from app.auth import AuthSettings, _required_role, resolve_external_api_key
from app.main import create_app


def settings() -> AuthSettings:
    return AuthSettings("visitor-secret", "admin-secret", "session-secret")


async def make_client(tmp_path: Path) -> AsyncClient:
    app = create_app(
        tmp_path / "images",
        tmp_path / "thumbs",
        auth_settings=settings(),
        external_api_key="external-secret",
    )
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def run(coro):
    return asyncio.run(coro)


def test_login_session_logout_and_role_switch(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with await make_client(tmp_path) as client:
            assert (await client.get("/api/memes")).status_code == 401
            invalid = await client.post("/api/auth/login", json={"key": "wrong"})
            assert invalid.status_code == 401
            visitor = await client.post("/api/auth/login", json={"key": "visitor-secret"})
            assert visitor.json() == {"authenticated": True, "role": "visitor"}
            assert "HttpOnly" in visitor.headers["set-cookie"]
            assert "SameSite=strict" in visitor.headers["set-cookie"]
            assert "Secure" not in visitor.headers["set-cookie"]
            assert (await client.get("/api/auth/me")).json()["role"] == "visitor"
            assert (await client.get("/api/tags")).status_code == 200
            assert (await client.post("/api/semantic-search", json={})).status_code != 403
            assert (await client.post("/api/memes", files={})).status_code == 403
            assert (await client.post("/api/export-jobs", json={})).status_code == 403
            await client.post("/api/auth/logout")
            assert (await client.get("/api/memes")).status_code == 401
            admin = await client.post("/api/auth/login", json={"key": "admin-secret"})
            assert admin.json()["role"] == "admin"
            assert (await client.post("/api/memes", files={})).status_code != 403

    run(scenario())


def test_media_and_docs_are_protected(tmp_path: Path) -> None:
    async def scenario() -> None:
        async with await make_client(tmp_path) as client:
            assert (await client.get("/media/images/known.png")).status_code == 401
            assert (await client.get("/openapi.json")).status_code == 401
            await client.post("/api/auth/login", json={"key": "visitor-secret"})
            assert (await client.get("/media/images/known.png")).status_code == 404
            assert (await client.get("/openapi.json")).status_code == 403
            await client.post("/api/auth/logout")
            await client.post("/api/auth/login", json={"key": "admin-secret"})
            assert (await client.get("/openapi.json")).status_code == 200

    run(scenario())


def test_invalid_configuration_is_rejected() -> None:
    try:
        AuthSettings("same", "same", "secret")
    except ValueError as error:
        assert "different" in str(error)
    else:
        raise AssertionError("matching keys must be rejected")

    for reused_key in ("visitor-secret", "admin-secret"):
        with pytest.raises(ValueError, match="must differ"):
            resolve_external_api_key(settings(), reused_key)


def test_production_environment_requires_all_secrets_and_secure_cookie(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MEME_VAULT_ENV", "production")
    monkeypatch.setenv("VISITOR_ACCESS_KEY", "visitor-secret")
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "admin-secret")
    monkeypatch.setenv("SESSION_SECRET", "session-secret")

    settings_from_environment = AuthSettings.from_environment()

    assert settings_from_environment is not None
    assert settings_from_environment.secure_cookie is True

    for missing_name in (
        "VISITOR_ACCESS_KEY",
        "ADMIN_ACCESS_KEY",
        "SESSION_SECRET",
    ):
        monkeypatch.delenv(missing_name)
        with pytest.raises(RuntimeError):
            AuthSettings.from_environment()
        monkeypatch.setenv(
            missing_name,
            {
                "VISITOR_ACCESS_KEY": "visitor-secret",
                "ADMIN_ACCESS_KEY": "admin-secret",
                "SESSION_SECRET": "session-secret",
            }[missing_name],
        )


def test_production_login_sets_secure_session_cookie(tmp_path: Path) -> None:
    async def scenario() -> None:
        secure_settings = AuthSettings(
            "visitor-secret",
            "admin-secret",
            "session-secret",
            secure_cookie=True,
        )
        app = create_app(
            tmp_path / "images",
            tmp_path / "thumbs",
            auth_settings=secure_settings,
        )
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="https://public.example",
        ) as client:
            response = await client.post(
                "/api/auth/login",
                json={"key": "visitor-secret"},
            )
            cookie = response.headers["set-cookie"]
            assert "Secure" in cookie
            assert "HttpOnly" in cookie
            assert "SameSite=strict" in cookie

    run(scenario())


def test_permission_policy_covers_read_write_and_sensitive_routes() -> None:
    assert _required_role("/api/memes/random", "GET") == "external"
    assert _required_role("/api/memes/library-random", "GET") == "authenticated"
    assert _required_role("/api/memes/semantic", "GET") == "external"
    assert _required_role("/api/memes/123/image", "GET") == "external"
    assert _required_role("/api/memes/1/similar", "GET") == "authenticated"
    assert _required_role("/api/semantic-search", "POST") == "authenticated"
    assert _required_role("/api/memes/1", "PATCH") == "admin"
    assert _required_role("/api/memes/1/collections", "GET") == "admin"
    assert _required_role("/api/export-jobs/1/download", "GET") == "admin"
    assert _required_role("/media/images/private.gif", "GET") == "authenticated"


def test_web_sessions_do_not_authenticate_external_api_and_bearer_cannot_write(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        async with await make_client(tmp_path) as client:
            external = {"Authorization": "Bearer external-secret"}
            assert (await client.get("/api/memes/random")).status_code == 401
            assert (await client.get(
                "/api/memes/random",
                headers={"Authorization": "Bearer wrong"},
            )).status_code == 401
            assert (await client.get(
                "/api/memes/random",
                headers={"Authorization": "Bearer visitor-secret"},
            )).status_code == 401
            assert (await client.get(
                "/api/memes/random",
                headers={"Authorization": "Bearer admin-secret"},
            )).status_code == 401

            visitor = await client.post(
                "/api/auth/login", json={"key": "visitor-secret"}
            )
            assert visitor.status_code == 200
            assert (await client.get("/api/memes/random")).status_code == 401
            assert (await client.post(
                "/api/memes", headers=external, files={}
            )).status_code == 403

            await client.post("/api/auth/logout")
            admin = await client.post(
                "/api/auth/login", json={"key": "admin-secret"}
            )
            assert admin.status_code == 200
            assert (await client.get("/api/memes/random")).status_code == 401
            assert (await client.get(
                "/api/memes/not-an-id/image", headers=external
            )).status_code == 422

        async with await make_client(tmp_path / "bearer-only") as client:
            assert (await client.post(
                "/api/memes", headers=external, files={}
            )).status_code == 401

    run(scenario())


def test_visitor_cannot_turn_multi_image_download_into_zip() -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(auth_role="visitor"),
        app=SimpleNamespace(state=SimpleNamespace()),
    )
    service = SimpleNamespace(
        get_meme=lambda _meme_id: SimpleNamespace(images=[object(), object()]),
    )
    with pytest.raises(HTTPException) as caught:
        download_meme(1, request, service)
    assert caught.value.status_code == 403
