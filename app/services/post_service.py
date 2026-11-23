from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.models.meme_image import MemeImage, utc_now
from app.models.publisher import PostDraft, PostItem
from app.models.vault import Vault
from app.repositories.post_repository import PostRepository
from app.schemas.publisher import PostContent, PostItemInput, PostItemResponse, PostResponse, PostSummary, PostUpdate
from app.storage.image_storage import ImageStorage
from app.storage.vault_storage import VaultStorageService, media_prefix_for


class PostNotFound(LookupError):
    pass


class PublisherConflict(RuntimeError):
    pass


class PublisherInputError(ValueError):
    def __init__(self, message: str, *, code: str | None = None) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class ResolvedPostItem:
    item: PostItem
    image: MemeImage | None = None
    title: str | None = None
    vault: Vault | None = None
    path: Path | None = None

    def response(self) -> PostItemResponse:
        result = PostItemResponse(
            id=self.item.id, meme_id=self.item.meme_id, meme_image_id=self.item.meme_image_id,
            caption=self.item.caption, position=self.item.position, meme_title=self.title,
        )
        if self.path and self.image and self.vault:
            original, thumbnails = media_prefix_for(self.vault)
            result.image_url = f"{original}/{quote(self.path.name)}"
            if self.image.thumbnail_path:
                name = ImageStorage.filename_from_reference(self.image.thumbnail_path)
                result.thumbnail_url = f"{thumbnails}/{quote(name)}"
        return result


class PostService:
    def __init__(self, session: Session, storage: VaultStorageService) -> None:
        self.session = session
        self.storage = storage
        self.repository = PostRepository(session)

    def list_posts(self) -> list[PostSummary]:
        return [PostSummary.model_validate(row) for row in self.repository.list_posts()]

    def other_post_image_ids(self, post_id: int) -> list[int]:
        return self.repository.other_post_image_ids(post_id)

    def get(self, post_id: int) -> PostDraft:
        post = self.repository.get(post_id)
        if post is None:
            raise PostNotFound("帖文不存在")
        return post

    def lock(self, post_id: int, revision: int | None = None) -> PostDraft:
        locked = self.repository.lock(post_id, revision)
        post = self.get(post_id)
        if not locked:
            raise PublisherConflict("草稿版本已变化。请先读取服务器上的最新版本。")
        return post

    def resolve_items(self, post: PostDraft) -> list[ResolvedPostItem]:
        images = self.repository.images({item.meme_image_id for item in post.items})
        resolved = []
        for item in post.items:
            source = images.get(item.meme_image_id)
            if source is None or (source[0].meme_id, source[0].stored_filename) != (item.meme_id, item.image_identity):
                resolved.append(ResolvedPostItem(item))
                continue
            image, title, vault = source
            try:
                path = self.storage.storage_for(vault).original_path(image.file_path)
                with path.open("rb") as file:
                    available = bool(file.read(1))
            except (OSError, ValueError):
                available = False
            resolved.append(ResolvedPostItem(item, image, title, vault, path if available else None))
        return resolved

    def response(self, post: PostDraft) -> PostResponse:
        return PostResponse(
            **PostSummary.model_validate(post).model_dump(),
            intro_text=post.intro_text,
            outro_text=post.outro_text,
            items=[item.response() for item in self.resolve_items(post)],
        )

    def create(self, payload: PostContent) -> PostResponse:
        post = self.repository.create(payload.title, payload.intro_text, payload.outro_text)
        self.repository.replace_items(post, self._items(post, payload.items))
        return self._commit_response(post)

    def update(self, post_id: int, payload: PostUpdate) -> PostResponse:
        post = self.lock(post_id, payload.revision)
        items = self._items(post, payload.items)
        post.title, post.intro_text, post.outro_text = payload.title, payload.intro_text, payload.outro_text
        self.repository.replace_items(post, items)
        return self._commit_response(post, edited=True)

    def append(self, post_id: int, inputs: list[PostItemInput]) -> PostResponse:
        post = self.lock(post_id)
        # Repeated delivery of the same append (e.g. after a lost response) is idempotent.
        old = {item.id: item for item in post.items}
        additions = []
        for input_item in inputs:
            existing = old.get(str(input_item.id))
            if existing is None:
                additions.append(input_item)
            elif (existing.meme_id, existing.meme_image_id) != (input_item.meme_id, input_item.meme_image_id):
                raise PublisherConflict("图片条目 ID 已被使用")
        if not additions:
            return self._commit_response(post)
        if len(post.items) + len(additions) > 500:
            raise PublisherInputError("一篇帖文最多保存 500 个图片条目")
        items = self._items(post, additions, offset=len(post.items))
        post.items.extend(items)
        return self._commit_response(post, edited=True)

    def copy(self, post_id: int) -> PostResponse:
        source = self.lock(post_id)
        post = self.repository.create((source.title or "未命名帖文")[:250] + "（副本）", source.intro_text, source.outro_text)
        post.items = [
            PostItem(id=item.id, meme_id=item.meme_id, meme_image_id=item.meme_image_id,
                     position=item.position, caption=item.caption, image_identity=item.image_identity)
            for item in source.items
        ]
        return self._commit_response(post)

    def move_to_top(self, post_id: int) -> PostSummary:
        post = self.lock(post_id)
        post.updated_at = utc_now()
        summary = PostSummary.model_validate(post)
        self.session.commit()
        return summary

    def delete(self, post_id: int, revision: int) -> None:
        self.repository.delete(self.lock(post_id, revision))
        self.session.commit()

    def _commit_response(self, post: PostDraft, edited: bool = False) -> PostResponse:
        if edited:
            post.revision += 1
            post.updated_at = utc_now()
        self.session.flush()
        response = self.response(post)
        self.session.commit()
        return response

    def _items(self, post: PostDraft, inputs: list[PostItemInput], offset: int = 0) -> list[PostItem]:
        if len({item.id for item in inputs}) != len(inputs):
            raise PublisherInputError("图片条目 ID 不能重复")
        old = {item.id: item for item in post.items}
        sources = self.repository.images({item.meme_image_id for item in inputs})
        items = []
        for position, item in enumerate(inputs, start=offset):
            previous = old.get(str(item.id))
            if previous and (previous.meme_id, previous.meme_image_id) == (item.meme_id, item.meme_image_id):
                identity = previous.image_identity
            else:
                source = sources.get(item.meme_image_id)
                if source is None or source[0].meme_id != item.meme_id:
                    raise PublisherInputError(f"第 {position + 1} 项引用的图片不存在或与素材不匹配")
                identity = source[0].stored_filename
            items.append(PostItem(
                post_id=post.id, id=str(item.id), meme_id=item.meme_id, meme_image_id=item.meme_image_id,
                position=position, caption=item.caption, image_identity=identity,
            ))
        return items
