param(
    [int]$Port = 8002
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$EnvFile = Join-Path $ProjectRoot ".env"

Set-Location -LiteralPath $ProjectRoot
$Host.UI.RawUI.WindowTitle = "Meme Vault"

if (-not (Test-Path -LiteralPath $Python)) {
    throw ".venv Python not found. Create the environment and install requirements first."
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw ".env not found. Copy .env.example to .env and configure it first."
}

Write-Host "Meme Vault: http://127.0.0.1:$Port" -ForegroundColor Cyan
& $Python -m uvicorn app.main:app --env-file $EnvFile --host 127.0.0.1 --port $Port --proxy-headers --forwarded-allow-ips 127.0.0.1
