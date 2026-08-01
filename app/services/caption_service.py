from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.ai.client import (
    AICaptionResult,
    AIClient,
    AIInputImage,
    AIInvalidResponseError,
)
from app.models.caption import Caption
from app.repositories.caption_repository import CaptionRepository
from app.repositories.meme_repository import MemeRepository
from app.services.meme_service import MemeFileMissingError
from app.storage.image_storage import ImageStorage


class CaptionNotFoundError(LookupError):
    pass


class CaptionService:
    def __init__(self, session: Session, storage: ImageStorage) -> None:
        self.session = session
        self.storage = storage
        self.repository = CaptionRepository(session)
        self.meme_repository = MemeRepository(session)

    def list_captions(self, meme_id: int) -> list[Caption]:
        self._meme(meme_id)
        return self.repository.list_for_meme(meme_id)

    def create_caption(
        self,
        meme_id: int,
        *,
        content: str,
        scene: str | None = None,
        tone: str | None = None,
        length: str | None = None,
        source: str = "manual",
    ) -> Caption:
        self._meme(meme_id)
        if source not in {"manual", "ai"}:
            raise ValueError("source must be manual or ai")
        self._validate_metadata(scene=scene, tone=tone, length=length)
        caption = Caption(
            meme_id=meme_id,
            content=self._content(content),
            scene=self._optional_text(scene),
            tone=self._optional_text(tone),
            length=length,
            source=source,
        )
        try:
            created = self.repository.create(caption)
            self.session.commit()
            return created
        except Exception:
            self.session.rollback()
            raise

    def update_caption(
        self,
        meme_id: int,
        caption_id: int,
        changes: Mapping[str, object],
    ) -> Caption:
        caption = self._caption(meme_id, caption_id)
        normalized = dict(changes)
        if "content" in normalized:
            normalized["content"] = self._content(str(normalized["content"]))
        for field in ("scene", "tone"):
            if field in normalized:
                value = normalized[field]
                normalized[field] = self._optional_text(
                    None if value is None else str(value)
                )
        normalized.pop("source", None)
        self._validate_metadata(
            scene=normalized.get("scene"),
            tone=normalized.get("tone"),
            length=normalized.get("length"),
        )
        try:
            updated = self.repository.update(caption, normalized)
            self.session.commit()
            return updated
        except Exception:
            self.session.rollback()
            raise

    def delete_caption(self, meme_id: int, caption_id: int) -> None:
        caption = self._caption(meme_id, caption_id)
        try:
            self.repository.delete(caption)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

    def generate_captions(
        self,
        meme_id: int,
        ai_client: AIClient,
        *,
        count: int = 5,
        scene: str | None = None,
        tone: str | None = None,
        length: str | None = None,
    ) -> AICaptionResult:
        if count not in {3, 5, 8}:
            raise ValueError("count must be 3, 5, or 8")
        self._validate_metadata(scene=scene, tone=tone, length=length)
        meme = self._meme(meme_id)
        result = ai_client.generate_captions(
            images=self._images(meme),
            title=meme.title,
            description=meme.description,
            tags=[tag.name for tag in meme.tags],
            template=meme.template.name if meme.template is not None else None,
            scene=self._optional_text(scene),
            tone=self._optional_text(tone),
            length=length,
            count=count,
        )
        return self._normalize_result(result, count)

    def rewrite_caption(
        self,
        meme_id: int,
        ai_client: AIClient,
        *,
        content: str,
        action: str,
        scene: str | None = None,
        tone: str | None = None,
        length: str | None = None,
    ) -> AICaptionResult:
        if action not in {"polish", "shorten", "expand", "retone"}:
            raise ValueError("unsupported rewrite action")
        self._validate_metadata(scene=scene, tone=tone, length=length)
        draft = self._content(content, label="draft")
        meme = self._meme(meme_id)
        result = ai_client.rewrite_caption(
            images=self._images(meme),
            title=meme.title,
            description=meme.description,
            tags=[tag.name for tag in meme.tags],
            template=meme.template.name if meme.template is not None else None,
            content=draft,
            action=action,
            scene=self._optional_text(scene),
            tone=self._optional_text(tone),
            length=length,
        )
        return self._normalize_result(result, 1)

    def _meme(self, meme_id: int):
        meme = self.meme_repository.get_by_id(meme_id)
        if meme is None:
            raise CaptionNotFoundError(f"Meme {meme_id} does not exist")
        return meme

    def _caption(self, meme_id: int, caption_id: int) -> Caption:
        self._meme(meme_id)
        caption = self.repository.get_for_meme(meme_id, caption_id)
        if caption is None:
            raise CaptionNotFoundError(
                f"Caption {caption_id} does not exist for Meme {meme_id}"
            )
        return caption

    def _images(self, meme) -> list[AIInputImage]:
        images = sorted(meme.images, key=lambda item: item.position)
        try:
            return [
                AIInputImage(
                    image_bytes=self.storage.read_original(image.file_path),
                    mime_type=image.mime_type,
                    position=image.position,
                )
                for image in images
            ]
        except FileNotFoundError as error:
            raise MemeFileMissingError(
                f"An image file for Meme {meme.id} is missing"
            ) from error

    @staticmethod
    def _content(value: str, *, label: str = "content") -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError(f"{label} cannot be blank")
        if len(normalized) > 2000:
            raise ValueError(f"{label} cannot exceed 2000 characters")
        return normalized

    @staticmethod
    def _optional_text(value: str | None) -> str | None:
        normalized = (value or "").strip()
        return normalized or None

    @staticmethod
    def _validate_metadata(
        *,
        scene: object = None,
        tone: object = None,
        length: object = None,
    ) -> None:
        if scene is not None and len(str(scene).strip()) > 100:
            raise ValueError("scene cannot exceed 100 characters")
        if tone is not None and len(str(tone).strip()) > 100:
            raise ValueError("tone cannot exceed 100 characters")
        if length is not None and length not in {"short", "medium", "long"}:
            raise ValueError("length must be short, medium, or long")

    @staticmethod
    def _normalize_result(
        result: AICaptionResult,
        expected_count: int,
    ) -> AICaptionResult:
        captions: list[str] = []
        seen: set[str] = set()
        for value in result.captions:
            if not isinstance(value, str):
                raise AIInvalidResponseError(
                    "AI service returned an invalid caption response"
                )
            normalized = value.strip()
            if len(normalized) > 2000:
                raise AIInvalidResponseError(
                    "AI service returned a caption longer than 2000 characters"
                )
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            captions.append(normalized)
        if len(captions) != expected_count:
            raise AIInvalidResponseError(
                f"AI service must return exactly {expected_count} unique captions"
            )
        return AICaptionResult(
            model_name=result.model_name,
            captions=tuple(captions),
        )
