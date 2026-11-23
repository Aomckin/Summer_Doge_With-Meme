import base64
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
from threading import Event
from time import monotonic, sleep
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

import app.database as database
from app.auth import AuthSettings
from app.database import Base, get_db
from app.main import create_app
from app.models.publisher import PostDraft, PostItem, PublishAttempt
from app.services.meme_service import MemeService
from app.services.publish_package import PackageSnapshot
from app.services.publisher_registry import MOCK_SCRIPT, PublisherRegistry
from app.services.publisher_service import PublisherService
from tests.vault_helpers import ensure_default_vault

BASE = "/api/publisher"


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.delenv("MEME_VAULT_PUBLISHERS_FILE", raising=False)
    monkeypatch.delenv("MEME_VAULT_PUBLISHER_EXECUTION", raising=False)
    engine = create_engine(f"sqlite:///{(tmp_path / 'vault.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    auth = AuthSettings(visitor_key="visitor-key", admin_key="admin-key", session_secret="publisher-test-secret")
    app = create_app(tmp_path / "images", tmp_path / "thumbs", auth_settings=auth,
                     import_archives_dir=tmp_path / "imports", export_archives_dir=tmp_path / "exports")
    worker = app.state.publisher_service
    worker.session_factory = factory
    with factory() as session:
        ensure_default_vault(session)

    def db():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = db
    # Skip the app lifespan so unrelated managers never use the default database.
    client = TestClient(app)
    assert client.post("/api/auth/login", json={"key": "admin-key"}).status_code == 200
    try:
        yield client, factory, worker
    finally:
        client.close()
        app.state.publisher_service.shutdown()
        worker.shutdown()
        engine.dispose()


def test_xiaoheihe_web_login_uses_admin_gate_and_existing_session_directory(vault, tmp_path):
    client, _, worker = vault
    script = tmp_path / "xiaoheihe_publisher.py"
    session_dir = tmp_path / "xiaoheihe-session"
    buffer = BytesIO()
    Image.new("RGB", (8, 8), "white").save(buffer, format="PNG")
    png = buffer.getvalue()
    script.write_text(
        "import json, sys, time\n"
        "from pathlib import Path\n"
        "session = Path(sys.argv[sys.argv.index('--session-dir') + 1])\n"
        "qr = Path(sys.argv[sys.argv.index('--login-qr') + 1])\n"
        f"qr.write_bytes(bytes.fromhex({png.hex()!r}))\n"
        "deadline = time.monotonic() + 8\n"
        "while not (session.parent / 'scanned').is_file() and time.monotonic() < deadline:\n"
        "    time.sleep(0.025)\n"
        "session.mkdir()\n"
        "(session / 'session.json').write_text('{}', encoding='utf-8')\n"
        "print(json.dumps({'ok': True, 'data': {'authenticated': True, 'user_id': 'hidden'}}))\n",
        encoding="utf-8",
    )
    manifest = json.loads(MOCK_SCRIPT.with_name("mock-manifest.json").read_text(encoding="utf-8"))
    config = tmp_path / "publishers.json"
    config.write_text(json.dumps([{
        "manifest": {**manifest, "plugin_id": "xiaoheihe"},
        "command": [sys.executable, "-I", str(script), "--session-dir", str(session_dir)],
    }]), encoding="utf-8")
    worker.registry = PublisherRegistry(config)
    login_path = f"{BASE}/plugins/xiaoheihe/login"

    guest = TestClient(client.app)
    try:
        assert guest.post(login_path).status_code == 401
        assert guest.post("/api/auth/login", json={"key": "visitor-key"}).status_code == 200
        assert guest.post(login_path).status_code == 403
    finally:
        guest.close()

    plugins = client.get(f"{BASE}/plugins").json()
    assert {plugin["plugin_id"]: plugin["qr_session_saved"] for plugin in plugins} == {"mock": None, "xiaoheihe": False}
    started = client.post(login_path)
    assert started.status_code == 202 and started.headers["Cache-Control"] == "no-store"
    attempt_id = started.json()["id"]
    assert client.post(login_path).json()["id"] == attempt_id
    status_url = f"{login_path}/{attempt_id}"
    deadline = monotonic() + 5
    while monotonic() < deadline:
        response = client.get(status_url)
        if response.json()["qr_png"]:
            break
        sleep(0.02)
    assert response.headers["Cache-Control"] == "no-store"
    assert base64.b64decode(response.json()["qr_png"]) == png
    assert response.json()["status"] == "waiting"

    (tmp_path / "scanned").touch()
    deadline = monotonic() + 5
    while monotonic() < deadline:
        response = client.get(status_url)
        if response.json()["status"] != "waiting":
            break
        sleep(0.02)
    assert response.json() == {
        "id": attempt_id, "status": "succeeded", "qr_png": None, "message": "扫码登录成功。",
    }
    assert not list(worker.directory.glob("work-*"))
    assert client.get(f"{login_path}/{uuid4()}").status_code == 404
    plugins = client.get(f"{BASE}/plugins").json()
    assert next(plugin for plugin in plugins if plugin["plugin_id"] == "xiaoheihe")["qr_session_saved"] is True


def seed(factory, worker, count=1):
    images = []
    with factory() as session:
        vault = ensure_default_vault(session)
        memes = MemeService(session, worker.storage.storage_for(vault))
        for number in range(count):
            buffer = BytesIO()
            Image.new("RGB", (11, 7), (number + 1, 10, 20)).save(buffer, format="PNG")
            meme = memes.create_meme(f"image-{number}.png", buffer.getvalue(), title=f"素材 {number}", vault_id=vault.id)
            images.append(meme.images[0])
        buffer = BytesIO()
        Image.new("RGB", (13, 9), "blue").save(buffer, format="PNG")
        group = memes.append_image(images[0].meme_id, "second.png", buffer.getvalue())
        return images, group.images[1]


def item(image, caption=""):
    return {"id": str(uuid4()), "meme_id": image.meme_id, "meme_image_id": image.id, "caption": caption}


def create_post(client, items, title="组合"):
    response = client.post(f"{BASE}/posts", json={
        "title": title, "intro_text": "开头\n第二行", "outro_text": "结尾", "items": items,
    })
    assert response.status_code == 201, response.text
    return response.json()


def submit(client, post, action="export", plugin_id=None, **extras):
    request = {"request_id": str(uuid4()), "revision": post["revision"], "action": action, "plugin_id": plugin_id, **extras}
    return client.post(f"{BASE}/posts/{post['id']}/attempts", json=request)


def wait(client, response):
    assert response.status_code == 202, response.text
    attempt = response.json()
    deadline = monotonic() + 7
    while monotonic() < deadline:
        result = client.get(f"{BASE}/attempts/{attempt['id']}")
        assert result.status_code == 200, result.text
        attempt = result.json()
        if attempt["status"] not in ("queued", "running"):
            return attempt
        sleep(0.02)
    pytest.fail(f"Publisher did not return a terminal state: {attempt['status']}")


def configure(worker, tmp_path, *, allowed=True, extra=()):
    output = tmp_path / "developer-output"
    config = tmp_path / "publishers.json"
    manifest = json.loads(MOCK_SCRIPT.with_name("mock-manifest.json").read_text(encoding="utf-8"))
    entries = []
    for mode in ("success", "failure", "timeout", "crash", "invalid"):
        plugin_id = f"mock-{mode}"
        entries.append({
            "manifest": {**manifest, "plugin_id": plugin_id}, "timeout_seconds": 0.9 if mode == "timeout" else 10,
            "command": [sys.executable, "-I", str(MOCK_SCRIPT), "--simulate", mode,
                        "--plugin-id", plugin_id, "--report-dir", str(output)],
        })
    config.write_text(json.dumps([{"malformed": True}, *entries, *extra]), encoding="utf-8")
    worker.registry = PublisherRegistry(config, allowed=allowed)
    return output


def test_25_images_ordered_zip_and_independent_mock(vault, tmp_path, monkeypatch):
    client, factory, worker = vault
    originals, secondary = seed(factory, worker, 24)
    images = originals[:23] + [secondary, originals[0]]
    selected = [item(image, f"图 {index}\n第二行" if index != 1 else "") for index, image in enumerate(images)]
    post = create_post(client, selected, "<合辑> 😀")
    assert len(post["items"]) == 25
    assert post["items"][-1]["meme_image_id"] == post["items"][0]["meme_image_id"]
    reordered = [selected[-1], *selected[:-1]]
    update = client.put(f"{BASE}/posts/{post['id']}", json={
        "title": post["title"], "intro_text": post["intro_text"], "outro_text": post["outro_text"],
        "revision": post["revision"], "items": reordered,
    })
    assert update.status_code == 200, update.text
    post = update.json()
    report_dir = configure(worker, tmp_path)

    started, release = Event(), Event()
    write_zip = PackageSnapshot.write_zip

    def pause(snapshot, path):
        started.set()
        assert release.wait(7)
        write_zip(snapshot, path)

    monkeypatch.setattr(PackageSnapshot, "write_zip", pause)
    request_id = str(uuid4())
    response = submit(client, post, request_id=request_id)
    try:
        assert started.wait(7)
        assert submit(client, post, request_id=request_id).json()["id"] == request_id
        assert submit(client, post, "prepare", "mock").status_code == 409
        assert submit(client, post, "prepare", "mock", request_id=request_id).status_code == 409
        modified = client.put(f"{BASE}/posts/{post['id']}", json={
            "title": post["title"], "revision": post["revision"], "items": [{"id": row["id"], "meme_id": row["meme_id"],
            "meme_image_id": row["meme_image_id"], "caption": "修改中"} for row in reordered],
        })
        assert modified.status_code == 200, modified.text
    finally:
        release.set()
    exported = wait(client, response)
    assert exported["status"] == "prepared" and exported["revision"] == post["revision"]
    assert not exported["external_url"]
    response = client.get(exported["download_url"])
    assert response.status_code == 200
    with ZipFile(BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert (manifest["protocol_version"], manifest["request_id"], manifest["post_id"], manifest["revision"]) == (
            "1", request_id, post["id"], post["revision"],
        )
        assert (manifest["title"], manifest["intro_text"], manifest["outro_text"]) == ("<合辑> 😀", "开头\n第二行", "结尾")
        assert len(archive.namelist()) == 26
        for position, (entry, expected) in enumerate(zip(manifest["items"], reordered, strict=True)):
            assert (entry["position"], entry["caption"], entry["meme_id"], entry["meme_image_id"]) == (
                position, expected["caption"], expected["meme_id"], expected["meme_image_id"],
            )
            assert entry["asset"] == f"assets/{position + 1:03}.png"
            assert entry["mime_type"] == "image/png"
            raw = archive.read(entry["asset"])
            assert len(raw) == entry["size"] and sha256(raw).hexdigest() == entry["sha256"]
    assert str(tmp_path) not in json.dumps(manifest)

    latest = modified.json()
    prepared = wait(client, submit(client, latest, "prepare", "mock-success"))
    assert prepared["status"] == "prepared" and prepared["external_post_id"] is None
    report = json.loads((report_dir / f"mock-{prepared['id']}.json").read_text(encoding="utf-8"))
    assert report["revision"] == latest["revision"]
    assert [entry["caption"] for entry in report["items"]] == ["修改中"] * 25
    assert [entry["sha256"] for entry in report["items"]] == [entry["sha256"] for entry in manifest["items"]]
    assert [entry["position"] for entry in report["items"]] == list(range(25))
    assert wait(client, submit(client, latest, "dry_run", "mock"))["status"] == "prepared"
    unsupported = submit(client, latest, "publish", "mock")
    assert unsupported.status_code == 422 and unsupported.json()["error_code"] == "unsupported"
    assert not list(worker.directory.glob("work-*"))


def test_append_conflict_duplicate_and_independent_posts(vault):
    client, factory, worker = vault
    images, secondary = seed(factory, worker)
    initial = item(images[0], "第一篇")
    post = create_post(client, [initial])
    add = item(secondary, "指定第二张")

    def append():
        return client.post(f"{BASE}/posts/{post['id']}/items", json={"items": [add]})

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: append(), range(2)))
    assert [result.status_code for result in results] == [200, 200]
    revision = post["revision"] + 1
    assert all(result.json()["revision"] == revision for result in results)
    assert [row["caption"] for row in results[0].json()["items"]] == ["第一篇", "指定第二张"]
    assert client.put(f"{BASE}/posts/{post['id']}", json={"revision": post["revision"], "items": [initial]}).status_code == 409

    def save(title):
        return client.put(f"{BASE}/posts/{post['id']}", json={"title": title, "revision": revision, "items": [initial, add]})

    with ThreadPoolExecutor(max_workers=2) as executor:
        writes = list(executor.map(save, ["第一位编辑", "第二位编辑"]))
    assert sorted(result.status_code for result in writes) == [200, 409]
    other = create_post(client, [item(images[0], "第二篇")])
    assert other["items"][0]["caption"] == "第二篇"
    cloned = client.post(f"{BASE}/posts/{post['id']}/copy").json()
    assert [row["caption"] for row in cloned["items"]] == ["第一篇", "指定第二张"]
    assert client.delete(f"{BASE}/posts/{post['id']}?revision={revision}").status_code == 409
    assert client.delete(f"{BASE}/posts/{post['id']}?revision={revision + 1}").status_code == 204
    assert client.get(f"{BASE}/posts/{post['id']}").status_code == 404
    assert client.get(f"{BASE}/posts/{cloned['id']}").status_code == 200
    assert client.get(f"{BASE}/posts/{other['id']}").status_code == 200


