// Configure your Prototyping Lab form endpoints here.
//
// GitHub Pages is static hosting and cannot process uploads or AI requests directly.
// Point these values at your separate backend server (for example the /backend folder in this project).
//
// Paste your Cloudflare tunnel URL once below. The endpoint paths are appended automatically.
//
// Leave an endpoint blank to disable that form submission.

window.LAB_FORM_BASE_URL = "https://api.samsongalvin.com";

(function configureLabFormEndpoints() {
  const baseUrl = (window.LAB_FORM_BASE_URL || "").trim().replace(/\/$/, "");

  function endpoint(path) {
    return baseUrl ? baseUrl + path : "";
  }

  window.LAB_FORM_ENDPOINTS = {
    printing: endpoint("/api/print-request"),
    laser: endpoint("/api/laser-request"),
    productDevelopment: endpoint("/api/product-request"),
    productDevelopmentAi: endpoint("/api/quote")
  };
})();
