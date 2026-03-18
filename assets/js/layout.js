(function () {
  function csvParse(text) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          const next = text[i + 1];
          if (next === '"') {
            value += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          value += c;
        }
        continue;
      }

      if (c === '"') {
        inQuotes = true;
        continue;
      }

      if (c === ",") {
        row.push(value);
        value = "";
        continue;
      }

      if (c === "\n") {
        row.push(value);
        value = "";
        // Ignore completely empty trailing line
        if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
        row = [];
        continue;
      }

      if (c === "\r") {
        continue;
      }

      value += c;
    }

    // Flush last value
    row.push(value);
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);

    return rows;
  }

  function renderCsvTable({ csvText, caption }) {
    const rows = csvParse(csvText);
    if (!rows.length) return null;

    const header = rows[0];
    const bodyRows = rows.slice(1);

    const table = document.createElement("table");
    table.className = "data-table";

    if (caption) {
      const cap = document.createElement("caption");
      cap.textContent = caption;
      table.appendChild(cap);
    }

    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    header.forEach((h) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = (h || "").trim();
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    bodyRows.forEach((r) => {
      if (!r.some((cell) => (cell || "").trim() !== "")) return;
      const tr = document.createElement("tr");

      r.forEach((cell, idx) => {
        const isFirstCol = idx === 0;
        const el = document.createElement(isFirstCol ? "th" : "td");
        if (isFirstCol) el.scope = "row";

        const raw = (cell || "").trim();
        // If a cell contains semicolon-separated values, render as a list.
        if (!isFirstCol && raw.includes(";")) {
          const ul = document.createElement("ul");
          raw
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((item) => {
              const li = document.createElement("li");
              li.textContent = item;
              ul.appendChild(li);
            });
          el.appendChild(ul);
        } else {
          el.textContent = raw;
        }

        tr.appendChild(el);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    return table;
  }

  async function loadHtmlIncludes() {
    const includeEls = Array.from(document.querySelectorAll("[data-include]"));
    if (!includeEls.length) return;

    await Promise.all(
      includeEls.map(async (el) => {
        const path = (el.getAttribute("data-include") || "").trim();
        if (!path) return;

        try {
          const res = await fetch(path, { cache: "no-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          el.innerHTML = html;
        } catch (err) {
          el.innerHTML = "";
          el.textContent = `Failed to load: ${path}`;
          console.error("Include failed", { path, err });
        }
      })
    );
  }

  async function loadCsvIncludes() {
    const includeEls = Array.from(document.querySelectorAll("[data-include-csv]"));
    if (!includeEls.length) return;

    await Promise.all(
      includeEls.map(async (el) => {
        const path = (el.getAttribute("data-include-csv") || "").trim();
        if (!path) return;
        const caption = (el.getAttribute("data-csv-caption") || "").trim();

        try {
          const res = await fetch(path, { cache: "no-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const csvText = await res.text();

          const table = renderCsvTable({ csvText, caption });
          el.innerHTML = "";
          if (table) el.appendChild(table);
        } catch (err) {
          el.innerHTML = "";
          el.textContent = `Failed to load: ${path}`;
          console.error("CSV include failed", { path, err });
        }
      })
    );
  }

  function basename(value) {
    if (!value) return "";
    const parts = value.split("?")[0].split("#")[0].split("/");
    return parts[parts.length - 1] || "";
  }

  function getHeaderOffsetPx() {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--header-height")
      .trim();
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function setHeaderHeight() {
    const header = document.querySelector("header");
    const height = header ? header.offsetHeight : 80;
    document.documentElement.style.setProperty("--header-height", height + "px");
  }

  function highlightActiveLinks(selector, options) {
    const resolvedOptions = options || {};
    const current = basename(window.location.pathname) || "index.html";
    const path = (window.location.pathname || "").toLowerCase();
    const isProjectDetailPage = path.includes("/projects/") && current !== "projects.html";
    const links = document.querySelectorAll(selector);

    links.forEach((a) => {
      const href = a.getAttribute("href");
      const name = basename(href);
      if (!href) return;

      // In-page anchors are handled separately.
      if (href.trim().startsWith("#")) return;

      if (name && name === current) {
        a.classList.add("active");
      } else {
        a.classList.remove("active");
      }

      // Treat the Projects top-level page as active for all /projects/* detail pages.
      if (
        resolvedOptions.treatProjectsAsActiveOnProjectDetailPages &&
        isProjectDetailPage &&
        name === "projects.html"
      ) {
        a.classList.add("active");
      }
    });
  }

  function setActiveHashLink() {
    const hash = (window.location.hash || "").trim();
    const links = document.querySelectorAll('.side-panel a[href^="#"]');
    if (!links.length) return;

    links.forEach((a) => {
      const href = (a.getAttribute("href") || "").trim();
      if (!href.startsWith("#")) return;
      if (!hash) {
        a.classList.remove("active");
        return;
      }
      if (href === hash) a.classList.add("active");
      else a.classList.remove("active");
    });
  }

  function enableScrollSpy() {
    const links = Array.from(document.querySelectorAll('.side-panel a[href^="#"]'));
    if (!links.length) return;

    const sections = links
      .map((a) => {
        const href = (a.getAttribute("href") || "").trim();
        const id = href.startsWith("#") ? href.slice(1) : "";
        const section = id ? document.getElementById(id) : null;
        return section ? { id, section } : null;
      })
      .filter(Boolean);

    if (!sections.length) return;

    const mainContent = document.querySelector(".main-content");
    const mainContentStyle = mainContent ? getComputedStyle(mainContent) : null;
    const isScrollableMain =
      !!mainContent &&
      mainContentStyle &&
      (mainContentStyle.overflowY === "auto" || mainContentStyle.overflowY === "scroll") &&
      mainContent.scrollHeight > mainContent.clientHeight + 2;

    const scrollRootEl = isScrollableMain ? mainContent : null;
    const scrollEventTarget = scrollRootEl || window;

    let scheduled = false;

    function setActiveId(activeId) {
      links.forEach((a) => {
        const href = (a.getAttribute("href") || "").trim();
        const id = href.startsWith("#") ? href.slice(1) : "";
        if (id && id === activeId) a.classList.add("active");
        else a.classList.remove("active");
      });
    }

    function computeActiveId() {
      const anchorY = scrollRootEl ? 10 : getHeaderOffsetPx() + 10;
      const rootRect = scrollRootEl ? scrollRootEl.getBoundingClientRect() : null;

      let candidateId = sections[0].id;
      for (const { id, section } of sections) {
        const rect = section.getBoundingClientRect();
        const top = rootRect ? rect.top - rootRect.top : rect.top;
        if (top <= anchorY) candidateId = id;
        else break;
      }

      return candidateId;
    }

    function update() {
      const activeId = computeActiveId();
      if (activeId) setActiveId(activeId);
    }

    function scheduleUpdate() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        update();
      });
    }

    scrollEventTarget.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    // Initial state
    scheduleUpdate();
  }

  function enableHashLinkClicks() {
    const links = document.querySelectorAll('.side-panel a[href^="#"]');
    if (!links.length) return;

    links.forEach((a) => {
      a.addEventListener("click", function () {
        links.forEach((l) => l.classList.remove("active"));
        a.classList.add("active");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Set an initial value early (prevents layout jank for pages with fixed sidebars)
    setHeaderHeight();

    // If the page uses HTML includes, wait for them before wiring up nav highlighting.
    Promise.all([loadHtmlIncludes(), loadCsvIncludes()]).finally(() => {
      setHeaderHeight();
      highlightActiveLinks(".primary-nav a", {
        treatProjectsAsActiveOnProjectDetailPages: true,
      });
      highlightActiveLinks(".service-nav a");
      highlightActiveLinks(".side-panel a");
      enableHashLinkClicks();
      setActiveHashLink();
      enableScrollSpy();
    });
  });

  window.addEventListener("resize", setHeaderHeight);
  window.addEventListener("hashchange", setActiveHashLink);
})();
