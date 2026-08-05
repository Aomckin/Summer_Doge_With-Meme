from datetime import UTC, datetime
import json
from pathlib import Path

from pydantic import ValidationError

from app.config import DATABASE_PATH
from app.services.meme_service import MemeService, TagMaintenancePlan

from .database import backup_sqlite_database, close_session, make_session
from .schemas import TagCandidate


def load_candidates(path: Path) -> list[TagCandidate]:
    candidates: list[TagCandidate] = []
    seen_ids: set[int] = set()
    with path.open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            if not raw_line.strip():
                continue
            try:
                candidate = TagCandidate.model_validate_json(raw_line)
            except (ValidationError, ValueError) as exc:
                raise ValueError(f"Invalid candidate on line {line_number}: {exc}") from exc
            if candidate.meme_id in seen_ids:
                raise ValueError(
                    f"Invalid candidate on line {line_number}: duplicate meme_id {candidate.meme_id}"
                )
            seen_ids.add(candidate.meme_id)
            candidates.append(candidate)
    return candidates


def _audit_record(
    candidate: TagCandidate,
    plan: TagMaintenancePlan,
    *,
    applied: bool,
    backup_path: Path | None,
) -> dict[str, object]:
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "mode": "apply" if applied else "dry-run",
        "meme_id": candidate.meme_id,
        "add_tags": list(plan.add_tags),
        "remove_tags": list(plan.remove_tags),
        "before": [{"name": name, "source": source} for name, source in plan.before],
        "after": [{"name": name, "source": source} for name, source in plan.after],
        "confidence": candidate.confidence,
        "reason": candidate.reason,
        "backup_path": str(backup_path) if backup_path else None,
    }


def import_candidates(
    candidates_path: Path,
    *,
    database_path: Path = DATABASE_PATH,
    apply: bool = False,
    allow_protected_removal: bool = False,
    backup_dir: Path | None = None,
    audit_path: Path | None = None,
) -> dict[str, object]:
    database_path = database_path.resolve()
    if not database_path.is_file():
        raise FileNotFoundError(f"SQLite database does not exist: {database_path}")
    candidates = load_candidates(candidates_path)
    session = make_session(database_path)
    backup_path: Path | None = None
    try:
        service = MemeService(session)
        plans = [
            service.plan_tag_maintenance(
                candidate.meme_id,
                add_tags=candidate.add_tags,
                remove_tags=candidate.remove_tags,
                allow_protected_removal=allow_protected_removal,
            )
            for candidate in candidates
        ]
        if apply:
            backup_path = backup_sqlite_database(
                database_path,
                (backup_dir or database_path.parent / "tagging_work" / "backups").resolve(),
            )

        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S_%fZ")
        resolved_audit_path = (
            audit_path
            or candidates_path.parent / f"audit_{timestamp}.jsonl"
        ).resolve()
        resolved_audit_path.parent.mkdir(parents=True, exist_ok=True)
        changed = 0
        with resolved_audit_path.open("x", encoding="utf-8", newline="\n") as audit:
            for candidate, plan in zip(candidates, plans, strict=True):
                if not plan.add_tags and not plan.remove_tags:
                    continue
                if apply:
                    plan = service.apply_tag_maintenance(
                        candidate.meme_id,
                        add_tags=candidate.add_tags,
                        remove_tags=candidate.remove_tags,
                        confidence=candidate.confidence,
                        allow_protected_removal=allow_protected_removal,
                    )
                audit.write(
                    json.dumps(
                        _audit_record(
                            candidate,
                            plan,
                            applied=apply,
                            backup_path=backup_path,
                        ),
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                audit.flush()
                changed += 1
    finally:
        close_session(session)
    return {
        "mode": "apply" if apply else "dry-run",
        "candidate_count": len(candidates),
        "changed_meme_count": changed,
        "audit_path": resolved_audit_path,
        "backup_path": backup_path,
    }
