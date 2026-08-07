from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.repositories.ai_analysis_repository import AIAnalysisRepository
from app.repositories.meme_repository import MemeRepository
from app.models.template import Template
from app.repositories.template_repository import TemplateRepository
from app.storage.template_image_storage import TemplateImageStorage
import json
from app.services.derived_data_invalidation import invalidate_meme_semantic_data

if TYPE_CHECKING:
    from app.ai.embedding_client import ImageEmbeddingClient


class TemplateNotFoundError(LookupError):
    pass


class TemplateNameConflictError(ValueError):
    pass


class TemplateService:
    def __init__(self, session: Session, storage: TemplateImageStorage | None = None) -> None:
        self.session = session
        self.repository = TemplateRepository(session)
        self.meme_repository = MemeRepository(session)
        self.ai_analysis_repository = AIAnalysisRepository(session)
        self.storage = storage or TemplateImageStorage()

    def set_reference_image(self, template_id: int, filename: str, content: bytes, embedding_client: ImageEmbeddingClient) -> Template:
        template = self.get_template(template_id)
        stored = self.storage.save(filename, content)
        old = (template.reference_stored_filename, template.reference_thumbnail_filename)
        try:
            embedding = embedding_client.embed_image(
                stored.thumbnail_path.read_bytes(),
                "image/png",
            )
            self.repository.update(template, {
                "reference_stored_filename": stored.file_path.name, "reference_thumbnail_filename": stored.thumbnail_path.name,
                "reference_mime_type": stored.mime_type, "reference_file_size": stored.file_size,
                "reference_width": stored.width, "reference_height": stored.height, "reference_file_hash": stored.file_hash,
                "reference_embedding_json": json.dumps(embedding.vector), "reference_embedding_model_id": embedding.model_id,
            })
            self.session.commit()
        except Exception:
            self.session.rollback(); self.storage.delete(stored.file_path, stored.thumbnail_path); raise
        if old[0]: self.storage.delete(old[0], old[1])
        return template

    def create_template_with_reference_image(
        self,
        name: str,
        description: str | None,
        filename: str,
        content: bytes,
        embedding_client: ImageEmbeddingClient,
    ) -> Template:
        normalized_name = self._normalize_name(name)
        if self.repository.get_by_name(normalized_name) is not None:
            raise TemplateNameConflictError(
                f'Template name "{normalized_name}" already exists'
            )

        stored = self.storage.save(filename, content)
        try:
            embedding = embedding_client.embed_image(
                stored.thumbnail_path.read_bytes(),
                "image/png",
            )
            template = self.repository.create(
                Template(
                    name=normalized_name,
                    description=self._normalize_description(description),
                    reference_stored_filename=stored.file_path.name,
                    reference_thumbnail_filename=stored.thumbnail_path.name,
                    reference_mime_type=stored.mime_type,
                    reference_file_size=stored.file_size,
                    reference_width=stored.width,
                    reference_height=stored.height,
                    reference_file_hash=stored.file_hash,
                    reference_embedding_json=json.dumps(embedding.vector),
                    reference_embedding_model_id=embedding.model_id,
                )
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            self.storage.delete(stored.file_path, stored.thumbnail_path)
            raise
        return template

    def delete_reference_image(self, template_id: int) -> None:
        template = self.get_template(template_id)
        if not template.reference_stored_filename: raise ValueError("Template has no reference image")
        old = (template.reference_stored_filename, template.reference_thumbnail_filename)
        self.repository.update(template, {key: None for key in ("reference_stored_filename", "reference_thumbnail_filename", "reference_mime_type", "reference_file_size", "reference_width", "reference_height", "reference_file_hash", "reference_embedding_json", "reference_embedding_model_id")})
        self.session.commit(); self.storage.delete(old[0], old[1])

    @staticmethod
    def _normalize_description(value: object) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @staticmethod
    def _normalize_name(value: object) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Template name cannot be empty")
        if len(normalized) > 100:
            raise ValueError("Template name cannot exceed 100 characters")
        return normalized

    def create_template(
        self,
        name: str,
        description: str | None = None,
    ) -> Template:
        normalized_name = self._normalize_name(name)
        if self.repository.get_by_name(normalized_name) is not None:
            raise TemplateNameConflictError(
                f'Template name "{normalized_name}" already exists'
            )
        try:
            template = self.repository.create(
                Template(
                    name=normalized_name,
                    description=self._normalize_description(description),
                )
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return template

    def get_template(self, template_id: int) -> Template:
        template = self.repository.get_by_id(template_id)
        if template is None:
            raise TemplateNotFoundError(
                f"Template {template_id} does not exist"
            )
        return template

    def list_templates(self) -> list[Template]:
        return self.repository.list()

    def update_template(
        self,
        template_id: int,
        changes: Mapping[str, object],
    ) -> Template:
        data = dict(changes)
        template = self.get_template(template_id)
        if "name" in data:
            name = self._normalize_name(data["name"])
            conflict = self.repository.get_by_name(name)
            if conflict is not None and conflict.id != template.id:
                raise TemplateNameConflictError(
                    f'Template name "{name}" already exists'
                )
            data["name"] = name
        if "description" in data:
            data["description"] = self._normalize_description(data["description"])
        name_changed = "name" in data and data["name"] != template.name
        affected = (
            self.meme_repository.meme_ids_for_template(template_id)
            if name_changed
            else []
        )
        try:
            updated = self.repository.update(template, data)
            invalidate_meme_semantic_data(self.session, affected)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return updated

    def delete_template(self, template_id: int) -> None:
        template = self.get_template(template_id)
        affected = self.meme_repository.meme_ids_for_template(template_id)
        old = (template.reference_stored_filename, template.reference_thumbnail_filename)
        try:
            self.meme_repository.clear_template_references(template_id)
            self.ai_analysis_repository.clear_template_references(template_id)
            invalidate_meme_semantic_data(self.session, affected)
            self.repository.delete(template)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        if old[0]:
            self.storage.delete(old[0], old[1])
