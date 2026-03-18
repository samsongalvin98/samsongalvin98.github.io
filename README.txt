Local preview note:
- Some pages load shared content via fetch() (e.g., CSV-driven dropdowns).
- If you double-click an .html file (file://), the browser will block those requests.
- Use serve.bat, then open: http://localhost:8000/

Website: samsongalvin.com

Hosting
- GitHub Pages (static hosting)

Important: file uploads on GitHub Pages
- GitHub Pages cannot directly receive form submissions or store uploaded files.
- To accept uploads from the Prototyping Lab pages, use a 3rd-party form backend that supports file uploads (e.g., Getform, Basin, Formspree paid).

Prototyping Lab setup
1) Create 3 forms with your provider (one each for 3D printing, laser engraving, product development).
2) Copy the POST endpoint URL for each form.
3) Paste the endpoints into: assets/js/lab-form-endpoints.js
	- printing
	- laser
	- productDevelopment

Notes
- If an endpoint is left blank, that form will show a message and won’t submit.
- The forms submit using normal browser POST for maximum compatibility.