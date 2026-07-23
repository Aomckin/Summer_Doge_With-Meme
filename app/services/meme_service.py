from collections.abc import Mapping, Sequence

from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.repositories.meme_repository import MemeRepository
from app.repositories.tag_repository import TagRepository
from app.storage.image_storage import ImageStorage


# Service 是业务编排层：把数据库操作和文件操作组成一次完整用例。
# 它也是事务的主人，Repository 只 flush，最终 commit/rollback 在这里决定。
EDITABLE_FIELDS = {"title", "description", "source", "tags"}
# 单独的哨兵对象用来区分“请求没传 tags”和“请求明确把 tags 清空”。
TAGS_NOT_PROVIDED = object()


class MemeNotFoundError(LookupError):
    # 业务异常不绑定 HTTP；API 层稍后会把它转换为 404。
    pass


class MemeFileMissingError(FileNotFoundError):
    # 数据库有记录、磁盘却缺文件，和“记录不存在”是不同状态。
    pass


class NoMemesAvailableError(LookupError):
    # 随机选择时没有任何候选 Meme。
    pass


class MemeService:
    def __init__(self, session: Session, storage: ImageStorage | None = None) -> None:
        # 依赖从外部传入，测试时可以换成临时数据库和临时文件目录。
        self.session = session
        self.repository = MemeRepository(session)
        self.tag_repository = TagRepository(session)
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
    ) -> Meme:
        # 先保存并检查图片，由存储层返回可信的文件信息。
        stored = self.storage.save(original_filename, content)
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
        )

        try:
            self.repository.create(meme)
            self.tag_repository.replace_meme_tags(meme, tags)
            # Meme 和标签关系都准备好后一次提交，保持数据库内部一致。
            self.session.commit()
        except Exception:
            # 数据库失败时既回滚事务，也删除刚落盘的文件，避免残留垃圾。
            self.session.rollback()
            self.storage.delete(stored.file_path, stored.thumbnail_path)
            raise

        return meme

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

    def get_random_meme(self, *, tags: Sequence[str] | None = None) -> Meme:
        # Repository 负责随机查询，Service 负责解释“没有结果”及检查文件。
        meme = self.repository.get_random(tags=tags)
        if meme is None:
            raise NoMemesAvailableError("No Meme matches the requested range")
        self._ensure_files_exist(meme)
        return meme

    def delete_meme(self, meme_id: int) -> None:
        meme = self.get_meme(meme_id)
        # ORM 对象删除后不应再依赖它取路径，所以提前保存普通字符串。
        file_path = meme.file_path
        thumbnail_path = meme.thumbnail_path

        try:
            self.repository.delete(meme)
            # 先确认数据库删除成功，再清理磁盘文件。
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        self.storage.delete(file_path, thumbnail_path)

    def _ensure_files_exist(self, meme: Meme) -> None:
        # 集中维护“数据库记录与磁盘文件必须对应”的完整性规则。
        if not self.storage.exists(meme.file_path, meme.thumbnail_path):
            raise MemeFileMissingError(f"Image file is missing for Meme {meme.id}")