def test_opening_a_post_keeps_order_and_move_to_top_preserves_its_revision(vault):
    client, _, _ = vault
    earlier = create_post(client, [], "较早帖文")
    later = create_post(client, [], "较新帖文")
    posts = f"{BASE}/posts"

    assert client.get(f"{posts}/{earlier['id']}").json() == earlier
    assert [post["id"] for post in client.get(posts).json()] == [later["id"], earlier["id"]]

    moved = client.post(f"{posts}/{earlier['id']}/move-to-top")
    assert moved.status_code == 200 and moved.headers["Cache-Control"] == "no-store"
    assert moved.json()["revision"] == earlier["revision"]
    assert moved.json()["title"] == earlier["title"]
    assert [post["id"] for post in client.get(posts).json()] == [earlier["id"], later["id"]]
    assert client.post(f"{posts}/99999/move-to-top").status_code == 404


def test_other_post_image_ids_exclude_current_post_and_deduplicate_references(vault):
    client, factory, worker = vault
    images, second = seed(factory, worker, count=2)
    current = create_post(client, [item(images[0]), item(images[1])])
    other = create_post(client, [item(images[0]), item(images[0]), item(second)])
    path = f"{BASE}/posts/{current['id']}/other-image-ids"

    result = client.get(path)
    assert result.status_code == 200 and result.headers["Cache-Control"] == "no-store"
    assert result.json() == sorted([images[0].id, second.id])
    assert client.delete(f"{BASE}/posts/{other['id']}?revision={other['revision']}").status_code == 204
    assert client.get(path).json() == []


