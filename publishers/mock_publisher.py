"""Standalone offline Publisher protocol v1 consumer (Python standard library only)."""
import argparse
import json
import re
from datetime import UTC, datetime
from hashlib import file_digest
from pathlib import Path
from time import sleep
from uuid import UUID

MIME_SIGNATURES = {
    "image/png": (".png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/jpeg": (".jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/webp": (".webp", lambda data: data[:4] == b"RIFF" and data[8:12] == b"WEBP"),
    "image/gif": (".gif", lambda data: data.startswith((b"GIF87a", b"GIF89a"))),
}


def read_package(root: Path) -> dict:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if manifest["protocol_version"] != "1" or manifest["content_type"] != "image_text":
        raise ValueError("unsupported package version/type")
    identity = UUID(manifest["request_id"])
    if identity.version != 4 or any(type(manifest[key]) is not int or manifest[key] < 1 for key in ("post_id", "revision")):
        raise ValueError("invalid identity")
    if any(not isinstance(manifest[field], str) for field in ("title", "intro_text", "outro_text")):
        raise ValueError("invalid post text")
    items = manifest["items"]
    if not isinstance(items, list) or not items:
        raise ValueError("invalid items")
    assets = (root / "assets").resolve()
    if assets.parent != root:
        raise ValueError("assets directory escapes package")
    for position, item in enumerate(items):
        if type(item["position"]) is not int or item["position"] != position or not isinstance(item["caption"], str):
            raise ValueError("invalid position or caption")
        if any(type(item[key]) is not int or item[key] <= 0 for key in ("meme_id", "meme_image_id", "size", "width", "height")):
            raise ValueError("invalid asset metadata")
        suffix, match_signature = MIME_SIGNATURES[item["mime_type"]]
        name = f"{position + 1:03d}{suffix}"
        if item["asset"] != f"assets/{name}" or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("invalid path or checksum")
        path = (assets / name).resolve()
        if path.parent != assets:
            raise ValueError("asset escapes package")
        with path.open("rb") as file:
            if path.stat().st_size != item["size"] or not match_signature(file.read(12)):
                raise ValueError("bad asset size or signature")
            file.seek(0)
            if file_digest(file, "sha256").hexdigest() != item["sha256"]:
                raise ValueError("bad asset checksum")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--action", required=True)
    parser.add_argument("--plugin-id", default="mock")
    parser.add_argument("--simulate", choices=["success", "failure", "timeout", "crash", "invalid"], default="success")
    parser.add_argument("--report-dir", type=Path)
    args = parser.parse_args()
    package = args.package.resolve()
    result = {"attempt_id": "", "plugin_id": args.plugin_id, "status": "failed",
              "started_at": datetime.now(UTC).isoformat()}
    try:
        header = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
        result["attempt_id"] = str(UUID(header["request_id"]))
        manifest = read_package(package)
    except (ValueError, KeyError, TypeError, OSError):
        result.update(error_code="invalid_package", error_message="Invalid package or asset")
        result["finished_at"] = datetime.now(UTC).isoformat()
        print(json.dumps(result))
        return
    if args.action not in {"prepare", "dry_run"}:
        result.update(error_code="unsupported", error_message="This action is unsupported")
    elif args.simulate == "failure":
        result.update(error_code="mock_failure", error_message="Simulated failure")
    elif args.simulate == "timeout":
        sleep(300)
    elif args.simulate == "crash":
        raise SystemExit(2)
    elif args.simulate == "invalid":
        print("invalid result")
        return
    else:
        report_dir = args.report_dir or package
        report_dir.mkdir(parents=True, exist_ok=True)
        report_file = report_dir / f"mock-{result['attempt_id']}.json"
        report_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        result["status"] = "prepared"
    result["finished_at"] = datetime.now(UTC).isoformat()
    print(json.dumps(result))


if __name__ == "__main__":
    main()
