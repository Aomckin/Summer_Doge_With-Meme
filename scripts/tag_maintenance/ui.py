from __future__ import annotations

from html import escape
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
import webbrowser

from app.config import DATABASE_PATH

from .exporter import export_batch
from .importer import import_candidates


PROMPT_PATH = Path(__file__).with_name("LUNA_PROMPT.txt")


def _batch_dir(work_dir: Path, batch_number: int) -> Path:
    return work_dir / f"batch_{batch_number:04d}"


def _load_manifest(work_dir: Path, batch_number: int) -> dict[str, object] | None:
    path = _batch_dir(work_dir, batch_number) / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def _image_path(
    work_dir: Path,
    batch_number: int,
    meme_id: int,
    position: int,
) -> Path | None:
    manifest = _load_manifest(work_dir, batch_number)
    if manifest is None:
        return None
    for meme in manifest["memes"]:
        if meme["meme_id"] != meme_id:
            continue
        for image in meme["images"]:
            if image["position"] == position:
                path = Path(image["absolute_path"])
                return path if path.is_file() else None
    return None


def _copy_block(label: str, value: str) -> str:
    return (
        f'<label>{escape(label)}</label>'
        f'<div class="copy"><textarea readonly>{escape(value)}</textarea>'
        '<button type="button" onclick="copyPrevious(this)">复制</button></div>'
    )


def render_page(
    work_dir: Path,
    batch_number: int,
    *,
    message: str = "",
) -> str:
    manifest = _load_manifest(work_dir, batch_number)
    batch_name = f"batch_{batch_number:04d}"
    batch_path = _batch_dir(work_dir, batch_number)
    relative_batch = f".\\data\\tagging_work\\{batch_name}"
    prompt = PROMPT_PATH.read_text(encoding="utf-8").replace(
        "<BATCH_DIR>", str(batch_path.resolve())
    )
    export_command = (
        ".\\.venv\\Scripts\\python.exe -m scripts.tag_maintenance export "
        f"--batch {batch_number} --batch-size 10"
    )
    dry_run_command = (
        ".\\.venv\\Scripts\\python.exe -m scripts.tag_maintenance import "
        f"{relative_batch}\\candidates.jsonl"
    )
    apply_command = dry_run_command + " --apply"

    cards = ""
    if manifest:
        for meme in manifest["memes"]:
            images = "".join(
                (
                    f'<figure><img loading="lazy" src="/image/{batch_number}/'
                    f'{meme["meme_id"]}/{image["position"]}" '
                    f'alt="Meme {meme["meme_id"]} image {image["position"]}">'
                    f'<figcaption>position {image["position"]}</figcaption></figure>'
                )
                for image in meme["images"]
            )
            tags = ", ".join(
                f'{tag["name"]} ({tag["source"]})' for tag in meme["current_tags"]
            ) or "无"
            cards += (
                f'<article><h3>#{meme["meme_id"]} {escape(meme["title"])}</h3>'
                f'<p>{escape(meme["description"] or "无描述")}</p>'
                f'<p><strong>当前标签：</strong>{escape(tags)}</p>'
                f'<div class="images">{images}</div></article>'
            )
    else:
        cards = f"<p>尚未导出 {batch_name}。</p>"

    notice = f'<p class="notice">{escape(message)}</p>' if message else ""
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Meme Vault 离线标签</title><style>
body{{font:15px system-ui;margin:auto;max-width:1100px;padding:24px;background:#f5f5f5;color:#222}}
h1,h2,h3{{margin:.4em 0}}section,article{{background:white;padding:16px;margin:16px 0;border-radius:10px}}
form{{display:flex;gap:8px;align-items:end;flex-wrap:wrap}}label{{display:block;font-weight:600;margin-top:8px}}
input,button,textarea{{font:inherit;padding:8px}}button{{cursor:pointer}}.notice{{background:#e7f6e7;padding:10px}}
.images{{display:flex;gap:12px;overflow:auto}}figure{{margin:0;min-width:220px}}img{{display:block;max-width:100%;max-height:420px}}
figcaption{{color:#666}}.copy{{display:flex;gap:8px}}textarea{{width:100%;min-height:42px}}.prompt textarea{{min-height:360px}}
</style></head><body><h1>Meme Vault 离线标签</h1>{notice}
<section><h2>批次操作</h2><form method="post" action="/export">
<label>批次<input name="batch" type="number" min="1" value="{batch_number}"></label>
<label>每批 Meme<input name="batch_size" type="number" min="1" max="100" value="10"></label>
<button>导出并显示</button></form>
<form method="post" action="/dry-run"><input name="batch" type="hidden" value="{batch_number}">
<button>校验 / dry-run 当前候选</button></form></section>
<section><h2>PowerShell 预设</h2>{_copy_block("导出", export_command)}
{_copy_block("dry-run", dry_run_command)}{_copy_block("apply（人工确认后使用）", apply_command)}</section>
<section class="prompt"><h2>交给 Codex Luna 的提示词</h2>{_copy_block("直接复制整段", prompt)}</section>
<section><h2>{batch_name} 图片</h2>{cards}</section>
<script>function copyPrevious(button){{navigator.clipboard.writeText(button.previousElementSibling.value);button.textContent='已复制'}}</script>
</body></html>"""


def run_ui(
    *,
    database_path: Path = DATABASE_PATH,
    work_dir: Path | None = None,
    port: int = 8765,
    open_browser: bool = True,
) -> None:
    resolved_work_dir = (work_dir or database_path.parent / "tagging_work").resolve()

    class Handler(BaseHTTPRequestHandler):
        def _page(self, batch: int, message: str = "", status: int = 200) -> None:
            body = render_page(resolved_work_dir, batch, message=message).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                query = parse_qs(parsed.query)
                self._page(int(query.get("batch", ["1"])[0]), query.get("message", [""])[0])
                return
            parts = parsed.path.strip("/").split("/")
            if len(parts) == 4 and parts[0] == "image":
                try:
                    path = _image_path(resolved_work_dir, *(int(value) for value in parts[1:]))
                except (ValueError, KeyError, TypeError):
                    path = None
                if path:
                    content = path.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                    return
            self.send_error(404)

        def do_POST(self) -> None:
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 65536)
                form = parse_qs(self.rfile.read(length).decode("utf-8"))
                batch = int(form.get("batch", ["1"])[0])
                if self.path == "/export":
                    size = int(form.get("batch_size", ["10"])[0])
                    if _load_manifest(resolved_work_dir, batch):
                        message = f"batch_{batch:04d} 已存在，直接显示；候选文件未覆盖"
                    else:
                        export_batch(
                            database_path=database_path,
                            work_dir=resolved_work_dir,
                            batch_number=batch,
                            batch_size=size,
                        )
                        message = f"batch_{batch:04d} 已导出"
                elif self.path == "/dry-run":
                    result = import_candidates(
                        _batch_dir(resolved_work_dir, batch) / "candidates.jsonl",
                        database_path=database_path,
                    )
                    message = f"dry-run 完成：{result['changed_meme_count']} 个 Meme 有变化"
                else:
                    self.send_error(404)
                    return
                self.send_response(303)
                self.send_header("Location", "/?" + urlencode({"batch": batch, "message": message}))
                self.end_headers()
            except (OSError, ValueError, LookupError) as exc:
                self._page(locals().get("batch", 1), str(exc), 400)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"Local tag maintenance UI: {url} (Ctrl+C to stop)")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
