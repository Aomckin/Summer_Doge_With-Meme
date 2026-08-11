from datetime import UTC, datetime
import json
from pathlib import Path

from pydantic import ValidationError

from app.config import DATABASE_PATH
from app.services.tag_maintenance_service import TagMaintenancePlan, TagMaintenanceService
from app.schemas.enrichment import EnrichmentCandidate
from app.services.meme_enrichment_service import MemeEnrichmentService
from app.storage.image_storage import ImageStorage

from .database import close_session, make_session
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
    suggestion_id: int,
) -> dict[str, object]:
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "mode": "submitted-for-review",
        "meme_id": candidate.meme_id,
        "add_tags": list(plan.add_tags),
        "remove_tags": list(plan.remove_tags),
        "before": [{"name": name, "source": source} for name, source in plan.before],
        "after": [{"name": name, "source": source} for name, source in plan.after],
        "confidence": candidate.confidence,
        "reason": candidate.reason,
        "suggested_title": candidate.suggested_title,
        "suggested_description": candidate.suggested_description,
        "suggested_template_name": candidate.suggested_template_name,
        "suggestion_id": suggestion_id,
    }


def import_candidates(
    candidates_path: Path,
    *,
    database_path: Path = DATABASE_PATH,
    allow_protected_removal: bool = False,
    audit_path: Path | None = None,
) -> dict[str, object]:
    database_path = database_path.resolve()
    if not database_path.is_file():
        raise FileNotFoundError(f"SQLite database does not exist: {database_path}")
    candidates = load_candidates(candidates_path)
    session = make_session(database_path)
    try:
        service = TagMaintenanceService(session)
        enrichment = MemeEnrichmentService(
            session,
            ImageStorage(database_path.parent / "images", database_path.parent / "thumbnails"),
        )
        plans = [
            service.plan(
                candidate.meme_id,
                add_tags=candidate.add_tags,
                remove_tags=candidate.remove_tags,
                allow_protected_removal=allow_protected_removal,
            )
            for candidate in candidates
        ]
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S_%fZ")
        resolved_audit_path = (
            audit_path
            or candidates_path.parent / f"audit_{timestamp}.jsonl"
        ).resolve()
        resolved_audit_path.parent.mkdir(parents=True, exist_ok=True)
        audit_records: list[dict[str, object]] = []
        try:
            for candidate, plan in zip(candidates, plans, strict=True):
                has_metadata = bool({
                    "suggested_title", "suggested_description", "suggested_template_name"
                } & candidate.model_fields_set)
                if not has_metadata and not plan.add_tags and not plan.remove_tags:
                    continue
                confidence = candidate.confidence
                if isinstance(confidence, (int, float)):
                    confidence = {"tags": float(confidence)}
                suggestion = enrichment.create_suggestion(
                    EnrichmentCandidate(
                        meme_id=candidate.meme_id,
                        suggested_title=candidate.suggested_title,
                        suggested_description=candidate.suggested_description,
                        add_tags=list(plan.add_tags),
                        remove_tags=list(plan.remove_tags),
                        suggested_template_name=candidate.suggested_template_name,
                        confidence=confidence,
                        reason=candidate.reason,
                    ),
                    source="luna",
                    commit=False,
                )
                audit_records.append(_audit_record(candidate, plan, suggestion_id=suggestion.id))
            session.commit()
        except Exception:
            session.rollback()
            raise
        with resolved_audit_path.open("x", encoding="utf-8", newline="\n") as audit:
            for record in audit_records:
                audit.write(json.dumps(record, ensure_ascii=False) + "\n")
    finally:
        close_session(session)
    return {
        "mode": "submitted-for-review",
        "candidate_count": len(candidates),
        "changed_meme_count": len(audit_records),
        "suggestion_count": len(audit_records),
        "audit_path": resolved_audit_path,
    }
