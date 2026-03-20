(function () {
  const LASER_BED_MM = {
    width: 400,
    height: 400,
  };

  const LASER_PANEL_COLLAPSED_STORAGE_KEY = "laserSidePanelCollapsed";
  const UNIT_TO_IN = {
    in: 1,
    mm: 1 / 25.4,
    cm: 1 / 2.54,
  };

  const MATERIAL_RATES_PER_SQIN = [
    { match: ["wood", "plywood", "birch", "maple", "oak", "mdf"], rate: 0.5 },
    { match: ["acrylic", "plexi", "plexiglass"], rate: 0.65 },
    { match: ["anodized", "aluminum", "aluminium"], rate: 0.95 },
    { match: ["leather"], rate: 0.75 },
    { match: ["glass"], rate: 1.15 },
  ];

  const DEFAULT_RATE_PER_SQIN = 0.55;
  const OVERSIZED_LASER_MINIMUM_USD = 50;

  const PROCESS_MULTIPLIER = {
    Engrave: 1,
    Cut: 1.15,
    "Engrave+Cut": 1.35,
    NotSure: 1.15,
  };

  const SETUP_FEE_USD = 5;
  const MINIMUM_USD = 15;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatUsd(value) {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function isLaserPanelCollapsed() {
    try {
      return window.sessionStorage.getItem(LASER_PANEL_COLLAPSED_STORAGE_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  function saveLaserPanelCollapsed(collapsed) {
    try {
      window.sessionStorage.setItem(LASER_PANEL_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
    } catch (error) {
      console.warn("Could not persist laser side panel state.", error);
    }
  }

  function applyLaserPanelCollapsedState(collapsed) {
    const panel = document.getElementById("laserSidePanel");
    const toggle = document.getElementById("laserSideToggle");
    if (!panel || !toggle) return;

    panel.classList.toggle("is-collapsed", !!collapsed);
    toggle.textContent = collapsed ? "Expand" : "Collapse";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function setLaserPanelVisible(visible) {
    const panel = document.getElementById("laserSidePanel");
    if (!panel) return;
    panel.classList.toggle("hidden-panel", !visible);
    if (visible) {
      applyLaserPanelCollapsedState(isLaserPanelCollapsed());
    }
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function getRatePerSqInFromMaterial(materialRaw) {
    const material = normalizeText(materialRaw);
    if (!material) return DEFAULT_RATE_PER_SQIN;

    for (const rule of MATERIAL_RATES_PER_SQIN) {
      if (rule.match.some((token) => material.includes(token))) return rule.rate;
    }

    return DEFAULT_RATE_PER_SQIN;
  }

  function parseNumber(value) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function parseIntSafe(value, fallback = 1) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function toMillimeters(value, unit) {
    if (unit === "mm") return value;
    if (unit === "cm") return value * 10;
    return value * 25.4;
  }

  function exceedsLaserBed(width, height, unit) {
    return toMillimeters(width, unit) > LASER_BED_MM.width || toMillimeters(height, unit) > LASER_BED_MM.height;
  }

  function getSelectedFile(fileInput) {
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
    return files.length ? files[0] : null;
  }

  function renderImagePreview(previewEl, file, { label }) {
    clearEl(previewEl);

    if (!file) return;

    const url = URL.createObjectURL(file);

    const img = document.createElement("img");
    img.className = "laser-preview-img";
    img.alt = (label || "Artwork") + " preview";
    img.src = url;

    img.addEventListener(
      "load",
      function () {
        const meta = document.createElement("div");
        meta.className = "laser-preview-meta";
        meta.textContent = `Image dimensions: ${img.naturalWidth} × ${img.naturalHeight} px`;
        previewEl.appendChild(meta);
      },
      { once: true }
    );

    img.addEventListener(
      "error",
      function () {
        URL.revokeObjectURL(url);
      },
      { once: true }
    );

    previewEl.appendChild(img);

    // Revoke when navigating away.
    window.addEventListener(
      "beforeunload",
      function () {
        URL.revokeObjectURL(url);
      },
      { once: true }
    );
  }

  function isExtension(file, ext) {
    return !!file && !!file.name && file.name.toLowerCase().endsWith(ext);
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
      reader.readAsText(file);
    });
  }

  function renderDxfPreview(previewEl, dxfText) {
    clearEl(previewEl);

    const canvas = document.createElement("canvas");
    canvas.className = "laser-preview-canvas";
    canvas.width = 820;
    canvas.height = 420;
    previewEl.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      const note = document.createElement("div");
      note.className = "help";
      note.textContent = "DXF preview unavailable in this browser.";
      previewEl.appendChild(note);
      return;
    }

    // Parse a minimal subset of DXF (2D ENTITIES).
    const lines = dxfText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const entities = [];

    let i = 0;
    let inEntities = false;
    while (i + 1 < lines.length) {
      const code = lines[i].trim();
      const value = lines[i + 1] !== undefined ? lines[i + 1].trim() : "";
      i += 2;

      if (code === "0" && value === "SECTION") {
        // Look ahead for section name (2, ENTITIES)
        continue;
      }
      if (code === "2" && value.toUpperCase() === "ENTITIES") {
        inEntities = true;
        continue;
      }
      if (inEntities && code === "0" && value === "ENDSEC") {
        inEntities = false;
        continue;
      }

      if (!inEntities) continue;

      if (code === "0") {
        const type = value.toUpperCase();
        const entity = { type, points: [], center: null, radius: null, startAngle: null, endAngle: null, closed: false };

        // Read entity data until next 0 code.
        while (i + 1 < lines.length) {
          const c = lines[i].trim();
          const v = lines[i + 1] !== undefined ? lines[i + 1].trim() : "";

          if (c === "0") break;

          const n = Number.parseFloat(v);

          if (type === "LINE") {
            if (c === "10") entity.x1 = n;
            else if (c === "20") entity.y1 = n;
            else if (c === "11") entity.x2 = n;
            else if (c === "21") entity.y2 = n;
          } else if (type === "LWPOLYLINE") {
            if (c === "10") entity._pendingX = n;
            else if (c === "20") {
              if (Number.isFinite(entity._pendingX)) {
                entity.points.push([entity._pendingX, n]);
                entity._pendingX = undefined;
              }
            } else if (c === "70") {
              entity.closed = (Number.parseInt(v, 10) & 1) === 1;
            }
          } else if (type === "CIRCLE") {
            if (c === "10") entity.cx = n;
            else if (c === "20") entity.cy = n;
            else if (c === "40") entity.r = n;
          } else if (type === "ARC") {
            if (c === "10") entity.cx = n;
            else if (c === "20") entity.cy = n;
            else if (c === "40") entity.r = n;
            else if (c === "50") entity.sa = n;
            else if (c === "51") entity.ea = n;
          }

          i += 2;
        }

        // Normalize into a common shape.
        if (type === "LINE" && Number.isFinite(entity.x1) && Number.isFinite(entity.y1) && Number.isFinite(entity.x2) && Number.isFinite(entity.y2)) {
          entities.push({ type, points: [[entity.x1, entity.y1], [entity.x2, entity.y2]] });
        } else if (type === "LWPOLYLINE" && entity.points.length) {
          entities.push({ type, points: entity.points, closed: entity.closed });
        } else if (type === "CIRCLE" && Number.isFinite(entity.cx) && Number.isFinite(entity.cy) && Number.isFinite(entity.r)) {
          entities.push({ type, center: [entity.cx, entity.cy], radius: entity.r });
        } else if (type === "ARC" && Number.isFinite(entity.cx) && Number.isFinite(entity.cy) && Number.isFinite(entity.r)) {
          entities.push({ type, center: [entity.cx, entity.cy], radius: entity.r, startAngle: entity.sa || 0, endAngle: entity.ea || 0 });
        }
      }
    }

    if (!entities.length) {
      const note = document.createElement("div");
      note.className = "help";
      note.textContent = "DXF preview: no supported entities found (supports LINE, LWPOLYLINE, CIRCLE, ARC).";
      previewEl.appendChild(note);
      return;
    }

    // Compute bounds.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    function includePoint(x, y) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    for (const e of entities) {
      if (e.points) {
        for (const p of e.points) includePoint(p[0], p[1]);
      } else if (e.center && Number.isFinite(e.radius)) {
        includePoint(e.center[0] - e.radius, e.center[1] - e.radius);
        includePoint(e.center[0] + e.radius, e.center[1] + e.radius);
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      const note = document.createElement("div");
      note.className = "help";
      note.textContent = "DXF preview unavailable (invalid bounds).";
      previewEl.appendChild(note);
      return;
    }

    const pad = 0.06;
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxY - minY);
    const scale = Math.min((canvas.width * (1 - 2 * pad)) / w, (canvas.height * (1 - 2 * pad)) / h);

    const ox = canvas.width / 2 - ((minX + maxX) / 2) * scale;
    const oy = canvas.height / 2 + ((minY + maxY) / 2) * scale;

    // Background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(229,231,235,0.9)";

    function tx(x) {
      return x * scale + ox;
    }
    function ty(y) {
      // flip Y
      return -y * scale + oy;
    }

    for (const e of entities) {
      ctx.beginPath();
      if (e.type === "LINE" || e.type === "LWPOLYLINE") {
        const pts = e.points || [];
        if (!pts.length) continue;
        ctx.moveTo(tx(pts[0][0]), ty(pts[0][1]));
        for (let k = 1; k < pts.length; k++) {
          ctx.lineTo(tx(pts[k][0]), ty(pts[k][1]));
        }
        if (e.closed) ctx.closePath();
      } else if (e.type === "CIRCLE") {
        const cx = e.center[0];
        const cy = e.center[1];
        ctx.arc(tx(cx), ty(cy), Math.abs(e.radius * scale), 0, Math.PI * 2);
      } else if (e.type === "ARC") {
        const cx = e.center[0];
        const cy = e.center[1];
        const start = ((e.startAngle || 0) * Math.PI) / 180;
        const end = ((e.endAngle || 0) * Math.PI) / 180;
        // Because we flip Y, reverse direction.
        ctx.arc(tx(cx), ty(cy), Math.abs(e.radius * scale), -start, -end, false);
      }
      ctx.stroke();
    }

    const meta = document.createElement("div");
    meta.className = "laser-preview-meta";
    meta.textContent = `DXF preview (approx). Entities: ${entities.length}`;
    previewEl.appendChild(meta);
  }

  async function renderArtworkPreview(previewEl, file) {
    clearEl(previewEl);
    if (!file) return;

    if (isExtension(file, ".png") || normalizeText(file.type) === "image/png") {
      renderImagePreview(previewEl, file, { label: "PNG" });
      return;
    }

    if (isExtension(file, ".svg") || normalizeText(file.type) === "image/svg+xml") {
      renderImagePreview(previewEl, file, { label: "SVG" });
      return;
    }

    if (isExtension(file, ".dxf")) {
      try {
        const text = await readFileText(file);
        renderDxfPreview(previewEl, text);
      } catch (err) {
        clearEl(previewEl);
        const note = document.createElement("div");
        note.className = "help";
        note.textContent = "DXF preview failed to load.";
        previewEl.appendChild(note);
        console.error("DXF preview failed", err);
      }
      return;
    }

    const note = document.createElement("div");
    note.className = "help";
    note.textContent = "Preview is available for PNG, SVG, and DXF files.";
    previewEl.appendChild(note);
  }

  function estimateCost({ width, height, unit, materialText, processValue, quantity }) {
    const scale = UNIT_TO_IN[unit] || 1;
    const widthIn = width * scale;
    const heightIn = height * scale;

    const areaSqIn = Math.max(0, widthIn) * Math.max(0, heightIn);
    const rate = getRatePerSqInFromMaterial(materialText);
    const multiplier = PROCESS_MULTIPLIER[processValue] ?? 1.1;

    // Basic model: setup fee + area rate with a process multiplier.
    const qty = parseIntSafe(quantity, 1);
    const oversized = exceedsLaserBed(width, height, unit);

    const rawUnit = SETUP_FEE_USD + areaSqIn * rate * multiplier;
    let unitTotal = clamp(rawUnit, MINIMUM_USD, Infinity);
    if (oversized) {
      unitTotal *= 2;
      unitTotal = Math.max(unitTotal, OVERSIZED_LASER_MINIMUM_USD);
    }
    const total = unitTotal * qty;

    return { areaSqIn, ratePerSqIn: rate, multiplier, totalUsd: total, quantity: qty, oversized };
  }

  function updateUi() {
    const form = document.getElementById("laserRequestForm");
    if (!form) return;

    const materialInput = document.getElementById("material");
    const processSelect = document.getElementById("process");

    const widthInput = document.getElementById("laserWidth");
    const heightInput = document.getElementById("laserHeight");
    const unitSelect = document.getElementById("laserUnit");
    const sizeHidden = document.getElementById("size");
    const quantityInput = document.getElementById("quantity");

    const fileInput = document.getElementById("file");
    const previewEl = document.getElementById("laserPreview");
    const estimateEl = document.getElementById("laserEstimate");

    if (!widthInput || !heightInput || !unitSelect || !estimateEl) return;

    const width = parseNumber(widthInput.value);
    const height = parseNumber(heightInput.value);
    const unit = (unitSelect.value || "in").trim();
    const quantity = quantityInput ? quantityInput.value : "1";

    const materialText = materialInput ? materialInput.value : "";
    const processValue = processSelect ? processSelect.value : "Engrave";

    if (sizeHidden) {
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        sizeHidden.value = `${width} ${unit} x ${height} ${unit}`;
      } else {
        sizeHidden.value = "";
      }
    }

    if (fileInput && previewEl) {
      renderArtworkPreview(previewEl, getSelectedFile(fileInput));
    }

    clearEl(estimateEl);

    const note = document.createElement("div");
    note.className = "help";
    note.textContent = "Estimates are approximate and intended for quick quoting only.";
    estimateEl.appendChild(note);

    if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
      const msg = document.createElement("div");
      msg.className = "help";
      msg.textContent = "Enter width and height to see an estimate.";
      estimateEl.appendChild(msg);
      setLaserPanelVisible(!!getSelectedFile(fileInput));
      return;
    }

    const result = estimateCost({ width, height, unit, materialText, processValue, quantity });

    const line1 = document.createElement("div");
    line1.className = "laser-estimate-line";
    line1.innerHTML = `<strong>Estimated cost:</strong> ${formatUsd(result.totalUsd)}`;

    const line2 = document.createElement("div");
    line2.className = "laser-estimate-line";
    line2.innerHTML = `<strong>Area:</strong> ${result.areaSqIn.toFixed(2)} in²`;

    const line3 = document.createElement("div");
    line3.className = "laser-estimate-line";
    line3.innerHTML = `<strong>Quantity:</strong> ${result.quantity}`;

    const line4 = document.createElement("div");
    line4.className = "laser-estimate-line";
    if (result.oversized) {
      line4.innerHTML = "<strong>Note:</strong> This job exceeds the standard 400 × 400 mm laser bed and will require special handling.";
    }

    estimateEl.appendChild(line1);
    estimateEl.appendChild(line2);
    estimateEl.appendChild(line3);
    if (result.oversized) estimateEl.appendChild(line4);
    setLaserPanelVisible(true);
  }

  document.addEventListener("DOMContentLoaded", function () {
    const materialInput = document.getElementById("material");
    const processSelect = document.getElementById("process");

    const widthInput = document.getElementById("laserWidth");
    const heightInput = document.getElementById("laserHeight");
    const unitSelect = document.getElementById("laserUnit");
    const quantityInput = document.getElementById("quantity");

    const fileInput = document.getElementById("file");
    const toggle = document.getElementById("laserSideToggle");

    if (materialInput) materialInput.addEventListener("input", updateUi);
    if (processSelect) processSelect.addEventListener("change", updateUi);

    if (widthInput) widthInput.addEventListener("input", updateUi);
    if (heightInput) heightInput.addEventListener("input", updateUi);
    if (unitSelect) unitSelect.addEventListener("change", updateUi);
    if (quantityInput) quantityInput.addEventListener("input", updateUi);

    if (fileInput) fileInput.addEventListener("change", updateUi);
    if (toggle) {
      toggle.addEventListener("click", function () {
        const collapsed = !isLaserPanelCollapsed();
        saveLaserPanelCollapsed(collapsed);
        applyLaserPanelCollapsedState(collapsed);
      });
    }

    setLaserPanelVisible(false);
    updateUi();
  });
})();
