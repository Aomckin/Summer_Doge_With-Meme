import logging
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import Empty, Queue
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore, Thread
from time import monotonic, time
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from app.models.meme_image import utc_now
from app.models.publisher import PublishAttempt
from app.repositories.publish_attempt_repository import XIAOHEIHE_DRAFT_RECHECK_ERRORS, PublishAttemptRepository
from app.schemas.publisher import AttemptResponse, PluginResult, PublisherInfo, PublishRequest
from app.services.post_service import PostNotFound, PostService, PublisherConflict, PublisherInputError
from app.services.publish_package import PackageAssetError, PackageSnapshot, snapshot_package
from app.services.publisher_registry import PublisherRegistry, RegisteredPublisher, publisher_process_env
from app.services.xiaoheihe_login import XiaoheiheLogin, xiaoheihe_session_dir
from app.storage.vault_storage import VaultStorageService

logger = logging.getLogger(__name__)
ARCHIVE_TTL_SECONDS = 24 * 60 * 60
MAX_RESULT_BYTES = 64 * 1024
EXPECTED_RESULT = {"prepare": "prepared", "dry_run": "prepared", "remote_draft": "remote_draft", "publish": "published"}
XIAOHEIHE_ERRORS = {
    "title_required": "小黑盒文章需要标题。",
    "xiaoheihe_login_required": "小黑盒会话未登录或已失效，请在 Publisher 管理重新扫码。",
    "xiaoheihe_session": "无法验证小黑盒的登录会话。",
    "xiaoheihe_draft_check": "小黑盒草稿箱已有内容或暂时无法核对，本次尚未上传图片。",
    "xiaoheihe_draft_rejected": "小黑盒明确拒绝保存这篇草稿，请检查文章内容和账号权限。",
    "xiaoheihe_editor_unavailable": "无法打开小黑盒网页编辑器或触发保存，请检查本机 Edge 和小黑盒登录会话。",
    "xiaoheihe_editor_unavailable": "无法打开小黑盒网页编辑器或触发保存，请检查本机 Edge 和小黑盒登录会话。",
    "xiaoheihe_prepare": "小黑盒提交前的文章准备失败。",
    "xiaoheihe_submit_unknown": "小黑盒提交阶段中断，请先核对平台记录。",
    "xiaoheihe_receipt_missing_id": "小黑盒已接收请求，但回执缺少有效的平台编号。",
    "xiaoheihe_readback_unverified": "小黑盒已接收请求并返回平台编号，但未能读回并核对内容。",
}


def plugin_error_message(result: PluginResult) -> str:
    if result.plugin_id == "xiaoheihe":
        if message := XIAOHEIHE_ERRORS.get(result.error_code):
            return message
        if position := re.fullmatch(r"xiaoheihe_upload_([1-9][0-9]{0,2})", result.error_code or ""):
            return f"上传第 {position[1]} 张图时失败，尚未向小黑盒提交帖文。"
    if result.status == "unknown":
        return "插件无法确认操作结果，请先核查平台记录。"
    return "插件报告操作失败；请根据错误代码检查插件。"