def test_missing_image_preserves_caption_and_can_be_replaced(vault):
    client, factory, worker = vault
    images, secondary = seed(factory, worker, 2)
    removed = item(images[1], "这条一旦迁移也要保留")
    post = create_post(client, [removed])
    with factory() as session:
        storage = worker.storage.storage_for(ensure_default_vault(session))
        storage.original_path(images[1].file_path).unlink()
    url = f"{BASE}/posts/{post['id']}"
    response = client.get(url).json()
    assert response["items"][0]["image_url"] is None
    assert response["items"][0]["caption"] == removed["caption"]
    assert submit(client, post).status_code == 422
    assert client.put(url, json={"revision": post["revision"], "items": [removed]}).status_code == 200
    assert client.delete(f"/api/vaults/{images[1].vault_id}/memes/{images[1].meme_id}").status_code == 204
    response = client.get(url).json()
    assert not response["items"][0]["image_url"]
    replacement = {**removed, "meme_image_id": secondary.id, "meme_id": secondary.meme_id}
    repaired = client.put(url, json={"revision": response["revision"], "items": [replacement]})
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["items"][0]["caption"] == removed["caption"]
    assert repaired.json()["items"][0]["image_url"]
    assert client.put(url, json={"revision": repaired.json()["revision"], "items": [{**replacement, "meme_id": 999}]}).status_code == 422


