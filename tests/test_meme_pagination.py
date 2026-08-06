import asyncio
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
from app.models.meme import Meme
from app.models.tag import MemeTag, Tag


def request(app, path: str):
    async def send():
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.get(path)

    return asyncio.run(send())


def build_meme(number: int) -> Meme:
    return Meme(
        title=f"Meme {number}",
        description="猫咪描述" if number == 37 else f"描述 {number}",
        original_filename=f"{number}.png",
        stored_filename=f"stored-{number}.png",
        file_path=f"stored-{number}.png",
        thumbnail_path=None,
        mime_type="image/png",
        file_size=number,
        width=320,
        height=240,
        file_hash=f"pagination-{number}",
        source="test",
    )


@pytest.fixture
def pagination_context(tmp_path: Path):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    cat = Tag(name="猫")
    irony = Tag(name="反讽")
    session.add_all([cat, irony])
    session.flush()
    for number in range(1, 106):
        meme = build_meme(number)
        session.add(meme)
        session.flush()
        if number % 2 == 0:
            session.add(MemeTag(meme_id=meme.id, tag_id=cat.id))
        if number % 3 == 0:
            session.add(MemeTag(meme_id=meme.id, tag_id=irony.id))
    session.commit()
    app = create_app(tmp_path / "images", tmp_path / "thumbs")
    app.dependency_overrides[get_db] = lambda: session
    yield app
    app.dependency_overrides.clear()
    session.close()


def ids(response) -> list[int]:
    return [item["id"] for item in response.json()["items"]]


def test_page_defaults_sizes_last_page_and_legacy_response(pagination_context) -> None:
    first = request(pagination_context, "/api/memes/page")
    assert first.status_code == 200
    assert first.json()["page"] == 1
    assert first.json()["page_size"] == 24
    assert first.json()["total"] == 105
    assert first.json()["total_pages"] == 5
    assert ids(first) == list(range(1, 25))

    for size in (24, 48, 96):
        assert request(pagination_context, f"/api/memes/page?page_size={size}").status_code == 200
    assert request(pagination_context, "/api/memes/page?page_size=25").status_code == 422

    last = request(pagination_context, "/api/memes/page?page=999&page_size=48")
    assert last.json()["page"] == 3
    assert len(last.json()["items"]) == 9
    legacy = request(pagination_context, "/api/memes?offset=24&limit=2")
    assert isinstance(legacy.json(), list)
    assert [item["id"] for item in legacy.json()] == [25, 26]


def test_page_search_and_multi_tag_and_count_are_consistent(pagination_context) -> None:
    title = request(pagination_context, "/api/memes/page?q=Meme%2037")
    description = request(pagination_context, "/api/memes/page?q=%E7%8C%AB%E5%92%AA")
    assert title.json()["total"] == 1
    assert description.json()["total"] == 1

    cat = request(pagination_context, "/api/memes/page?tags=%E7%8C%AB&page_size=24")
    both = request(
        pagination_context,
        "/api/memes/page?tags=%E7%8C%AB&tags=%E5%8F%8D%E8%AE%BD&page_size=24",
    )
    assert cat.json()["total"] == 52
    assert cat.json()["total_pages"] == 3
    assert both.json()["total"] == 17
    assert all(item % 6 == 0 for item in ids(both))

    empty = request(pagination_context, "/api/memes/page?q=does-not-exist")
    assert empty.json()["items"] == []
    assert empty.json()["total"] == 0
    assert empty.json()["page"] == 1
    assert empty.json()["total_pages"] == 0


def test_shuffle_validation_stability_pages_and_filters(pagination_context) -> None:
    assert request(pagination_context, "/api/memes/page?sort=shuffle").status_code == 422
    assert request(pagination_context, "/api/memes/page?sort=shuffle&shuffle_seed=-1").status_code == 422
    assert request(pagination_context, "/api/memes/page?sort=shuffle&shuffle_seed=2147483647").status_code == 422

    path = "/api/memes/page?sort=shuffle&shuffle_seed=92837461&page_size=24"
    first = request(pagination_context, path)
    repeated = request(pagination_context, path)
    second = request(pagination_context, path + "&page=2")
    other = request(
        pagination_context,
        "/api/memes/page?sort=shuffle&shuffle_seed=1500000000&page_size=24",
    )
    assert ids(first) == ids(repeated)
    assert set(ids(first)).isdisjoint(ids(second))
    assert ids(first) != ids(other)
    assert first.json()["shuffle_seed"] == 92837461

    filtered = request(
        pagination_context,
        path + "&q=Meme&tags=%E7%8C%AB&tags=%E5%8F%8D%E8%AE%BD",
    )
    assert filtered.json()["total"] == 17
    assert all(item % 6 == 0 for item in ids(filtered))


def test_default_sort_ignores_shuffle_seed(pagination_context) -> None:
    response = request(
        pagination_context,
        "/api/memes/page?sort=default&shuffle_seed=999999999999",
    )
    assert response.status_code == 200
    assert response.json()["shuffle_seed"] is None
