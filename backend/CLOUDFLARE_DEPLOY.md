# Cloudflare Tunnel Deployment

This backend is a FastAPI app that listens on `http://localhost:8788`.

Recommended setup:

- Frontend site: `https://samsongalvin.com`
- API subdomain: `https://api.samsongalvin.com`
- Cloudflare Tunnel forwards `api.samsongalvin.com` to `http://localhost:8788`

## 1. Prepare the backend machine

Cloudflare Tunnel does not host your Python app by itself. The backend must run on a machine that stays online.

- Best reliability: a VPS or always-on mini PC
- Works for testing: your Windows desktop, but the API will stop when the PC is off or asleep

From the `backend` folder:

```powershell
python -m venv ..\.venv
..\.venv\Scripts\python -m pip install -r requirements.txt
```

Set required environment variables in Windows:

```powershell
setx BACKEND_CORS_ORIGINS "https://samsongalvin.com,https://www.samsongalvin.com"
setx SUCCESS_REDIRECT_URL "https://samsongalvin.com/lab-3d-printing.html"
setx SUBMISSIONS_ADMIN_PASSWORD "replace-with-a-strong-password"
setx GEMINI_API_KEY "replace-with-your-gemini-key"
```

Optional if you want uploads stored outside the repo:

```powershell
setx SUBMISSIONS_DIR "C:\backend-data\submissions"
```

## 2. Test the backend locally

From the `backend` folder:

```powershell
run_backend.bat
```

Confirm this works in a browser:

`http://localhost:8788/health`

Expected response:

```json
{"status":"ok"}
```

## 3. Install Cloudflared

Install `cloudflared` on the same machine that runs the backend.

If you use `winget`:

```powershell
winget install Cloudflare.cloudflared
```

Then authenticate it with your Cloudflare account:

```powershell
cloudflared tunnel login
```

## 4. Create a named tunnel

Create a permanent tunnel:

```powershell
cloudflared tunnel create samsongalvin-api
```

That command returns a tunnel ID and creates a credentials JSON file under your Cloudflared folder.

## 5. Create the tunnel config

Create this file:

`%USERPROFILE%\.cloudflared\config.yml`

Example:

```yaml
tunnel: REPLACE_WITH_TUNNEL_ID
credentials-file: C:\Users\samso\.cloudflared\REPLACE_WITH_TUNNEL_ID.json

ingress:
  - hostname: api.samsongalvin.com
    service: http://localhost:8788
  - service: http_status:404
```

## 6. Attach DNS to the tunnel

Create the DNS route in Cloudflare:

```powershell
cloudflared tunnel route dns samsongalvin-api api.samsongalvin.com
```

This creates the proxied DNS record automatically in your `samsongalvin.com` zone.

## 7. Run the tunnel

Test it first in a terminal:

```powershell
cloudflared tunnel run samsongalvin-api
```

Now this should respond:

`https://api.samsongalvin.com/health`

## 8. Make it persistent on Windows

For a permanent tunnel on Windows, install Cloudflared as a service:

```powershell
cloudflared service install
```

Important: this uses `%USERPROFILE%\.cloudflared\config.yml`, so make sure that file exists first.

You also need the FastAPI app itself to start automatically.

Two workable options:

- Use Task Scheduler to run `backend\run_backend.bat` at startup
- Use NSSM to run `..\.venv\Scripts\python -m uvicorn app:app --host 0.0.0.0 --port 8788` as a Windows service

If the Python app is not running, Cloudflare Tunnel stays up but returns origin errors.

## 9. Update the frontend to use the permanent API URL

After the tunnel works, replace the temporary TryCloudflare URL in:

- `assets/js/lab-form-endpoints.js`

with:

```js
window.LAB_FORM_BASE_URL = "https://api.samsongalvin.com";
```

That single change updates:

- `/api/print-request`
- `/api/laser-request`
- `/api/product-request`
- `/api/quote`

## 10. Recommended production notes

- Do not use `*` for CORS once the real domain is live
- Keep a strong `SUBMISSIONS_ADMIN_PASSWORD`
- Cloudflare free plans enforce request size limits; large STL or ZIP uploads may fail if they exceed Cloudflare's cap
- If you want true uptime, move the backend from your personal PC to a VPS or always-on device

## Quick summary

1. Run FastAPI on port `8788`
2. Create a named Cloudflare tunnel
3. Route `api.samsongalvin.com` to that tunnel
4. Point the tunnel to `http://localhost:8788`
5. Change `LAB_FORM_BASE_URL` to `https://api.samsongalvin.com`