@pytest.mark.parametrize(("mode", "status", "code"), [
    ("failure", "failed", "mock_failure"), ("timeout", "unknown", "timeout"),
    ("crash", "unknown", "plugin_exit"), ("invalid", "unknown", "invalid_result"),
])
def test_plugin_failures_and_safe_retries(vault, tmp_path, mode, status, code):
    client, factory, worker = vault
    images, _ = seed(factory, worker)
    configure(worker, tmp_path)
    post = create_post(client, [item(images[0])])
    plugin = f"mock-{mode}"
    result = wait(client, submit(client, post, "prepare", plugin))
    assert (result["status"], result["error_code"]) == (status, code)
    assert result["started_at"].endswith("Z") and result["finished_at"].endswith("Z")
    assert result["external_url"] is None
    retry = submit(client, post, "prepare", plugin, retry_of=result["id"])
    if status == "failed":
        next_attempt = wait(client, retry)
        assert next_attempt["id"] != result["id"] and next_attempt["retry_of"] == result["id"]
    else:
        assert retry.status_code == 409
    assert not list(worker.directory.glob("work-*"))


def test_admin_only_disabled_execution_and_bad_entry_isolated(vault, tmp_path):
    client, factory, worker = vault
    images, _ = seed(factory, worker)
    configure(worker, tmp_path, allowed=False)
    post = create_post(client, [item(images[0])])
    plugins = client.get(f"{BASE}/plugins").json()
    assert len(plugins) == 6 and all(not plugin["enabled"] and not plugin["available"] for plugin in plugins)
    assert str(tmp_path) not in json.dumps(plugins)
    assert submit(client, post, "prepare", "mock").status_code == 422
    assert submit(client, post, "publish", "mock").status_code == 422
    exported = wait(client, submit(client, post))
    guest = TestClient(client.app)
    paths = [
        f"{BASE}/posts", f"{BASE}/posts/{post['id']}", f"{BASE}/plugins", f"{BASE}/posts/{post['id']}/attempts",
        f"{BASE}/posts/{post['id']}/other-image-ids",
        f"{BASE}/attempts/{exported['id']}", exported["download_url"],
    ]
    for path in paths:
        assert guest.get(path).status_code == 401
    assert guest.post("/api/auth/login", json={"key": "visitor-key"}).status_code == 200
    for path in paths:
        assert guest.get(path).status_code == 403
    assert submit(guest, post).status_code == 403
    assert guest.post(f"{BASE}/posts", json={}).status_code == 403
    guest.close()

    path = worker.directory / f"post-{exported['id']}.zip"
    os.utime(path, (1, 1))
    assert client.get(exported["download_url"]).status_code == 410
    assert client.get(f"{BASE}/posts").headers["Cache-Control"] == "no-store"
    worker.cleanup_archives()
    assert not path.exists()


