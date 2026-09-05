param(
    [string]$Mode = "start"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

Set-Location -LiteralPath $ProjectRoot
$Host.UI.RawUI.WindowTitle = "Meme Vault Tagging"

if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host "[ERROR] .venv Python not found. Create the environment and install requirements first." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

switch ($Mode.ToLowerInvariant()) {
    "start" { & $Python -m scripts.tag_maintenance ui }
    "help"  { Write-Host "Usage: .\run-tagging.ps1 [start|help]" }
    default { Write-Host "Unknown mode: $Mode" -ForegroundColor Yellow; Write-Host "Usage: .\run-tagging.ps1 [start|help]"; exit 1 }
}
