@echo off
setlocal

echo Starting AI quote server on http://localhost:8787 ...
echo Make sure you set GEMINI_API_KEY in your environment.
echo Example (PowerShell): setx GEMINI_API_KEY "your_key_here"
echo.

python -m uvicorn ai_quote_server:app --host 0.0.0.0 --port 8787
