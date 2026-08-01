import asyncio
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.ai.client import AICaptionResult, AIInputImage, AIInvalidResponseError
from app.api.captions import get_caption_service
from app.api.memes import get_ai_client, get_meme_service
from app.database import Base, get_db
from app.main import create_app
from app.models.caption import Caption
from app.services.caption_service import CaptionService
from app.services.meme_service import MemeService
from app.storage.image_storage import ImageStorage


def request(app, method: str, path: str, **kwargs: object) -> Response:
    async def send() -> Response:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def make_image_bytes(color: str = "purple") -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (320, 240), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def create_services(tmp_path: Path) -> tuple[MemeService, CaptionService, Session]:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    return MemeService(session, storage), CaptionService(session, storage), session


class FakeCaptionAIClient:
    def __init__(self, results: tuple[str, ...]) -> None:
        self.results = results
        self.generate_calls: list[dict[str, object]] = []
        self.rewrite_calls: list[dict[str, object]] = []

    def generate_captions(self, **kwargs: object) -> AICaptionResult:
        self.generate_calls.append(kwargs)
        return AICaptionResult(model_name="vision-test", captions=self.results)

    def rewrite_caption(self, **kwargs: object) -> AICaptionResult:
        self.rewrite_calls.append(kwargs)
        return AICaptionResult(
            model_name="vision-test",
            captions=self.results[:1],
        )


def test_caption_crud_is_scoped_to_meme_and_preserves_source(tmp_path: Path) -> None:
    meme_service, service, session = create_services(tmp_path)
    try:
        first = meme_service.create_meme(
            "first.png",
            make_image_bytes(),
            title="第一张",
        )
        second = meme_service.create_meme(
            "second.png",
            make_image_bytes("blue"),
            title="第二张",
        )

        older = service.create_caption(
            first.id,
            content="  手写文案  ",
            scene="  群聊  ",
            tone="吐槽",
            length="short",
            source="manual",
        )
        newer = service.create_caption(
            first.id,
            content="AI 候选",
            source="ai",
        )
        service.create_caption(second.id, content="另一张的文案", source="manual")
        updated = service.update_caption(
            first.id,
            newer.id,
            {"content": "  修改后的 AI 文案  ", "tone": "冷幽默"},
        )

        assert older.content == "手写文案"
        assert older.scene == "群聊"
        assert updated.content == "修改后的 AI 文案"
        assert updated.source == "ai"
        assert [item.id for item in service.list_captions(first.id)] == [
            newer.id,
            older.id,
        ]

        service.delete_caption(first.id, older.id)
        assert session.get(Caption, older.id) is None
        assert session.scalar(select(func.count()).select_from(Caption)) == 2
    finally:
        session.close()


def test_deleting_meme_cascades_to_captions(tmp_path: Path) -> None:
    meme_service, service, session = create_services(tmp_path)
    try:
        meme = meme_service.create_meme(
            "delete.png",
            make_image_bytes(),
            title="待删除",
        )
        caption = service.create_caption(
            meme.id,
            content="会一起删除",
            source="manual",
        )

        meme_service.delete_meme(meme.id)

        assert session.get(Caption, caption.id) is None
    finally:
        session.close()


def test_generate_uses_all_ordered_images_and_normalizes_candidates(
    tmp_path: Path,
) -> None:
    meme_service, service, session = create_services(tmp_path)
    try:
        meme = meme_service.create_meme(
            "first.png",
            make_image_bytes(),
            title="复合 Meme",
            description="上下文",
            tags=["反应图"],
        )
        meme_service.append_image(
            meme.id,
            "second.png",
            make_image_bytes("blue"),
        )
        client = FakeCaptionAIClient(
            ("  第一条  ", "第一条", "", "第二条", "第三条"),
        )

        result = service.generate_captions(
            meme.id,
            client,
            count=3,
            scene="群聊",
            tone="冷幽默",
            length="short",
        )

        call = client.generate_calls[0]
        images = call["images"]
        assert isinstance(images, list)
        assert all(isinstance(image, AIInputImage) for image in images)
        assert [image.position for image in images] == [0, 1]
        assert call["title"] == "复合 Meme"
        assert call["description"] == "上下文"
        assert call["tags"] == ["反应图"]
        assert call["scene"] == "群聊"
        assert result.captions == ("第一条", "第二条", "第三条")
        assert session.scalar(select(func.count()).select_from(Caption)) == 0
    finally:
        session.close()


