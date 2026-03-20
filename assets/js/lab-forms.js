(function () {
  function setStatus(statusEl, text) {
    if (!statusEl) return;
    statusEl.textContent = text;
  }

  function setButtonBusy(buttonEl, busy) {
    if (!buttonEl) return;

    if (!buttonEl.dataset.defaultLabel) {
      buttonEl.dataset.defaultLabel = buttonEl.textContent;
    }

    buttonEl.disabled = !!busy;
    buttonEl.textContent = busy ? "Submitting..." : buttonEl.dataset.defaultLabel;
  }

  function normalizeEndpoint(value) {
    if (!value) return "";
    if (typeof value !== "string") return "";
    return value.trim();
  }

  async function readErrorMessage(response) {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => null);
      if (payload && typeof payload.detail === "string") return payload.detail;
    }

    const text = await response.text().catch(() => "");
    return text.trim();
  }

  function initLabForm(options) {
    const form = document.getElementById(options.formId);
    if (!form) return;

    const statusEl = document.getElementById(options.statusId);
    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');

    const endpoints = (window.LAB_FORM_ENDPOINTS || {});
    const endpoint = normalizeEndpoint(endpoints[options.endpointKey]);

    form.method = "POST";
    form.enctype = "multipart/form-data";

    form.addEventListener("submit", async function (e) {
      e.preventDefault();

      if (!endpoint) {
        setStatus(statusEl, "Submission failed, website not accepting submissions at this time.");
        return;
      }

      setButtonBusy(submitButton, true);
      setStatus(statusEl, "Submitting request...");

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          body: new FormData(form),
        });

        if (!response.ok) {
          const errorMessage = await readErrorMessage(response);
          throw new Error(errorMessage || "Request failed.");
        }

        form.reset();
        setStatus(statusEl, "Request submitted.");
      } catch (error) {
        console.error("Lab form submission failed", error);
        setStatus(statusEl, "Submission failed, website not accepting submissions at this time.");
      } finally {
        setButtonBusy(submitButton, false);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initLabForm({ formId: "printRequestForm", statusId: "status", endpointKey: "printing" });
    initLabForm({ formId: "laserRequestForm", statusId: "status", endpointKey: "laser" });
    initLabForm({ formId: "devRequestForm", statusId: "status", endpointKey: "productDevelopment" });
  });
})();
