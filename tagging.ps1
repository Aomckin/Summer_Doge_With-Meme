$ErrorActionPreference = "Stop"
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "Please create .venv and install requirements first."
}
Set-Location -LiteralPath $PSScriptRoot
& $python -m scripts.tag_maintenance ui