@pytest.mark.parametrize("count", [3, 5, 8])
def test_generate_accepts_supported_candidate_counts(
    tmp_path: Path,
    count: int,
) -> None:
    meme_service, service, session = create_services(tmp_path)
    try:
        meme = meme_service.create_meme(
            "count.png",
            make_image_bytes(),
            title="数量",
        )
        values = tuple(f"候选 {index}" for index in range(count))
        result = service.generate_captions(
            meme.id,
            FakeCaptionAIClient(values),
            count=count,
        )
        assert len(result.captions) == count
    finally:
        session.close()


def test_generate_rejects_invalid_or_insufficient_ai_results(
    tmp_path: Path,
) -> None:
    meme_service, service, session = create_services(tmp_path)
    try:
        meme = meme_service.create_meme(
            "invalid.png",
            make_image_bytes(),
            title="异常",
        )
        with pytest.raises(AIInvalidResponseError, match="unique captions"):
            service.generate_captions(
                meme.id,
                FakeCaptionAIClient(("重复", "重复", "")),
                count=3,
            )
    finally:
        session.close()


def test_rewrite_rejects_blank_draft_without_calling_ai(tmp_path: Path) -> None:
    meme_service, service, session = create_services(tmp_path)
    try:
        meme = meme_service.create_meme(
            "rewrite.png",
            make_image_bytes(),
            title="改写",
        )
        client = FakeCaptionAIClient(("改写结果",))

        with pytest.raises(ValueError, match="draft"):
            service.rewrite_caption(
                meme.id,
                client,
                content="   ",
                action="polish",
            )

        assert client.rewrite_calls == []
        assert service.list_captions(meme.id) == []
    finally:
        session.close()


def test_caption_api_crud_and_ai_endpoints(tmp_path: Path) -> None:
    meme_service, caption_service, session = create_services(tmp_path)
    app = create_app(
        tmp_path / "images",
        tmp_path / "thumbnails",
        tmp_path / "frontend",
        tmp_path / "settings.key",
    )
    client = FakeCaptionAIClient(("候选一", "候选二", "候选三"))
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_meme_service] = lambda: meme_service
    app.dependency_overrides[get_caption_service] = lambda: caption_service
    app.dependency_overrides[get_ai_client] = lambda: client
    try:
        meme = meme_service.create_meme(
            "api.png",
            make_image_bytes(),
            title="API",
        )
        created = request(
            app,
            "POST",
            f"/api/memes/{meme.id}/captions",
            json={"content": " 手写 ", "scene": None, "tone": None, "length": None},
        )
        assert created.status_code == 201
        assert created.json()["source"] == "manual"

        generated = request(
            app,
            "POST",
            f"/api/memes/{meme.id}/captions/generate",
            json={"count": 3, "scene": "群聊", "tone": None, "length": "short"},
        )
        assert generated.status_code == 200
        assert generated.json()["captions"] == ["候选一", "候选二", "候选三"]

        rewritten = request(
            app,
            "POST",
            f"/api/memes/{meme.id}/captions/rewrite",
            json={
                "content": "原草稿",
                "action": "polish",
                "scene": None,
                "tone": None,
                "length": None,
            },
        )
        assert rewritten.status_code == 200

        listed = request(app, "GET", f"/api/memes/{meme.id}/captions")
        caption_id = created.json()["id"]
        assert [item["id"] for item in listed.json()] == [caption_id]

        patched = request(
            app,
            "PATCH",
            f"/api/memes/{meme.id}/captions/{caption_id}",
            json={"content": "修改"},
        )
        assert patched.status_code == 200
        assert patched.json()["source"] == "manual"

        deleted = request(
            app,
            "DELETE",
            f"/api/memes/{meme.id}/captions/{caption_id}",
        )
        assert deleted.status_code == 204
    finally:
        app.dependency_overrides.clear()
        session.close()
