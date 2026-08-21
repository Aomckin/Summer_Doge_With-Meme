"""Access-key login, opaque server-side sessions, and centralized authorization."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse


LOGGER = logging.getLogger("meme_vault.auth")
Role = Literal["visitor", "admin"]
SESSION_COOKIE = "meme_vault_session"


@dataclass(frozen=True)
class AuthSettings:
    visitor_key: str
    admin_key: str
    session_secret: str
    secure_cookie: bool = False
    session_ttl_seconds: int = 60 * 60 * 24 * 7

    def __post_init__(self) -> None:
        if not self.visitor_key or not self.admin_key or not self.session_secret:
            raise ValueError("Access keys and session secret must not be empty")
        if hmac.compare_digest(self.visitor_key, self.admin_key):
            raise ValueError("Visitor and admin access keys must be different")

    @classmethod
    def from_environment(cls) -> AuthSettings | None:
        values = {
            "visitor_key": os.getenv("VISITOR_ACCESS_KEY", ""),
            "admin_key": os.getenv("ADMIN_ACCESS_KEY", ""),
            "session_secret": os.getenv("SESSION_SECRET", ""),
        }
        configured = [bool(value) for value in values.values()]
        production = os.getenv("MEME_VAULT_ENV", "development").lower() == "production"
        if not any(configured):
            if production:
                raise RuntimeError("Access keys are not configured for production")
            LOGGER.warning("Access control is disabled because access keys are not configured")
            return None
        if not all(configured):
            raise RuntimeError(
                "VISITOR_ACCESS_KEY, ADMIN_ACCESS_KEY and SESSION_SECRET must be configured together"
            )
        return cls(**values, secure_cookie=production)


@dataclass
class SessionRecord:
    role: Role
    expires_at: float


class SessionStore:
    def __init__(self, secret: str, ttl_seconds: int) -> None:
        self._secret = secret.encode("utf-8")
        self._ttl_seconds = ttl_seconds
        self._sessions: dict[str, SessionRecord] = {}

    def _signature(self, session_id: str) -> str:
        return hmac.new(self._secret, session_id.encode("ascii"), hashlib.sha256).hexdigest()

    def create(self, role: Role) -> str:
        session_id = secrets.token_urlsafe(32)
        self._sessions[session_id] = SessionRecord(
            role=role,
            expires_at=time.time() + self._ttl_seconds,
        )
        return f"{session_id}.{self._signature(session_id)}"

    def resolve(self, token: str | None) -> Role | None:
        if not token:
            return None
        try:
            session_id, signature = token.rsplit(".", 1)
        except ValueError:
            return None
        if not hmac.compare_digest(signature, self._signature(session_id)):
            return None
        record = self._sessions.get(session_id)
        if record is None:
            return None
        if record.expires_at <= time.time():
            self._sessions.pop(session_id, None)
            return None
        return record.role

    def destroy(self, token: str | None) -> None:
        if not token:
            return
        session_id = token.rsplit(".", 1)[0]
        self._sessions.pop(session_id, None)


class LoginPayload(BaseModel):
    key: str = Field(min_length=1, max_length=4096)


class AuthResponse(BaseModel):
    authenticated: bool
    role: Role | None


def _required_role(path: str, method: str) -> Literal["public", "authenticated", "admin"]:
    if path in {"/api/health"} or path.startswith("/api/auth/"):
        return "public"
    if path in {"/docs", "/redoc", "/openapi.json"}:
        return "admin"
    if path == "/mobile" or path.startswith("/api/import-jobs"):
        return "admin"
    if path.startswith((
        "/api/export-jobs",
        "/api/embedding-jobs",
        "/api/enrichment-",
        "/api/ai-settings",
        "/api/similarity-inspection",
        "/api/meme-similarity-ignores",
        "/api/collections",
    )):
        return "admin"
    if path == "/api/semantic-index/status":
        return "admin"
    if path.startswith("/api/memes/") and path.endswith("/collections"):
        return "admin"
    if path.startswith("/media/"):
        return "authenticated"
    if not path.startswith("/api/"):
        return "public"
    if method in {"GET", "HEAD", "OPTIONS"}:
        return "authenticated"
    if path in {"/api/semantic-search", "/api/meme-recommendations/chat"} and method == "POST":
        return "authenticated"
    return "admin"


class AuthorizationMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, store: SessionStore) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.store = store

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        role = self.store.resolve(request.cookies.get(SESSION_COOKIE))
        request.state.auth_role = role
        required = _required_role(request.url.path, request.method)
        if required != "public" and role is None:
            return JSONResponse({"detail": "Authentication required"}, status_code=401)
        if required == "admin" and role != "admin":
            return JSONResponse({"detail": "Admin access required"}, status_code=403)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            fetch_site = request.headers.get("sec-fetch-site", "")
            if fetch_site == "cross-site":
                return JSONResponse({"detail": "Cross-site request rejected"}, status_code=403)
        return await call_next(request)


def build_auth_router(settings: AuthSettings, store: SessionStore) -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    @router.post("/login", response_model=AuthResponse)
    def login(payload: LoginPayload, response: Response) -> AuthResponse:
        role: Role | None = None
        if hmac.compare_digest(payload.key, settings.admin_key):
            role = "admin"
        elif hmac.compare_digest(payload.key, settings.visitor_key):
            role = "visitor"
        if role is None:
            LOGGER.info("Login failed")
            raise HTTPException(status_code=401, detail="Invalid access key")
        token = store.create(role)
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=settings.session_ttl_seconds,
            httponly=True,
            secure=settings.secure_cookie,
            samesite="strict",
            path="/",
        )
        LOGGER.info("%s login success", role.capitalize())
        return AuthResponse(authenticated=True, role=role)

    @router.get("/me", response_model=AuthResponse)
    def me(request: Request) -> AuthResponse:
        role = store.resolve(request.cookies.get(SESSION_COOKIE))
        return AuthResponse(authenticated=role is not None, role=role)

    @router.post("/logout", response_model=AuthResponse)
    def logout(request: Request, response: Response) -> AuthResponse:
        store.destroy(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(SESSION_COOKIE, path="/", samesite="strict")
        LOGGER.info("Logout")
        return AuthResponse(authenticated=False, role=None)

    return router
