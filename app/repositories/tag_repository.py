# TagRepository 统一处理标签规范化、复用和 MemeTag 关联。
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.models.tag import MemeTag, Tag


@dataclass(frozen=True)
class TagWithUsage:
    id: int
    name: str
    category: str
    description: str | None
    created_at: datetime
    usage_count: int

    @classmethod
    def from_tag(cls, tag: Tag, usage_count: int) -> "TagWithUsage":
        return cls(
            id=tag.id,
            name=tag.name,
            category=tag.category,
            description=tag.description,
            created_at=tag.created_at,
            usage_count=usage_count,
        )


class TagRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    @staticmethod
    def normalize_name(name: str) -> str:
        # “ Cat ”和“cat”会归一为同一个名称，防止产生肉眼相同的重复标签。
        return name.strip().lower()

    def get_or_create(self, name: str, *, category: str = "custom") -> Tag:
        normalized = self.normalize_name(name)
        if not normalized:
            raise ValueError("Tag name cannot be empty")

        tag = self.session.scalar(select(Tag).where(Tag.name == normalized))
        if tag is None:
            # 只有查不到时才新建；已有标签直接复用。
            tag = Tag(name=normalized, category=category)
            self.session.add(tag)
            self.session.flush()
        return tag

    def get_by_id(self, tag_id: int) -> Tag | None:
        return self.session.get(Tag, tag_id)

    def get_by_name(self, name: str) -> Tag | None:
        normalized = self.normalize_name(name)
        if not normalized:
            return None
        return self.session.scalar(select(Tag).where(Tag.name == normalized))

    def meme_ids_for_tag(self, tag_id: int) -> list[int]:
        return list(self.session.scalars(
            select(MemeTag.meme_id).where(MemeTag.tag_id == tag_id)
        ))

    def replace_meme_tags(
        self,
        meme: Meme,
        names: Sequence[str],
        *,
        source: str = "user",
    ) -> list[Tag]:
        # dict.fromkeys 在去重的同时保留用户输入顺序。
        normalized_names = list(
            dict.fromkeys(
                normalized
                for name in names
                if (normalized := self.normalize_name(name))
            )
        )

        # PATCH 标签采用“整体替换”语义：先清空旧关联，再建立新关联。
        # 被其他 Meme 使用的 Tag 本体不会因此删除。
        meme.tag_links.clear()
        for name in normalized_names:
            meme.tag_links.append(
                MemeTag(tag=self.get_or_create(name), source=source)
            )
        self.session.flush()
        return list(meme.tags)

    def add_ai_tags(
        self,
        meme: Meme,
        suggestions: Sequence[tuple[str, float]],
    ) -> list[Tag]:
        links_by_name = {link.tag.name: link for link in meme.tag_links}
        for name, confidence in suggestions:
            normalized = self.normalize_name(name)
            if not normalized:
                continue
            existing_link = links_by_name.get(normalized)
            if existing_link is not None:
                # 用户标签拥有更高优先级，AI 确认不能改写其来源和置信度。
                if existing_link.source == "ai":
                    existing_link.confidence = confidence
                continue

            link = MemeTag(
                tag=self.get_or_create(normalized),
                source="ai",
                confidence=confidence,
            )
            meme.tag_links.append(link)
            links_by_name[normalized] = link

        self.session.flush()
        return list(meme.tags)

    def apply_maintenance_tags(
        self,
        meme: Meme,
        *,
        add_names: Sequence[str],
        remove_names: Sequence[str],
        source: str = "codex",
        confidence: float | None = None,
    ) -> list[Tag]:
        """Apply an already validated offline-maintenance tag delta."""
        remove_set = {self.normalize_name(name) for name in remove_names}
        if remove_set:
            meme.tag_links[:] = [
                link for link in meme.tag_links if link.tag.name not in remove_set
            ]

        links_by_name = {link.tag.name: link for link in meme.tag_links}
        for name in add_names:
            normalized = self.normalize_name(name)
            if not normalized or normalized in links_by_name:
                continue
            link = MemeTag(
                tag=self.get_or_create(normalized),
                source=source,
                confidence=confidence,
            )
            meme.tag_links.append(link)
            links_by_name[normalized] = link

        self.session.flush()
        return list(meme.tags)

    def list_with_usage(
        self,
        *,
        include_empty: bool = False,
        q: str | None = None,
        sort: str = "name_asc",
    ) -> list[TagWithUsage]:
        usage = func.count(MemeTag.meme_id)
        statement = (
            select(Tag, usage.label("usage_count"))
            .outerjoin(MemeTag, MemeTag.tag_id == Tag.id)
            .group_by(Tag.id)
        )
        query = self.normalize_name(q or "")
        if query:
            statement = statement.where(Tag.name.contains(query))
        if not include_empty:
            statement = statement.having(usage > 0)
        order = {
            "name_asc": (Tag.name.asc(), Tag.id.asc()),
            "name_desc": (Tag.name.desc(), Tag.id.asc()),
            "usage_asc": (usage.asc(), Tag.name.asc(), Tag.id.asc()),
            "usage_desc": (usage.desc(), Tag.name.asc(), Tag.id.asc()),
        }.get(sort)
        if order is None:
            raise ValueError(f"Unsupported tag sort: {sort}")
        rows = self.session.execute(statement.order_by(*order)).all()
        return [TagWithUsage.from_tag(tag, int(count)) for tag, count in rows]

    def rename(self, tag: Tag, name: str) -> Tag:
        tag.name = name
        self.session.flush()
        return tag

    def usage_count(self, tag_id: int) -> int:
        return int(
            self.session.scalar(
                select(func.count(MemeTag.meme_id)).where(MemeTag.tag_id == tag_id)
            )
            or 0
        )

    @staticmethod
    def _prefer_source(source: MemeTag, target: MemeTag) -> bool:
        priority = {"ai": 0, "codex": 1, "user": 2, "manual": 2}
        source_priority = priority.get(source.source, 0)
        target_priority = priority.get(target.source, 0)
        if source_priority != target_priority:
            return source_priority > target_priority
        if source.source != target.source:
            return False
        source_confidence = float("-inf") if source.confidence is None else source.confidence
        target_confidence = float("-inf") if target.confidence is None else target.confidence
        return source_confidence > target_confidence

    def merge(self, source: Tag, target: Tag) -> Tag:
        source_links = list(
            self.session.scalars(
                select(MemeTag).where(MemeTag.tag_id == source.id)
            )
        )
        target_links = {
            link.meme_id: link
            for link in self.session.scalars(
                select(MemeTag).where(MemeTag.tag_id == target.id)
            )
        }
        transferable: list[MemeTag] = []
        for source_link in source_links:
            target_link = target_links.get(source_link.meme_id)
            if target_link is None:
                transferable.append(source_link)
                continue
            if self._prefer_source(source_link, target_link):
                target_link.source = source_link.source
                target_link.confidence = source_link.confidence
            if target_link.source in {"user", "manual"}:
                target_link.confidence = None
            self.session.delete(source_link)

        # 先删除冲突关联并 flush，再改复合主键，避免 SQLite 的即时唯一约束冲突。
        self.session.flush()
        for link in transferable:
            link.tag = target
            if link.source in {"user", "manual"}:
                link.confidence = None
        self.session.flush()
        self.session.delete(source)
        self.session.flush()
        return target

    def delete_empty(self, tag: Tag) -> bool:
        if self.usage_count(tag.id) != 0:
            return False
        self.session.delete(tag)
        self.session.flush()
        return True

    def cleanup_empty(self) -> list[str]:
        empty_tags = list(
            self.session.scalars(
                select(Tag)
                .outerjoin(MemeTag, MemeTag.tag_id == Tag.id)
                .group_by(Tag.id)
                .having(func.count(MemeTag.meme_id) == 0)
                .order_by(Tag.name)
            )
        )
        names = [tag.name for tag in empty_tags]
        for tag in empty_tags:
            self.session.delete(tag)
        self.session.flush()
        return names

    def list(self) -> list[Tag]:
        # AI 建议仍需要完整词典（包括暂时未使用的标签）。
        return list(self.session.scalars(select(Tag).order_by(Tag.name)))
