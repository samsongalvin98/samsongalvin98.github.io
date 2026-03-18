(function () {
  function setStatus(statusEl, text) {
    if (!statusEl) return;
    statusEl.textContent = text;
  }

  function normalizeEndpoint(value) {
    if (!value) return "";
    if (typeof value !== "string") return "";
    return value.trim();
  }

  function initLabForm(options) {
    const form = document.getElementById(options.formId);
    if (!form) return;

    const statusEl = document.getElementById(options.statusId);

    const endpoints = (window.LAB_FORM_ENDPOINTS || {});
    const endpoint = normalizeEndpoint(endpoints[options.endpointKey]);

    form.method = "POST";
    form.enctype = "multipart/form-data";

    if (endpoint) {
      form.action = endpoint;
      // Allow normal form submission (no CORS issues), which is the most reliable for 3rd-party form backends.
      // The backend may redirect to its own thank-you page.
      setStatus(statusEl, "");
      return;
    }

    // No endpoint configured: keep the user on-page and explain.
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      setStatus(statusEl, "Submission isn't configured yet. Set your endpoint in assets/js/lab-form-endpoints.js");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initLabForm({ formId: "printRequestForm", statusId: "status", endpointKey: "printing" });
    initLabForm({ formId: "laserRequestForm", statusId: "status", endpointKey: "laser" });
    initLabForm({ formId: "devRequestForm", statusId: "status", endpointKey: "productDevelopment" });
  });
})();
