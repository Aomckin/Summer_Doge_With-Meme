from datetime import UTC, datetime
import json
from pathlib import Path

from app.config import DATABASE_PATH
from app.repositories.meme_repository import MemeRepository
from app.repositories.tag_repository import TagRepository

from .database import close_session, make_session
from .schemas import TagCandidate


def _json_dump(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def export_batch(
    *,
    database_path: Path = DATABASE_PATH,
    work_dir: Path | None = None,
    batch_number: int = 1,
    batch_size: int = 10,
) -> Path:
    if batch_number < 1:
        raise ValueError("batch_number must be at least 1")
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    database_path = database_path.resolve()
    if not database_path.is_file():
        raise FileNotFoundError(f"SQLite database does not exist: {database_path}")
    output_root = (work_dir or database_path.parent / "tagging_work").resolve()
    batch_dir = output_root / f"batch_{batch_number:04d}"
    if batch_dir.exists() and any(batch_dir.iterdir()):
        raise FileExistsError(
            f"Batch already exists and will not be overwritten: {batch_dir}"
        )
    batch_dir.mkdir(parents=True, exist_ok=True)

    session = make_session(database_path)
    try:
        memes = MemeRepository(session).list(
            offset=(batch_number - 1) * batch_size,
            limit=batch_size,
        )
        records: list[dict[str, object]] = []
        image_paths: dict[str, list[dict[str, object]]] = {}
        candidates: list[dict[str, object]] = []
        for meme in memes:
            images: list[dict[str, object]] = []
            for image in sorted(meme.images, key=lambda item: item.position):
                absolute_path = (database_path.parent / "images" / image.file_path).resolve()
                image_info = {
                    "image_id": image.id,
                    "position": image.position,
                    "original_filename": image.original_filename,
                    "mime_type": image.mime_type,
                    "width": image.width,
                    "height": image.height,
                    "relative_path": absolute_path.relative_to(database_path.parent).as_posix(),
                    "absolute_path": str(absolute_path),
                }
                images.append(image_info)
            current_tags = [
                {
                    "name": link.tag.name,
                    "source": link.source,
                    "confidence": link.confidence,
                }
                for link in meme.tag_links
            ]
            records.append(
                {
                    "meme_id": meme.id,
                    "title": meme.title,
                    "description": meme.description,
                    "images": images,
                    "current_tags": current_tags,
                }
            )
            image_paths[str(meme.id)] = [
                {"position": item["position"], "absolute_path": item["absolute_path"]}
                for item in images
            ]
            candidates.append(
                {
                    "meme_id": meme.id,
                    "add_tags": [],
                    "remove_tags": [],
                    "confidence": 0.0,
                    "reason": "TODO: Codex local image review",
                }
            )

        manifest = {
            "schema_version": 1,
            "generated_at": datetime.now(UTC).isoformat(),
            "batch_number": batch_number,
            "batch_size": batch_size,
            "sort": "meme_id ASC",
            "memes": records,
        }
        tags = [
            {
                "id": tag.id,
                "name": tag.name,
                "category": tag.category,
                "description": tag.description,
            }
            for tag in TagRepository(session).list()
        ]
        _json_dump(batch_dir / "manifest.json", manifest)
        _json_dump(batch_dir / "tags.json", tags)
        _json_dump(batch_dir / "image_paths.json", image_paths)
        _json_dump(batch_dir / "candidate.schema.json", TagCandidate.model_json_schema())
        with (batch_dir / "candidates.jsonl").open("w", encoding="utf-8", newline="\n") as handle:
            for candidate in candidates:
                handle.write(json.dumps(candidate, ensure_ascii=False) + "\n")
    finally:
        close_session(session)
    return batch_dir
