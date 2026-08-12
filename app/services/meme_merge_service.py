from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.models.caption import Caption
from app.models.meme import Meme
from app.models.meme_relation import MemeRelation
from app.models.tag import MemeTag
from app.repositories.tag_repository import TagRepository
from app.services.derived_data_invalidation import invalidate_meme_semantic_data


class MemeMergeError(ValueError):
    pass


class MemeMergeService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def merge(self, target_meme_id: int, source_meme_id: int) -> Meme:
        if target_meme_id == source_meme_id:
            raise MemeMergeError("Target and source Meme must be different")
        target = self._load(target_meme_id)
        source = self._load(source_meme_id)
        if target is None:
            raise LookupError(f"Target Meme {target_meme_id} does not exist")
        if source is None:
            raise LookupError(f"Source Meme {source_meme_id} does not exist")
        if not target.images or not source.images:
            raise MemeMergeError("Both Meme records must contain at least one image")

        try:
            self._move_images(target, source)
            self._merge_tags(target, source)
            self._move_captions(target, source)
            self._reconnect_relations(target.id, source.id)
            self._sync_cover(target)
            invalidate_meme_semantic_data(self.session, [target.id])
            # 资产已经显式迁移；直接删除父行，让数据库 FK Cascade 只清理
            # Source 剩余的机器派生记录，避免 ORM delete-orphan 二次处理迁移资产。
            self.session.expunge(source)
            self.session.execute(delete(Meme).where(Meme.id == source_meme_id))
            self.session.flush()
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return self._load(target.id, populate_existing=True) or target

    def _move_images(self, target: Meme, source: Meme) -> None:
        target_images = sorted(target.images, key=lambda item: item.position)
        source_images = sorted(source.images, key=lambda item: item.position)
        for offset, image in enumerate(source_images, start=1):
            image.position = -offset
        self.session.flush()
        for image in source_images:
            image.meme = target
        self.session.flush()
        for position, image in enumerate([*target_images, *source_images]):
            image.position = position
        self.session.flush()

    def _merge_tags(self, target: Meme, source: Meme) -> None:
        target_by_tag = {link.tag_id: link for link in target.tag_links}
        additions: list[tuple[object, str, float | None]] = []
        for source_link in list(source.tag_links):
            target_link = target_by_tag.get(source_link.tag_id)
            if target_link is None:
                additions.append(
                    (
                        source_link.tag,
                        source_link.source,
                        None
                        if source_link.source in {"user", "manual"}
                        else source_link.confidence,
                    )
                )
            else:
                target_link.source, target_link.confidence = (
                    TagRepository.preferred_link_values(source_link, target_link)
                )
            self.session.delete(source_link)
        self.session.flush()
        for tag, source_name, confidence in additions:
            target.tag_links.append(
                MemeTag(tag=tag, source=source_name, confidence=confidence)
            )
        self.session.flush()

    def _move_captions(self, target: Meme, source: Meme) -> None:
        self.session.execute(
            update(Caption)
            .where(Caption.meme_id == source.id)
            .values(meme_id=target.id)
        )
        self.session.flush()
        self.session.expire(target, ["captions"])
        self.session.expire(source, ["captions"])

    def _reconnect_relations(self, target_id: int, source_id: int) -> None:
        edges = list(
            self.session.scalars(
                select(MemeRelation).where(
                    or_(
                        MemeRelation.meme_a_id.in_((target_id, source_id)),
                        MemeRelation.meme_b_id.in_((target_id, source_id)),
                    )
                )
            )
        )
        neighbors: set[int] = set()
        for edge in edges:
            neighbors.add(
                edge.meme_b_id
                if edge.meme_a_id in {target_id, source_id}
                else edge.meme_a_id
            )
        neighbors.difference_update({target_id, source_id})
        self.session.execute(
            delete(MemeRelation).where(
                or_(
                    MemeRelation.meme_a_id.in_((target_id, source_id)),
                    MemeRelation.meme_b_id.in_((target_id, source_id)),
                )
            )
        )
        self.session.flush()
        for neighbor_id in sorted(neighbors):
            left, right = sorted((target_id, neighbor_id))
            self.session.add(MemeRelation(meme_a_id=left, meme_b_id=right))
        self.session.flush()

    @staticmethod
    def _sync_cover(meme: Meme) -> None:
        cover = min(meme.images, key=lambda item: item.position)
        for field in (
            "original_filename",
            "stored_filename",
            "file_path",
            "thumbnail_path",
            "mime_type",
            "file_size",
            "width",
            "height",
            "file_hash",
        ):
            setattr(meme, field, getattr(cover, field))

    def _load(self, meme_id: int, *, populate_existing: bool = False) -> Meme | None:
        statement = (
            select(Meme)
            .options(
                selectinload(Meme.images),
                selectinload(Meme.tag_links).selectinload(MemeTag.tag),
                selectinload(Meme.captions),
                selectinload(Meme.template),
            )
            .where(Meme.id == meme_id)
        )
        if populate_existing:
            statement = statement.execution_options(populate_existing=True)
        return self.session.scalar(statement)
