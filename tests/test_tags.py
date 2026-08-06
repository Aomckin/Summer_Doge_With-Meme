import asyncio
from importlib import import_module, util
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.database import get_db
from app.models.tag import MemeTag, Tag
from app.services.meme_service import MemeService
from app.services.tag_service import TagService
from app.storage.image_storage import ImageStorage


def load_tag_components():
    if any(
        util.find_spec(name) is None
        for name in (
            "app.models.tag",
            "app.repositories.tag_repository",
            "app.api.tags",
        )
    ):
        pytest.skip("Tag components have not been implemented")
    model_module = import_module("app.models.tag")
    repository_module = import_module("app.repositories.tag_repository")
    api_module = import_module("app.api.tags")
    if not all(
        [
            hasattr(model_module, "Tag"),
            hasattr(model_module, "MemeTag"),
            hasattr(repository_module, "TagRepository"),
            hasattr(api_module, "router"),
        ]
    ):
        pytest.skip("Tag components have not been implemented")
    return model_module, repository_module, api_module


def make_image_bytes(color: str) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (160, 120), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def request(app, method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


@pytest.fixture
def tag_context(tmp_path: Path):
    model_module, _, tag_api = load_tag_components()
    meme_api = import_module("app.api.memes")
    main = import_module("app.main")
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    storage = ImageStorage(tmp_path / "images", tmp_path / "thumbnails")
    service = MemeService(session, storage)
    main.app.dependency_overrides[meme_api.get_meme_service] = lambda: service
    main.app.dependency_overrides[get_db] = lambda: session

    yield main.app, session, model_module

    main.app.dependency_overrides.clear()
    session.close()


def test_tag_components_exist() -> None:
    assert util.find_spec("app.models.tag") is not None, "Tag model is missing"
    assert util.find_spec("app.repositories.tag_repository") is not None, (
        "TagRepository is missing"
    )
    assert util.find_spec("app.api.tags") is not None, "Tag Router is missing"
    model_module = import_module("app.models.tag")
    repository_module = import_module("app.repositories.tag_repository")
    api_module = import_module("app.api.tags")

    assert hasattr(model_module, "Tag"), "Tag model is missing"
    assert hasattr(model_module, "MemeTag"), "MemeTag model is missing"
    assert hasattr(repository_module, "TagRepository"), "TagRepository is missing"
    assert hasattr(api_module, "router"), "Tag Router is missing"


def test_upload_reuses_tags_and_exposes_tag_list(tag_context) -> None:
    app, session, model_module = tag_context

    first = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("first.png", make_image_bytes("red"), "image/png")},
        data={"title": "第一张", "tags": " Funny, CAT, funny "},
    )
    second = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("second.png", make_image_bytes("green"), "image/png")},
        data={"title": "第二张", "tags": "cat"},
    )
    tags = request(app, "GET", "/api/tags")

    assert first.status_code == 201
    assert second.status_code == 201
    assert [tag["name"] for tag in first.json()["tags"]] == ["funny", "cat"]
    assert session.scalar(select(func.count()).select_from(model_module.Tag)) == 2
    assert [tag["name"] for tag in tags.json()] == ["cat", "funny"]
    assert [tag["usage_count"] for tag in tags.json()] == [2, 1]


def test_filter_and_update_meme_tags(tag_context) -> None:
    app, _, _ = tag_context
    first = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("first.png", make_image_bytes("blue"), "image/png")},
        data={"title": "蓝色", "tags": "funny,cat"},
    ).json()
    request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("second.png", make_image_bytes("yellow"), "image/png")},
        data={"title": "黄色", "tags": "funny"},
    )

    filtered = request(
        app,
        "GET",
        "/api/memes",
        params=[("tags", "funny"), ("tags", "cat")],
    )
    updated = request(
        app,
        "PATCH",
        f"/api/memes/{first['id']}",
        json={"tags": ["reaction"]},
    )

    assert [meme["id"] for meme in filtered.json()] == [first["id"]]
    assert [tag["name"] for tag in updated.json()["tags"]] == ["reaction"]


