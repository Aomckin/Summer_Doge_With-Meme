from collections.abc import Sequence

from sqlalchemy import bindparam, inspect, text
from sqlalchemy.orm import Session


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
    if changed and inspect(session.connection()).has_table("semantic_index_state"):
        result = session.execute(text(
            "UPDATE semantic_index_state SET generation = generation + 1 WHERE id = 1"
        ))
        if not result.rowcount:
            session.execute(text(
                "INSERT INTO semantic_index_state (id, generation) VALUES (1, 1)"
            ))
    if changed:
        session.expire_all()
    return changed
