from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.ai.client import (
    AIClient,
    AIInputImage,
    AIImageResult,
    AIInvalidResponseError,
    AITemplateCandidate,
)
from app.models.meme import Meme
from app.models.meme_image import MemeImage
from app.models.meme_relation import MemeRelation
from app.models.ai_analysis import MemeAIAnalysis
from app.repositories.ai_analysis_repository import AIAnalysisRepository
from app.repositories.meme_repository import MemeRepository
from app.repositories.tag_repository import TagRepository
from app.repositories.template_repository import TemplateRepository
from app.storage.image_storage import ImageStorage, StoredImage, ValidatedImage
from app.storage.template_image_storage import TemplateImageStorage
from app.ai.embedding_client import ImageEmbeddingClient
from app.services.template_matching import rank_visual_templates
import json


# Service 是业务编排层：把数据库操作和文件操作组成一次完整用例。
# 它也是事务的主人，Repository 只 flush，最终 commit/rollback 在这里决定。
EDITABLE_FIELDS = {"title", "description", "source", "tags", "template_id"}
# 单独的哨兵对象用来区分“请求没传 tags”和“请求明确把 tags 清空”。
TAGS_NOT_PROVIDED = object()
MIN_AI_SUGGESTIONS = 2
MAX_AI_SUGGESTIONS = 8
PROTECTED_MAINTENANCE_TAG_SOURCES = frozenset({"user", "manual"})


@dataclass(frozen=True)
class TagMaintenancePlan:
    meme_id: int
    before: tuple[tuple[str, str], ...]
    add_tags: tuple[str, ...]
    remove_tags: tuple[str, ...]
    after: tuple[tuple[str, str], ...]


class MemeNotFoundError(LookupError):
    # 业务异常不绑定 HTTP；API 层稍后会把它转换为 404。
    pass


class MemeFileMissingError(FileNotFoundError):
    # 数据库有记录、磁盘却缺文件，和“记录不存在”是不同状态。
    pass


class NoMemesAvailableError(LookupError):
    # 随机选择时没有任何候选 Meme。
    pass


class AIAnalysisNotFoundError(LookupError):
    pass


class AIAnalysisAlreadyConfirmedError(RuntimeError):
    pass


class DuplicateImageError(ValueError):
    pass


