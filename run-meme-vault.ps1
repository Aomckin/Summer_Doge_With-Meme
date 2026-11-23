param(
    [int]$Port = 8002,
    [switch]$NoPauseOnError
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$EnvFile = Join-Path $ProjectRoot ".env"
$Frontend = Join-Path $ProjectRoot "frontend"

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

    $BuildEntries = @("dist\index.html", "dist\mobile\index.html") | ForEach-Object { Join-Path $Frontend $_ }
    $NeedsBuild = -not (Test-Path -LiteralPath (Join-Path $Frontend "dist\assets") -PathType Container)
    if (@($BuildEntries | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }).Count) {
        $NeedsBuild = $true
    }
    if (-not $NeedsBuild) {
        $OldestEntry = (Get-Item -LiteralPath $BuildEntries | Sort-Object LastWriteTimeUtc | Select-Object -First 1).LastWriteTimeUtc
        $Inputs = @("src", "mobile", "public", "index.html", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts") |
            ForEach-Object { Join-Path $Frontend $_ } |
            Where-Object { Test-Path -LiteralPath $_ }
        if ($Inputs) {
        if ($Inputs) {
            $NeedsBuild = $null -ne (Get-ChildItem -LiteralPath $Inputs -File -Recurse |
                Where-Object { $_.LastWriteTimeUtc -gt $OldestEntry } | Select-Object -First 1)
        }
        }
    }
    if ($NeedsBuild) {
        $Npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $Npm) {
            throw "The frontend needs a build. Install Node.js with npm, then launch Meme Vault again."
        }
        Write-Host "Building the current Meme Vault frontend..." -ForegroundColor Cyan
        & $Npm.Source --prefix $Frontend run build
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend build failed. Check the error above and install dependencies with npm.cmd --prefix frontend ci if needed."
        }
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
