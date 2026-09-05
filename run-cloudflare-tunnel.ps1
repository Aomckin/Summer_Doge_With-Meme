param(
    [int]$Port = 8002
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -LiteralPath $ProjectRoot
$Host.UI.RawUI.WindowTitle = "Meme Vault - Cloudflare Quick Tunnel"

$Cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $Cloudflared) {
    throw "cloudflared not found in PATH. Install it before starting a Quick Tunnel."
}

$LocalUrl = "http://127.0.0.1:$Port"
try {
    Invoke-WebRequest -Uri "$LocalUrl/api/health" -UseBasicParsing -TimeoutSec 3 | Out-Null
}
catch {
    Write-Host "[WARN] Meme Vault did not respond at $LocalUrl. Start run-meme-vault.ps1 first." -ForegroundColor Yellow
}

Write-Host "Starting Cloudflare Quick Tunnel for $LocalUrl" -ForegroundColor Cyan
Write-Host "Share the generated trycloudflare.com URL; Ctrl+C stops the tunnel." -ForegroundColor DarkCyan
& $Cloudflared.Source tunnel --url $LocalUrl
