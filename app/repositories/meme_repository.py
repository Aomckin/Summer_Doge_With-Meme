# Repository 层只关心“怎样读写数据库”，不理解 HTTP，也不保存图片。
from collections.abc import Mapping, Sequence

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.models.tag import MemeTag, Tag


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

    def list(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        tags: Sequence[str] | None = None,
        q: str | None = None,
    ) -> list[Meme]:
        statement = select(Meme)
        search = (q or "").strip().lower()
        if search:
            # coalesce 把空描述视为空字符串；autoescape 让 %、_ 按普通字符搜索。
            statement = statement.where(
                or_(
                    func.lower(Meme.title).contains(search, autoescape=True),
                    func.lower(func.coalesce(Meme.description, "")).contains(
                        search,
                        autoescape=True,
                    ),
                )
            )
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
                .where(Tag.name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
        statement = statement.order_by(Meme.id).offset(offset).limit(limit)
        return list(self.session.scalars(statement))

    def update(self, meme: Meme, changes: Mapping[str, object]) -> Meme:
        # Repository 不决定哪些字段允许修改；这条业务规则由 Service 负责。
        for field, value in changes.items():
            setattr(meme, field, value)

        self.session.flush()
        self.session.refresh(meme)
        return meme

    def get_random(self, *, tags: Sequence[str] | None = None) -> Meme | None:
        statement = select(Meme)
        normalized_tags = list(
            dict.fromkeys(tag.strip().lower() for tag in tags or [] if tag.strip())
        )
        if normalized_tags:
            # 随机范围和列表筛选使用相同的“全部标签”规则。
            statement = (
                statement.join(MemeTag)
                .join(Tag)
                .where(Tag.name.in_(normalized_tags))
                .group_by(Meme.id)
                .having(func.count(func.distinct(Tag.id)) == len(normalized_tags))
            )
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
        self.session.flush()
