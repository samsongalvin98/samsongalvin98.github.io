@echo off
setlocal

REM Combined backend for lab uploads and AI quick quote.
REM
REM First-time setup:
REM   cd /d "%~dp0"
REM   python -m pip install -r requirements.txt
REM
REM Required for AI quick quote:
REM   setx GEMINI_API_KEY "your_key_here"
REM
REM Optional:
REM   setx BACKEND_CORS_ORIGINS "https://your-site.github.io,http://localhost:8000"
REM   setx SUCCESS_REDIRECT_URL "https://your-site.github.io/lab-3d-printing.html"
REM   setx SUBMISSIONS_DIR "C:\backend-data\submissions"

cd /d "%~dp0"

echo Starting backend on http://localhost:8788 ...
echo Upload endpoints:
echo   /api/print-request
echo   /api/laser-request
echo   /api/product-request
echo AI endpoint:
echo   /api/quote
echo.

python -m uvicorn app:app --host 0.0.0.0 --port 8788