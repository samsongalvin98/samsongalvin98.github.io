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
        if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
        row = [];
        continue;
      }

      if (c === "\r") continue;

      value += c;
    }

    row.push(value);
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);

    return rows;
  }

  function getCsvConfig() {
    const form = document.getElementById("printRequestForm");
    if (!form) return null;

    const path = (form.getAttribute("data-material-color-csv") || "").trim();
    if (!path) return null;

    const materialSelect = document.getElementById("material");
    const colorSelect = document.getElementById("color");

    if (!materialSelect || !colorSelect) return null;

    return { path, materialSelect, colorSelect };
  }

  function normalizeHeader(value) {
    return (value || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase();
  }

  function setFallbackOnError(materialSelect, colorSelect, message) {
    materialSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "Other / Not sure";
    opt.textContent = message || "Other / Not sure";
    materialSelect.appendChild(opt);
    materialSelect.value = opt.value;

    setSelectOptions(colorSelect, [], { includeBlank: true, blankLabel: "No preference" });

    const statusEl = document.getElementById("status");
    if (statusEl && message) statusEl.textContent = message;
  }

  function buildOptions({ materials, materialColumnIndex, colorsColumnIndex }) {
    const map = new Map();

    materials.forEach((row) => {
      const material = ((row[materialColumnIndex] || "").trim());
      if (!material) return;

      const colorsRaw = ((row[colorsColumnIndex] || "").trim());
      const colors = colorsRaw
        ? colorsRaw
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      if (!map.has(material)) map.set(material, []);
      const current = map.get(material);
      colors.forEach((c) => {
        if (!current.includes(c)) current.push(c);
      });
    });

    return map;
  }

  function setSelectOptions(select, options, { includeBlank, blankLabel } = {}) {
    const previousValue = select.value;
    select.innerHTML = "";

    if (includeBlank) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = blankLabel || "";
      select.appendChild(opt);
    }

    options.forEach((value) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });

    // Restore selection if possible.
    const hasPrevious = Array.from(select.options).some((o) => o.value === previousValue);
    if (hasPrevious) select.value = previousValue;
  }

  function setMaterialSelect(materialSelect, materials) {
    // Force the list to match the CSV.
    materialSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select material...";
    placeholder.disabled = true;
    placeholder.selected = true;
    materialSelect.appendChild(placeholder);

    materials.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      materialSelect.appendChild(opt);
    });

    // If there are materials available, select the first one to keep the form usable immediately.
    if (materials.length) materialSelect.value = materials[0];
  }

  async function initMaterialColorDropdowns() {
    const config = getCsvConfig();
    if (!config) return;

    const { path, materialSelect, colorSelect } = config;

    try {
      if (window.location && window.location.protocol === "file:") {
        setFallbackOnError(
          materialSelect,
          colorSelect,
          "Materials/colors can’t load from CSV when opened as a file. Preview via http:// (local server or GitHub Pages)."
        );
        return;
      }

      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csvText = await res.text();

      const rows = csvParse(csvText);
      if (rows.length < 2) return;

      const header = rows[0].map(normalizeHeader);
      const body = rows.slice(1);

      const materialColumnIndex = header.indexOf("material");
      // Support either "Common colors" or just "colors" in the CSV header.
      const colorsColumnIndex =
        header.indexOf("common colors") !== -1 ? header.indexOf("common colors") : header.indexOf("colors");

      if (materialColumnIndex === -1 || colorsColumnIndex === -1) {
        console.error("CSV missing required headers", { header });
        setFallbackOnError(
          materialSelect,
          colorSelect,
          'CSV must include headers: "Material" and "Common colors" (or "Colors").'
        );
        return;
      }

      const materialToColors = buildOptions({
        materials: body,
        materialColumnIndex,
        colorsColumnIndex,
      });

      const materials = Array.from(materialToColors.keys());
      setMaterialSelect(materialSelect, materials);

      function updateColors() {
        const material = materialSelect.value;
        const colors = materialToColors.get(material) || [];
        setSelectOptions(colorSelect, colors, { includeBlank: true, blankLabel: "No preference" });
      }

      materialSelect.addEventListener("change", updateColors);

      // Initial state
      updateColors();
    } catch (err) {
      console.error("Failed to init material/color dropdowns", err);
      setFallbackOnError(
        materialSelect,
        colorSelect,
        "Couldn’t load materials/colors from CSV. Check the CSV path and preview over http:// (not file://)."
      );
    }
  }

  document.addEventListener("DOMContentLoaded", initMaterialColorDropdowns);
})();