def test_confirmed_and_uncertain_remote_attempts_block_repeat(vault, tmp_path):
    client, factory, worker = vault
    images, _ = seed(factory, worker)
    script = tmp_path / "plugin.py"
    script.write_text(
        "import argparse, json\nfrom pathlib import Path\n"
        "p = argparse.ArgumentParser(); p.add_argument('--package'); p.add_argument('--action'); p.add_argument('--name')\n"
        "a = p.parse_args(); m = json.loads((Path(a.package) / 'manifest.json').read_text(encoding='utf-8'))\n"
        "status = {'publish': 'published', 'remote_draft': 'remote_draft'}[a.action]\n"
        "result = dict(attempt_id=m['request_id'],plugin_id=a.name,status=status,external_url='https://example.invalid/post/1')\n"
        "print(json.dumps(result) if a.name == 'test-platform' else 'malformed')\n", encoding="utf-8",
    )
    manifest = {
        "name": "Test Platform", "version": "1", "protocol_version": "1", "supported_content_types": ["image_text"],
        "capabilities": ["image_text", "remote_draft", "publish", "external_url"], "limits": {"max_images": 1},
        "execution_mode": "local_process",
    }
    configure(worker, tmp_path, extra=[
        {"manifest": {**manifest, "plugin_id": name}, "command": [sys.executable, str(script), "--name", name]}
        for name in ("test-platform", "uncertain-platform")
    ])
    post = create_post(client, [item(images[0])])
    draft = wait(client, submit(client, post, "remote_draft", "test-platform"))
    assert draft["status"] == "remote_draft"
    assert submit(client, post, "remote_draft", "test-platform").status_code == 409
    published = wait(client, submit(client, post, "publish", "test-platform"))
    assert published["status"] == "published" and published["external_url"] == "https://example.invalid/post/1"
    assert submit(client, post, "publish", "test-platform").status_code == 409
    assert wait(client, submit(client, post, "publish", "uncertain-platform"))["status"] == "unknown"
    assert submit(client, post, "publish", "uncertain-platform").status_code == 409
    too_many = create_post(client, [item(images[0]), item(images[0])])
    assert submit(client, too_many, "publish", "test-platform").status_code == 422


