import re
import unicodedata
from pathlib import PurePosixPath

WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
DANGEROUS_RE = re.compile(r'[<>:"/\\|?*]')


def sanitize_stem(value: str | None, fallback: str, *, max_length: int = 120) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = CONTROL_RE.sub("", text)
    text = DANGEROUS_RE.sub("_", text).replace("..", "_")
    text = re.sub(r"\s+", " ", text).strip(" ._")
    if not text:
        text = fallback
    if text.upper() in WINDOWS_RESERVED:
        text = f"_{text}"
    return text[:max_length].rstrip(" .") or fallback


def safe_extension(filename: str, mime_type: str | None = None) -> str:
    by_mime = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    if mime_type in by_mime:
        return by_mime[mime_type]
    suffix = PurePosixPath(filename.replace("\\", "/")).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".zip"} else ""


def safe_download_filename(
    title: str | None,
    fallback: str,
    extension: str,
    *,
    max_stem_length: int = 120,
) -> str:
    suffix = extension if extension.startswith(".") else f".{extension}"
    return f"{sanitize_stem(title, fallback, max_length=max_stem_length)}{suffix.lower()}"


def unique_archive_name(name: str, used: set[str]) -> str:
    """Return a stable, relative and traversal-free ZIP entry name."""
    parts = [
        sanitize_stem(part, "item", max_length=100)
        for part in name.replace("\\", "/").split("/")
        if part not in {"", ".", ".."}
    ]
    safe = "/".join(parts) or "item"
    path = PurePosixPath(safe)
    parent = "" if str(path.parent) == "." else f"{path.parent.as_posix()}/"
    stem, suffix = path.stem, path.suffix
    candidate = safe
    counter = 2
    while candidate.casefold() in used:
        candidate = f"{parent}{stem}_{counter}{suffix}"
        counter += 1
    used.add(candidate.casefold())
    return candidate
