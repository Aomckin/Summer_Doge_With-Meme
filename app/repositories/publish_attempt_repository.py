from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.meme_image import utc_now
from app.models.publisher import PublishAttempt


XIAOHEIHE_DRAFT_RECHECK_ERRORS = ("plugin_exit", "xiaoheihe_submit_unknown")


class PublishAttemptRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, attempt_id: str) -> PublishAttempt | None:
        return self.session.get(PublishAttempt, attempt_id)

    def add(self, attempt: PublishAttempt) -> None:
        self.session.add(attempt)
        self.session.flush()

    def history(self, post_id: int, limit: int, offset: int) -> list[PublishAttempt]:
        return list(self.session.scalars(
            select(PublishAttempt).where(PublishAttempt.post_id == post_id)
            .order_by(PublishAttempt.created_at.desc(), PublishAttempt.id.desc()).limit(limit).offset(offset)
        ))

    def recent(self, plugin_id: str) -> PublishAttempt | None:
        return self.session.scalar(
            select(PublishAttempt).where(PublishAttempt.plugin_id == plugin_id)
            .order_by(PublishAttempt.created_at.desc(), PublishAttempt.id.desc()).limit(1)
        )

    def remote_conflict(self, post_id: int, plugin_id: str, action: str, *, recheck_revision: int | None = None) -> PublishAttempt | None:
        actions = ["remote_draft", "publish"]
        results_to_block = ["published"] + (["remote_draft"] if action == "remote_draft" else [])
        query = select(PublishAttempt).where(
            PublishAttempt.post_id == post_id, PublishAttempt.plugin_id == plugin_id,
            PublishAttempt.action.in_(actions),
            PublishAttempt.status.in_(["queued", "running", "unknown", *results_to_block]),
        )
        if recheck_revision is not None:
            query = query.where(~(
                (PublishAttempt.revision == recheck_revision) & (PublishAttempt.action == "remote_draft")
                & (PublishAttempt.status == "unknown")
                & func.coalesce(PublishAttempt.error_code, "").in_(XIAOHEIHE_DRAFT_RECHECK_ERRORS)
                & PublishAttempt.external_post_id.is_(None) & PublishAttempt.external_url.is_(None)
            ))
        return self.session.scalar(query.limit(1))

    def active_for_post(self, post_id: int) -> bool:
        return self.session.scalar(
            select(PublishAttempt.id).where(
                PublishAttempt.post_id == post_id,
                PublishAttempt.status.in_(["queued", "running"]),
            ).limit(1)
        ) is not None

    def recover_interrupted(self) -> None:
        self.session.execute(update(PublishAttempt).where(PublishAttempt.status == "queued").values(
            status="failed", error_code="interrupted", error_message="服务在任务开始前停止",
            finished_at=utc_now(),
        ))
        self.session.execute(update(PublishAttempt).where(PublishAttempt.status == "running").values(
            status="unknown", error_code="interrupted", error_message="服务在任务执行期间停止，结果未知",
            finished_at=utc_now(),
        ))
