import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
import sys

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config import BASE_DIR
from app.schemas.publisher import PublisherManifest

logger = logging.getLogger(__name__)
MOCK_SCRIPT = BASE_DIR / "publishers" / "mock_publisher.py"


def publisher_process_env() -> dict[str, str]:
    # Keep application secrets out of Publisher subprocesses.
    inherit = {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "LANG", "LC_ALL"}
    return {key: value for key, value in os.environ.items() if key.upper() in inherit}


class PluginConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manifest: PublisherManifest
    command: list[str] = Field(min_length=1, max_length=20)
    enabled: bool = True
    timeout_seconds: float = Field(default=30, gt=0, le=300)


@dataclass(frozen=True)
class RegisteredPublisher:
    config: PluginConfig
    allowed: bool

    @property
    def enabled(self) -> bool:
        return self.allowed and self.config.enabled

    @property
    def available(self) -> bool:
        executable = Path(self.config.command[0])
        return (
            self.enabled and executable.is_absolute() and executable.is_file()
            and executable.suffix.lower() not in {".cmd", ".bat", ".ps1"}
            and (os.name == "nt" or os.access(executable, os.X_OK))
        )


class PublisherRegistry:
    def __init__(self, config_path: Path | None = None, *, allowed: bool = True) -> None:
        self.plugins: dict[str, RegisteredPublisher] = {}
        try:
            mock = PublisherManifest.model_validate_json(MOCK_SCRIPT.with_name("mock-manifest.json").read_bytes())
            self.plugins[mock.plugin_id] = RegisteredPublisher(PluginConfig(
                manifest=mock, command=[sys.executable, "-I", str(MOCK_SCRIPT)], enabled=MOCK_SCRIPT.is_file(),
            ), allowed)
        except (OSError, ValidationError):
            logger.warning("Bundled Mock Publisher manifest is unavailable")

        if config_path is None:
            return
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
            if not isinstance(raw, list):
                raise ValueError("Expected a list")
        except (OSError, ValueError):
            logger.warning("Publisher configuration could not be read")
            return
        for index, entry in enumerate(raw):
            try:
                config = PluginConfig.model_validate(entry)
                plugin_id = config.manifest.plugin_id
                if plugin_id in self.plugins:
                    raise ValueError("Duplicate publisher ID")
                if not Path(config.command[0]).is_absolute() or any("\x00" in arg for arg in config.command):
                    raise ValueError("Invalid command")
                self.plugins[plugin_id] = RegisteredPublisher(config, allowed)
            except (ValidationError, ValueError):
                logger.warning("Publisher configuration entry %d is invalid or duplicated", index + 1)

    @classmethod
    def from_environment(cls) -> "PublisherRegistry":
        filename = os.environ.get("MEME_VAULT_PUBLISHERS_FILE")
        return cls(
            Path(filename) if filename else None,
            allowed=os.environ.get("MEME_VAULT_PUBLISHER_EXECUTION", "1") == "1",
        )
