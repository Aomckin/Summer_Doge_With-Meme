from collections.abc import Sequence

from sqlalchemy import bindparam, inspect, select, text
from sqlalchemy.orm import Session

from app.models.meme import Meme


def invalidate_meme_semantic_data(session: Session, meme_ids: Sequence[int]) -> int:
    """Mark persisted semantic derivatives stale in the caller's transaction."""
    ids = sorted(set(meme_ids))
    if not ids or not inspect(session.connection()).has_table("meme_embeddings"):
        return 0
    statement = text(
        "UPDATE meme_embeddings SET status = 'stale' "
        "WHERE meme_id IN :meme_ids AND status != 'stale'"
    ).bindparams(bindparam("meme_ids", expanding=True))
    changed = int(session.execute(statement, {"meme_ids": ids}).rowcount or 0)
    if changed:
        # 每个 Vault 拥有独立代次；只递增受影响 Meme 所属仓库的索引代次。
        if inspect(session.connection()).has_table("semantic_index_state"):
            vault_ids = list(
                session.scalars(
                    select(Meme.vault_id).where(Meme.id.in_(ids)).distinct()
                )
            )
            for vault_id in vault_ids:
                session.execute(text(
                    "UPDATE semantic_index_state SET generation = generation + 1 "
                    "WHERE vault_id = :vault_id"
                ), {"vault_id": vault_id})
            missing = [
                vault_id
                for vault_id in vault_ids
                if not session.execute(
                    text(
                        "SELECT 1 FROM semantic_index_state WHERE vault_id = :vault_id"
                    ),
                    {"vault_id": vault_id},
                ).first()
            ]
            for vault_id in missing:
                session.execute(text(
                    "INSERT INTO semantic_index_state (vault_id, generation) VALUES (:vault_id, 1)"
                ), {"vault_id": vault_id})
        session.expire_all()
    return changed
