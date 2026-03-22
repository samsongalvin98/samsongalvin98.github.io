@echo off
setlocal

REM Runs the named Cloudflare tunnel for the API.
REM
REM Equivalent command:
REM   cloudflared tunnel run samsongalvin-api

cd /d "%~dp0"

where cloudflared >nul 2>nul
if errorlevel 1 (
	echo cloudflared was not found in PATH.
	echo Install it first, for example with: winget install Cloudflare.cloudflared
	pause
	exit /b 1
)

echo Starting Cloudflare tunnel: samsongalvin-api ...
echo.

cloudflared tunnel run samsongalvin-api

if errorlevel 1 (
	echo.
	echo Tunnel process exited with an error.
	pause
	exit /b 1
)