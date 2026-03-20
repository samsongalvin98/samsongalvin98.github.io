(function () {
  const ESTIMATE_COLLAPSED_STORAGE_KEY = "stlEstimateCollapsed";
  const FDM_BUILD_VOLUME_MM = {
    x: 256,
    y: 256,
    z: 256,
  };

  const SLA_BUILD_VOLUME_MM = {
    x: 218,
    y: 120,
    z: 220,
  };

  const OVERSIZED_FDM_MINIMUM_USD = 50;
  const OVERSIZED_SLA_MINIMUM_USD = 100;

  const UNIT_TO_MM = {
    mm: 1,
    cm: 10,
    in: 25.4,
  };

  const DEFAULT_LABOR_RATE_PER_HOUR = 30;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatUsd(value) {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  function formatNumber(value, digits = 2) {
    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  }

  function toCents(amount) {
    const safe = Number.isFinite(amount) ? amount : 0;
    return Math.round(safe * 100);
  }

  function fromCents(cents) {
    const safe = Number.isFinite(cents) ? cents : 0;
    return safe / 100;
  }

  function durationString(totalSeconds) {
    const rounded = Math.max(0, Math.round(totalSeconds || 0));
    const hours = Math.floor(rounded / 3600);
    const mins = Math.floor((rounded % 3600) / 60);
    if (hours > 0) return hours + "h " + mins + "m";
    return mins + "m";
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function getLaborRatePerHourFromMaterial(materialRaw) {
    const material = normalizeText(materialRaw);

    // If no material is assigned, assume PLA.
    if (!material) return 25;

    if (material.includes("sla") || material.includes("resin")) return 50;
    if (material.includes("petg")) return 35;
    if (material.includes("pla")) return 25;

    return DEFAULT_LABOR_RATE_PER_HOUR;
  }

  function getBuildConstraints(materialRaw) {
    const material = normalizeText(materialRaw);

    if (material.includes("sla") || material.includes("resin")) {
      return {
        label: "SLA",
        sizeMm: SLA_BUILD_VOLUME_MM,
        oversizedMinimumUsd: OVERSIZED_SLA_MINIMUM_USD,
      };
    }

    return {
      label: "FDM",
      sizeMm: FDM_BUILD_VOLUME_MM,
      oversizedMinimumUsd: OVERSIZED_FDM_MINIMUM_USD,
    };
  }

  function exceedsBuildVolume(sizeMm, buildVolumeMm) {
    return sizeMm.x > buildVolumeMm.x || sizeMm.y > buildVolumeMm.y || sizeMm.z > buildVolumeMm.z;
  }

  function detectBinarySTL(buffer) {
    if (!buffer || buffer.byteLength < 84) return false;
    const dv = new DataView(buffer);
    const triCount = dv.getUint32(80, true);
    const expected = 84 + triCount * 50;
    if (expected === buffer.byteLength) return true;

    const header = new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength));
    const text = new TextDecoder().decode(header).trim().toLowerCase();
    if (text.startsWith("solid")) return false;

    return buffer.byteLength >= 84;
  }

  function updateBounds(bounds, x, y, z) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }

  function tetraVolume(v0, v1, v2) {
    return (
      v0[0] * (v1[1] * v2[2] - v1[2] * v2[1]) -
      v0[1] * (v1[0] * v2[2] - v1[2] * v2[0]) +
      v0[2] * (v1[0] * v2[1] - v1[1] * v2[0])
    ) / 6;
  }

  function parseBinarySTL(buffer) {
    const dv = new DataView(buffer);
    const triangleCount = dv.getUint32(80, true);

    const bounds = {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    };

    let signedVolume = 0;
    let offset = 84;

    for (let i = 0; i < triangleCount; i++) {
      offset += 12; // normal

      const v0 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)];
      offset += 12;
      const v1 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)];
      offset += 12;
      const v2 = [dv.getFloat32(offset, true), dv.getFloat32(offset + 4, true), dv.getFloat32(offset + 8, true)];
      offset += 12;

      signedVolume += tetraVolume(v0, v1, v2);

      updateBounds(bounds, v0[0], v0[1], v0[2]);
      updateBounds(bounds, v1[0], v1[1], v1[2]);
      updateBounds(bounds, v2[0], v2[1], v2[2]);

      offset += 2;
    }

    return { triangleCount, signedVolumeRaw: signedVolume, boundsRaw: bounds };
  }

  function parseAsciiSTL(buffer) {
    const text = new TextDecoder().decode(buffer);
    const vertexRegex =
      /vertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

    const numbers = [];
    let match;
    while ((match = vertexRegex.exec(text)) !== null) {
      numbers.push(Number.parseFloat(match[1]));
      numbers.push(Number.parseFloat(match[2]));
      numbers.push(Number.parseFloat(match[3]));
    }

    if (numbers.length < 9 || numbers.length % 9 !== 0) throw new Error("ASCII STL parse failed.");

    const bounds = {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    };

    let signedVolume = 0;
    const triangleCount = numbers.length / 9;

    for (let i = 0; i < numbers.length; i += 9) {
      const v0 = [numbers[i], numbers[i + 1], numbers[i + 2]];
      const v1 = [numbers[i + 3], numbers[i + 4], numbers[i + 5]];
      const v2 = [numbers[i + 6], numbers[i + 7], numbers[i + 8]];

      signedVolume += tetraVolume(v0, v1, v2);

      updateBounds(bounds, v0[0], v0[1], v0[2]);
      updateBounds(bounds, v1[0], v1[1], v1[2]);
      updateBounds(bounds, v2[0], v2[1], v2[2]);
    }

    return { triangleCount, signedVolumeRaw: signedVolume, boundsRaw: bounds };
  }

  function parseSTL(buffer) {
    if (detectBinarySTL(buffer)) return parseBinarySTL(buffer);
    return parseAsciiSTL(buffer);
  }

  function convertMeshToMillimeters(meshRaw, modelUnit) {
    const scale = UNIT_TO_MM[modelUnit] || 1;
    const scale3 = scale * scale * scale;
    const b = meshRaw.boundsRaw;

    return {
      triangleCount: meshRaw.triangleCount,
      volumeMm3: Math.abs(meshRaw.signedVolumeRaw) * scale3,
      sizeMm: {
        x: Math.max(0, (b.maxX - b.minX) * scale),
        y: Math.max(0, (b.maxY - b.minY) * scale),
        z: Math.max(0, (b.maxZ - b.minZ) * scale),
      },
    };
  }

  function getDefaultEstimateSettings() {
    return {
      infill: 0.2,
      layerHeight: 0.2,
      printSpeed: 60,
      lineWidth: 0.4,
      wallLines: 3,
      topBottomLayers: 4,
      support: 0.0,
      filamentDiameter: 1.75,
      density: 1.24,
      costKg: 24,
      overhead: 18,
      flowEfficiency: 0.82,
    };
  }

  function estimatePrint(meshMm, settings) {
    const minSize = Math.max(Math.min(meshMm.sizeMm.x, meshMm.sizeMm.y, meshMm.sizeMm.z), 0.1);
    const shellThickness = settings.wallLines * settings.lineWidth;
    const topBottomThickness = 2 * settings.topBottomLayers * settings.layerHeight;

    const shellFraction = clamp((2 * shellThickness) / minSize, 0.02, 0.75);
    const topBottomFraction = clamp(topBottomThickness / Math.max(meshMm.sizeMm.z, 0.1), 0.01, 0.55);
    const denseFraction = clamp(shellFraction + topBottomFraction, 0.05, 0.92);

    const effectiveSolidFraction = clamp(settings.infill + (1 - settings.infill) * denseFraction, 0.03, 1);
    let printedVolumeMm3 = meshMm.volumeMm3 * effectiveSolidFraction;
    printedVolumeMm3 *= 1 + settings.support;

    const filamentArea = Math.PI * Math.pow(settings.filamentDiameter / 2, 2);
    const filamentLengthMm = printedVolumeMm3 / filamentArea;

    const materialCm3 = printedVolumeMm3 / 1000;
    const massG = materialCm3 * settings.density;
    const materialCost = (massG / 1000) * settings.costKg;

    const volumetricRate = Math.max(settings.printSpeed * settings.layerHeight * settings.lineWidth * settings.flowEfficiency, 0.1);
    const printSeconds = (printedVolumeMm3 / volumetricRate) * (1 + settings.overhead / 100);

    return {
      modelVolumeMm3: meshMm.volumeMm3,
      filamentLengthMm,
      massG,
      materialCost,
      printSeconds,
      sizeMm: meshMm.sizeMm,
    };
  }

  function isStlFile(file) {
    const name = (file && file.name ? file.name : "").toLowerCase();
    return name.endsWith(".stl");
  }

  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function isEstimateCollapsed() {
    try {
      return window.sessionStorage.getItem(ESTIMATE_COLLAPSED_STORAGE_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  function saveEstimateCollapsed(collapsed) {
    try {
      window.sessionStorage.setItem(ESTIMATE_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
    } catch (error) {
      console.warn("Could not persist STL estimate panel state.", error);
    }
  }

  function applyEstimateCollapsedState(collapsed) {
    const panel = document.getElementById("stlEstimatePanel");
    const toggle = document.getElementById("stlEstimateToggle");
    if (!panel || !toggle) return;

    panel.classList.toggle("is-collapsed", !!collapsed);
    toggle.textContent = collapsed ? "Expand" : "Collapse";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function setEstimatePanelVisible(visible) {
    const panel = document.getElementById("stlEstimatePanel");
    if (!panel) return;
    panel.classList.toggle("hidden-panel", !visible);
    if (visible) {
      applyEstimateCollapsedState(isEstimateCollapsed());
    }
  }

  function getMaterialValue() {
    const materialSelect = document.getElementById("material");
    if (!materialSelect) return "";
    return materialSelect.value || materialSelect.options?.[materialSelect.selectedIndex]?.text || "";
  }

  function renderEstimateItem(listEl, { fileName, estimate, modelUnit, totalCostCents, exceedsBuildVolumeLimit, buildConstraints }) {
    const item = document.createElement("div");
    item.className = "stl-estimate-item";

    const title = document.createElement("div");
    title.className = "stl-estimate-title";
    title.textContent = fileName;
    item.appendChild(title);

    const body = document.createElement("div");
    body.className = "stl-estimate-metrics";

    if (!estimate) {
      body.textContent = "Estimate available for STL files only.";
      item.appendChild(body);
      listEl.appendChild(item);
      return;
    }

    const volumeCm3 = estimate.modelVolumeMm3 / 1000;
    const size = estimate.sizeMm;

    body.innerHTML =
      "<div><strong>Estimated print time:</strong> " +
      durationString(estimate.printSeconds) +
      "</div>" +
      "<div><strong>Estimated cost:</strong> " +
      formatUsd(fromCents(totalCostCents)) +
      "</div>" +
      "<div><strong>Volume:</strong> " +
      formatNumber(volumeCm3, 2) +
      " cm3</div>" +
      "<div><strong>Size:</strong> " +
      formatNumber(size.x, 1) +
      " × " +
      formatNumber(size.y, 1) +
      " × " +
      formatNumber(size.z, 1) +
      " mm (assuming " +
      modelUnit +
      ")</div>";

    if (exceedsBuildVolumeLimit) {
      body.innerHTML +=
        "<div><strong>Note:</strong> This part exceeds the standard " +
        formatNumber(buildConstraints.sizeMm.x, 0) +
        " × " +
        formatNumber(buildConstraints.sizeMm.y, 0) +
        " × " +
        formatNumber(buildConstraints.sizeMm.z, 0) +
        " mm " +
        buildConstraints.label +
        " build volume and will require special handling.</div>";
    }

    item.appendChild(body);
    listEl.appendChild(item);
  }

  async function buildEstimates() {
    const fileInput = document.getElementById("file");
    const unitSelect = document.getElementById("stlModelUnit");
    const listEl = document.getElementById("stlEstimateList");

    if (!fileInput || !unitSelect || !listEl) return;

    clearEl(listEl);

    const files = Array.from(fileInput.files || []);
    if (!files.length) {
      setEstimatePanelVisible(false);
      return;
    }

    const modelUnit = (unitSelect.value || "mm").trim();
    const settings = getDefaultEstimateSettings();

    const materialValue = getMaterialValue();
    const laborRatePerHour = getLaborRatePerHourFromMaterial(materialValue);
    const buildConstraints = getBuildConstraints(materialValue);
    const anyStl = files.some(isStlFile);

    if (!anyStl) {
      setEstimatePanelVisible(false);
      return;
    }

    setEstimatePanelVisible(true);

    let totalSeconds = 0;
    let totalCostCents = 0;

    for (const file of files) {
      if (!isStlFile(file)) {
        renderEstimateItem(listEl, { fileName: file.name, estimate: null, modelUnit, totalCostCents: 0 });
        continue;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const meshRaw = parseSTL(arrayBuffer);
        const meshMm = convertMeshToMillimeters(meshRaw, modelUnit);
        const estimate = estimatePrint(meshMm, settings);
        const exceedsBuildVolumeLimit = exceedsBuildVolume(meshMm.sizeMm, buildConstraints.sizeMm);

        totalSeconds += estimate.printSeconds;

        const laborCost = (estimate.printSeconds / 3600) * laborRatePerHour;
        let fileTotalCostCents = toCents(estimate.materialCost + laborCost);

        if (exceedsBuildVolumeLimit) {
          fileTotalCostCents *= 2;
          fileTotalCostCents = Math.max(fileTotalCostCents, toCents(buildConstraints.oversizedMinimumUsd));
        }

        totalCostCents += fileTotalCostCents;

        renderEstimateItem(listEl, {
          fileName: file.name,
          estimate,
          modelUnit,
          totalCostCents: fileTotalCostCents,
          exceedsBuildVolumeLimit,
          buildConstraints,
        });
      } catch (err) {
        const item = document.createElement("div");
        item.className = "stl-estimate-item";
        const title = document.createElement("div");
        title.className = "stl-estimate-title";
        title.textContent = file.name;
        const note = document.createElement("div");
        note.className = "stl-estimate-metrics";
        note.textContent = "Could not estimate this STL.";
        item.appendChild(title);
        item.appendChild(note);
        listEl.appendChild(item);
        console.error("STL estimate failed", { file: file.name, err });
      }
    }

    if (anyStl) {
      const total = document.createElement("div");
      total.className = "stl-estimate-item";

      const title = document.createElement("div");
      title.className = "stl-estimate-title";
      title.textContent = "Estimated total (STL files)";

      const val = document.createElement("div");
      val.className = "stl-estimate-metrics";
      val.innerHTML =
        "<div><strong>Total print time:</strong> " +
        durationString(totalSeconds) +
        "</div>" +
        "<div><strong>Total cost:</strong> " +
        formatUsd(fromCents(totalCostCents)) +
        "</div>";

      total.appendChild(title);
      total.appendChild(val);
      listEl.appendChild(total);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const fileInput = document.getElementById("file");
    const unitSelect = document.getElementById("stlModelUnit");
    const materialSelect = document.getElementById("material");
    const toggle = document.getElementById("stlEstimateToggle");

    if (fileInput) fileInput.addEventListener("change", buildEstimates);
    if (unitSelect) unitSelect.addEventListener("change", buildEstimates);
    if (materialSelect) materialSelect.addEventListener("change", buildEstimates);
    if (toggle) {
      toggle.addEventListener("click", function () {
        const collapsed = !isEstimateCollapsed();
        saveEstimateCollapsed(collapsed);
        applyEstimateCollapsedState(collapsed);
      });
    }

    buildEstimates();
  });
})();
