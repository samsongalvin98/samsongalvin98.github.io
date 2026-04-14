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
    return row;
  }

  function updateConversationField(fieldEl, history) {
    if (!fieldEl) return;
    fieldEl.value = JSON.stringify(history);
  }

  function addIntroMessage(listEl) {
    addMsg(listEl, {
      role: "ai",
      text: "Send your project description from the form above, then use the reply box below for follow-up AI messages. Replies will appear here.",
    });
  }

  function setBusy(buttonEl, busy, busyLabel) {
    if (!buttonEl) return;
    if (!buttonEl.dataset.defaultLabel) {
      buttonEl.dataset.defaultLabel = buttonEl.textContent;
    }

    buttonEl.disabled = !!busy;
    buttonEl.textContent = busy ? (busyLabel || "AI Thinking...") : buttonEl.dataset.defaultLabel;
  }

  function setPopupBusy(buttonEl, busy) {
    if (!buttonEl) return;
    if (!buttonEl.dataset.defaultLabel) {
      buttonEl.dataset.defaultLabel = buttonEl.textContent;
    }

    buttonEl.disabled = !!busy;
    buttonEl.textContent = busy ? "Resetting..." : buttonEl.dataset.defaultLabel;
  }

  async function sendMessage(options) {
    const res = await fetch(options.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.userText,
        requestType: options.requestType,
        history: options.history.slice(-12),
        adminPassword: options.adminPassword,
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
      adminResetCommandUsed: !!(data.usage && data.usage.adminResetCommandUsed),
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
    const aiUnavailable = !!usage.aiUnavailable;
    const unavailableReason = String(usage.reason || "");
    const adminOverrideUsed = !!usage.adminOverrideUsed;
    const adminResetUsed = !!usage.adminResetUsed;
    const limitReached = !!usage.limitReached;
    const adminOverrideAvailable = !!usage.adminOverrideAvailable;

    if (aiUnavailable) {
      if (unavailableReason === "gemini_api_key_revoked") {
        return "AI quote service unavailable: Gemini API key was revoked and must be replaced on the backend.";
      }
      return "AI quote service is temporarily unavailable.";
    }

    const parts = [];
    if (typeof requestTokens === "number") parts.push("Request tokens: " + requestTokens);
    if (typeof todayTotalTokens === "number") parts.push("Today total: " + todayTotalTokens);
    if (typeof remainingTokens === "number") parts.push("Remaining: " + remainingTokens);
    if (adminOverrideUsed) parts.push("Admin override used");
    if (adminResetUsed) parts.push("Token count reset");
    if (limitReached && adminOverrideAvailable) parts.push("Enter admin password to continue");

    return parts.length ? parts.join(" | ") : "Quote updated.";
  }

  function isLimitReachedResponse(result) {
    if (!result) return false;
    if (result.usage && result.usage.limitReached) return true;
    if (result.usage && result.usage.aiUnavailable) return false;

    var text = String(result.text || "").toLowerCase();
    return text.indexOf("daily ai limit reached") !== -1;
  }

  document.addEventListener("DOMContentLoaded", function () {
    const listEl = byId("aiChatMessages");
    const chatInputEl = byId("aiChatInput");
    const projectSendButtonEl = byId("aiProjectDescriptionSend");
    const replySendButtonEl = byId("aiChatSend");
    const statusEl = byId("aiChatStatus");
    const adminPopupEl = byId("aiAdminPopup");
    const adminPasswordEl = byId("aiAdminPassword");
    const adminResetButtonEl = byId("aiAdminResetButton");
    const adminCancelButtonEl = byId("aiAdminCancelButton");
    const adminPopupStatusEl = byId("aiAdminPopupStatus");
    const notesEl = byId("notes");
    const formEl = byId("devRequestForm");
    const conversationFieldEl = byId("aiConversation");
    const endpoint = getEndpoint();
    const history = [];
    let pendingAdminRetry = null;

    if (!listEl || !notesEl || !chatInputEl || !projectSendButtonEl || !replySendButtonEl || !statusEl || !adminPopupEl || !adminPasswordEl || !adminResetButtonEl || !adminCancelButtonEl || !adminPopupStatusEl) return;

    clearEl(listEl);
    updateConversationField(conversationFieldEl, history);

    if (!endpoint) {
      addMsg(listEl, {
        role: "ai",
        text: "AI quote chat is not configured yet. Set LAB_FORM_ENDPOINTS.productDevelopmentAi in assets/js/lab-form-endpoints.js to your backend URL.",
      });
      projectSendButtonEl.disabled = true;
      replySendButtonEl.disabled = true;
      if (statusEl) statusEl.textContent = "AI chat disabled (no endpoint configured).";
      return;
    }

    addIntroMessage(listEl);

    function showAdminPopup(message) {
      adminPopupEl.hidden = false;
      adminPopupStatusEl.textContent = message || "";
      adminPasswordEl.focus();
    }

    function hideAdminPopup() {
      adminPopupEl.hidden = true;
      adminPopupStatusEl.textContent = "";
      adminPasswordEl.value = "";
    }

    function readProjectDescriptionText() {
      return String(notesEl.value || "").trim();
    }

    function readReplyText() {
      return String(chatInputEl.value || "").trim();
    }

    function clearComposer() {
      chatInputEl.value = "";
    }

    async function runRequest(options) {
      const requestOptions = options || {};
      const userText = String(requestOptions.userText || "").trim();
      const isRetry = !!requestOptions.isRetry;
      const triggerButtonEl = requestOptions.triggerButtonEl || null;
      const busyLabel = requestOptions.busyLabel || "AI Thinking...";

      if (!userText) {
        if (statusEl) statusEl.textContent = requestOptions.emptyMessage || "Enter a project description or AI message first.";
        return;
      }

      if (!isRetry) {
        const userRowEl = addMsg(listEl, { role: "user", text: userText });
        history.push({ role: "user", text: userText });
        updateConversationField(conversationFieldEl, history);

        requestOptions.userRowEl = userRowEl;
      }

      setBusy(projectSendButtonEl, true, busyLabel);
      setBusy(replySendButtonEl, true, busyLabel);
      if (statusEl) statusEl.textContent = "Contacting AI quote service...";

      try {
        const result = await sendMessage({
          endpoint,
          history,
          userText: buildAiMessage(userText, history.slice(0, -1)),
          requestType: getRequestType(),
          adminPassword: String(adminPasswordEl.value || "").trim(),
        });

        if (isLimitReachedResponse(result)) {
          pendingAdminRetry = {
            userText: userText,
          };
          if (statusEl) statusEl.textContent = formatUsageStatus(result.usage);
          showAdminPopup("Token limit reached. Enter admin password to reset and continue.");
          return;
        }

        if (result.adminResetCommandUsed) {
          if (requestOptions.userRowEl && requestOptions.userRowEl.parentNode) {
            requestOptions.userRowEl.parentNode.removeChild(requestOptions.userRowEl);
          }
          if (history.length && history[history.length - 1].role === "user") {
            history.pop();
            updateConversationField(conversationFieldEl, history);
          }
        }

        addMsg(listEl, { role: "ai", text: result.text });
        history.push({ role: "ai", text: result.text });
        updateConversationField(conversationFieldEl, history);
        clearComposer();
        pendingAdminRetry = null;
        hideAdminPopup();
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
        setBusy(projectSendButtonEl, false);
        setBusy(replySendButtonEl, false);
      }
    }

    function handleProjectDescriptionSend() {
      runRequest({
        userText: readProjectDescriptionText(),
        triggerButtonEl: projectSendButtonEl,
        busyLabel: "Sending project description...",
        emptyMessage: "Enter a project description first.",
      });
    }

    function handleReplySend() {
      if (!history.length) {
        if (statusEl) statusEl.textContent = "Send the project description first, then use the reply message box.";
        return;
      }

      runRequest({
        userText: readReplyText(),
        triggerButtonEl: replySendButtonEl,
        busyLabel: "Sending reply...",
        emptyMessage: "Enter a reply message first.",
      });
    }

    async function handleAdminReset() {
      if (!pendingAdminRetry) {
        hideAdminPopup();
        return;
      }

      if (!String(adminPasswordEl.value || "").trim()) {
        adminPopupStatusEl.textContent = "Enter the admin password.";
        return;
      }

      setPopupBusy(adminResetButtonEl, true);
      adminPopupStatusEl.textContent = "Resetting token count...";

      try {
        await runRequest({
          userText: pendingAdminRetry.userText,
          isRetry: true,
        });
      } finally {
        setPopupBusy(adminResetButtonEl, false);
      }
    }

    projectSendButtonEl.addEventListener("click", function () {
      handleProjectDescriptionSend();
    });

    replySendButtonEl.addEventListener("click", function () {
      handleReplySend();
    });

    adminResetButtonEl.addEventListener("click", function () {
      handleAdminReset();
    });

    adminCancelButtonEl.addEventListener("click", function () {
      pendingAdminRetry = null;
      hideAdminPopup();
    });

    adminPasswordEl.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdminReset();
      }
    });

    chatInputEl.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleReplySend();
      }
    });

    if (formEl) {
      formEl.addEventListener("reset", function () {
        history.length = 0;
        pendingAdminRetry = null;
        clearEl(listEl);
        addIntroMessage(listEl);
        clearComposer();
        hideAdminPopup();
        updateConversationField(conversationFieldEl, history);
        if (statusEl) statusEl.textContent = "";
      });
    }
  });
})();