def test_list_tags_usage_search_sort_and_empty_visibility(tag_context) -> None:
    app, session, _ = tag_context
    for index, (tags, color) in enumerate(
        zip(("cat,funny", "cat", "reaction"), ("red", "green", "blue")),
        start=1,
    ):
        response = request(
            app,
            "POST",
            "/api/memes",
            files={"file": (f"{index}.png", make_image_bytes(color), "image/png")},
            data={"title": f"Meme {index}", "tags": tags},
        )
        assert response.status_code == 201
    session.add(Tag(name="empty"))
    session.commit()

    default = request(app, "GET", "/api/tags")
    all_tags = request(
        app,
        "GET",
        "/api/tags",
        params={"include_empty": "true", "sort": "usage_desc"},
    )
    searched = request(
        app,
        "GET",
        "/api/tags",
        params={"include_empty": "true", "q": "CAT", "sort": "name_desc"},
    )

    assert [(item["name"], item["usage_count"]) for item in default.json()] == [
        ("cat", 2),
        ("funny", 1),
        ("reaction", 1),
    ]
    assert [(item["name"], item["usage_count"]) for item in all_tags.json()] == [
        ("cat", 2),
        ("funny", 1),
        ("reaction", 1),
        ("empty", 0),
    ]
    assert [(item["name"], item["usage_count"]) for item in searched.json()] == [
        ("cat", 2)
    ]


def test_rename_updates_every_meme_and_rejects_invalid_names(tag_context) -> None:
    app, session, _ = tag_context
    meme_ids = []
    for index in range(2):
        response = request(
            app,
            "POST",
            "/api/memes",
            files={"file": (f"rename-{index}.png", make_image_bytes("blue" if index else "red"), "image/png")},
            data={"title": f"Rename {index}", "tags": "old,existing" if index == 0 else "old"},
        )
        meme_ids.append(response.json()["id"])
    old = session.scalar(select(Tag).where(Tag.name == "old"))
    assert old is not None

    renamed = request(app, "PATCH", f"/api/tags/{old.id}", json={"name": " New Name "})
    empty = request(app, "PATCH", f"/api/tags/{old.id}", json={"name": "   "})
    conflict = request(app, "PATCH", f"/api/tags/{old.id}", json={"name": "existing"})
    too_long = request(app, "PATCH", f"/api/tags/{old.id}", json={"name": "x" * 101})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "new name"
    assert renamed.json()["usage_count"] == 2
    assert empty.status_code == 422
    assert conflict.status_code == 409
    assert "merge" in conflict.json()["detail"]
    assert too_long.status_code == 422
    for meme_id in meme_ids:
        detail = request(app, "GET", f"/api/memes/{meme_id}").json()
        assert "new name" in [tag["name"] for tag in detail["tags"]]


def _set_link(
    session,
    meme_id: int,
    tag_name: str,
    source: str,
    confidence: float | None,
) -> None:
    link = session.scalar(
        select(MemeTag)
        .join(Tag)
        .where(MemeTag.meme_id == meme_id, Tag.name == tag_name)
    )
    assert link is not None
    link.source = source
    link.confidence = confidence
    session.commit()


@pytest.mark.parametrize(
    ("source_source", "source_confidence", "target_source", "target_confidence", "expected_source", "expected_confidence"),
    [
        ("ai", 0.99, "manual", None, "manual", None),
        ("codex", 0.5, "ai", 0.99, "codex", 0.5),
        ("ai", 0.9, "ai", 0.4, "ai", 0.9),
        ("ai", None, "ai", None, "ai", None),
    ],
)
def test_merge_resolves_duplicate_relationship_priority(
    tag_context,
    source_source,
    source_confidence,
    target_source,
    target_confidence,
    expected_source,
    expected_confidence,
) -> None:
    app, session, _ = tag_context
    uploaded = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("merge.png", make_image_bytes("purple"), "image/png")},
        data={"title": "Merge", "tags": "source,target"},
    ).json()
    _set_link(session, uploaded["id"], "source", source_source, source_confidence)
    _set_link(session, uploaded["id"], "target", target_source, target_confidence)
    source = session.scalar(select(Tag).where(Tag.name == "source"))
    target = session.scalar(select(Tag).where(Tag.name == "target"))
    assert source is not None and target is not None

    response = request(
        app,
        "POST",
        f"/api/tags/{source.id}/merge",
        json={"target_tag_id": target.id},
    )

    assert response.status_code == 200
    assert response.json()["usage_count"] == 1
    assert session.get(Tag, source.id) is None
    links = list(session.scalars(select(MemeTag).where(MemeTag.meme_id == uploaded["id"])))
    assert len(links) == 1
    assert links[0].tag_id == target.id
    assert links[0].source == expected_source
    assert links[0].confidence == expected_confidence


