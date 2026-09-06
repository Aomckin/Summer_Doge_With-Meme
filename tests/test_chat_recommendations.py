import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.ai.client import AIConfigurationError
from app.api.recommendations import get_service, router
from app.schemas.recommendation import ChatRecommendationRequest
from app.services.chat_recommendation_service import (
    ChatRecommendationService,
    build_scene_query,
)
from app.services.semantic_search_service import MemeEmbeddingUnavailableError


def response_meme(meme_id: int = 1) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=meme_id,
        title="无语",
        description="聊天回应",
        source=None,
        original_filename="reaction.png",
        stored_filename="reaction.png",
        file_path="reaction.png",
        thumbnail_path=None,
        mime_type="image/png",
        file_size=10,
        width=10,
        height=10,
        file_hash="a" * 64,
        created_at=now,
        updated_at=now,
        tags=[],
        template=None,
        images=[],
        vault=None,
    )


def send(payload: dict[str, object], service: object):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_service] = lambda: service

    async def request():
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.post("/api/meme-recommendations/chat", json=payload)

    return asyncio.run(request())


def test_scene_query_handles_context_only_and_prioritizes_intent() -> None:
    context_only = build_scene_query("  朋友：又迟到了  ")
    assert context_only.startswith("聊天场景：\n朋友：又迟到了")
    assert "Reaction Meme" in context_only

    with_intent = build_scene_query(" 朋友：面试挂了 ", "  损友式嘲笑 ")
    assert with_intent.startswith("回应意图（优先匹配）：\n损友式嘲笑")
    assert with_intent.index("回应意图") < with_intent.index("聊天场景")
    assert with_intent.endswith("聊天场景：\n朋友：面试挂了")

    with pytest.raises(ValueError, match="context"):
        build_scene_query("   ")


def test_request_normalizes_inputs_and_rejects_invalid_lengths() -> None:
    request = ChatRecommendationRequest(
        context="  最近几句聊天  ", response_intent="   "
    )
    assert request.context == "最近几句聊天"
    assert request.response_intent is None
    assert request.page_size == 12

    for payload in (
        {"context": "   "},
        {"context": "聊" * 4001},
        {"context": "聊天", "response_intent": "回" * 201},
    ):
        with pytest.raises(ValidationError):
            ChatRecommendationRequest.model_validate(payload)


def test_service_only_delegates_to_existing_semantic_search() -> None:
    semantic = SimpleNamespace(search=lambda **kwargs: kwargs)
    result = ChatRecommendationService(semantic).recommend(
        context=" 聊天内容 ",
        response_intent=" 阴阳怪气 ",
        page=3,
        page_size=12,
    )
    assert result == {
        "query": "回应意图（优先匹配）：\n阴阳怪气\n\n聊天场景：\n聊天内容",
        "tags": [],
        "template_id": None,
        "page": 3,
        "page_size": 12,
        "vault_id": None,
    }


def test_chat_recommendation_api_returns_scored_memes_without_extra_work() -> None:
    calls: list[dict[str, object]] = []

    def recommend(**kwargs):
        calls.append(kwargs)
        return {
            "hits": [(response_meme(), 0.81)],
            "total": 13,
            "page": 2,
            "page_size": 12,
            "total_pages": 2,
            "indexed_count": 20,
            "missing_count": 1,
            "model_id": "qwen3-vl-embedding",
        }

    response = send(
        {
            "context": "  最近聊天  ",
            "response_intent": "  看戏  ",
            "page": 2,
            "page_size": 12,
        },
        SimpleNamespace(recommend=recommend),
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["meme"]["title"] == "无语"
    assert calls == [
        {
            "context": "最近聊天",
            "response_intent": "看戏",
            "page": 2,
            "page_size": 12,
        }
    ]


@pytest.mark.parametrize(
    "error",
    [
        AIConfigurationError("Embedding Provider is not configured"),
        MemeEmbeddingUnavailableError("Semantic index is unavailable"),
    ],
)
def test_chat_recommendation_api_reuses_semantic_unavailable_errors(error) -> None:
    def recommend(**_kwargs):
        raise error

    response = send({"context": "最近聊天"}, SimpleNamespace(recommend=recommend))
    assert response.status_code == 503
    assert response.json()["detail"] == str(error)


def test_chat_recommendation_api_rejects_empty_context_before_service() -> None:
    service = SimpleNamespace(recommend=lambda **_kwargs: pytest.fail("must not run"))
    response = send({"context": "   "}, service)
    assert response.status_code == 422
