from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Sequence

from sqlalchemy.orm import Session

from app.ai.client import AIClient, AIInputImage, AIInvalidResponseError, AITemplateCandidate
from app.models.enrichment import MemeEnrichmentSuggestion
from app.models.meme import Meme
from app.repositories.enrichment_repository import EnrichmentRepository
from app.repositories.tag_repository import TagRepository
from app.repositories.template_repository import TemplateRepository
from app.schemas.enrichment import EnrichmentCandidate
from app.services.derived_data_invalidation import invalidate_meme_semantic_data
from app.storage.image_storage import ImageStorage


class EnrichmentNotFoundError(LookupError):
    pass


class EnrichmentConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class EnrichmentAttempt:
    candidate: EnrichmentCandidate | None = None
    model_name: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    response_summary: str | None = None
    error: Exception | None = None


class MemeEnrichmentService:
    """Single suggestion creation and safe-apply boundary for every producer."""

    def __init__(self, session: Session, storage: ImageStorage) -> None:
        self.session = session
        self.storage = storage
        self.repository = EnrichmentRepository(session)
        self.tags = TagRepository(session)
        self.templates = TemplateRepository(session)

    @staticmethod
    def source_hash(meme: Meme) -> str:
        payload = {
            "title": meme.title,
            "description": meme.description,
            "tags": sorted(link.tag.name for link in meme.tag_links),
            "template_id": meme.template_id,
            "images": [
                {"position": image.position, "file_hash": image.file_hash}
                for image in sorted(meme.images, key=lambda value: value.position)
            ],
        }
        return sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def get_meme(self, meme_id: int) -> Meme:
        meme = self.repository.get_meme(meme_id)
        if meme is None:
            raise EnrichmentNotFoundError(f"Meme {meme_id} does not exist")
        return meme

    def create_suggestion(
        self,
        candidate: EnrichmentCandidate | dict[str, Any],
        *,
        source: str,
        provider_id: int | None = None,
        model_record_id: int | None = None,
        model_id_snapshot: str | None = None,
        job_id: int | None = None,
        supersede: bool = True,
        commit: bool = True,
    ) -> MemeEnrichmentSuggestion:
        value = candidate if isinstance(candidate, EnrichmentCandidate) else EnrichmentCandidate.model_validate(candidate)
        if source not in {"luna", "provider", "manual_import"}:
            raise ValueError("unsupported enrichment source")
        meme = self.get_meme(value.meme_id)
        template_id = value.suggested_template_id
        if value.suggested_template_name is not None:
            template = self.templates.get_by_name(value.suggested_template_name)
            template_id = template.id if template is not None else None
        if template_id is not None and self.templates.get_by_id(template_id) is None:
            raise ValueError(f"Template {template_id} does not exist")
        add_tags = self._normalize_tags(value.add_tags)
        remove_tags = self._normalize_tags(value.remove_tags)
        overlap = set(add_tags) & set(remove_tags)
        if overlap:
            raise ValueError("tags cannot be both added and removed: " + ", ".join(sorted(overlap)))
        if supersede:
            self.repository.supersede_pending(meme.id)
        suggestion = MemeEnrichmentSuggestion(
            meme_id=meme.id,
            source=source,
            provider_id=provider_id,
            model_record_id=model_record_id,
            model_id_snapshot=model_id_snapshot,
            job_id=job_id,
            suggested_title=value.suggested_title,
            suggested_description=value.suggested_description,
            suggested_template_id=template_id,
            add_tags_json=json.dumps(add_tags, ensure_ascii=False),
            remove_tags_json=json.dumps(remove_tags, ensure_ascii=False),
            field_confidence_json=json.dumps(value.confidence or {}, ensure_ascii=False),
            reason=value.reason,
            status="pending",
            source_hash=self.source_hash(meme),
        )
        try:
            self.repository.create_suggestion(suggestion)
            self.repository.audit(suggestion.id, "created", "[]")
            if commit:
                self.session.commit()
        except Exception:
            if commit:
                self.session.rollback()
            raise
        return suggestion

    def analyze(
        self,
        meme_id: int,
        client: AIClient,
        *,
        provider_id: int | None = None,
        model_record_id: int | None = None,
        model_id_snapshot: str | None = None,
        job_id: int | None = None,
        analyze_title: bool = True,
        analyze_description: bool = True,
        analyze_tags: bool = True,
        analyze_template: bool = True,
        commit: bool = True,
    ) -> EnrichmentAttempt:
        meme = self.get_meme(meme_id)
        inputs = [
            AIInputImage(self.storage.read_original(image.file_path), image.mime_type, image.position)
            for image in sorted(meme.images, key=lambda value: value.position)
        ]
        template_candidates = [
            AITemplateCandidate(template.id, template.name, template.description)
            for template in self.templates.list(limit=200)
        ]
        current_tags = [link.tag.name for link in meme.tag_links]
        tag_dictionary = [tag.name for tag in self.tags.list()[:500]]
        try:
            if hasattr(client, "analyze_enrichment"):
                result = client.analyze_enrichment(  # type: ignore[attr-defined]
                    images=inputs,
                    title=meme.title,
                    description=meme.description,
                    tags=current_tags,
                    template=meme.template.name if meme.template else None,
                    existing_tags=tag_dictionary,
                    existing_templates=template_candidates,
                )
                raw = result if isinstance(result, dict) else vars(result)
                candidate = EnrichmentCandidate.model_validate({
                    "meme_id": meme.id,
                    "suggested_title": raw.get("suggested_title") if analyze_title else None,
                    "suggested_description": raw.get("suggested_description") if analyze_description else None,
                    "add_tags": raw.get("add_tags", []) if analyze_tags else [],
                    "remove_tags": raw.get("remove_tags", []) if analyze_tags else [],
                    "suggested_template_name": raw.get("suggested_template_name") if analyze_template else None,
                    "confidence": raw.get("confidence"),
                    "reason": raw.get("reason"),
                })
                model_name = str(raw.get("model_name") or model_id_snapshot or "")
                input_tokens = int(raw.get("input_tokens") or 0)
                output_tokens = int(raw.get("output_tokens") or 0)
                total_tokens = int(raw.get("total_tokens") or input_tokens + output_tokens)
            else:
                result = client.analyze_images(images=inputs, existing_tags=tag_dictionary, existing_templates=template_candidates)
                proposed = [item.name for item in result.tags]
                candidate = EnrichmentCandidate(
                    meme_id=meme.id,
                    suggested_title=result.title if analyze_title and result.title.strip() != meme.title.strip() else None,
                    suggested_description=result.description if analyze_description and result.description.strip() != (meme.description or "").strip() else None,
                    add_tags=[name for name in proposed if self.tags.normalize_name(name) not in current_tags] if analyze_tags else [],
                    remove_tags=[],
                    suggested_template_id=result.template_id if analyze_template else None,
                    confidence=None,
                    reason="由兼容图片分析结果生成。",
                )
                model_name = result.model_name
                input_tokens = output_tokens = total_tokens = 0
            if commit:
                self.create_suggestion(
                    candidate, source="provider", provider_id=provider_id,
                    model_record_id=model_record_id, model_id_snapshot=model_name or model_id_snapshot,
                    job_id=job_id, commit=True,
                )
            return EnrichmentAttempt(candidate, model_name, input_tokens, output_tokens, total_tokens)
        except Exception as error:
            if commit:
                self.session.rollback()
            if isinstance(error, AIInvalidResponseError):
                return EnrichmentAttempt(
                    model_name=error.model_name,
                    input_tokens=error.input_tokens,
                    output_tokens=error.output_tokens,
                    total_tokens=error.total_tokens,
                    response_summary=error.response_summary,
                    error=error,
                )
            return EnrichmentAttempt(error=error)

    def get_suggestion(self, suggestion_id: int, *, mark_stale: bool = True) -> MemeEnrichmentSuggestion:
        suggestion = self.repository.get_suggestion(suggestion_id)
        if suggestion is None:
            raise EnrichmentNotFoundError(f"Suggestion {suggestion_id} does not exist")
        if mark_stale and suggestion.status in {"pending", "partially_accepted", "accepted"}:
            meme = self.repository.get_meme(suggestion.meme_id)
            if meme is None or self.source_hash(meme) != (suggestion.review_source_hash or suggestion.source_hash):
                suggestion.status = "stale"
                self.session.commit()
        return suggestion

    def reject(self, suggestion_id: int) -> MemeEnrichmentSuggestion:
        suggestion = self.get_suggestion(suggestion_id, mark_stale=False)
        if suggestion.status in {"applied", "rejected", "superseded"}:
            raise EnrichmentConflictError("Suggestion is no longer reviewable")
        suggestion.status = "rejected"
        suggestion.reviewed_at = self._now()
        self.repository.audit(suggestion.id, "rejected", "[]")
        self.session.commit()
        return suggestion

    def apply(self, suggestion_id: int, fields: Sequence[str], *, allow_stale: bool = False) -> tuple[MemeEnrichmentSuggestion, Meme]:
        suggestion = self.get_suggestion(suggestion_id, mark_stale=False)
        if suggestion.status in {"applied", "rejected", "superseded", "failed"}:
            raise EnrichmentConflictError("Suggestion is no longer applicable")
        meme = self.get_meme(suggestion.meme_id)
        stale = self.source_hash(meme) != (suggestion.review_source_hash or suggestion.source_hash)
        if stale and not allow_stale:
            suggestion.status = "stale"
            self.session.commit()
            raise EnrichmentConflictError("Suggestion is stale because the Meme has changed")
        selected = list(dict.fromkeys(fields))
        add_tags = self.add_tags(suggestion)
        remove_tags = self.remove_tags(suggestion)
        before = self._snapshot(meme)
        changed = False
        if "title" in selected and suggestion.suggested_title is not None and meme.title != suggestion.suggested_title:
            meme.title = suggestion.suggested_title
            changed = True
        if "description" in selected and suggestion.suggested_description is not None and meme.description != suggestion.suggested_description:
            meme.description = suggestion.suggested_description
            changed = True
        if "template" in selected and meme.template_id != suggestion.suggested_template_id:
            if suggestion.suggested_template_id is not None and self.templates.get_by_id(suggestion.suggested_template_id) is None:
                raise EnrichmentConflictError("Suggested template no longer exists")
            meme.template_id = suggestion.suggested_template_id
            changed = True
        if "remove_tags" in selected:
            protected = sorted(link.tag.name for link in meme.tag_links if link.tag.name in remove_tags and link.source in {"user", "manual"})
            if protected:
                raise EnrichmentConflictError("Cannot remove user/manual tags: " + ", ".join(protected))
        tag_fields = {"add_tags", "remove_tags"} & set(selected)
        if tag_fields:
            before_names = {link.tag.name for link in meme.tag_links}
            self.tags.apply_maintenance_tags(
                meme,
                add_names=add_tags if "add_tags" in selected else [],
                remove_names=remove_tags if "remove_tags" in selected else [],
                source="ai" if suggestion.source == "provider" else "codex",
                confidence=None,
            )
            changed = changed or before_names != {link.tag.name for link in meme.tag_links}
        try:
            if changed:
                invalidate_meme_semantic_data(self.session, [meme.id])
            already = self.applied_fields(suggestion)
            combined = list(dict.fromkeys([*already, *selected]))
            suggestion.applied_fields_json = json.dumps(combined, ensure_ascii=False)
            suggestion.reviewed_at = self._now()
            suggestion.applied_at = self._now()
            available = set(self.available_fields(suggestion))
            suggestion.status = "applied" if available.issubset(combined) else "partially_accepted"
            suggestion.review_source_hash = self.source_hash(meme)
            self.repository.audit(
                suggestion.id, "applied", json.dumps(selected, ensure_ascii=False),
                json.dumps(before, ensure_ascii=False), json.dumps(self._snapshot(meme), ensure_ascii=False),
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return suggestion, meme

    def list_suggestions(self, **kwargs: Any) -> tuple[list[MemeEnrichmentSuggestion], int]:
        items, total = self.repository.list_suggestions(**kwargs)
        changed = False
        for item in items:
            if item.status in {"pending", "partially_accepted", "accepted"}:
                meme = self.repository.get_meme(item.meme_id)
                if meme is None or self.source_hash(meme) != (item.review_source_hash or item.source_hash):
                    item.status = "stale"
                    changed = True
        if changed:
            self.session.commit()
        return items, total

    @staticmethod
    def _now():
        from datetime import UTC, datetime
        return datetime.now(UTC)

    def _normalize_tags(self, values: Sequence[str]) -> list[str]:
        return list(dict.fromkeys(self.tags.normalize_name(value) for value in values if self.tags.normalize_name(value)))

    @staticmethod
    def add_tags(suggestion: MemeEnrichmentSuggestion) -> list[str]:
        return list(json.loads(suggestion.add_tags_json))

    @staticmethod
    def remove_tags(suggestion: MemeEnrichmentSuggestion) -> list[str]:
        return list(json.loads(suggestion.remove_tags_json))

    @staticmethod
    def confidence(suggestion: MemeEnrichmentSuggestion) -> dict[str, float | None]:
        return dict(json.loads(suggestion.field_confidence_json))

    @staticmethod
    def applied_fields(suggestion: MemeEnrichmentSuggestion) -> list[str]:
        return list(json.loads(suggestion.applied_fields_json))

    def is_stale(self, suggestion: MemeEnrichmentSuggestion) -> bool:
        meme = self.repository.get_meme(suggestion.meme_id)
        return meme is None or self.source_hash(meme) != (suggestion.review_source_hash or suggestion.source_hash)

    def available_fields(self, suggestion: MemeEnrichmentSuggestion) -> list[str]:
        fields: list[str] = []
        if suggestion.suggested_title is not None:
            fields.append("title")
        if suggestion.suggested_description is not None:
            fields.append("description")
        if self.add_tags(suggestion):
            fields.append("add_tags")
        if self.remove_tags(suggestion):
            fields.append("remove_tags")
        if suggestion.suggested_template_id is not None:
            fields.append("template")
        return fields

    @staticmethod
    def _snapshot(meme: Meme) -> dict[str, Any]:
        return {
            "title": meme.title, "description": meme.description,
            "tags": [link.tag.name for link in meme.tag_links], "template_id": meme.template_id,
        }