def test_merge_transfers_all_memes_and_validates_ids(tag_context) -> None:
    app, session, _ = tag_context
    first = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("source.png", make_image_bytes("orange"), "image/png")},
        data={"title": "Source", "tags": "source"},
    ).json()
    second = request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("target.png", make_image_bytes("green"), "image/png")},
        data={"title": "Target", "tags": "target"},
    ).json()
    source = session.scalar(select(Tag).where(Tag.name == "source"))
    target = session.scalar(select(Tag).where(Tag.name == "target"))
    assert source is not None and target is not None

    self_merge = request(app, "POST", f"/api/tags/{source.id}/merge", json={"target_tag_id": source.id})
    missing = request(app, "POST", "/api/tags/9999/merge", json={"target_tag_id": target.id})
    merged = request(app, "POST", f"/api/tags/{source.id}/merge", json={"target_tag_id": target.id})

    assert self_merge.status_code == 422
    assert missing.status_code == 404
    assert merged.status_code == 200
    assert merged.json()["usage_count"] == 2
    for meme_id in (first["id"], second["id"]):
        detail = request(app, "GET", f"/api/memes/{meme_id}").json()
        assert [tag["name"] for tag in detail["tags"]] == ["target"]


def test_delete_and_cleanup_only_remove_empty_tags(tag_context) -> None:
    app, session, _ = tag_context
    request(
        app,
        "POST",
        "/api/memes",
        files={"file": ("used.png", make_image_bytes("black"), "image/png")},
        data={"title": "Used", "tags": "used"},
    )
    used = session.scalar(select(Tag).where(Tag.name == "used"))
    empty_one = Tag(name="empty-one")
    empty_two = Tag(name="empty-two")
    session.add_all([empty_one, empty_two])
    session.commit()
    assert used is not None

    in_use = request(app, "DELETE", f"/api/tags/{used.id}")
    deleted = request(app, "DELETE", f"/api/tags/{empty_one.id}")
    unconfirmed = request(app, "POST", "/api/tags/cleanup-empty", json={"confirm": False})
    cleanup = request(app, "POST", "/api/tags/cleanup-empty", json={"confirm": True})

    assert in_use.status_code == 409
    assert "1" in in_use.json()["detail"]
    assert deleted.status_code == 204
    assert unconfirmed.status_code == 422
    assert cleanup.status_code == 200
    assert cleanup.json() == {"deleted_count": 1, "deleted_tags": ["empty-two"]}
    assert session.get(Tag, used.id) is not None


def test_merge_failure_rolls_back_every_change(tag_context, monkeypatch) -> None:
    _, session, _ = tag_context
    source = Tag(name="source")
    target = Tag(name="target")
    session.add_all([source, target])
    session.commit()
    service = TagService(session)

    def fail_merge(source_tag: Tag, _target_tag: Tag) -> Tag:
        source_tag.name = "partially-changed"
        session.flush()
        raise RuntimeError("forced failure")

    monkeypatch.setattr(service.repository, "merge", fail_merge)
    with pytest.raises(RuntimeError, match="forced failure"):
        service.merge_tags(source.id, target.id)

    session.expire_all()
    assert session.get(Tag, source.id).name == "source"
    assert session.get(Tag, target.id).name == "target"
