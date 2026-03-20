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

  function addMsg(listEl, options) {
    const row = document.createElement("div");
    row.className = "ai-chat-row " + (options.role === "user" ? "is-user" : "is-ai");

    const bubble = document.createElement("div");
    bubble.className = "ai-chat-bubble";
    bubble.textContent = options.text;

    row.appendChild(bubble);
    listEl.appendChild(row);
    listEl.scrollTop = listEl.scrollHeight;
  }

  function updateConversationField(fieldEl, history) {
    if (!fieldEl) return;
    fieldEl.value = JSON.stringify(history);
  }

  function addIntroMessage(listEl) {
    addMsg(listEl, {
      role: "ai",
      text: "Use the Project Description field above to send your product details or follow-up AI messages. Replies will appear here.",
    });
  }

  function setBusy(sendButtonEl, busy) {
    if (sendButtonEl) {
      sendButtonEl.disabled = !!busy;
      sendButtonEl.textContent = busy ? "AI Thinking..." : "AI Send Message";
    }
  }

  async function sendMessage(options) {
    const res = await fetch(options.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.userText,
        requestType: options.requestType,
        history: options.history.slice(-12),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text}`.trim());
    }

    const data = await res.json();
    if (!data || typeof data.text !== "string") {
      throw new Error("Invalid response from AI server.");
    }
    return {
      text: data.text,
      usage: data.usage || null,
    };
  }

  function getRequestType() {
    const field = byId("requestType");
    if (!field) return "General";
    return field.value || "General";
  }

  function buildAiMessage(userText, history) {
    if (history.length > 0) return userText;

    return [
      "Please provide a rough product development quote based on the project description below.",
      "Include likely scope, major work stages, important assumptions, and an approximate cost range.",
      "Project description:",
      userText,
    ].join("\n\n");
  }

  function formatUsageStatus(usage) {
    if (!usage || typeof usage !== "object") return "Quote updated.";

    const requestTokens = usage.requestTokens && typeof usage.requestTokens === "object"
      ? usage.requestTokens.totalTokens
      : null;
    const todayTotalTokens = typeof usage.todayTotalTokens === "number" ? usage.todayTotalTokens : null;
    const remainingTokens = typeof usage.remainingTokens === "number" ? usage.remainingTokens : null;

    const parts = [];
    if (typeof requestTokens === "number") parts.push("Request tokens: " + requestTokens);
    if (typeof todayTotalTokens === "number") parts.push("Today total: " + todayTotalTokens);
    if (typeof remainingTokens === "number") parts.push("Remaining: " + remainingTokens);

    return parts.length ? parts.join(" | ") : "Quote updated.";
  }

  document.addEventListener("DOMContentLoaded", function () {
    const listEl = byId("aiChatMessages");
    const sendButtonEl = byId("aiChatSend");
    const statusEl = byId("aiChatStatus");
    const notesEl = byId("notes");
    const formEl = byId("devRequestForm");
    const conversationFieldEl = byId("aiConversation");
    const endpoint = getEndpoint();
    const history = [];

    if (!listEl || !notesEl || !sendButtonEl) return;

    clearEl(listEl);
    updateConversationField(conversationFieldEl, history);

    if (!endpoint) {
      addMsg(listEl, {
        role: "ai",
        text: "AI quote chat is not configured yet. Set LAB_FORM_ENDPOINTS.productDevelopmentAi in assets/js/lab-form-endpoints.js to your backend URL.",
      });
      sendButtonEl.disabled = true;
      if (statusEl) statusEl.textContent = "AI chat disabled (no endpoint configured).";
      return;
    }

    addIntroMessage(listEl);

    async function runRequest() {
      const userText = String(notesEl.value || "").trim();

      if (!userText) {
        if (statusEl) statusEl.textContent = "Enter a project description or AI message first.";
        return;
      }

      addMsg(listEl, { role: "user", text: userText });
      history.push({ role: "user", text: userText });
  updateConversationField(conversationFieldEl, history);

      setBusy(sendButtonEl, true);
      if (statusEl) statusEl.textContent = "Contacting AI quote service...";

      try {
        const result = await sendMessage({
          endpoint,
          history,
          userText: buildAiMessage(userText, history.slice(0, -1)),
          requestType: getRequestType(),
        });

        addMsg(listEl, { role: "ai", text: result.text });
        history.push({ role: "ai", text: result.text });
        updateConversationField(conversationFieldEl, history);
        if (statusEl) statusEl.textContent = formatUsageStatus(result.usage);
      } catch (err) {
        console.error("AI chat failed", err);
        if (statusEl) statusEl.textContent = "AI request failed. Check console and backend logs.";
        history.push({
          role: "ai",
          text: "Sorry, I could not reach the AI quote server. Please try again in a moment.",
        });
        updateConversationField(conversationFieldEl, history);
        addMsg(listEl, {
          role: "ai",
          text: "Sorry, I could not reach the AI quote server. Please try again in a moment.",
        });
      } finally {
        setBusy(sendButtonEl, false);
      }
    }

    sendButtonEl.addEventListener("click", function () {
      runRequest();
    });

    if (formEl) {
      formEl.addEventListener("reset", function () {
        history.length = 0;
        clearEl(listEl);
        addIntroMessage(listEl);
        updateConversationField(conversationFieldEl, history);
        if (statusEl) statusEl.textContent = "";
      });
    }
  });
})();
