import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.ai.client import AIConfigurationError


class APIKeyCipher:
    """Encrypt provider credentials before they are persisted locally."""

    def __init__(
        self,
        key_file: Path,
        *,
        environ: dict[str, str] | None = None,
    ) -> None:
        self.key_file = key_file
        self.environ = environ if environ is not None else os.environ

    def encrypt(self, value: str) -> str:
        return self._fernet().encrypt(value.encode("utf-8")).decode("ascii")

    def decrypt(self, value: str) -> str:
        try:
            return self._fernet().decrypt(value.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError) as error:
            raise AIConfigurationError(
                "保存的 API Key 无法解密，请在 API 设置中重新填写"
            ) from error

    def _fernet(self) -> Fernet:
        configured = self.environ.get("AI_SETTINGS_ENCRYPTION_KEY", "").strip()
        if configured:
            key = configured.encode("ascii")
        elif self.key_file.is_file():
            key = self.key_file.read_bytes().strip()
        else:
            key = Fernet.generate_key()
            self.key_file.parent.mkdir(parents=True, exist_ok=True)
            self.key_file.write_bytes(key + b"\n")
            try:
                self.key_file.chmod(0o600)
            except OSError:
                pass
        try:
            return Fernet(key)
        except (TypeError, ValueError) as error:
            raise AIConfigurationError(
                "AI_SETTINGS_ENCRYPTION_KEY 格式无效"
            ) from error
