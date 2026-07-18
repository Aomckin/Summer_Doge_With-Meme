import asyncio

from httpx import ASGITransport, AsyncClient, Response

import app.main as main_module


def get(path: str) -> Response:
    async def request() -> Response:
        transport = ASGITransport(app=main_module.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path)

    return asyncio.run(request())


def test_health_check_returns_ok() -> None:
    assert hasattr(main_module, "app"), "FastAPI app has not been created"

    response = get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_swagger_ui_is_available() -> None:
    assert hasattr(main_module, "app"), "FastAPI app has not been created"

    response = get("/docs")

    assert response.status_code == 200
    assert "Swagger UI" in response.text
