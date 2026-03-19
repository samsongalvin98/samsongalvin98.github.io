Local preview note:
- Some pages load shared content via fetch() (e.g., CSV-driven dropdowns).
- If you double-click an .html file (file://), the browser will block those requests.
- Run a local web server from the website folder, then open: http://localhost:8000/
- Example: python -m http.server 8000

Website: samsongalvin.com

Hosting
- GitHub Pages (static hosting)

Important: uploads and AI on GitHub Pages
- GitHub Pages cannot directly receive form submissions, store uploaded files, or safely hold AI API keys.
- Use the separate backend in: backend/

Prototyping Lab setup
1) On the computer that will run the backend, copy the backend/ folder.
2) Install backend dependencies with: python -m pip install -r requirements.txt
3) Start the backend with: run_backend.bat
4) Paste the public backend endpoints into: assets/js/lab-form-endpoints.js
	- printing
	- laser
	- productDevelopment
	- productDevelopmentAi

Notes
- If an endpoint is left blank, that form will show a message and won’t submit.
- The forms submit using normal browser POST for maximum compatibility.
- The AI quick quote uses fetch() to call /api/quote on the same backend.