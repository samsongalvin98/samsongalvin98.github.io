(function () {
  function byId(id) {
    return document.getElementById(id);
  }

  function getEndpoint() {
    const endpoints = window.LAB_FORM_ENDPOINTS || {};
    const value = endpoints.productDevelopmentAi;
    return typeof value === "string" ? value.trim() : "";
  }

  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function addMsg(listEl, { role, text }) {
    const row = document.createElement("div");
    row.className = "ai-chat-row " + (role === "user" ? "is-user" : "is-ai");

    const bubble = document.createElement("div");
    bubble.className = "ai-chat-bubble";
    bubble.textContent = text;

    row.appendChild(bubble);
    listEl.appendChild(row);

    // Keep scrolled to bottom.
    listEl.scrollTop = listEl.scrollHeight;
  }

  function setBusy(buttonEl, busy) {
    if (!buttonEl) return;
    buttonEl.disabled = !!busy;
    buttonEl.textContent = busy ? "Thinking…" : "Send";
  }

  async function sendMessage({ endpoint, history, userText, requestType }) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userText,
        requestType,
        history: history.slice(-12),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text}`.trim());
    }

    const data = await res.json();
    if (!data || typeof data.text !== "string") throw new Error("Invalid response from AI server.");
    return data.text;
  }

  function getRequestType() {
    const sel = byId("requestType");
    if (!sel) return "";
    return sel.value || "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    const listEl = byId("aiChatMessages");
    const inputEl = byId("aiChatInput");
    const btnEl = byId("aiChatSend");
    const statusEl = byId("aiChatStatus");

    if (!listEl || !inputEl || !btnEl) return;

    const endpoint = getEndpoint();
    const history = [];

    clearEl(listEl);

    if (!endpoint) {
      addMsg(listEl, {
        role: "ai",
        text: "AI quote chat isn’t configured yet. Set LAB_FORM_ENDPOINTS.productDevelopmentAi in assets/js/lab-form-endpoints.js to your backend URL.",
      });
      btnEl.disabled = true;
      if (statusEl) statusEl.textContent = "AI chat disabled (no endpoint configured).";
      return;
    }

    addMsg(listEl, {
      role: "ai",
      text: "Describe your product idea and what you need (CAD, prototype, testing, etc). I’ll ask a couple questions and give an approximate quote range.",
    });

    async function handleSend() {
      const text = String(inputEl.value || "").trim();
      if (!text) return;

      inputEl.value = "";
      addMsg(listEl, { role: "user", text });
      history.push({ role: "user", text });

      setBusy(btnEl, true);
      if (statusEl) statusEl.textContent = "";

      try {
        const reply = await sendMessage({
          endpoint,
          history,
          userText: text,
          requestType: getRequestType(),
        });
        addMsg(listEl, { role: "ai", text: reply });
        history.push({ role: "ai", text: reply });
      } catch (err) {
        console.error("AI chat failed", err);
        if (statusEl) statusEl.textContent = "AI request failed. Check console and backend logs.";
        addMsg(listEl, {
          role: "ai",
          text: "Sorry — I couldn’t reach the AI quote server. Please try again in a moment.",
        });
      } finally {
        setBusy(btnEl, false);
      }
    }

    btnEl.addEventListener("click", handleSend);
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  });
})();
