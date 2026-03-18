@echo off
setlocal

REM Starts a local web server so fetch() can load CSV/partials.
REM Then open: http://localhost:8000/lab-3d-printing.html

cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8000
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8000
  goto :eof
)

echo Python was not found. Install Python from https://python.org (or Microsoft Store), then run this again.
pause
