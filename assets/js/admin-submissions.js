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

  async function request(url, options) {
    const response = await fetch(url, options);

    if (!response.ok) {
      const message = await response.text().catch(function () { return ""; });
      throw new Error(message || "Request failed.");
    }

    return response;
  }

  async function fetchJson(url, password) {
    const response = await request(url, {
      headers: { "X-Admin-Password": password },
    });

    return response.json();
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

    return response.json();
  }

  async function deleteFile(url, password) {
    const response = await request(url, {
      method: "DELETE",
      headers: { "X-Admin-Password": password },
    });

    return response.json();
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

    return response.json();
  }

  function renderFiles(listEl, files, actions) {
    listEl.innerHTML = "";

    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "admin-empty";
      empty.textContent = "No uploaded files found in the backend submissions folder.";
      listEl.appendChild(empty);
      return;
    }

    files.forEach(function (file) {
      const row = document.createElement("div");
      row.className = "admin-item";

      const info = document.createElement("div");
      info.className = "admin-item-info";

      const name = document.createElement("div");
      name.className = "admin-item-name";
      name.textContent = file.name || file.path;

      const meta = document.createElement("div");
      meta.className = "admin-item-meta";
      meta.textContent = [file.category, file.submissionId, formatBytes(file.bytes), formatDate(file.modifiedAt)]
        .filter(Boolean)
        .join(" | ");

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
    var baseUrl = getBaseUrl();
    var currentPassword = getSavedPassword();

    if (!accessCard || !accessForm || !accessPassword || !accessStatus || !accessButton || !workspace || !workspaceStatus || !listEl || !refreshButton || !logoutButton || !uploadForm || !uploadInput || !uploadButton || !csvCard || !csvEditor || !csvStatus || !csvReloadButton || !csvSaveButton) {
      return;
    }

    function showWorkspace() {
      accessCard.classList.add("admin-hidden");
      workspace.classList.remove("admin-hidden");
      csvCard.classList.remove("admin-hidden");
    }

    function showGate() {
      workspace.classList.add("admin-hidden");
      csvCard.classList.add("admin-hidden");
      accessCard.classList.remove("admin-hidden");
      accessPassword.value = "";
    }

    async function loadCsv() {
      if (!baseUrl || !currentPassword) return;

      setBusy(csvReloadButton, true, "Loading...");
      setStatus(csvStatus, "Loading print color options CSV...");

      try {
        var payload = await fetchJson(baseUrl + "/api/admin/print-color-options", currentPassword);
        csvEditor.value = typeof payload.content === "string" ? payload.content : "";
        setStatus(csvStatus, "CSV loaded.");
      } catch (error) {
        console.error("Failed to load print color options CSV", error);
        setStatus(csvStatus, "Could not load CSV. Check password and backend settings.");
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
        renderFiles(listEl, files, {
          onDownload: handleDownload,
          onDelete: handleDelete,
        });
        setStatus(workspaceStatus, files.length ? "Uploaded files loaded." : "No uploaded files found.");
        showWorkspace();
        await loadCsv();
      } catch (error) {
        console.error("Failed to load submission files", error);
        clearSavedPassword();
        currentPassword = "";
        listEl.innerHTML = "";
        csvEditor.value = "";
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
        setStatus(workspaceStatus, "Download failed. Check password and backend settings.");
      } finally {
        setBusy(button, false, "Downloading...");
      }
    }

    async function handleDelete(file, button) {
      if (!baseUrl || !currentPassword || !file || !file.path) return;
      if (!window.confirm("Delete " + (file.name || file.path) + "?")) return;

      setBusy(button, true, "Deleting...");
      setStatus(workspaceStatus, "Deleting file...");

      try {
        await deleteFile(baseUrl + "/api/admin/submissions?path=" + encodeURIComponent(file.path), currentPassword);
        setStatus(workspaceStatus, "File deleted.");
        await loadFiles();
      } catch (error) {
        console.error("Failed to delete submission file", error);
        setStatus(workspaceStatus, "Delete failed. Check password and backend settings.");
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
      if (!baseUrl || !currentPassword) return;

      setBusy(csvSaveButton, true, "Saving...");
      setStatus(csvStatus, "Saving print color options CSV...");

      try {
        await putJson(baseUrl + "/api/admin/print-color-options", currentPassword, {
          content: String(csvEditor.value || ""),
        });
        setStatus(csvStatus, "CSV saved.");
      } catch (error) {
        console.error("Failed to save print color options CSV", error);
        setStatus(csvStatus, "Save failed. Keep the header as Material,Common colors and check backend settings.");
      } finally {
        setBusy(csvSaveButton, false, "Saving...");
      }
    }

    accessForm.addEventListener("submit", handleUnlock);
    refreshButton.addEventListener("click", loadFiles);
    uploadForm.addEventListener("submit", handleUpload);
    csvReloadButton.addEventListener("click", loadCsv);
    csvSaveButton.addEventListener("click", handleSaveCsv);
    logoutButton.addEventListener("click", function () {
      clearSavedPassword();
      currentPassword = "";
      listEl.innerHTML = "";
      csvEditor.value = "";
      setStatus(csvStatus, "");
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
