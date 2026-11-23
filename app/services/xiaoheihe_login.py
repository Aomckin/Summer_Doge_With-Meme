import base64
import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from uuid import UUID, uuid4

from app.schemas.publisher import PublisherLogin, PublisherLoginStatus
from app.services.post_service import PostNotFound, PublisherInputError
from app.services.publisher_registry import RegisteredPublisher, publisher_process_env

logger = logging.getLogger(__name__)


def xiaoheihe_session_dir(publisher: RegisteredPublisher | None) -> Path | None:
    if not publisher or not publisher.available or publisher.config.manifest.plugin_id != "xiaoheihe":
        return None
    command = publisher.config.command
    if not any(Path(arg).name == "xiaoheihe_publisher.py" for arg in command[1:]) or "--session-dir" not in command:
        return None
    index = command.index("--session-dir") + 1
    if index == len(command):
        return None
    session_dir = Path(command[index])
    return session_dir if session_dir.is_absolute() else None


@dataclass
class LoginAttempt:
    id: UUID
    qr_path: Path
    process: subprocess.Popen[bytes]
    status: PublisherLoginStatus = "waiting"
    message: str | None = None


class XiaoheiheLogin:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.lock = Lock()
        self.attempt: LoginAttempt | None = None
        self.worker: Thread | None = None

    def start(self, publisher: RegisteredPublisher | None) -> PublisherLogin:
        if xiaoheihe_session_dir(publisher) is None:
            raise PublisherInputError("当前小黑盒插件未配置扫码登录")
        with self.lock:
            if self.attempt and self.attempt.status == "waiting":
                return self._response(self.attempt)
            self.directory.mkdir(parents=True, exist_ok=True)
            temporary = TemporaryDirectory(prefix="work-", dir=self.directory)
            qr_path = Path(temporary.name) / "qr.png"
            try:
                process = subprocess.Popen(
                    [*publisher.config.command, "--login-qr", str(qr_path)],
                    cwd=temporary.name, env=publisher_process_env(), shell=False,
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                )
            except OSError as error:
                temporary.cleanup()
                logger.warning("Unable to start Xiaoheihe login process")
                raise PublisherInputError("无法启动小黑盒 CLI，请检查插件配置") from error
            attempt = LoginAttempt(uuid4(), qr_path, process)
            self.attempt = attempt
            self.worker = Thread(target=self._finish, args=(attempt, temporary), name="xiaoheihe-login", daemon=True)
            self.worker.start()
            return self._response(attempt)

    def status(self, attempt_id: UUID) -> PublisherLogin:
        with self.lock:
            if self.attempt is None or self.attempt.id != attempt_id:
                raise PostNotFound("扫码请求已失效，请重新获取二维码")
            return self._response(self.attempt)

    def shutdown(self) -> None:
        with self.lock:
            if self.attempt and self.attempt.process.poll() is None:
                self.attempt.process.kill()
            worker = self.worker
        if worker is not None:
            worker.join(timeout=5)

    def _response(self, attempt: LoginAttempt) -> PublisherLogin:
        qr_png = None
        if attempt.status == "waiting":
            try:
                with attempt.qr_path.open("rb") as image:
                    png = image.read(64 * 1024 + 1)
            except (FileNotFoundError, PermissionError):
                # The CLI creates the file before writing the complete PNG.
                png = b""
            if len(png) <= 64 * 1024 and png.startswith(b"\x89PNG\r\n\x1a\n") and png.endswith(b"IEND\xaeB\x60\x82"):
                qr_png = base64.b64encode(png).decode("ascii")
        return PublisherLogin(id=attempt.id, status=attempt.status, qr_png=qr_png, message=attempt.message)

    def _finish(self, attempt: LoginAttempt, temporary: TemporaryDirectory) -> None:
        status: PublisherLoginStatus = "failed"
        message = "小黑盒登录未完成，请重新扫码。"
        try:
            stdout, _ = attempt.process.communicate(timeout=155)
            reply = json.loads(stdout)
            if attempt.process.returncode == 0 and reply["ok"] is True and reply["data"]["authenticated"] is True:
                status, message = "succeeded", "扫码登录成功。"
            else:
                code = reply["error"]["code"]
                if code in ("qr_expired", "login_timeout"):
                    status, message = "expired", "二维码已过期，请重新获取。"
                elif code == "network":
                    message = "连接小黑盒失败，请稍后重试。"
                elif code in ("captcha", "auth"):
                    message = "小黑盒要求额外验证，请使用 CLI 的网页登录方式。"
        except subprocess.TimeoutExpired:
            attempt.process.kill()
            attempt.process.communicate()
            status, message = "expired", "扫码等待超时，请重新获取二维码。"
        except (ValueError, KeyError, TypeError):
            logger.warning("Xiaoheihe CLI login returned an invalid or incomplete result")
        finally:
            with self.lock:
                attempt.status, attempt.message = status, message
                temporary.cleanup()
