@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-meme-vault.ps1" -NoPauseOnError %*
if errorlevel 1 (
    pause
    exit /b 1
)
