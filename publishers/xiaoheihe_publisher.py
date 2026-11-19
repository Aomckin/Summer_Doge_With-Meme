"""Publisher Bridge adapter for the pinned xiaoheihe-cli installation."""
import argparse
import asyncio
import html
import json
import os
import re
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode, urlsplit
from uuid import UUID

from xhh_operator.article import prepare_article
from xhh_operator.errors import OperatorError
from xhh_operator.service import Operator, identifier


PLUGIN_ID = "xiaoheihe"
ARTICLE_SUFFIXES = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
DRAFT_ENDPOINT = "/bbs/app/api/link/post"
DRAFT_EDITOR = "https://www.xiaoheihe.cn/creator/editor/draft/article"


def browser_draft_form(form: dict, blocks: list[dict], plain_text: str) -> dict:
    images = iter(blocks[1:])

    def image_tag(match) -> str:
        item = next(images)
        url = html.escape(item["url"], quote=True)
        description = re.search(r'\sdata-description="([^"]*)"', match[0])
        return (f'<p><img data-type="image" data-original="{url}" data-height="{item["height"]}" '
                f'data-width="{item["width"]}" data-description="{description[1] if description else ""}"></p>')

    # The bridge generates every img in this HTML from its ordered local images.
    content = re.sub(r"<p>\s*<img\b[^>]*>\s*</p>|<img\b[^>]*>", image_tag, blocks[0]["text"])
    blocks[0]["text"] = re.sub(r">\s+<", "><", content)
    for image in blocks[1:]:
        image["width"] = str(image["width"])
        image["height"] = str(image["height"])
    return {**form, "desc": plain_text[:100], "words_count": str(len(plain_text)),
            "hashtags": form.get("hashtags", "[]"), "schedule_ts": "0", "declaration": "0",
            "text": json.dumps(blocks, ensure_ascii=False, separators=(",", ":"))}


