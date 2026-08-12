import asyncio
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
from app.models.collection import Collection, CollectionItem
from app.models.meme import Meme
from app.models.meme_image import MemeImage
from app.schemas.collection import CollectionCreate


def request(app, method: str, path: str, **kwargs) -> Response:
    async def send() -> Response:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def add_meme(session, title: str) -> Meme:
    token = title.encode().hex().ljust(64, "0")[:64]
    meme = Meme(
        title=title, description=None, original_filename=f"{title}.png",
        stored_filename=f"{token}.png", file_path=f"{token}.png",
        thumbnail_path=None, mime_type="image/png", file_size=1,
        width=1, height=1, file_hash=token, source=None,
    )
    session.add(meme)
    session.flush()
    meme.images.append(MemeImage(
        original_filename=meme.original_filename, stored_filename=meme.stored_filename,
        file_path=meme.file_path, thumbnail_path=None, mime_type=meme.mime_type,
        file_size=1, width=1, height=1, file_hash=token, position=0,
    ))
    session.flush()
    return meme


@pytest.fixture
def context(tmp_path: Path):
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    app = create_app(tmp_path / "images", tmp_path / "thumbs", tmp_path / "frontend")
    app.dependency_overrides[get_db] = lambda: session
    yield app, session
    app.dependency_overrides.clear()
    session.close()
    engine.dispose()


def test_collection_crud_normalizes_and_returns_ordered_items(context) -> None:
    app, session = context
    first, second = add_meme(session, "first"), add_meme(session, "second")
    session.commit()

    created = request(app, "POST", "/api/collections", json={"name": "  高频火力  ", "description": "  常用  "})
    assert created.status_code == 201
    collection_id = created.json()["id"]
    assert (created.json()["name"], created.json()["description"], created.json()["meme_count"]) == (
        "高频火力", "常用", 0
    )
    assert request(app, "POST", f"/api/collections/{collection_id}/memes", json={"meme_id": second.id}).status_code == 204
    assert request(app, "POST", f"/api/collections/{collection_id}/memes", json={"meme_id": first.id}).status_code == 204
    assert request(app, "POST", f"/api/collections/{collection_id}/memes", json={"meme_id": first.id}).status_code == 204

    detail = request(app, "GET", f"/api/collections/{collection_id}").json()
    assert detail["meme_count"] == 2
    assert [item["meme"]["id"] for item in detail["items"]] == [second.id, first.id]
    assert [item["position"] for item in detail["items"]] == [0, 1]
    assert request(app, "GET", "/api/collections").json()[0]["meme_count"] == 2

    updated = request(app, "PATCH", f"/api/collections/{collection_id}", json={"name": "  群聊  ", "description": None})
    assert (updated.json()["name"], updated.json()["description"], updated.json()["meme_count"]) == (
        "群聊", None, 2
    )
    assert request(app, "DELETE", f"/api/collections/{collection_id}/memes/{second.id}").status_code == 204
    assert request(app, "GET", f"/api/collections/{collection_id}").json()["meme_count"] == 1


@pytest.mark.parametrize("name", ["   ", "x" * 101])
def test_collection_rejects_invalid_name(context, name: str) -> None:
    app, _ = context
    response = request(app, "POST", "/api/collections", json={"name": name})
    assert response.status_code == 422


def test_collection_delete_and_missing_errors_do_not_delete_memes(context) -> None:
    app, session = context
    meme = add_meme(session, "kept")
    session.commit()
    created = request(app, "POST", "/api/collections", json={"name": "temporary"}).json()
    request(app, "POST", f"/api/collections/{created['id']}/memes", json={"meme_id": meme.id})
    assert request(app, "DELETE", f"/api/collections/{created['id']}").status_code == 204
    assert session.get(Meme, meme.id) is not None
    assert request(app, "DELETE", "/api/collections/999").status_code == 404
    assert request(app, "GET", "/api/collections/999").status_code == 404


def test_membership_replace_supports_many_to_many_without_semantic_changes(context) -> None:
    app, session = context
    first, second = add_meme(session, "first"), add_meme(session, "second")
    collections = [Collection(name=name) for name in ("C1", "C2", "C3")]
    session.add_all(collections)
    session.commit()

    response = request(
        app, "PUT", f"/api/memes/{first.id}/collections",
        json={"collection_ids": [collections[0].id, collections[1].id]},
    )
    assert response.json()["collection_ids"] == [collections[0].id, collections[1].id]
    request(app, "POST", f"/api/collections/{collections[0].id}/memes", json={"meme_id": second.id})
    replaced = request(
        app, "PUT", f"/api/memes/{first.id}/collections",
        json={"collection_ids": [collections[1].id, collections[2].id]},
    )
    assert replaced.json()["collection_ids"] == [collections[1].id, collections[2].id]
    assert request(app, "GET", f"/api/memes/{first.id}/collections").json()["collection_ids"] == [
        collections[1].id, collections[2].id
    ]
    assert len(list(session.scalars(select(CollectionItem)))) == 3
    assert request(app, "PUT", f"/api/memes/{first.id}/collections", json={"collection_ids": [999]}).status_code == 404


def test_deleting_meme_cascades_items_but_keeps_collection(context) -> None:
    _, session = context
    meme = add_meme(session, "deleted")
    collection = Collection(name="kept")
    session.add(collection)
    session.flush()
    session.add(CollectionItem(collection_id=collection.id, meme_id=meme.id, position=0))
    session.commit()
    collection_id = collection.id

    session.delete(meme)
    session.commit()
    assert session.get(Collection, collection_id) is not None
    assert list(session.scalars(select(CollectionItem))) == []


def test_collection_schema_and_api_reject_overlong_description(context) -> None:
    app, _ = context
    with pytest.raises(Exception):
        CollectionCreate(name="valid", description="x" * 501)
    assert request(app, "POST", "/api/collections", json={"name": "valid", "description": "x" * 501}).status_code == 422