class PluginOutcomeUnknown(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class PublisherService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        storage: VaultStorageService,
        directory: Path,
        registry: PublisherRegistry,
    ) -> None:
        self.session_factory = session_factory
        self.storage = storage
        self.directory = directory.resolve()
        self.registry = registry
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="publisher")
        self.slots = BoundedSemaphore(4)
        self.xiaoheihe_login = XiaoheiheLogin(self.directory)

    def startup(self) -> None:
        with self.session_factory() as session:
            PublishAttemptRepository(session).recover_interrupted()
            session.commit()
        if self.directory.is_dir():
            for entry in self.directory.iterdir():
                if re.fullmatch(r"work-[a-z0-9_]{8}", entry.name) and entry.is_dir():
                    if entry.resolve().parent == self.directory and not entry.is_symlink():
                        shutil.rmtree(entry)
                elif entry.name.endswith(".zip.part"):
                    entry.unlink(missing_ok=True)
            self.cleanup_archives()

    def shutdown(self) -> None:
        self.xiaoheihe_login.shutdown()
        self.executor.shutdown(wait=True, cancel_futures=True)

    def cleanup_archives(self) -> None:
        cutoff = time() - ARCHIVE_TTL_SECONDS
        for archive in self.directory.glob("post-*.zip"):
            try:
                if archive.stat().st_mtime <= cutoff:
                    archive.unlink(missing_ok=True)
            except FileNotFoundError:
                continue
            except PermissionError:
                # Windows can hold an open download handle during expiry cleanup.
                logger.debug("Expired Publisher archive could not be removed yet")

    def _archive(self, attempt_id: UUID) -> Path:
        return self.directory / f"post-{attempt_id}.zip"

    def _response(self, attempt: PublishAttempt) -> AttemptResponse:
        result = AttemptResponse.model_validate(attempt)
        if result.action == "export" and result.status == "prepared":
            try:
                fresh = self._archive(result.id).stat().st_mtime > time() - ARCHIVE_TTL_SECONDS
            except FileNotFoundError:
                fresh = False
            if fresh:
                result.download_url = f"/api/publisher/attempts/{result.id}/download"
        return result

    def _get(self, session: Session, attempt_id: UUID) -> PublishAttempt:
        attempt = PublishAttemptRepository(session).get(str(attempt_id))
        if attempt is None:
            raise PostNotFound("发布任务不存在")
        return attempt

    def find(self, session: Session, attempt_id: UUID) -> AttemptResponse:
        return self._response(self._get(session, attempt_id))

    def download(self, session: Session, attempt_id: UUID) -> tuple[Path, str]:
        result = self.find(session, attempt_id)
        if result.action != "export" or result.status != "prepared":
            raise PublisherConflict("此任务没有可下载的发布包")
        if result.download_url is None:
            raise FileNotFoundError("发布包已过期，请重新导出")
        return self._archive(attempt_id), f"post-{result.post_id}-r{result.revision}.zip"

    def history(self, session: Session, post_id: int, limit: int, offset: int) -> list[AttemptResponse]:
        return [self._response(row) for row in PublishAttemptRepository(session).history(post_id, limit, offset)]

    def plugins(self, session: Session) -> list[PublisherInfo]:
        repository = PublishAttemptRepository(session)
        entries = []
        for plugin_id, publisher in self.registry.plugins.items():
            recent = repository.recent(plugin_id)
            session_dir = xiaoheihe_session_dir(publisher)
            entries.append(PublisherInfo(
                **publisher.config.manifest.model_dump(), enabled=publisher.enabled, available=publisher.available,
                recent_attempt=self._response(recent) if recent else None,
                qr_session_saved=(session_dir / "session.json").is_file() if session_dir else None,
            ))
        return entries

    def submit(self, session: Session, post_id: int, request: PublishRequest) -> AttemptResponse:
        posts = PostService(session, self.storage)
        # All task creation for a post shares the same DB write lock as edits and gallery appends.
        post = posts.lock(post_id)
        repository = PublishAttemptRepository(session)
        attempt_id = str(request.request_id)
        retry_of = str(request.retry_of) if request.retry_of else None
        identity = (post_id, request.revision, request.action, request.plugin_id, retry_of)
        existing = repository.get(attempt_id)
        if existing:
            if identity != (existing.post_id, existing.revision, existing.action, existing.plugin_id, existing.retry_of):
                raise PublisherConflict("任务请求 ID 已被其他操作使用")
            return self._response(existing)
        if post.revision != request.revision:
            raise PublisherConflict("草稿版本已变化，请保存或重新打开后再试")
        if repository.active_for_post(post_id):
            raise PublisherConflict("这篇帖文已有任务在执行")
        publisher = self._target(request)
        recheck_empty_drafts = False
        if request.retry_of:
            previous = repository.get(retry_of)
            if previous is None or identity[:4] != (
                previous.post_id, previous.revision, previous.action, previous.plugin_id,
            ):
                raise PublisherConflict("重试必须使用原任务的版本和目标")
            recheck_empty_drafts = (
                previous.plugin_id == "xiaoheihe" and previous.action == "remote_draft"
                and previous.status == "unknown" and previous.error_code in XIAOHEIHE_DRAFT_RECHECK_ERRORS
                and previous.external_post_id is None and previous.external_url is None
            )
            if previous.status != "failed" and not recheck_empty_drafts:
                raise PublisherConflict("该任务无法重试，请先核查平台记录")
        if request.action in ("publish", "remote_draft") and repository.remote_conflict(
            post_id, request.plugin_id, request.action, recheck_revision=post.revision if recheck_empty_drafts else None,
        ):
            raise PublisherConflict("该平台已有成功、执行中或结果未知的任务，请先核查平台记录")
        package = snapshot_package(posts, post, request.request_id, publisher.config.manifest if publisher else None)
        if not self.slots.acquire(blocking=False):
            raise PublisherConflict("发布队列已满，请等待已有任务完成")
        attempt = PublishAttempt(
            id=attempt_id, post_id=post_id, revision=post.revision, action=request.action,
            plugin_id=request.plugin_id, plugin_version=publisher.config.manifest.version if publisher else None,
            retry_of=retry_of,
        )
        try:
            repository.add(attempt)
            response = self._response(attempt)
            session.commit()
            try:
                future = self.executor.submit(self._run, attempt_id, package, publisher, request.action, recheck_empty_drafts)
            except RuntimeError as error:
                attempt.status, attempt.error_code = "failed", "queue_unavailable"
                attempt.error_message, attempt.finished_at = "发布队列已关闭", utc_now()
                session.commit()
                raise PublisherConflict(attempt.error_message) from error
        except Exception:
            self.slots.release()
            raise
        future.add_done_callback(lambda _future: self.slots.release())
        return response

    def _target(self, request: PublishRequest) -> RegisteredPublisher | None:
        if request.action == "export" and request.plugin_id is None:
            return None
        if request.action == "export" or request.plugin_id is None:
            raise PublisherInputError("请选择与操作匹配的 Publisher")
        publisher = self.registry.plugins.get(request.plugin_id)
        if publisher is None or not publisher.available:
            raise PublisherInputError("此 Publisher 未注册、已禁用或不可用")
        manifest = publisher.config.manifest
        if request.action not in manifest.capabilities or "image_text" not in manifest.supported_content_types:
            raise PublisherInputError("此 Publisher 不支持该操作", code="unsupported")
        return publisher

    def _run(
        self, attempt_id: str, package: PackageSnapshot, publisher: RegisteredPublisher | None, action: str,
        recheck_empty_drafts: bool,
    ) -> None:
        with self.session_factory() as session:
            attempt = PublishAttemptRepository(session).get(attempt_id)
            attempt.status, attempt.started_at = "running", utc_now()
            session.commit()
            result = None
            exported = False
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
                self.cleanup_archives()
                required = sum(item.size for item in package.manifest.items) + 64 * 1024 ** 2
                if shutil.disk_usage(self.directory).free < required:
                    attempt.status, attempt.error_code = "failed", "insufficient_space"
                    attempt.error_message = "磁盘剩余空间不足，无法准备发布包"
                    return
                if publisher is None:
                    final = self._archive(package.manifest.request_id)
                    part = final.with_suffix(".zip.part")
                    try:
                        package.write_zip(part)
                        part.replace(final)
                        exported = True
                    finally:
                        part.unlink(missing_ok=True)
                else:
                    with TemporaryDirectory(prefix="work-", dir=self.directory) as working:
                        root = Path(working)
                        package.write_directory(root)
                        result = run_plugin(publisher, root, action, package.manifest.request_id,
                                            recheck_empty_drafts=recheck_empty_drafts)
            except PackageAssetError as error:
                attempt.status, attempt.error_code, attempt.error_message = "failed", "asset_changed", str(error)
            except PluginOutcomeUnknown as error:
                attempt.status, attempt.error_code, attempt.error_message = "unknown", error.code, str(error)
            except OSError:
                # No subprocess result should be lost because cleanup failed after completion.
                if result is None and not exported:
                    attempt.status, attempt.error_code = "failed", "local_io"
                    attempt.error_message = "无法准备本地发布包或启动插件"
                logger.warning("Publisher local I/O failed for attempt %s", attempt_id)
            finally:
                if result:
                    attempt.status = result.status
                    attempt.external_post_id = result.external_post_id
                    attempt.external_url = str(result.external_url) if result.external_url else None
                    if result.status in ("failed", "unknown"):
                        attempt.error_code = result.error_code or f"plugin_{result.status}"
                        attempt.error_message = plugin_error_message(result)
                elif attempt.status == "running":
                    attempt.status = "prepared" if exported else "unknown"
                    if not exported:
                        attempt.error_code = "internal_error"
                        attempt.error_message = "执行意外中止，结果未知"
                        logger.error("Publisher attempt %s stopped without a result", attempt_id)
                attempt.finished_at = utc_now()
                session.commit()