class MemeService:
    def __init__(self, session: Session, storage: ImageStorage | None = None) -> None:
        # 依赖从外部传入，测试时可以换成临时数据库和临时文件目录。
        self.session = session
        self.repository = MemeRepository(session)
        self.tag_repository = TagRepository(session)
        self.ai_analysis_repository = AIAnalysisRepository(session)
        self.template_repository = TemplateRepository(session)
        self.storage = storage or ImageStorage()

    def create_meme(
        self,
        original_filename: str,
        content: bytes,
        *,
        title: str,
        description: str | None = None,
        source: str | None = None,
        tags: Sequence[str] = (),
        template_id: int | None = None,
    ) -> Meme:
        validated = self.storage.validate(content)
        stored: StoredImage | None = None
        try:
            meme, stored = self.create_meme_no_commit(
                original_filename,
                validated,
                title=title,
                description=description,
                source=source,
                tags=tags,
                template_id=template_id,
                check_duplicate=False,
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            if stored is not None:
                self.storage.delete(stored.file_path, stored.thumbnail_path)
            raise
        return meme

    def create_meme_no_commit(
        self,
        original_filename: str,
        validated: ValidatedImage,
        *,
        title: str,
        description: str | None = None,
        source: str | None = None,
        tags: Sequence[str] = (),
        template_id: int | None = None,
        check_duplicate: bool = True,
    ) -> tuple[Meme, StoredImage]:
        """Create and flush one Meme while leaving commit/rollback to the caller."""
        if (
            template_id is not None
            and self.template_repository.get_by_id(template_id) is None
        ):
            raise ValueError(f"Template {template_id} does not exist")
        if check_duplicate and self.repository.get_by_file_hash(validated.file_hash) is not None:
            raise DuplicateImageError("Image already exists")
        # 查重完成后才生成缩略图，避免为重复图片执行 Pillow 缩放。
        stored = self.storage.save_validated(original_filename, validated)
        # ORM 对象只保存元数据和磁盘路径，图片二进制本身不塞进数据库。
        meme = Meme(
            title=title,
            description=description,
            original_filename=stored.original_filename,
            stored_filename=stored.stored_filename,
            file_path=stored.file_path.name,
            thumbnail_path=stored.thumbnail_path.name,
            mime_type=stored.mime_type,
            file_size=stored.file_size,
            width=stored.width,
            height=stored.height,
            file_hash=stored.file_hash,
            source=source,
            template_id=template_id,
        )
        meme.images.append(
            MemeImage(
                original_filename=stored.original_filename,
                stored_filename=stored.stored_filename,
                file_path=stored.file_path.name,
                thumbnail_path=stored.thumbnail_path.name,
                mime_type=stored.mime_type,
                file_size=stored.file_size,
                width=stored.width,
                height=stored.height,
                file_hash=stored.file_hash,
                position=0,
            )
        )

        try:
            self.repository.create(meme)
            self.tag_repository.replace_meme_tags(meme, tags)
        except Exception:
            self.storage.delete(stored.file_path, stored.thumbnail_path)
            raise
        return meme, stored

    def append_image(self, meme_id: int, original_filename: str, content: bytes) -> Meme:
        meme = self.get_meme(meme_id)
        stored = self.storage.save(original_filename, content)
        image = MemeImage(
            meme_id=meme.id,
            original_filename=stored.original_filename,
            stored_filename=stored.stored_filename,
            file_path=stored.file_path.name,
            thumbnail_path=stored.thumbnail_path.name,
            mime_type=stored.mime_type,
            file_size=stored.file_size,
            width=stored.width,
            height=stored.height,
            file_hash=stored.file_hash,
            position=len(meme.images),
        )
        try:
            self.session.add(image)
            self.session.flush()
            self.session.commit()
        except Exception:
            self.session.rollback()
            self.storage.delete(stored.file_path, stored.thumbnail_path)
            raise
        self.session.refresh(meme)
        return meme

    def reorder_images(self, meme_id: int, image_ids: Sequence[int]) -> Meme:
        meme = self.get_meme(meme_id)
        current = {image.id: image for image in meme.images}
        if len(image_ids) != len(current) or set(image_ids) != set(current):
            raise ValueError("Image order must contain every meme image exactly once")
        try:
            # SQLite 唯一约束不是延迟检查；先移到临时负位置才能安全交换。
            for position, image in enumerate(meme.images, start=1):
                image.position = -position
            self.session.flush()
            for position, image_id in enumerate(image_ids):
                current[image_id].position = position
            self.session.flush()
            self.session.refresh(meme)
            self._sync_cover(meme)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return meme

    def delete_image(self, meme_id: int, image_id: int) -> Meme:
        meme = self.get_meme(meme_id)
        image = next((item for item in meme.images if item.id == image_id), None)
        if image is None:
            raise MemeNotFoundError(f"Image {image_id} does not exist for Meme {meme_id}")
        if len(meme.images) == 1:
            raise ValueError("Cannot delete the last image of a Meme")
        file_path, thumbnail_path = image.file_path, image.thumbnail_path
        try:
            meme.images.remove(image)
            self.session.flush()
            remaining = sorted(meme.images, key=lambda item: item.position)
            # Reorders may leave primary-key order different from position order.
            # Move every survivor out of the unique positive range before compacting.
            for temporary_position, item in enumerate(remaining, start=1):
                item.position = -temporary_position
            self.session.flush()
            for position, item in enumerate(remaining):
                item.position = position
            self.session.flush()
            self._sync_cover(meme)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        self.storage.delete(file_path, thumbnail_path)
        return meme

    def list_relations(self, meme_id: int) -> list[Meme]:
        self.get_meme(meme_id)
        edges = self.session.scalars(
            select(MemeRelation).where(or_(MemeRelation.meme_a_id == meme_id, MemeRelation.meme_b_id == meme_id))
        ).all()
        ids = [edge.meme_b_id if edge.meme_a_id == meme_id else edge.meme_a_id for edge in edges]
        return list(self.session.scalars(select(Meme).where(Meme.id.in_(ids)).order_by(Meme.id))) if ids else []

    def add_relations(self, meme_id: int, related_ids: Sequence[int]) -> list[Meme]:
        self.get_meme(meme_id)
        ids = list(dict.fromkeys(item for item in related_ids if item != meme_id))
        if any(item == meme_id for item in related_ids):
            raise ValueError("A Meme cannot relate to itself")
        targets = list(self.session.scalars(select(Meme).where(Meme.id.in_(ids)))) if ids else []
        if len(targets) != len(ids):
            raise ValueError("Every related Meme must exist")
        existing = {(edge.meme_a_id, edge.meme_b_id) for edge in self.session.scalars(select(MemeRelation).where(or_(MemeRelation.meme_a_id == meme_id, MemeRelation.meme_b_id == meme_id)))}
        try:
            for other_id in ids:
                pair = (min(meme_id, other_id), max(meme_id, other_id))
                if pair not in existing:
                    self.session.add(MemeRelation(meme_a_id=pair[0], meme_b_id=pair[1]))
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return self.list_relations(meme_id)

    def remove_relation(self, meme_id: int, related_id: int) -> None:
        self.get_meme(meme_id)
        pair = (min(meme_id, related_id), max(meme_id, related_id))
        edge = self.session.scalar(select(MemeRelation).where(MemeRelation.meme_a_id == pair[0], MemeRelation.meme_b_id == pair[1]))
        if edge is None:
            raise MemeNotFoundError(f"Relation between Meme {meme_id} and {related_id} does not exist")
        self.session.delete(edge)
        self.session.commit()

    def _sync_cover(self, meme: Meme) -> None:
        cover = min(meme.images, key=lambda item: item.position)
        for field in (
            "original_filename", "stored_filename", "file_path", "thumbnail_path",
            "mime_type", "file_size", "width", "height", "file_hash",
        ):
            setattr(meme, field, getattr(cover, field))

    def get_meme(self, meme_id: int) -> Meme:
        meme = self.repository.get_by_id(meme_id)
        if meme is None:
            raise MemeNotFoundError(f"Meme {meme_id} does not exist")

        # 找到数据库记录还不够；对外返回前也要确认对应文件仍然存在。
        self._ensure_files_exist(meme)
        return meme

    def list_memes(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        tags: Sequence[str] | None = None,
        q: str | None = None,
    ) -> list[Meme]:
        # 查询细节由 Repository 封装，Service 只传递业务参数。
        return self.repository.list(offset=offset, limit=limit, tags=tags, q=q)

    def update_meme(
        self,
        meme_id: int,
        changes: Mapping[str, object],
    ) -> Meme:
        data = dict(changes)
        # 白名单阻止调用者意外修改文件路径、哈希等系统维护字段。
        unknown_fields = set(data) - EDITABLE_FIELDS
        if unknown_fields:
            names = ", ".join(sorted(unknown_fields))
            raise ValueError(f"Fields cannot be updated: {names}")

        tag_names = data.pop("tags", TAGS_NOT_PROVIDED)
        if "template_id" in data:
            template_id = data["template_id"]
            if (
                template_id is not None
                and (
                    isinstance(template_id, bool)
                    or not isinstance(template_id, int)
                    or self.template_repository.get_by_id(template_id) is None
                )
            ):
                raise ValueError(f"Template {template_id} does not exist")
        meme = self.get_meme(meme_id)
        try:
            updated = self.repository.update(meme, data)
            if tag_names is not TAGS_NOT_PROVIDED:
                # 传入空列表表示主动清空；完全没传则保留原标签。
                self.tag_repository.replace_meme_tags(meme, tag_names or [])
            self.session.commit()
        except Exception:
            # 任一更新步骤失败，标题等字段和标签关系都一起撤销。
            self.session.rollback()
            raise

        return updated

    def list_tags(self):
        # 当前只是简单转发，仍保留 Service 入口，避免 API 直接依赖数据层。
        return self.tag_repository.list()

    def plan_tag_maintenance(
        self,
        meme_id: int,
        *,
        add_tags: Sequence[str],
        remove_tags: Sequence[str],
        allow_protected_removal: bool = False,
    ) -> TagMaintenancePlan:
        """Validate and describe an offline tag change without writing it."""
        meme = self.repository.get_by_id(meme_id)
        if meme is None:
            raise MemeNotFoundError(f"Meme {meme_id} does not exist")

        def normalize_names(names: Sequence[str]) -> tuple[str, ...]:
            normalized: list[str] = []
            for name in names:
                value = self.tag_repository.normalize_name(name)
                if value and value not in normalized:
                    normalized.append(value)
            return tuple(normalized)

        additions = normalize_names(add_tags)
        removals = normalize_names(remove_tags)
        overlap = set(additions) & set(removals)
        if overlap:
            raise ValueError(
                "Tags cannot be added and removed together: " + ", ".join(sorted(overlap))
            )

        links_by_name = {link.tag.name: link for link in meme.tag_links}
        protected = sorted(
            name
            for name in removals
            if name in links_by_name
            and links_by_name[name].source in PROTECTED_MAINTENANCE_TAG_SOURCES
        )
        if protected and not allow_protected_removal:
            raise ValueError(
                "Cannot remove user/manual tags: " + ", ".join(protected)
            )

        actual_additions = tuple(
            name for name in additions if name not in links_by_name
        )
        actual_removals = tuple(name for name in removals if name in links_by_name)
        before = tuple((link.tag.name, link.source) for link in meme.tag_links)
        removal_set = set(actual_removals)
        after = tuple(item for item in before if item[0] not in removal_set) + tuple(
            (name, "codex") for name in actual_additions
        )
        return TagMaintenancePlan(
            meme_id=meme_id,
            before=before,
            add_tags=actual_additions,
            remove_tags=actual_removals,
            after=after,
        )

    def apply_tag_maintenance(
        self,
        meme_id: int,
        *,
        add_tags: Sequence[str],
        remove_tags: Sequence[str],
        confidence: float,
        allow_protected_removal: bool = False,
    ) -> TagMaintenancePlan:
        """Apply one validated offline tag delta as a Service-owned transaction."""
        plan = self.plan_tag_maintenance(
            meme_id,
            add_tags=add_tags,
            remove_tags=remove_tags,
            allow_protected_removal=allow_protected_removal,
        )
        meme = self.repository.get_by_id(meme_id)
        assert meme is not None
        try:
            self.tag_repository.apply_maintenance_tags(
                meme,
                add_names=plan.add_tags,
                remove_names=plan.remove_tags,
                source="codex",
                confidence=confidence,
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return plan

    def get_random_meme(self, *, tags: Sequence[str] | None = None) -> Meme:
        # Repository 负责随机查询，Service 负责解释“没有结果”及检查文件。
        meme = self.repository.get_random(tags=tags)
        if meme is None:
            raise NoMemesAvailableError("No Meme matches the requested range")
        self._ensure_files_exist(meme)
        return meme

    def analyze_meme(
        self,
        meme_id: int,
        ai_client: AIClient,
        embedding_client: ImageEmbeddingClient | None = None,
    ) -> MemeAIAnalysis:
        meme = self.get_meme(meme_id)
        templates = self.template_repository.list()
        ranked: dict[int, float] = {}
        if embedding_client is not None:
            query = embedding_client.embed_image(self.storage.read_original(meme.file_path), meme.mime_type)
            ranked = {item.template_id: item.similarity for item in rank_visual_templates(query.vector, [(template.id, json.loads(template.reference_embedding_json)) for template in templates if template.reference_embedding_json and template.reference_embedding_model_id == query.model_id])}
        reference_storage = TemplateImageStorage()
        candidates = [
            AITemplateCandidate(
                id=template.id,
                name=template.name,
                description=template.description,
                reference_image_bytes=(reference_storage.read_thumbnail(template.reference_thumbnail_filename) if template.id in ranked and template.reference_thumbnail_filename else None),
                reference_image_mime_type=("image/png" if template.id in ranked else None),
                visual_similarity=ranked.get(template.id),
            )
            for template in templates
        ]
        inputs = [AIInputImage(self.storage.read_original(image.file_path), image.mime_type, image.position) for image in meme.images]
        kwargs = {"existing_tags": [tag.name for tag in self.tag_repository.list()[:200]], "existing_templates": candidates}
        if hasattr(ai_client, "analyze_images"):
            result = ai_client.analyze_images(images=inputs, **kwargs)
        else:  # 兼容 v0.3.3 测试替身；正式客户端始终走完整有序输入。
            result = ai_client.analyze_image(image_bytes=inputs[0].image_bytes, mime_type=inputs[0].mime_type, **kwargs)
        candidate_ids = {candidate.id for candidate in candidates}
        if result.template_id is not None and result.template_id not in candidate_ids:
            raise AIInvalidResponseError(
                "AI template_id is not in the provided template candidates"
            )
        suggestions = self._normalize_ai_suggestions(result)
        suggested_title = result.title.strip()
        if not suggested_title or len(suggested_title) > 255:
            raise AIInvalidResponseError(
                "AI title must contain 1 to 255 characters"
            )
        description = result.description.strip()
        if not description:
            raise AIInvalidResponseError("AI description cannot be empty")

        try:
            analysis = self.ai_analysis_repository.create(
                meme,
                model_name=result.model_name[:100],
                suggested_title=suggested_title,
                description=description,
                suggestions=suggestions,
                suggested_template_id=result.template_id,
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return analysis

    def confirm_ai_analysis(
        self,
        meme_id: int,
        analysis_id: int,
        *,
        tags: Sequence[str],
        apply_description: bool,
        apply_title: bool = False,
        template_id: int | None = None,
        apply_template: bool = False,
    ) -> Meme:
        meme = self.get_meme(meme_id)
        analysis = self.ai_analysis_repository.get_for_meme(meme_id, analysis_id)
        if analysis is None:
            raise AIAnalysisNotFoundError(
                f"AI analysis {analysis_id} does not exist for Meme {meme_id}"
            )
        if analysis.confirmed_at is not None:
            raise AIAnalysisAlreadyConfirmedError(
                f"AI analysis {analysis_id} has already been confirmed"
            )
        if apply_title and analysis.suggested_title is None:
            raise ValueError(
                f"AI analysis {analysis_id} does not have a suggested title"
            )

        suggestions = self.ai_analysis_repository.load_suggestions(analysis)
        confidence_by_name = {
            str(item["name"]): float(item["confidence"])
            for item in suggestions
        }
        selected_names = list(
            dict.fromkeys(
                normalized
                for name in tags
                if (normalized := self.tag_repository.normalize_name(name))
            )
        )
        unknown_names = set(selected_names) - set(confidence_by_name)
        if unknown_names:
            names = ", ".join(sorted(unknown_names))
            raise ValueError(f"Tags were not suggested by this analysis: {names}")
        if (
            apply_template
            and template_id is not None
            and self.template_repository.get_by_id(template_id) is None
        ):
            raise ValueError(f"Template {template_id} does not exist")

        try:
            self.tag_repository.add_ai_tags(
                meme,
                [
                    (name, confidence_by_name[name])
                    for name in selected_names
                ],
            )
            if apply_description:
                self.repository.update(meme, {"description": analysis.description})
            if apply_title:
                self.repository.update(meme, {"title": analysis.suggested_title})
            if apply_template:
                self.repository.update(meme, {"template_id": template_id})
            analysis.confirmed_at = datetime.now(UTC)
            self.session.flush()
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return meme

    def delete_meme(self, meme_id: int) -> None:
        # 删除的目标是清理记录；即使磁盘文件已丢失，也不能阻止数据库删除。
        meme = self.repository.get_by_id(meme_id)
        if meme is None:
            raise MemeNotFoundError(f"Meme {meme_id} does not exist")
        # ORM 对象删除后不应再依赖它取路径，所以提前保存普通字符串。
        stored_files = [
            (image.file_path, image.thumbnail_path)
            for image in meme.images
        ] or [(meme.file_path, meme.thumbnail_path)]

        try:
            self.session.execute(
                delete(MemeRelation).where(
                    or_(MemeRelation.meme_a_id == meme_id, MemeRelation.meme_b_id == meme_id)
                )
            )
            self.repository.delete(meme)
            # 先确认数据库删除成功，再清理磁盘文件。
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        for file_path, thumbnail_path in stored_files:
            self.storage.delete(file_path, thumbnail_path)

    def _ensure_files_exist(self, meme: Meme) -> None:
        # 集中维护“数据库记录与磁盘文件必须对应”的完整性规则。
        image_references = [
            (image.file_path, image.thumbnail_path)
            for image in meme.images
        ] or [(meme.file_path, meme.thumbnail_path)]
        if any(
            not self.storage.exists(file_path, thumbnail_path)
            for file_path, thumbnail_path in image_references
        ):
            raise MemeFileMissingError(f"Image file is missing for Meme {meme.id}")

    def _normalize_ai_suggestions(
        self,
        result: AIImageResult,
    ) -> list[dict[str, object]]:
        existing_names = {tag.name for tag in self.tag_repository.list()}
        existing_suggestions: list[dict[str, object]] = []
        new_suggestions: list[dict[str, object]] = []
        seen: set[str] = set()

        for suggestion in result.tags:
            name = self.tag_repository.normalize_name(suggestion.name)
            if not name or len(name) > 100 or name in seen:
                continue
            is_existing = name in existing_names

            raw_confidence = float(suggestion.confidence)
            confidence = (
                min(1.0, max(0.0, raw_confidence))
                if isfinite(raw_confidence)
                else 0.0
            )
            normalized = {
                "name": name,
                "confidence": confidence,
                "existing": is_existing,
            }
            target = existing_suggestions if is_existing else new_suggestions
            target.append(normalized)
            seen.add(name)

        # 即使模型没有按提示排序，服务端仍保证已有标签先占建议名额。
        prioritized = [
            *existing_suggestions,
            *new_suggestions,
        ]
        normalized = prioritized[:MAX_AI_SUGGESTIONS]
        if len(normalized) < MIN_AI_SUGGESTIONS:
            raise AIInvalidResponseError(
                "AI service must suggest between 2 and 8 unique tags"
            )
        return normalized
