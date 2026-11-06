@echo off
cd /d "%~dp0"
echo Starting Attention Lab local HTTPS server (camera eye-tracking requires a secure context)...
echo A self-signed certificate will be created on first run. If Windows asks, click "Yes".
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
pause