def run_plugin(
    publisher: RegisteredPublisher, root: Path, action: str, attempt_id: UUID,
    *, recheck_empty_drafts: bool = False,
) -> PluginResult:
    config = publisher.config
    deadline = monotonic() + config.timeout_seconds
    command = [*config.command, "--package", str(root), "--action", action]
    if recheck_empty_drafts:
        command.append("--require-empty-drafts")
    process = subprocess.Popen(
        command,
        cwd=root, env=publisher_process_env(), shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    output: Queue[bytes | OSError] = Queue(maxsize=1)

    def read_result() -> None:
        with process.stdout as pipe:
            try:
                output.put(pipe.read(MAX_RESULT_BYTES + 1))
            except OSError as error:
                output.put(error)

    try:
        Thread(target=read_result, name="publisher-result", daemon=True).start()
        reply = output.get(timeout=max(0, deadline - monotonic()))
        if isinstance(reply, OSError) or len(reply) > MAX_RESULT_BYTES:
            raise PluginOutcomeUnknown("invalid_result", "插件输出无法读取或超过长度限制，执行结果未知")
        if process.wait(timeout=max(0, deadline - monotonic())) != 0:
            raise PluginOutcomeUnknown("plugin_exit", "插件异常退出，执行结果未知")
    except (Empty, subprocess.TimeoutExpired) as error:
        raise PluginOutcomeUnknown("timeout", "插件执行超时，执行结果未知") from error
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()

    try:
        result = PluginResult.model_validate_json(reply)
        if result.attempt_id != attempt_id or result.plugin_id != config.manifest.plugin_id:
            raise ValueError("Mismatched result identity")
        remote = action in ("remote_draft", "publish")
        if result.status not in ("failed", EXPECTED_RESULT[action]) and not (remote and result.status == "unknown"):
            raise ValueError("Unsupported result state")
        if result.external_post_id and result.status not in ("published", "remote_draft", "unknown"):
            raise ValueError("Unexpected remote receipt")
        if result.external_url and (
            result.status not in ("published", "remote_draft") or "external_url" not in config.manifest.capabilities
            or result.external_url.username or result.external_url.password
        ):
            raise ValueError("Invalid result URL")
        if result.status not in ("failed", "unknown") and (result.error_code or result.error_message):
            raise ValueError("Unexpected error in successful result")
    except (ValidationError, ValueError) as error:
        raise PluginOutcomeUnknown("invalid_result", "插件回执不符合协议，执行结果未知") from error
    return result
