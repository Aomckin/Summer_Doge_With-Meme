from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.repositories.meme_repository import MemeRepository
from app.repositories.tag_repository import TagRepository
from app.services.derived_data_invalidation import invalidate_meme_semantic_data


PROTECTED_TAG_SOURCES = frozenset({"user", "manual"})


@dataclass(frozen=True)
class TagMaintenancePlan:
    meme_id: int
    before: tuple[tuple[str, str], ...]
    add_tags: tuple[str, ...]
    remove_tags: tuple[str, ...]
    after: tuple[tuple[str, str], ...]


class TagMaintenanceService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.memes = MemeRepository(session)
        self.tags = TagRepository(session)

    def plan(
        self,
        meme_id: int,
        *,
        add_tags: Sequence[str],
        remove_tags: Sequence[str],
        allow_protected_removal: bool = False,
    ) -> TagMaintenancePlan:
        meme = self.memes.get_by_id(meme_id)
        if meme is None:
            raise LookupError(f"Meme {meme_id} does not exist")

        def normalize(names: Sequence[str]) -> tuple[str, ...]:
            values: list[str] = []
            for name in names:
                value = self.tags.normalize_name(name)
                if value and value not in values:
                    values.append(value)
            return tuple(values)

        additions = normalize(add_tags)
        removals = normalize(remove_tags)
        overlap = set(additions) & set(removals)
        if overlap:
            raise ValueError(
                "Tags cannot be added and removed together: "
                + ", ".join(sorted(overlap))
            )
        links_by_name = {link.tag.name: link for link in meme.tag_links}
        protected = sorted(
            name for name in removals
            if name in links_by_name and links_by_name[name].source in PROTECTED_TAG_SOURCES
        )
        if protected and not allow_protected_removal:
            raise ValueError("Cannot remove user/manual tags: " + ", ".join(protected))
        actual_additions = tuple(name for name in additions if name not in links_by_name)
        actual_removals = tuple(name for name in removals if name in links_by_name)
        before = tuple((link.tag.name, link.source) for link in meme.tag_links)
        removal_set = set(actual_removals)
        after = tuple(item for item in before if item[0] not in removal_set) + tuple(
            (name, "codex") for name in actual_additions
        )
        return TagMaintenancePlan(
            meme_id, before, actual_additions, actual_removals, after
        )

    def apply(
        self,
        meme_id: int,
        *,
        add_tags: Sequence[str],
        remove_tags: Sequence[str],
        confidence: float,
        allow_protected_removal: bool = False,
    ) -> TagMaintenancePlan:
        plan = self.plan(
            meme_id,
            add_tags=add_tags,
            remove_tags=remove_tags,
            allow_protected_removal=allow_protected_removal,
        )
        meme = self.memes.get_by_id(meme_id)
        assert meme is not None
        try:
            self.tags.apply_maintenance_tags(
                meme,
                add_names=plan.add_tags,
                remove_names=plan.remove_tags,
                source="codex",
                confidence=confidence,
            )
            if plan.add_tags or plan.remove_tags:
                invalidate_meme_semantic_data(self.session, [meme_id])
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return plan