def is_draft_endpoint(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and parts.netloc == "api.xiaoheihe.cn" and parts.path == DRAFT_ENDPOINT


def browser_draft_matches(result: dict, title: str, blocks: list[dict], account: str) -> bool:
    from xhh_operator.article import semantic_html
    from xhh_operator.media import same_asset
    from xhh_operator.service import link_id

    readback = result.get("readback") or {}
    record = (readback.get("result") or {}).get("link") or {}
    if record.get("title") != title or str(record.get("userid")) != account or link_id(record) != result["link_id"]:
        return False
    try:
        actual = json.loads(record["text"])
    except (KeyError, TypeError, ValueError):
        return False
    if not isinstance(actual, list) or any(not isinstance(item, dict) for item in actual):
        return False
    if [item.get("type") for item in actual] != [item["type"] for item in blocks]:
        return False
    content = actual[0].get("text")
    if not isinstance(content, str):
        return False
    # The editor may add empty paragraphs around image-only paragraphs during save.
    expected_body = re.sub(r"<p>\s*</p>", "", blocks[0]["text"])
    actual_body = re.sub(r"<p>\s*</p>", "", content)
    expected_urls = [block["url"] for block in blocks[1:]]
    inline_urls = re.findall(r'<img\b[^>]*\bdata-original="([^"]+)"', content)
    return (semantic_html(actual_body) == semantic_html(expected_body)
            and len(inline_urls) == len(expected_urls)
            and all(same_asset(url, image.get("url")) and same_asset(url, html.unescape(inline))
                    for url, image, inline in zip(expected_urls, actual[1:], inline_urls)))


class PublisherOperator(Operator):
    def __init__(self, plain_text: str):
        super().__init__()
        self.plain_text = plain_text
        self.upload_position = 0
        self.submitting = False
        self.draft_rejected = False

    def uploader(self):
        return self

    async def upload(self, item):
        self.upload_position += 1
        return await super().uploader().upload(item)

    async def _submit_post(self, form, blocks, *, draft, **kwargs):
        if not draft:
            self.submitting = True
            return await super()._submit_post(form, blocks, draft=False, **kwargs)

        form = browser_draft_form(form, blocks, self.plain_text)
        api = self.api

        async def request(path, **options):
            if path == DRAFT_ENDPOINT and options.get("form") is form:
                return await self.save_in_browser(form)
            return await api.request(path, **options)

        # Keep the CLI's existing bounded readback and media/author checks after the official save.
        self.api = SimpleNamespace(request=request)
        try:
            result = await super()._submit_post(form, blocks, draft=True, **kwargs)
        finally:
            self.api = api
        if result.get("readback") and result.get("link_id"):
            result["verified"] = browser_draft_matches(result, form["title"], blocks, self.session["user_id"])
        return result

    async def save_in_browser(self, form):
        from playwright.async_api import Error as BrowserError, async_playwright

        launch = {"headless": True, "args": ["--no-proxy-server"]}
        if os.name == "nt":
            edge = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
            launch["executable_path"] = str(edge / "Microsoft/Edge/Application/msedge.exe")
        cookies = []
        for saved in self.session["cookies"]:
            if saved.get("domain", "").lstrip(".") in ("xiaoheihe.cn", "www.xiaoheihe.cn", "api.xiaoheihe.cn"):
                cookie = {key: saved[key] for key in ("name", "value", "domain", "secure", "httpOnly", "sameSite") if key in saved}
                cookies.append({**cookie, "path": saved.get("path", "/")})
        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(**launch)
                try:
                    context = await browser.new_context()
                    await context.add_cookies(cookies)
                    page = await context.new_page()
                    save_clicked = False

                    async def save(route):
                        if route.request.method != "POST":
                            await route.continue_()
                            return
                        payload = route.request.post_data_json
                        if not save_clicked or self.submitting or not isinstance(payload, dict) or str(payload.get("draft")) != "1":
                            await route.abort()
                            return
                        self.submitting = True
                        await route.continue_(post_data=urlencode({**payload, **form, "draft": "1"}))

                    await page.route(is_draft_endpoint, save)
                    await page.goto(DRAFT_EDITOR, wait_until="domcontentloaded", timeout=30000)
                    save_button = page.get_by_text("保存草稿", exact=True)
                    await save_button.wait_for(timeout=15000)
                    editors = page.locator('[contenteditable="true"]:visible')
                    await editors.nth(0).fill(form["title"], timeout=10000)
                    await editors.nth(1).fill("草稿", timeout=10000)
                    async with page.expect_response(
                        lambda response: is_draft_endpoint(response.url) and response.request.method == "POST",
                        timeout=20000,
                    ) as pending:
                        save_clicked = True
                        await save_button.click(timeout=10000)
                    response = await pending.value
                    envelope = await response.json()
                    self.draft_rejected = (response.status == 200 and isinstance(envelope, dict)
                                           and envelope.get("status") == "failed")
                    if not response.ok or not isinstance(envelope, dict) or envelope.get("status") != "ok":
                        raise OperatorError("小黑盒网页草稿请求失败。", "editor")
                    return envelope
                finally:
                    await browser.close()
        except (BrowserError, ValueError):
            raise OperatorError("小黑盒网页编辑器无法完成该操作。", "editor") from None


async def write_remote(title: str, body: Path, plain_text: str, *, draft: bool, require_empty_drafts: bool):
    operator = None
    stage = "session"
    try:
        operator = PublisherOperator(plain_text)
        async with operator:
            account = await operator.require_account()
            if require_empty_drafts:
                stage = "draft_check"
                response = await operator.api.request("/bbs/app/link/drafts", params={"heybox_id": account})
                drafts = response.get("result")
                if not isinstance(drafts, dict) or drafts.get("links") != [] or drafts.get("total_page") not in (0, 1):
                    return "failed", {"error_code": "xiaoheihe_draft_check"}
            stage = "prepare"
            result = await operator.write_post(title, body.read_text(encoding="utf-8"),
                                               draft=draft, post_kind="article", base_dir=body.parent)
    except (OperatorError, OSError, ValueError) as error:
        cause = getattr(error, "code", None)
        if operator is not None and operator.draft_rejected:
            # A platform rejection is different from losing the response to a submitted draft.
            return "failed", {"error_code": "xiaoheihe_draft_rejected"}
        if operator is not None and operator.submitting:
            return "unknown", {"error_code": "xiaoheihe_submit_unknown"}
        if cause == "editor":
            return "failed", {"error_code": "xiaoheihe_editor_unavailable"}
        if cause == "auth":
            return "failed", {"error_code": "xiaoheihe_login_required"}
        if operator is not None and operator.upload_position:
            return "failed", {"error_code": f"xiaoheihe_upload_{operator.upload_position}"}
        return "failed", {"error_code": f"xiaoheihe_{stage}"}

    if result.get("accepted") is not True or result.get("is_draft") is not draft:
        return "unknown", {"error_code": "xiaoheihe_submit_unknown"}
    try:
        link_id = identifier(result.get("link_id") or "")
    except ValueError:
        return "unknown", {"error_code": "xiaoheihe_receipt_missing_id"}
    if result.get("verified") is not True:
        return "unknown", {"error_code": "xiaoheihe_readback_unverified", "external_post_id": link_id}
    return ("remote_draft" if draft else "published"), {"external_post_id": link_id}


def escape_article_text(text: str) -> str:
    # The CLI treats absolute paths in Markdown as upload candidates. Captions are literal text.
    return html.escape(text).replace("/", "&#47;").replace("\\", "&#92;")


def paragraph(text: str) -> str:
    escaped = escape_article_text(text)
    escaped = escaped.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")
    return f"<p>{escaped}</p>" if text else ""


def article(root: Path, manifest: dict) -> tuple[str, Path]:
    title = manifest["title"].strip()
    if not title:
        raise ValueError("title_required")
    blocks = [paragraph(manifest["intro_text"])]
    assets = []
    for position, item in enumerate(manifest["items"]):
        suffix = ARTICLE_SUFFIXES[item["mime_type"]]
        asset = f"assets/{position + 1:03d}.{suffix}"
        if item["asset"] != asset or item["position"] != position:
            raise ValueError("invalid_package")
        path = (root / asset).resolve()
        if path.parent != (root / "assets") or not path.is_file():
            raise ValueError("invalid_package")
        assets.append(path)
        # The native description editor is a single-line text input.
        description = escape_article_text(" ".join(item["caption"].splitlines()))
        blocks.append(f'<p><img src="{asset}" alt="" data-description="{description}"></p>')
    if not assets:
        raise ValueError("invalid_package")
    blocks.append(paragraph(manifest["outro_text"]))
    body = root / "xiaoheihe-article.md"
    body.write_text("\n\n".join(filter(None, blocks)), encoding="utf-8")
    # Preflight the same parser used by post create before any account access or upload.
    prepared = prepare_article(body.read_text(encoding="utf-8"), base_dir=root)
    if [image.path for image in prepared.images] != assets:
        raise ValueError("invalid_package")
    return title, body


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path)
    parser.add_argument("--action", choices=("dry_run", "remote_draft", "publish"))
    parser.add_argument("--require-empty-drafts", action="store_true")
    parser.add_argument("--login-qr", type=Path)
    parser.add_argument("--session-dir", required=True, type=Path)
    args = parser.parse_args()
    os.environ["XHH_OPERATOR_HOME"] = str(args.session_dir.resolve())
    if args.login_qr is not None:
        from xhh_operator.cli import main as cli_main

        cli_main(["login", "--qr-file", str(args.login_qr), "--timeout", "120"])
        return 0
    if args.package is None or args.action is None:
        parser.error("--package and --action are required for publishing")
    if args.require_empty_drafts and args.action != "remote_draft":
        parser.error("--require-empty-drafts is only valid for remote_draft")
    root = args.package.resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    attempt_id = str(UUID(manifest["request_id"]))

    def reply(status: str, **details) -> int:
        print(json.dumps({"attempt_id": attempt_id, "plugin_id": PLUGIN_ID, "status": status, **details}))
        return 0

    try:
        if manifest["protocol_version"] != "1" or manifest["content_type"] != "image_text":
            return reply("failed", error_code="unsupported")
        title, body = article(root, manifest)
    except (KeyError, TypeError, OSError, ValueError) as error:
        code = "title_required" if error.args == ("title_required",) else "invalid_package"
        return reply("failed", error_code=code)
    if args.action == "dry_run":
        return reply("prepared")

    plain_text = "\n".join(filter(None, [manifest["intro_text"], manifest["outro_text"]])).strip()
    status, details = asyncio.run(write_remote(
        title, body, plain_text, draft=args.action == "remote_draft", require_empty_drafts=args.require_empty_drafts,
    ))
    return reply(status, **details)


if __name__ == "__main__":
    raise SystemExit(main())