def test_xiaoheihe_legacy_retry_checks_drafts_and_preserves_unverified_receipt(vault, tmp_path):
    client, factory, worker = vault
    images, _ = seed(factory, worker)
    script = tmp_path / "xiaoheihe_publisher.py"
    script.write_text(
        "import json, sys\nfrom pathlib import Path\n"
        "assert '--require-empty-drafts' in sys.argv\n"
        "root = Path(sys.argv[sys.argv.index('--package') + 1])\n"
        "request = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))\n"
        "print(json.dumps(dict(plugin_id='xiaoheihe', attempt_id=request['request_id'], status='unknown', "
        "error_code='xiaoheihe_readback_unverified', external_post_id='ab-42', error_message='private')))\n",
        encoding="utf-8",
    )
    configure(worker, tmp_path, extra=[{
        "manifest": {
            "plugin_id": "xiaoheihe", "name": "Test Platform", "version": "1", "protocol_version": "1",
            "supported_content_types": ["image_text"], "capabilities": ["image_text", "remote_draft", "publish"],
            "limits": {}, "execution_mode": "local_process",
        },
        "command": [sys.executable, str(script)], "timeout_seconds": 300,
    }])
    post = create_post(client, [item(images[0])])
    original_id = str(uuid4())
    intermediate_id = str(uuid4())
    with factory() as session:
        session.add(PublishAttempt(id=original_id, post_id=post["id"], revision=post["revision"],
                                   action="remote_draft", plugin_id="xiaoheihe", status="unknown",
                                   error_code="plugin_exit"))
        session.add(PublishAttempt(id=intermediate_id, post_id=post["id"], revision=post["revision"],
                                   action="remote_draft", plugin_id="xiaoheihe", status="unknown",
                                   error_code="xiaoheihe_submit_unknown", retry_of=original_id))
        session.commit()

    assert submit(client, post, "remote_draft", "xiaoheihe").status_code == 409
    assert submit(client, post, "publish", "xiaoheihe", retry_of=original_id).status_code == 409
    result = wait(client, submit(client, post, "remote_draft", "xiaoheihe", retry_of=intermediate_id))
    assert (result["status"], result["error_code"], result["external_post_id"]) == (
        "unknown", "xiaoheihe_readback_unverified", "ab-42",
    )
    assert "平台编号" in result["error_message"] and "private" not in result["error_message"]
    assert submit(client, post, "remote_draft", "xiaoheihe", retry_of=result["id"]).status_code == 409
    assert submit(client, post, "remote_draft", "xiaoheihe", retry_of=original_id).status_code == 409


def test_clean_database_starts_with_default_vault_and_publisher_tables(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'clean.db').as_posix()}")
    monkeypatch.setattr(database, "engine", engine)
    try:
        database.create_tables()
        assert {"post_drafts", "post_items", "publish_attempts"} <= set(inspect(engine).get_table_names())
        with sessionmaker(engine)() as session:
            vault = ensure_default_vault(session)
            assert (vault.slug, vault.profile, vault.next_asset_no) == ("meme", "meme", 1)
    finally:
        engine.dispose()


def test_legacy_schema_gets_additive_tables_and_restart_preserves_content(vault, monkeypatch, tmp_path):
    client, _, worker = vault
    legacy_engine = create_engine(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")
    publisher_tables = {PostDraft.__table__, PostItem.__table__, PublishAttempt.__table__}
    Base.metadata.create_all(legacy_engine, tables=[table for table in Base.metadata.sorted_tables if table not in publisher_tables])
    Legacy = sessionmaker(bind=legacy_engine, expire_on_commit=False)
    originals, _ = seed(Legacy, worker)
    monkeypatch.setattr(database, "engine", legacy_engine)
    for _ in range(2):
        database.create_tables()
    assert {table.name for table in publisher_tables} <= set(inspect(legacy_engine).get_table_names())
    with Legacy() as session:
        assert ensure_default_vault(session).id == originals[0].vault_id

    def legacy_db():
        with Legacy() as session:
            yield session

    client.app.dependency_overrides[get_db] = legacy_db
    first = PublisherService(Legacy, worker.storage, tmp_path / "restart", worker.registry)
    client.app.state.publisher_service = first
    post = create_post(client, [item(originals[0], "保存后重启")])
    assert wait(client, submit(client, post))["status"] == "prepared"
    first.shutdown()
    with Legacy.begin() as session:
        for state in ("queued", "running"):
            session.add(PublishAttempt(id=str(uuid4()), post_id=post["id"], revision=post["revision"], action="export", status=state))
    restarted = PublisherService(Legacy, worker.storage, tmp_path / "restart", worker.registry)
    client.app.state.publisher_service = restarted
    restarted.startup()
    assert client.get(f"{BASE}/posts/{post['id']}").json()["items"][0]["caption"] == "保存后重启"
    history = client.get(f"{BASE}/posts/{post['id']}/attempts").json()
    assert {entry["status"] for entry in history} == {"prepared", "failed", "unknown"}
    assert client.delete(f"{BASE}/posts/{post['id']}?revision={post['revision']}").status_code == 204
    assert len(client.get(f"{BASE}/posts/{post['id']}/attempts").json()) == 3
    legacy_engine.dispose()
