from __future__ import annotations

# Repository 层只关心“怎样读写数据库”，不理解 HTTP，也不保存图片。
from collections.abc import Mapping, Sequence

from sqlalchemy import exists, func, or_, select, update, and_
from sqlalchemy.orm import Session, selectinload

from app.models.asset_metadata import AssetMetadata
from app.models.meme import Meme
from app.models.tag import MemeTag, Tag

SHUFFLE_MODULUS = 2_147_483_647
SHUFFLE_MULTIPLIER = 1_103_515_245


class MemeRepository:
    def __init__(self, session: Session) -> None:
        # Session 由外部传入，使 Service 能控制整次业务操作的提交和回滚。
        self.session = session

    def create(self, meme: Meme) -> Meme:
        self.session.add(meme)
        # flush 把 SQL 发给数据库但不提交事务，因此出错时仍能统一 rollback。
        self.session.flush()
        # refresh 重新读取数据库生成的 id、时间等字段。
        self.session.refresh(meme)
        return meme

    def get_by_id(self, meme_id: int) -> Meme | None:
        return self.session.get(Meme, meme_id)

    def get_by_file_hash(self, vault_id: int, file_hash: str) -> Meme | None:
        # 去重只在 Vault 内生效；同一图片允许存在于不同 Vault。
        return self.session.scalar(
            select(Meme).where(Meme.vault_id == vault_id, Meme.file_hash == file_hash)
        )

    @staticmethod
    def _profile_filters(
        *,
        q: str | None,
        orientation: str | None,
        favorite: bool,
        search_metadata: bool,
    ) -> list:
        """Profile 化的附加过滤：方向、收藏标记与 Typed Metadata 关键词。"""
        conditions = []
        if orientation == "portrait":
            conditions.append(Meme.height > Meme.width)
        elif orientation == "landscape":
            conditions.append(Meme.width > Meme.height)
        elif orientation == "square":
            conditions.append(Meme.height == Meme.width)
        elif orientation is not None:
            raise ValueError("orientation must be portrait, landscape, or square")
        if favorite:
            conditions.append(exists().where(and_(
                AssetMetadata.meme_id == Meme.id,
                func.coalesce(
                    func.json_extract(AssetMetadata.data, "$.favorite_level"), 0
                ) >= 1,
            )))
        return conditions
        return conditions

    @staticmethod
    def _metadata_search_condition(q: str | None):
        """Typed Metadata 关键词条件：与标题/描述条件 OR 组合，而不是 AND。"""
        search = (q or "").strip().lower()
        if not search:
            return None
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return exists().where(and_(
            AssetMetadata.meme_id == Meme.id,
            AssetMetadata.data.like(f"%{escaped}%", escape="\\"),
        ))

    def list(
        self,
        *,
        vault_id: int,
        offset: int = 0,
        limit: int = 100,
        tags: Sequence[str] | None = None,
        q: str | None = None,
        template_id: int | None = None,
        gif_only: bool = False,
        orientation: str | None = None,
        favorite: bool = False,
        search_metadata: bool = False,
    ) -> list[Meme]:
        statement = select(Meme).where(Meme.vault_id == vault_id)
        for condition in self._profile_filters(
            q=q, orientation=orientation, favorite=favorite, search_metadata=search_metadata
        ):
            statement = statement.where(condition)
        search = (q or "").strip().lower()
        if search:
            # coalesce 把空描述视为空字符串；autoescape 让 %、_ 按普通字符搜索。
            search_conditions = [
                func.lower(Meme.title).contains(search, autoescape=True),
                func.lower(func.coalesce(Meme.description, "")).contains(
                    search,
                    autoescape=True,
                ),
            ]
            if search_metadata:
                metadata_condition = self._metadata_search_condition(search)
                if metadata_condition is not None:
                    search_conditions.append(metadata_condition)
            statement = statement.where(or_(*search_conditions))
        # 先规范化并去重，避免 tags=["cat", "CAT"] 被当作两个筛选条件。
        normalized_tags = list(
            dict.fromkeys(tag.strip().lower() for tag in tags or [] if tag.strip())
        )
        if normalized_tags:
            # where 找到含任一指定标签的行；group_by + having 再要求匹配数量
            # 等于标签总数，于是最终语义是“同时拥有全部指定标签”。
            statement = (
                statement.join(MemeTag)
                .join(Tag)
                .where(Tag.normalized_name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
        if template_id is not None:
            statement = statement.where(Meme.template_id == template_id)
        if gif_only:
            statement = statement.where(func.lower(Meme.mime_type) == "image/gif")
        statement = statement.order_by(Meme.id).offset(offset).limit(limit)
        return list(self.session.scalars(statement))

    def _build_filtered_ids_statement(
        self,
        *,
        vault_id: int,
        tags: Sequence[str] | None = None,
        q: str | None = None,
        template_id: int | None = None,
        gif_only: bool = False,
        orientation: str | None = None,
        favorite: bool = False,
        search_metadata: bool = False,
    ):
        statement = select(Meme.id.label("meme_id")).where(Meme.vault_id == vault_id)
        for condition in self._profile_filters(
            q=q, orientation=orientation, favorite=favorite, search_metadata=search_metadata
        ):
            statement = statement.where(condition)
        search = (q or "").strip().lower()
        if search:
            search_conditions = [
                func.lower(Meme.title).contains(search, autoescape=True),
                func.lower(func.coalesce(Meme.description, "")).contains(
                    search,
                    autoescape=True,
                ),
            ]
            if search_metadata:
                metadata_condition = self._metadata_search_condition(search)
                if metadata_condition is not None:
                    search_conditions.append(metadata_condition)
            statement = statement.where(or_(*search_conditions))
        normalized_tags = list(
            dict.fromkeys(tag.strip().lower() for tag in tags or [] if tag.strip())
        )
        if normalized_tags:
            statement = (
                statement.join(MemeTag)
                .join(Tag)
                .where(Tag.normalized_name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
        if template_id is not None:
            statement = statement.where(Meme.template_id == template_id)
        if gif_only:
            statement = statement.where(func.lower(Meme.mime_type) == "image/gif")
        return statement

    def count_filtered(
        self,
        *,
        vault_id: int,
        tags: Sequence[str] | None = None,
        q: str | None = None,
        template_id: int | None = None,
        gif_only: bool = False,
        orientation: str | None = None,
        favorite: bool = False,
        search_metadata: bool = False,
    ) -> int:
        filtered_ids = self._build_filtered_ids_statement(
            vault_id=vault_id,
            tags=tags, q=q, template_id=template_id, gif_only=gif_only,
            orientation=orientation, favorite=favorite, search_metadata=search_metadata,
        ).subquery()
        return int(
            self.session.scalar(select(func.count()).select_from(filtered_ids)) or 0
        )

    def list_page(
        self,
        *,
        vault_id: int,
        offset: int,
        limit: int,
        tags: Sequence[str] | None = None,
        q: str | None = None,
        template_id: int | None = None,
        gif_only: bool = False,
        sort: str = "default",
        shuffle_seed: int | None = None,
        orientation: str | None = None,
        favorite: bool = False,
        search_metadata: bool = False,
    ) -> list[Meme]:
        filtered_ids = self._build_filtered_ids_statement(
            vault_id=vault_id,
            tags=tags, q=q, template_id=template_id, gif_only=gif_only,
            orientation=orientation, favorite=favorite, search_metadata=search_metadata,
        ).subquery()
        statement = select(Meme).join(
            filtered_ids,
            Meme.id == filtered_ids.c.meme_id,
        )
        if sort == "shuffle":
            assert shuffle_seed is not None
            shuffle_key = (
                Meme.id * SHUFFLE_MULTIPLIER + shuffle_seed
            ) % SHUFFLE_MODULUS
            statement = statement.order_by(shuffle_key.asc(), Meme.id.asc())
        else:
            statement = statement.order_by(Meme.id.asc())
        return list(self.session.scalars(statement.offset(offset).limit(limit)).unique())

    def list_all_for_export(
        self,
        *,
        vault_id: int,
        tags: Sequence[str] | None = None,
        q: str | None = None,
        template_id: int | None = None,
        orientation: str | None = None,
        favorite: bool = False,
        search_metadata: bool = False,
    ) -> list[Meme]:
        statement = (
            select(Meme)
            .where(Meme.vault_id == vault_id)
            .options(
                selectinload(Meme.images),
                selectinload(Meme.tag_links).selectinload(MemeTag.tag),
                selectinload(Meme.template),
            )
        )
        for condition in self._profile_filters(
            q=q, orientation=orientation, favorite=favorite, search_metadata=search_metadata
        ):
            statement = statement.where(condition)
        search = (q or "").strip().lower()
        if search:
            search_conditions = [
                func.lower(Meme.title).contains(search, autoescape=True),
                func.lower(func.coalesce(Meme.description, "")).contains(
                    search,
                    autoescape=True,
                ),
            ]
            if search_metadata:
                metadata_condition = self._metadata_search_condition(search)
                if metadata_condition is not None:
                    search_conditions.append(metadata_condition)
            statement = statement.where(or_(*search_conditions))
        normalized_tags = list(dict.fromkeys(tag.strip().lower() for tag in tags or [] if tag.strip()))
        if normalized_tags:
            statement = (
                statement.join(MemeTag).join(Tag)
                .where(Tag.normalized_name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
        if template_id is not None:
            statement = statement.where(Meme.template_id == template_id)
        return list(self.session.scalars(statement.order_by(Meme.id)).unique())

    def update(self, meme: Meme, changes: Mapping[str, object]) -> Meme:
        # Repository 不决定哪些字段允许修改；这条业务规则由 Service 负责。
        for field, value in changes.items():
            setattr(meme, field, value)

        self.session.flush()
        self.session.refresh(meme)
        return meme

    def get_random(
        self,
        *,
        vault_id: int,
        tags: Sequence[str] | None = None,
        template_id: int | None = None,
        gif_only: bool = False,
        exclude_ids: Sequence[int] = (),
        orientation: str | None = None,
        favorite: bool = False,
    ) -> Meme | None:
        statement = select(Meme).where(Meme.vault_id == vault_id)
        for condition in self._profile_filters(
            q=None, orientation=orientation, favorite=favorite, search_metadata=False
        ):
            statement = statement.where(condition)
        normalized_tags = list(
            dict.fromkeys(tag.strip().lower() for tag in tags or [] if tag.strip())
        )
        if normalized_tags:
            # 随机范围和列表筛选使用相同的“全部标签”规则。
            statement = (
                statement.join(MemeTag)
                .join(Tag)
                .where(Tag.normalized_name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
        if template_id is not None:
            statement = statement.where(Meme.template_id == template_id)
        if gif_only:
            statement = statement.where(func.lower(Meme.mime_type) == "image/gif")
        if exclude_ids:
            statement = statement.where(Meme.id.not_in(set(exclude_ids)))
        # SQLite 的 random() 为候选行生成随机顺序，只取第一条。
        statement = statement.order_by(func.random()).limit(1)
        return self.session.scalar(statement)

    def delete(self, meme: Meme) -> None:
        self.session.delete(meme)
        # 此处仍不 commit，让 Service 决定整个业务流程是否成功。
        self.session.flush()

    def clear_template_references(self, template_id: int) -> None:
        self.session.execute(
            update(Meme)
            .where(Meme.template_id == template_id)
            .values(template_id=None)
        )

    def meme_ids_for_template(self, template_id: int) -> list[int]:
        return list(self.session.scalars(
            select(Meme.id).where(Meme.template_id == template_id)
        ))
        self.session.flush()
