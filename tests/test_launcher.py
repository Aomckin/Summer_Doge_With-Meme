"""Exercise the Windows launcher without the real app, database or providers."""
import json
import shutil
import socket
import subprocess
import sys
import venv
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which("powershell.exe")
pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or not POWERSHELL,
    reason="Windows PowerShell launcher",
)


@pytest.fixture
def launcher_root(tmp_path: Path) -> Path:
    root = tmp_path / "vault 测试 [路径]"
    root.mkdir()
    for name in ("run-meme-vault.ps1", "run-meme-vault.cmd"):
        shutil.copy2(ROOT / name, root / name)
    return root


def run_script(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
         str(root / "run-meme-vault.ps1"), *args],
        cwd=root.parent,
        input="\n",
        capture_output=True,
        text=True,
        errors="replace",
        timeout=20,
    )


def prepare_fake_uvicorn(root: Path, exit_code: int = 0) -> None:
    venv.EnvBuilder(with_pip=False).create(root / ".venv")
    (root / ".env").write_text("# fake configuration\n", encoding="utf-8")
    (root / "uvicorn.py").write_text(
        "import json, os, sys\n"
        "print('LAUNCH=' + json.dumps({'cwd': os.getcwd(), 'args': sys.argv[1:]}))\n"
        "print('Fake Uvicorn diagnostic', file=sys.stderr)\n"
        f"sys.exit({exit_code})\n",
        encoding="utf-8",
    )


def launched_command(result: subprocess.CompletedProcess[str]) -> dict:
    line = next(line for line in result.stdout.splitlines() if line.startswith("LAUNCH="))
    return json.loads(line.removeprefix("LAUNCH="))


def test_missing_python_preserves_error_and_waits(launcher_root: Path) -> None:
    result = run_script(launcher_root)
    assert result.returncode == 1
    assert ".venv Python not found" in result.stdout
    assert "Press Enter to close" in result.stdout


def test_missing_env_can_fail_without_prompt(launcher_root: Path) -> None:
    venv.EnvBuilder(with_pip=False).create(launcher_root / ".venv")
    result = run_script(launcher_root, "-NoPauseOnError")
    assert result.returncode == 1
    assert ".env not found" in result.stdout
    assert "Press Enter to close" not in result.stdout


@pytest.mark.parametrize("port", ["0", "65536"])
def test_invalid_port_does_not_launch_server(launcher_root: Path, port: str) -> None:
    prepare_fake_uvicorn(launcher_root)
    result = run_script(launcher_root, "-NoPauseOnError", "-Port", port)
    assert result.returncode == 1
    assert "Port must be between 1 and 65535" in result.stdout
    assert "LAUNCH=" not in result.stdout


def test_uvicorn_arguments_and_project_directory(launcher_root: Path) -> None:
    prepare_fake_uvicorn(launcher_root)
    result = run_script(launcher_root, "-NoPauseOnError", "-Port", "8003")
    assert result.returncode == 0, result.stdout + result.stderr
    launched = launched_command(result)
    assert Path(launched["cwd"]) == launcher_root
    assert launched["args"] == [
        "app.main:app", "--env-file", str(launcher_root / ".env"),
        "--host", "127.0.0.1", "--port", "8003", "--proxy-headers",
        "--forwarded-allow-ips", "127.0.0.1",
    ]
    assert "Press Enter to close" not in result.stdout
    assert "Fake Uvicorn diagnostic" in result.stderr


def test_uvicorn_failure_is_reported_and_waits(launcher_root: Path) -> None:
    prepare_fake_uvicorn(launcher_root, exit_code=7)
    result = run_script(launcher_root, "-Port", "8003")
    assert result.returncode == 1
    assert "Uvicorn exited with code 7" in result.stdout
    assert "Press Enter to close" in result.stdout


@pytest.mark.parametrize("exit_code", [0, 7])
def test_cmd_entry_forwards_port_and_preserves_failure(
    launcher_root: Path, exit_code: int,
) -> None:
    prepare_fake_uvicorn(launcher_root, exit_code)
    result = subprocess.run(
        f'cmd.exe /d /c ""{launcher_root / "run-meme-vault.cmd"}" -Port 8004"',
        cwd=launcher_root.parent,
        input="\n",
        capture_output=True,
        text=True,
        errors="replace",
        timeout=20,
    )
    assert result.returncode == (1 if exit_code else 0), result.stdout + result.stderr
    args = launched_command(result)["args"]
    assert args[args.index("--port") + 1] == "8004"
    assert "Press Enter to close" not in result.stdout
    if exit_code:
        assert "Uvicorn exited with code 7" in result.stdout


def test_occupied_port_fails_before_application_startup(launcher_root: Path) -> None:
    prepare_fake_uvicorn(launcher_root)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        result = run_script(launcher_root, "-NoPauseOnError", "-Port", str(port))
    assert result.returncode == 1
    assert f"Cannot bind to 127.0.0.1:{port}" in result.stdout
    assert "-Port 8003" in result.stdout
    assert "LAUNCH=" not in result.stdout
