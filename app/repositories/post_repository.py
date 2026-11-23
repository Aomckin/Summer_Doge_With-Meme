from collections.abc import Collection

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.meme import Meme
from app.models.meme_image import MemeImage
from app.models.publisher import PostDraft, PostItem
from app.models.vault import Vault


class PostRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_posts(self):
        return self.session.execute(
            select(PostDraft.id, PostDraft.title, PostDraft.revision, PostDraft.created_at, PostDraft.updated_at)
            .order_by(PostDraft.updated_at.desc(), PostDraft.id.desc())
        ).mappings().all()

    def get(self, post_id: int) -> PostDraft | None:
        return self.session.get(PostDraft, post_id, populate_existing=True)

    def other_post_image_ids(self, post_id: int) -> list[int]:
        return list(self.session.scalars(
            select(PostItem.meme_image_id)
            .join(PostDraft, PostDraft.id == PostItem.post_id)
            .join(MemeImage, (MemeImage.id == PostItem.meme_image_id)
                  & (MemeImage.meme_id == PostItem.meme_id)
                  & (MemeImage.stored_filename == PostItem.image_identity))
            .where(PostItem.post_id != post_id)
            .distinct().order_by(PostItem.meme_image_id)
        ))

    def lock(self, post_id: int, revision: int | None = None) -> bool:
        # SQLite serializes writers. Claim the write transaction before loading a draft or comparing items.
        statement = update(PostDraft).where(PostDraft.id == post_id)
        if revision is not None:
            statement = statement.where(PostDraft.revision == revision)
        return self.session.execute(statement.values(revision=PostDraft.revision)).rowcount == 1

    def create(self, title: str, intro_text: str, outro_text: str) -> PostDraft:
        post = PostDraft(title=title, intro_text=intro_text, outro_text=outro_text, items=[])
        self.session.add(post)
        self.session.flush()
        return post

    def replace_items(self, post: PostDraft, items: list[PostItem]) -> None:
        self.session.execute(delete(PostItem).where(PostItem.post_id == post.id))
        self.session.add_all(items)
        self.session.flush()
        self.session.expire(post, ["items"])

    def delete(self, post: PostDraft) -> None:
        self.session.delete(post)
        self.session.flush()

    def images(self, ids: Collection[int]) -> dict[int, tuple[MemeImage, str, Vault]]:
        if not ids:
            return {}
        rows = self.session.execute(
            select(MemeImage, Meme.title, Vault)
            .join(Meme, (Meme.id == MemeImage.meme_id) & (Meme.vault_id == MemeImage.vault_id))
            .join(Vault, Vault.id == Meme.vault_id)
            .where(MemeImage.id.in_(ids))
        )
        return {image.id: (image, title, vault) for image, title, vault in rows}
