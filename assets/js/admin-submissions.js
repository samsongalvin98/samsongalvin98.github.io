(function () {
  var PASSWORD_STORAGE_KEY = "submissionControlPassword";

  function byId(id) {
    return document.getElementById(id);
  }

  function getBaseUrl() {
    const baseUrl = typeof window.LAB_FORM_BASE_URL === "string" ? window.LAB_FORM_BASE_URL.trim() : "";
    if (baseUrl) return baseUrl.replace(/\/$/, "");

    const endpoints = window.LAB_FORM_ENDPOINTS || {};
    const value = typeof endpoints.printing === "string" ? endpoints.printing.trim() : "";
    if (!value) return "";

    return value.replace(/\/api\/[^/]+$/, "");
  }

  function setStatus(el, text) {
    if (!el) return;
    el.textContent = text;
  }

  function getErrorMessage(error, fallback) {
    if (!error) return fallback;
    if (error.message) return error.message;
    return fallback;
  }

  function getSavedPassword() {
    try {
      return window.sessionStorage.getItem(PASSWORD_STORAGE_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function savePassword(password) {
    try {
      window.sessionStorage.setItem(PASSWORD_STORAGE_KEY, password);
    } catch (error) {
      console.warn("Could not persist admin password in session storage.", error);
    }
  }

  function clearSavedPassword() {
    try {
      window.sessionStorage.removeItem(PASSWORD_STORAGE_KEY);
    } catch (error) {
      console.warn("Could not clear admin password from session storage.", error);
    }
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent;
    }

    button.disabled = !!busy;
    button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
  }

  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + " MB";
    return (size / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function compareSubmissionFiles(left, right) {
    var leftName = String((left && left.name) || "").toLowerCase();
    var rightName = String((right && right.name) || "").toLowerCase();

    if (leftName === "metadata.json" && rightName !== "metadata.json") return -1;
    if (rightName === "metadata.json" && leftName !== "metadata.json") return 1;

    return leftName.localeCompare(rightName);
  }

  function getDisplayName(file) {
    if (!file) return "";
    if (String(file.name || "").toLowerCase() === "metadata.json") {
      return "metadata.json";
    }

    return file.name || file.path;
  }

  function getFolderLabel(group) {
    if (!group) return "Submission Folder";
    return (group.category || "submission") + " folder";
  }

  function getFolderPath(group) {
    if (!group) return "";
    return [group.category || "submission", group.submissionId || "unknown"].join("/");
  }

  function getDisplayMeta(file) {
    if (!file) return "";

    var details = [file.category, file.submissionId, formatBytes(file.bytes), formatDate(file.modifiedAt)]
      .filter(Boolean);

    if (String(file.name || "").toLowerCase() === "metadata.json") {
      details.unshift("metadata.json");
    }

    return details.join(" | ");
  }

  function getGroupPalette(index) {
    var palettes = [
      {
        accent: "#34d399",
        tintStrong: "rgba(52,211,153,0.14)",
        border: "rgba(52,211,153,0.24)",
        metaBg: "rgba(59,130,246,0.14)",
        metaBorder: "rgba(96,165,250,0.3)",
        fileBg: "rgba(255,255,255,0.04)",
      },
      {
        accent: "#f59e0b",
        tintStrong: "rgba(245,158,11,0.14)",
        border: "rgba(245,158,11,0.24)",
        metaBg: "rgba(217,119,6,0.18)",
        metaBorder: "rgba(251,191,36,0.3)",
        fileBg: "rgba(255,249,235,0.04)",
      },
      {
        accent: "#f472b6",
        tintStrong: "rgba(244,114,182,0.14)",
        border: "rgba(244,114,182,0.24)",
        metaBg: "rgba(236,72,153,0.16)",
        metaBorder: "rgba(244,114,182,0.3)",
        fileBg: "rgba(255,255,255,0.04)",
      },
      {
        accent: "#38bdf8",
        tintStrong: "rgba(56,189,248,0.14)",
        border: "rgba(56,189,248,0.24)",
        metaBg: "rgba(14,165,233,0.16)",
        metaBorder: "rgba(56,189,248,0.32)",
        fileBg: "rgba(255,255,255,0.04)",
      },
      {
        accent: "#a78bfa",
        tintStrong: "rgba(167,139,250,0.14)",
        border: "rgba(167,139,250,0.24)",
        metaBg: "rgba(139,92,246,0.16)",
        metaBorder: "rgba(167,139,250,0.3)",
        fileBg: "rgba(255,255,255,0.04)",
      },
    ];

    return palettes[index % palettes.length];
  }

  function applyGroupPalette(el, palette) {
    if (!el || !palette) return;

    el.style.setProperty("--submission-accent", palette.accent);
    el.style.setProperty("--submission-tint-strong", palette.tintStrong);
    el.style.setProperty("--submission-border", palette.border);
    el.style.setProperty("--submission-meta-bg", palette.metaBg);
    el.style.setProperty("--submission-meta-border", palette.metaBorder);
    el.style.setProperty("--submission-file-bg", palette.fileBg);
  }

  function reloadPageAfterDelete(delayMs) {
    window.setTimeout(function () {
      window.location.reload();
    }, delayMs);
  }

  async function readResponsePayload(response) {
    if (!response) return null;

    var contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.indexOf("application/json") !== -1) {
      return response.json();
    }

    var text = await response.text().catch(function () {
      return "";
    });

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (error) {
      return { text: text };
    }
  }

  function buildGroupsFromFiles(files) {
    var grouped = {};

    (files || []).forEach(function (file) {
      var category = file && file.category ? file.category : "";
      var submissionId = file && file.submissionId ? file.submissionId : "";
      var key = [category, submissionId].join("/");
      var bytes = Number(file && file.bytes) || 0;
      var modifiedAt = file && file.modifiedAt ? file.modifiedAt : "";

      if (!grouped[key]) {
        grouped[key] = {
          category: category,
          submissionId: submissionId,
          fileCount: 0,
          bytes: 0,
          modifiedAt: modifiedAt,
        };
      }

      grouped[key].fileCount += 1;
      grouped[key].bytes += bytes;
      if (modifiedAt && (!grouped[key].modifiedAt || String(modifiedAt) > String(grouped[key].modifiedAt))) {
        grouped[key].modifiedAt = modifiedAt;
      }
    });

    return Object.keys(grouped)
      .map(function (key) {
        return grouped[key];
      })
      .sort(function (left, right) {
        return String(right.modifiedAt || "").localeCompare(String(left.modifiedAt || ""));
      });
  }

  async function request(url, options) {
    const response = await fetch(url, Object.assign({ cache: "no-store" }, options || {}));

    if (!response.ok) {
      let message = "";

      try {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.indexOf("application/json") !== -1) {
          const payload = await response.json();
          if (payload && typeof payload.detail === "string") {
            message = payload.detail;
          } else if (payload && typeof payload.message === "string") {
            message = payload.message;
          }
        } else {
          message = await response.text();
        }
      } catch (error) {
        message = "";
      }

      throw new Error(message || ("Request failed with HTTP " + response.status + "."));
    }

    return response;
  }

  async function fetchJson(url, password) {
    const response = await request(url, {
      headers: { "X-Admin-Password": password },
    });

    return readResponsePayload(response);
  }

  async function fetchFile(url, password) {
    const response = await request(url, {
      headers: { "X-Admin-Password": password },
    });

    return response.blob();
  }

  async function postFiles(url, password, files) {
    const formData = new FormData();

    Array.prototype.forEach.call(files, function (file) {
      formData.append("file", file);
    });

    const response = await request(url, {
      method: "POST",
      headers: { "X-Admin-Password": password },
      body: formData,
    });

    return readResponsePayload(response);
  }

  async function deleteFile(url, password) {
    const response = await request(url, {
      method: "DELETE",
      headers: { "X-Admin-Password": password },
    });

    return readResponsePayload(response);
  }

  async function deleteSubmissionFolder(url, password) {
    const response = await request(url, {
      method: "DELETE",
      headers: { "X-Admin-Password": password },
    });

    return readResponsePayload(response);
  }

  async function deleteJson(url, password, payload) {
    const response = await request(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify(payload),
    });

    return readResponsePayload(response);
  }

  async function putJson(url, password, payload) {
    const response = await request(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify(payload),
    });

    return readResponsePayload(response);
  }

  function renderFiles(listEl, files, groups, actions) {
    listEl.innerHTML = "";

    var resolvedGroups = Array.isArray(groups) && groups.length ? groups : buildGroupsFromFiles(files);

    if (!resolvedGroups.length && !files.length) {
      const empty = document.createElement("div");
      empty.className = "admin-empty";
      empty.textContent = "No uploaded files found in the backend submissions folder.";
      listEl.appendChild(empty);
      return;
    }

    var groupedFiles = {};
    files.forEach(function (file) {
      var key = [file.category || "", file.submissionId || ""].join("/");
      if (!groupedFiles[key]) {
        groupedFiles[key] = {
          category: file.category || "",
          submissionId: file.submissionId || "",
          files: [],
        };
      }

      groupedFiles[key].files.push(file);
    });

    resolvedGroups.forEach(function (group, groupIndex) {
      var key = [group.category || "", group.submissionId || ""].join("/");
      var grouped = groupedFiles[key] || { files: [] };
      var groupWrapper = document.createElement("section");
      var palette = getGroupPalette(groupIndex);
      groupWrapper.className = "admin-submission-group";
      applyGroupPalette(groupWrapper, palette);

      var groupCard = document.createElement("div");
      groupCard.className = "admin-item";
      groupCard.classList.add("admin-group-header");

      var groupInfo = document.createElement("div");
      groupInfo.className = "admin-item-info";

      var groupType = document.createElement("div");
      groupType.className = "admin-item-type is-folder";
      groupType.textContent = getFolderLabel(group);

      var groupPath = document.createElement("div");
      groupPath.className = "admin-group-path";
      groupPath.textContent = "Folder: " + getFolderPath(group);

      var groupName = document.createElement("div");
      groupName.className = "admin-item-name";
      groupName.textContent = group.submissionId || "unknown";

      var groupMeta = document.createElement("div");
      groupMeta.className = "admin-item-meta";
      groupMeta.textContent = [
        (typeof group.fileCount === "number" ? group.fileCount : grouped.files.length) + " file" + ((typeof group.fileCount === "number" ? group.fileCount : grouped.files.length) === 1 ? "" : "s"),
        typeof group.bytes === "number" ? formatBytes(group.bytes) : "",
        group.modifiedAt ? formatDate(group.modifiedAt) : "",
      ].filter(Boolean).join(" | ");

      groupInfo.appendChild(groupType);
      groupInfo.appendChild(groupPath);
      groupInfo.appendChild(groupName);
      groupInfo.appendChild(groupMeta);
      groupCard.appendChild(groupInfo);

      if (actions.onDeleteFolder && group.category && group.submissionId) {
        var groupActions = document.createElement("div");
        groupActions.className = "admin-item-actions";

        var deleteFolderButton = document.createElement("button");
        deleteFolderButton.type = "button";
        deleteFolderButton.className = "admin-delete-action";
        deleteFolderButton.textContent = "Delete Folder";
        deleteFolderButton.addEventListener("click", function () {
          actions.onDeleteFolder(group, deleteFolderButton);
        });

        groupActions.appendChild(deleteFolderButton);
        groupCard.appendChild(groupActions);
      }

      groupWrapper.appendChild(groupCard);

      var groupBody = document.createElement("div");
      groupBody.className = "admin-group-body";

      grouped.files.sort(compareSubmissionFiles);

      grouped.files.forEach(function (file) {
        const row = document.createElement("div");
        row.className = "admin-item";
        row.classList.add("admin-group-file");

        var isMetadata = String(file.name || "").toLowerCase() === "metadata.json";
        row.classList.add(isMetadata ? "is-metadata" : "is-upload");

        const info = document.createElement("div");
        info.className = "admin-item-info";

        const typeLabel = document.createElement("div");
        typeLabel.className = "admin-item-type " + (isMetadata ? "is-metadata" : "is-upload");
        typeLabel.textContent = isMetadata ? "Metadata" : "Uploaded File";

        const name = document.createElement("div");
        name.className = "admin-item-name";
        name.textContent = getDisplayName(file);

        const meta = document.createElement("div");
        meta.className = "admin-item-meta";
        meta.textContent = getDisplayMeta(file);

        info.appendChild(typeLabel);
        info.appendChild(name);
        info.appendChild(meta);

        const actionRow = document.createElement("div");
        actionRow.className = "admin-item-actions";

        const downloadButton = document.createElement("button");
        downloadButton.type = "button";
        downloadButton.className = "admin-download-action";
        downloadButton.textContent = "Download";
        downloadButton.addEventListener("click", function () {
          actions.onDownload(file, downloadButton);
        });

        actionRow.appendChild(downloadButton);

        if (actions.onDelete) {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "admin-delete-action";
          deleteButton.textContent = "Delete";
          deleteButton.addEventListener("click", function () {
            actions.onDelete(file, deleteButton);
          });
          actionRow.appendChild(deleteButton);
        }

        row.appendChild(info);
        row.appendChild(actionRow);
        groupBody.appendChild(row);
      });

      groupWrapper.appendChild(groupBody);

      listEl.appendChild(groupWrapper);
    });
  }

  function renderAiUsage(listEl, users, actions) {
    listEl.innerHTML = "";

    if (!users.length) {
      const empty = document.createElement("div");
      empty.className = "admin-empty";
      empty.textContent = "No AI usage found for the selected day.";
      listEl.appendChild(empty);
      return;
    }

    users.forEach(function (user) {
      const row = document.createElement("div");
      row.className = "admin-item";

      const info = document.createElement("div");
      info.className = "admin-item-info";

      const name = document.createElement("div");
      name.className = "admin-item-name";
      name.textContent = user.user;

      const meta = document.createElement("div");
      meta.className = "admin-item-meta";
      meta.textContent = [
        "Total: " + (Number(user.totalTokens) || 0),
        "Requests: " + (Number(user.requestCount) || 0),
        user.lastRequestType ? "Last type: " + user.lastRequestType : "",
        user.updatedAt ? formatDate(user.updatedAt) : "",
      ].filter(Boolean).join(" | ");

      info.appendChild(name);
      info.appendChild(meta);

      const actionRow = document.createElement("div");
      actionRow.className = "admin-item-actions";

      const resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "admin-delete-action";
      resetButton.textContent = "Reset Tokens";
      resetButton.addEventListener("click", function () {
        actions.onReset(user, resetButton);
      });

      actionRow.appendChild(resetButton);
      row.appendChild(info);
      row.appendChild(actionRow);
      listEl.appendChild(row);
    });
  }

  async function verifyPassword(baseUrl, password) {
    await fetchJson(baseUrl + "/api/admin/submissions", password);
  }

  function initFabricationGate() {
    var toggle = byId("adminDownloadToggle");
    var panel = byId("adminDownloadPanel");
    var close = byId("adminDownloadClose");
    var form = byId("adminDownloadForm");
    var passwordInput = byId("adminDownloadPassword");
    var statusEl = byId("adminDownloadStatus");
    var checkButton = byId("adminDownloadRefresh");
    var submitButton = form ? form.querySelector('button[type="submit"]') : null;
    var baseUrl = getBaseUrl();

    if (!toggle || !panel || !form || !passwordInput || !statusEl || !checkButton) return;

    function showPanel() {
      panel.hidden = false;
      passwordInput.focus();
    }

    function hidePanel() {
      panel.hidden = true;
      setStatus(statusEl, "");
    }

    async function continueToAdmin() {
      var password = String(passwordInput.value || "").trim();
      if (!baseUrl) {
        setStatus(statusEl, "Backend URL is not configured on this page yet.");
        return;
      }

      if (!password) {
        setStatus(statusEl, "Enter your employee password.");
        return;
      }

      setBusy(submitButton, true, "Checking...");
      setBusy(checkButton, true, "Checking...");
      setStatus(statusEl, "Checking password...");

      try {
        await verifyPassword(baseUrl, password);
        savePassword(password);
        window.location.href = "admin-submissions.html";
      } catch (error) {
        console.error("Admin access denied", error);
        setStatus(statusEl, "Password rejected or backend unavailable.");
      } finally {
        setBusy(submitButton, false, "Checking...");
        setBusy(checkButton, false, "Checking...");
      }
    }

    toggle.addEventListener("click", function () {
      if (panel.hidden) showPanel(); else hidePanel();
    });

    close.addEventListener("click", hidePanel);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      continueToAdmin();
    });
    checkButton.addEventListener("click", continueToAdmin);
  }

  function initAdminWorkspace() {
    var accessCard = byId("adminAccessCard");
    var accessForm = byId("adminAccessForm");
    var accessPassword = byId("adminAccessPassword");
    var accessStatus = byId("adminAccessStatus");
    var accessButton = byId("adminAccessButton");
    var workspace = byId("adminWorkspace");
    var workspaceStatus = byId("adminWorkspaceStatus");
    var listEl = byId("adminFileList");
    var refreshButton = byId("adminRefreshButton");
    var logoutButton = byId("adminLogoutButton");
    var uploadForm = byId("adminUploadForm");
    var uploadInput = byId("adminUploadFiles");
    var uploadButton = byId("adminUploadButton");
    var csvCard = byId("adminCsvCard");
    var csvEditor = byId("adminCsvEditor");
    var csvStatus = byId("adminCsvStatus");
    var csvReloadButton = byId("adminCsvReloadButton");
    var csvSaveButton = byId("adminCsvSaveButton");
    var aiUsageCard = byId("adminAiUsageCard");
    var aiUsageList = byId("adminAiUsageList");
    var aiUsageStatus = byId("adminAiUsageStatus");
    var aiUsageRefreshButton = byId("adminAiUsageRefreshButton");
    var aiUsageResetForm = byId("adminAiUsageResetForm");
    var aiUsageUserInput = byId("adminAiUsageUser");
    var aiUsageResetButton = byId("adminAiUsageResetButton");
    var baseUrl = getBaseUrl();
    var currentPassword = getSavedPassword();
    var currentAiUsageDayKey = "";

    if (!accessCard || !accessForm || !accessPassword || !accessStatus || !accessButton || !workspace || !workspaceStatus || !listEl || !refreshButton || !logoutButton || !uploadForm || !uploadInput || !uploadButton || !csvCard || !csvEditor || !csvStatus || !csvReloadButton || !csvSaveButton || !aiUsageCard || !aiUsageList || !aiUsageStatus || !aiUsageRefreshButton || !aiUsageResetForm || !aiUsageUserInput || !aiUsageResetButton) {
      return;
    }

    function showWorkspace() {
      accessCard.classList.add("admin-hidden");
      workspace.classList.remove("admin-hidden");
      csvCard.classList.remove("admin-hidden");
      aiUsageCard.classList.remove("admin-hidden");
    }

    function showGate() {
      workspace.classList.add("admin-hidden");
      csvCard.classList.add("admin-hidden");
      aiUsageCard.classList.add("admin-hidden");
      accessCard.classList.remove("admin-hidden");
      accessPassword.value = "";
    }

    async function loadAiUsage() {
      if (!baseUrl || !currentPassword) return;

      setBusy(aiUsageRefreshButton, true, "Loading...");
      setStatus(aiUsageStatus, "Loading AI usage...");

      try {
        var payload = await fetchJson(baseUrl + "/api/admin/ai-usage", currentPassword);
        var users = Array.isArray(payload.users) ? payload.users : [];
        currentAiUsageDayKey = typeof payload.dayKey === "string" ? payload.dayKey : "";
        renderAiUsage(aiUsageList, users, {
          onReset: handleResetAiUsage,
        });
        setStatus(aiUsageStatus, users.length ? "AI usage loaded for " + currentAiUsageDayKey + "." : "No AI usage found for " + (currentAiUsageDayKey || "today") + ".");
      } catch (error) {
        console.error("Failed to load AI usage", error);
        setStatus(aiUsageStatus, getErrorMessage(error, "Could not load AI usage. Check password and backend settings."));
      } finally {
        setBusy(aiUsageRefreshButton, false, "Loading...");
      }
    }

    async function loadCsv() {
      setBusy(csvReloadButton, true, "Loading...");
      setStatus(csvStatus, "Loading print color options CSV from assets...");

      try {
        // If admin previously saved a local override, prefer that so admin sees what's currently in use
        let text = null;
        try { text = localStorage.getItem('printColorOptionsCsv'); } catch (e) { text = null; }
        if (text) {
          csvEditor.value = text;
          setStatus(csvStatus, 'CSV loaded from local admin preview.');
        } else {
          const res = await fetch('assets/data/print-color-options.csv', { cache: 'no-cache' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const fetched = await res.text();
          csvEditor.value = fetched || "";
          setStatus(csvStatus, "CSV loaded from assets/data/print-color-options.csv.");
        }
      } catch (error) {
        console.error("Failed to load print color options CSV from assets", error);
        setStatus(csvStatus, "Could not load CSV. Check file path or hosting.");
      } finally {
        setBusy(csvReloadButton, false, "Loading...");
      }
    }

    async function loadFiles() {
      if (!baseUrl) {
        setStatus(workspaceStatus, "Backend URL is not configured on this page yet.");
        return;
      }

      if (!currentPassword) {
        showGate();
        return;
      }

      setBusy(refreshButton, true, "Refreshing...");
      setStatus(workspaceStatus, "Loading uploaded files...");

      try {
        var payload = await fetchJson(baseUrl + "/api/admin/submissions", currentPassword);
        var files = Array.isArray(payload.files) ? payload.files : [];
        var groups = Array.isArray(payload.groups) ? payload.groups : [];
        renderFiles(listEl, files, groups, {
          onDownload: handleDownload,
          onDelete: handleDelete,
          onDeleteFolder: handleDeleteFolder,
        });
        setStatus(workspaceStatus, groups.length || files.length ? "Uploaded files loaded." : "No uploaded files found.");
        showWorkspace();
        await loadCsv();
        await loadAiUsage();
      } catch (error) {
        console.error("Failed to load submission files", error);
        clearSavedPassword();
        currentPassword = "";
        listEl.innerHTML = "";
        csvEditor.value = "";
        aiUsageList.innerHTML = "";
        aiUsageUserInput.value = "";
        showGate();
        setStatus(accessStatus, "Password rejected or backend unavailable.");
      } finally {
        setBusy(refreshButton, false, "Refreshing...");
      }
    }

    async function handleDownload(file, button) {
      if (!baseUrl || !currentPassword || !file || !file.path) return;

      setBusy(button, true, "Downloading...");
      setStatus(workspaceStatus, "Preparing download...");

      try {
        var blob = await fetchFile(baseUrl + "/api/admin/submissions/download?path=" + encodeURIComponent(file.path), currentPassword);
        var objectUrl = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = objectUrl;
        link.download = file.name || "download";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        setStatus(workspaceStatus, "Download started.");
      } catch (error) {
        console.error("Failed to download submission file", error);
        setStatus(workspaceStatus, getErrorMessage(error, "Download failed. Check password and backend settings."));
      } finally {
        setBusy(button, false, "Downloading...");
      }
    }

    async function handleDelete(file, button) {
      if (!baseUrl || !currentPassword || !file || !file.path) return;
      if (!window.confirm("Delete file " + (file.name || file.path) + " from " + [file.category || "submission", file.submissionId || "unknown"].join("/") + "?")) return;

      setBusy(button, true, "Deleting...");
      setStatus(workspaceStatus, "Deleting file...");

      try {
        await deleteFile(baseUrl + "/api/admin/submissions?path=" + encodeURIComponent(file.path), currentPassword);
        setStatus(workspaceStatus, "File deleted.");
        window.setTimeout(loadFiles, 450);
      } catch (error) {
        console.error("Failed to delete submission file", error);
        setStatus(workspaceStatus, getErrorMessage(error, "Delete failed. Check password and backend settings."));
      } finally {
        setBusy(button, false, "Deleting...");
      }
    }

    async function handleDeleteFolder(group, button) {
      if (!baseUrl || !currentPassword || !group || !group.category || !group.submissionId) return;
      if (!window.confirm("Delete folder " + group.category + "/" + group.submissionId + " and all files inside it?")) return;

      setBusy(button, true, "Deleting...");
      setStatus(workspaceStatus, "Deleting folder...");

      try {
        await deleteSubmissionFolder(
          baseUrl + "/api/admin/submission-folders?category=" + encodeURIComponent(group.category) + "&submission_id=" + encodeURIComponent(group.submissionId),
          currentPassword
        );
        setStatus(workspaceStatus, "Folder deleted.");
        window.setTimeout(loadFiles, 450);
      } catch (error) {
        console.error("Failed to delete submission folder", error);
        setStatus(workspaceStatus, getErrorMessage(error, "Delete failed. Check password and backend settings."));
      } finally {
        setBusy(button, false, "Deleting...");
      }
    }

    async function handleUnlock(event) {
      event.preventDefault();
      var password = String(accessPassword.value || "").trim();

      if (!baseUrl) {
        setStatus(accessStatus, "Backend URL is not configured on this page yet.");
        return;
      }

      if (!password) {
        setStatus(accessStatus, "Enter your employee password.");
        return;
      }

      setBusy(accessButton, true, "Checking...");
      setStatus(accessStatus, "Checking password...");

      try {
        await verifyPassword(baseUrl, password);
        currentPassword = password;
        savePassword(password);
        setStatus(accessStatus, "");
        await loadFiles();
      } catch (error) {
        console.error("Admin access denied", error);
        setStatus(accessStatus, "Password rejected or backend unavailable.");
      } finally {
        setBusy(accessButton, false, "Checking...");
      }
    }

    async function handleUpload(event) {
      event.preventDefault();
      if (!baseUrl || !currentPassword) return;
      if (!uploadInput.files || !uploadInput.files.length) {
        setStatus(workspaceStatus, "Choose at least one file to upload.");
        return;
      }

      setBusy(uploadButton, true, "Uploading...");
      setStatus(workspaceStatus, "Uploading files...");

      try {
        await postFiles(baseUrl + "/api/admin/submissions/upload", currentPassword, uploadInput.files);
        uploadForm.reset();
        setStatus(workspaceStatus, "Files uploaded.");
        await loadFiles();
      } catch (error) {
        console.error("Failed to upload admin files", error);
        setStatus(workspaceStatus, "Upload failed. Check password and backend settings.");
      } finally {
        setBusy(uploadButton, false, "Uploading...");
      }
    }

    async function handleSaveCsv() {
      setBusy(csvSaveButton, true, "Saving...");
      setStatus(csvStatus, "Saving CSV...");

      const content = String(csvEditor.value || "");
      try {
        localStorage.setItem('printColorOptionsCsv', content);
        const bc = new BroadcastChannel('print-color-options');
        bc.postMessage({ type: 'update', content });
        bc.close();
        setStatus(csvStatus, 'Local preview updated. The 3D printing page will reflect this immediately in open tabs.');
        await loadCsv();
      } catch (error) {
        console.error('Failed to set local CSV override', error);
        setStatus(csvStatus, getErrorMessage(error, 'Could not update local preview.'));
      } finally {
        setBusy(csvSaveButton, false, 'Saving...');
      }
    }

    async function handleResetAiUsage(user, button) {
      if (!user || !user.user) return;
      if (!window.confirm("Reset AI tokens for " + user.user + "?")) return;

      aiUsageUserInput.value = user.user;
      setBusy(button, true, "Resetting...");
      setStatus(aiUsageStatus, "Resetting AI usage...");

      try {
        await deleteJson(baseUrl + "/api/admin/ai-usage", currentPassword, {
          user: user.user,
          dayKey: currentAiUsageDayKey || undefined,
        });
        setStatus(aiUsageStatus, "AI usage reset for " + user.user + ".");
        await loadAiUsage();
      } catch (error) {
        console.error("Failed to reset AI usage", error);
        setStatus(aiUsageStatus, getErrorMessage(error, "Could not reset AI usage."));
      } finally {
        setBusy(button, false, "Resetting...");
      }
    }

    async function handleResetAiUsageForm(event) {
      event.preventDefault();
      if (!baseUrl || !currentPassword) return;

      var user = String(aiUsageUserInput.value || "").trim();
      if (!user) {
        setStatus(aiUsageStatus, "Enter a user from the usage list.");
        return;
      }

      setBusy(aiUsageResetButton, true, "Resetting...");
      setStatus(aiUsageStatus, "Resetting AI usage...");

      try {
        await deleteJson(baseUrl + "/api/admin/ai-usage", currentPassword, {
          user: user,
          dayKey: currentAiUsageDayKey || undefined,
        });
        setStatus(aiUsageStatus, "AI usage reset for " + user + ".");
        aiUsageUserInput.value = "";
        await loadAiUsage();
      } catch (error) {
        console.error("Failed to reset AI usage", error);
        setStatus(aiUsageStatus, getErrorMessage(error, "Could not reset AI usage."));
      } finally {
        setBusy(aiUsageResetButton, false, "Resetting...");
      }
    }

    accessForm.addEventListener("submit", handleUnlock);
    refreshButton.addEventListener("click", loadFiles);
    uploadForm.addEventListener("submit", handleUpload);
    csvReloadButton.addEventListener("click", loadCsv);
    csvSaveButton.addEventListener("click", handleSaveCsv);
    aiUsageRefreshButton.addEventListener("click", loadAiUsage);
    aiUsageResetForm.addEventListener("submit", handleResetAiUsageForm);
    logoutButton.addEventListener("click", function () {
      clearSavedPassword();
      currentPassword = "";
      listEl.innerHTML = "";
      csvEditor.value = "";
      aiUsageList.innerHTML = "";
      aiUsageUserInput.value = "";
      currentAiUsageDayKey = "";
      setStatus(csvStatus, "");
      setStatus(aiUsageStatus, "");
      setStatus(workspaceStatus, "");
      showGate();
      setStatus(accessStatus, "Submission control locked.");
    });

    if (currentPassword) {
      loadFiles();
    } else {
      showGate();
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initFabricationGate();
    initAdminWorkspace();
  });
})();
