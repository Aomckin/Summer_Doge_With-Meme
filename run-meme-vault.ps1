param(
    [int]$Port = 8002,
    [switch]$NoPauseOnError
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$EnvFile = Join-Path $ProjectRoot ".env"

try {
    Set-Location -LiteralPath $ProjectRoot
    $Host.UI.RawUI.WindowTitle = "Meme Vault"

    if (-not (Test-Path -LiteralPath $Python)) {
        throw ".venv Python not found. Create the environment and install requirements first."
    }
    if (-not (Test-Path -LiteralPath $EnvFile)) {
        throw ".env not found. Copy .env.example to .env and configure it first."
    }
    if ($Port -lt 1 -or $Port -gt 65535) {
        throw "Port must be between 1 and 65535."
    }

    # Check before application startup can run database migrations or job recovery.
    $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $Listener.Server.ExclusiveAddressUse = $true
    try {
        $Listener.Start()
    }
    catch {
        throw "Cannot bind to 127.0.0.1:$Port. The port may already be in use. Retry with an unused port, for example: -Port 8003."
    }
    finally {
        $Listener.Stop()
    }

    Write-Host "Starting Meme Vault: http://127.0.0.1:$Port" -ForegroundColor Cyan
    & $Python -m uvicorn app.main:app --env-file $EnvFile --host 127.0.0.1 --port $Port --proxy-headers --forwarded-allow-ips 127.0.0.1
    if ($LASTEXITCODE -ne 0) {
        throw "Uvicorn exited with code $LASTEXITCODE. See the error above."
    }
}
catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    if (-not $NoPauseOnError) {
        Write-Host "Press Enter to close"
        Read-Host | Out-Null
    }
    exit 1
}
