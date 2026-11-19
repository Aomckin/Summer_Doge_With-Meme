import importlib.util
import json
import re
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock, call
from uuid import uuid4

import pytest


@pytest.fixture
def adapter(monkeypatch, tmp_path):
    class OperatorError(Exception):
        def __init__(self, code):
            self.code = code

    account = AsyncMock(return_value="test-account")
    draft_box = AsyncMock(return_value={"result": {"links": [], "total_page": 1}})
    upload = AsyncMock()
    submit = AsyncMock()

    class Operator:
        def __init__(self):
            self.api = SimpleNamespace(request=draft_box)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def require_account(self):
            return await account()

        def uploader(self):
            return SimpleNamespace(upload=upload)

        async def _submit_post(self, form, blocks, *, draft):
            if draft:
                return await self.api.request("/bbs/app/api/link/post", form=form)
            return await submit(form, draft=False)

        async def write_post(self, title, content, *, draft, post_kind, base_dir):
            assert post_kind == "article" and base_dir == tmp_path
            for path in paths:
                await self.uploader().upload(path)
            blocks = [
                {"type": "html", "text": content.replace('src="assets/001.png"', 'src="https://example.invalid/a"')
                 .replace('src="assets/002.gif"', 'src="https://example.invalid/b"')},
                {"type": "img", "url": "https://example.invalid/a", "width": 12, "height": 10},
                {"type": "img", "url": "https://example.invalid/b", "width": 16, "height": 14},
            ]
            return await self._submit_post({"title": title, "words_count": "3"}, blocks, draft=draft)

    def identifier(value):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value):
            raise ValueError
        return value


    assets = tmp_path / "assets"
    assets.mkdir()
    paths = [assets / "001.png", assets / "002.gif"]
    for path in paths:
        path.touch()
    manifest = {
        "request_id": str(uuid4()),
        "protocol_version": "1",
        "content_type": "image_text",
        "title": "中文合集",
        "intro_text": "开头",
        "outro_text": "结尾",
        "items": [
            {"position": 0, "asset": "assets/001.png", "mime_type": "image/png",
             "caption": "第一行\n第二行 <img src=x> C:\\sample.png /sample.png & \"引号\""},
            {"position": 1, "asset": "assets/002.gif", "mime_type": "image/gif", "caption": ""},
        ],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("XHH_OPERATOR_HOME", str(tmp_path))
    for name, attributes in {
        "article": {"prepare_article": Mock(return_value=SimpleNamespace(images=[SimpleNamespace(path=p) for p in paths]))},
        "service": {"Operator": Operator, "identifier": identifier},
        "errors": {"OperatorError": OperatorError},
    }.items():
        module = ModuleType(f"xhh_operator.{name}")
        vars(module).update(attributes)
        monkeypatch.setitem(sys.modules, module.__name__, module)
    filename = Path(__file__).resolve().parents[1] / "publishers/xiaoheihe_publisher.py"
    spec = importlib.util.spec_from_file_location("adapter", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    async def browser_save(operator, form):
        operator.submitting = True
        try:
            return await submit(form, draft=True)
        except OperatorError as error:
            operator.draft_rejected = error.code == "draft_rejected"
            raise

    monkeypatch.setattr(module.PublisherOperator, "save_in_browser", browser_save)

    def run(action, *options):
        monkeypatch.setattr(sys, "argv", [str(filename), "--package", str(tmp_path), "--action", action,
                                         "--session-dir", str(tmp_path / "session"), *options])
        return module.main()

    return SimpleNamespace(run=run, account=account, draft_box=draft_box, upload=upload,
                           submit=submit, error=OperatorError, paths=paths)


def test_dry_run_preserves_order_and_does_not_open_a_session(adapter, tmp_path, capsys):
    assert adapter.run("dry_run") == 0
    assert json.loads(capsys.readouterr().out)["status"] == "prepared"
    body = (tmp_path / "xiaoheihe-article.md").read_text(encoding="utf-8")
    assert body.index("001.png") < body.index('data-description="第一行 第二行') < body.index("002.gif")
    assert "<p>第一行" not in body
    assert "&lt;img src=x&gt;" in body
    assert "C:&#92;sample.png &#47;sample.png" in body
    adapter.account.assert_not_awaited()
    adapter.upload.assert_not_awaited()
    adapter.submit.assert_not_awaited()


@pytest.mark.parametrize(("action", "expected"), [("remote_draft", "remote_draft"), ("publish", "published")])
def test_remote_receipt_accepts_platform_id_and_requires_verified_readback(adapter, action, expected, capsys):
    draft = action == "remote_draft"
    adapter.submit.return_value = {"accepted": True, "verified": False, "is_draft": draft, "link_id": "ab-42"}
    assert adapter.run(action) == 0
    result = json.loads(capsys.readouterr().out)
    assert (result["status"], result["error_code"], result["external_post_id"]) == (
        "unknown", "xiaoheihe_readback_unverified", "ab-42",
    )
    assert adapter.upload.await_args_list == [call(path) for path in adapter.paths]
    adapter.submit.assert_awaited_once()
    form = adapter.submit.await_args.args[0]
    assert form["title"] == "中文合集" and adapter.submit.await_args.kwargs["draft"] is draft
    if draft:
        assert form["desc"] == "开头\n结尾"
        assert tuple(form[k] for k in ("words_count", "hashtags", "schedule_ts", "declaration")) == (
            str(len(form["desc"])), "[]", "0", "0",
        )
        blocks = json.loads(form["text"])
        assert blocks[0]["text"] == (
            '<p>开头</p><p><img data-type="image" data-original="https://example.invalid/a" '
            'data-height="10" data-width="12" data-description="第一行 第二行 &lt;img src=x&gt; '
            'C:&#92;sample.png &#47;sample.png &amp; &quot;引号&quot;"></p>'
            '<p><img data-type="image" data-original="https://example.invalid/b" '
            'data-height="14" data-width="16" data-description=""></p><p>结尾</p>'
        )
        assert blocks[1] == {"type": "img", "url": "https://example.invalid/a", "width": "12", "height": "10"}
    else:
        assert form == {"title": "中文合集", "words_count": "3"}
    adapter.submit.return_value["verified"] = True
    assert adapter.run(action) == 0
    assert json.loads(capsys.readouterr().out)["status"] == expected


def test_remote_write_requires_a_verified_session(adapter, capsys):
    adapter.account.side_effect = adapter.error("auth")
    assert adapter.run("remote_draft") == 0
    result = json.loads(capsys.readouterr().out)
    assert (result["status"], result["error_code"]) == ("failed", "xiaoheihe_login_required")
    adapter.upload.assert_not_awaited()
    adapter.submit.assert_not_awaited()


def test_second_image_failure_stops_before_remote_submit(adapter, capsys):
    adapter.upload.side_effect = [None, adapter.error("network")]
    assert adapter.run("remote_draft") == 0
    result = json.loads(capsys.readouterr().out)
    assert (result["status"], result["error_code"]) == ("failed", "xiaoheihe_upload_2")
    adapter.submit.assert_not_awaited()


def test_submit_network_failure_is_unknown(adapter, capsys):
    adapter.submit.side_effect = adapter.error("network")
    assert adapter.run("remote_draft") == 0
    result = json.loads(capsys.readouterr().out)
    assert (result["status"], result["error_code"]) == ("unknown", "xiaoheihe_submit_unknown")


def test_platform_rejection_of_draft_is_definite_failure(adapter, capsys):
    adapter.submit.side_effect = adapter.error("draft_rejected")
    assert adapter.run("remote_draft") == 0
    reply = capsys.readouterr().out
    result = json.loads(reply)
    assert (result["status"], result["error_code"]) == ("failed", "xiaoheihe_draft_rejected")


@pytest.mark.parametrize("drafts", [
    {"links": [{"link_id": "existing"}], "total_page": 1},
    {"links": [], "total_page": 2},
    {"total_page": 1},
])
def test_guarded_retry_requires_a_confirmed_empty_draft_box(adapter, capsys, drafts):
    adapter.draft_box.return_value = {"result": drafts}
    assert adapter.run("remote_draft", "--require-empty-drafts") == 0
    result = json.loads(capsys.readouterr().out)
    assert (result["status"], result["error_code"]) == ("failed", "xiaoheihe_draft_check")
    adapter.draft_box.assert_awaited_once_with("/bbs/app/link/drafts", params={"heybox_id": "test-account"})
    adapter.upload.assert_not_awaited()
    adapter.submit.assert_not_awaited()


def test_guarded_retry_creates_once_when_draft_box_is_empty(adapter, capsys):
    adapter.submit.return_value = {"accepted": True, "verified": True, "is_draft": True, "link_id": "42"}
    assert adapter.run("remote_draft", "--require-empty-drafts") == 0
    assert json.loads(capsys.readouterr().out)["status"] == "remote_draft"
    adapter.draft_box.assert_awaited_once()
    adapter.submit.assert_awaited_once()
