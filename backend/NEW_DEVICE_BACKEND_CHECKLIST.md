# Backend Setup Checklist For A New Device

Use this checklist when moving the backend to a different computer.

Goal:
- Run the FastAPI backend on the new device
- Expose it through Cloudflare Tunnel
- Point the frontend to the permanent API URL

## 1. Prepare the new device

- [ ] Make sure the new device stays on and does not sleep
- [ ] Install Python 3.11 or newer
- [ ] Copy or clone this repo onto the new device
- [ ] Open PowerShell in the `backend` folder

## 2. Create the Python environment

- [ ] Create the virtual environment

```powershell
python -m venv ..\.venv
```

- [ ] Install dependencies

```powershell
..\.venv\Scripts\python -m pip install -r requirements.txt
```

## 3. Set required environment variables

- [ ] Set CORS origins

```powershell
setx BACKEND_CORS_ORIGINS "https://samsongalvin.com,https://www.samsongalvin.com"
```

- [ ] Set the success redirect URL

```powershell
setx SUCCESS_REDIRECT_URL "https://samsongalvin.com/lab-3d-printing.html"
```

- [ ] Set the admin password

```powershell
setx SUBMISSIONS_ADMIN_PASSWORD "replace-with-a-strong-password"
```

- [ ] Set the Gemini API key

```powershell
setx GEMINI_API_KEY "replace-with-your-gemini-key"
```

Optional:

- [ ] Store uploads outside the repo

```powershell
setx SUBMISSIONS_DIR "C:\backend-data\submissions"
```

- [ ] Store AI usage log outside the repo

```powershell
setx AI_USAGE_LOG_PATH "C:\backend-data\ai_usage.json"
```

- [ ] Close and reopen PowerShell after setting env vars

## 4. Test the backend locally

- [ ] Start the backend

```powershell
run_backend.bat
```

- [ ] Test the health endpoint in a browser

```text
http://localhost:8788/health
```

- [ ] Confirm the response is:

```json
{"status":"ok"}
```

## 5. Install Cloudflare Tunnel

- [ ] Install `cloudflared`

```powershell
winget install Cloudflare.cloudflared
```

- [ ] Log in to Cloudflare

```powershell
cloudflared tunnel login
```

## 6. Create the named tunnel

- [ ] Create the tunnel

```powershell
cloudflared tunnel create samsongalvin-api
```

- [ ] Save the tunnel ID that Cloudflare returns

## 7. Create the Cloudflare config

- [ ] Create this file:

```text
%USERPROFILE%\.cloudflared\config.yml
```

- [ ] Put this in the file and replace the placeholders:

```yaml
tunnel: REPLACE_WITH_TUNNEL_ID
credentials-file: C:\Users\YOUR_USERNAME\.cloudflared\REPLACE_WITH_TUNNEL_ID.json

ingress:
  - hostname: api.samsongalvin.com
    service: http://localhost:8788
  - service: http_status:404
```

## 8. Attach DNS to the tunnel

- [ ] Create the DNS route

```powershell
cloudflared tunnel route dns samsongalvin-api api.samsongalvin.com
```

## 9. Test the public API

- [ ] Run the tunnel

```powershell
cloudflared tunnel run samsongalvin-api
```

- [ ] Test the public health endpoint

```text
https://api.samsongalvin.com/health
```

- [ ] Confirm the response works from outside the local machine

## 10. Make it start automatically

- [ ] Install Cloudflare Tunnel as a Windows service

```powershell
cloudflared service install
```

- [ ] Make the backend app start automatically at boot

Recommended options:
- [ ] Use Task Scheduler to run `backend\run_backend.bat` at startup
- [ ] Or use NSSM to run uvicorn as a Windows service

Example NSSM target:

```powershell
..\.venv\Scripts\python -m uvicorn app:app --host 0.0.0.0 --port 8788
```

## 11. Update the frontend to use the permanent API URL

- [ ] Update the frontend API base URL in `assets/js/lab-form-endpoints.js`

```js
window.LAB_FORM_BASE_URL = "https://api.samsongalvin.com";
```

- [ ] Confirm these routes now use the new backend:
  - `/api/print-request`
  - `/api/laser-request`
  - `/api/product-request`
  - `/api/quote`

## 12. Final verification

- [ ] Submit a test 3D printing request
- [ ] Submit a test laser request
- [ ] Submit a test product request
- [ ] Test the AI quote endpoint
- [ ] Confirm uploads are being saved where expected
- [ ] Confirm admin access still works

## Notes

- If the new device is off, asleep, or disconnected, the backend will be unavailable
- If the Python app is down, the tunnel can still be up but the API will return origin errors
- Keep `SUBMISSIONS_ADMIN_PASSWORD` strong
- Cloudflare upload limits may block very large files
- For best reliability, use an always-on mini PC or VPS