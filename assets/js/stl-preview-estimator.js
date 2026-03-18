(function () {
  const UNIT_TO_MM = {
    mm: 1,
    cm: 10,
    in: 25.4,
  };

  const DEFAULT_LABOR_RATE_PER_HOUR = 30;

  function getLaborRatePerHourFromMaterial(materialRaw) {
    const material = String(materialRaw || "")
      .trim()
      .toLowerCase();

    // Match loosely so values like "PLA+" or "PETG (Carbon Fiber)" work.
    if (material.includes("sla") || material.includes("resin")) return 50;
    if (material.includes("petg")) return 35;
    if (material.includes("pla")) return 25;
    return DEFAULT_LABOR_RATE_PER_HOUR;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value, digits = 2) {
    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  }

  function formatUsd(value) {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString(undefined, { style: "currency", currency: "USD" });
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

  function detectBinarySTL(buffer) {
    // Binary STL has 80-byte header + uint32 triangle count + 50 bytes per triangle.
    if (!buffer || buffer.byteLength < 84) return false;
    const dv = new DataView(buffer);
    const triCount = dv.getUint32(80, true);
    const expected = 84 + triCount * 50;
    if (expected === buffer.byteLength) return true;

    // Fallback heuristic: if the file starts with "solid" it might be ASCII.
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
    // Signed volume contribution for triangle (v0,v1,v2) with origin.
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
      // normal(12 bytes) skip
      offset += 12;

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

      offset += 2; // attribute byte count
    }

    return {
      triangleCount,
      signedVolumeRaw: signedVolume,
      boundsRaw: bounds,
    };
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

    if (numbers.length < 9 || numbers.length % 9 !== 0) {
      throw new Error("ASCII STL parse failed.");
    }

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

    return {
      triangleCount,
      signedVolumeRaw: signedVolume,
      boundsRaw: bounds,
    };
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
    // Mirrors the defaults used in stl_print_estimator.html.
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
    const cost = (massG / 1000) * settings.costKg;

    const volumetricRate = Math.max(
      settings.printSpeed * settings.layerHeight * settings.lineWidth * settings.flowEfficiency,
      0.1
    );

    const printSeconds = (printedVolumeMm3 / volumetricRate) * (1 + settings.overhead / 100);

    return {
      modelVolumeMm3: meshMm.volumeMm3,
      printedVolumeMm3,
      filamentLengthMm,
      massG,
      cost,
      printSeconds,
      triangleCount: meshMm.triangleCount,
      sizeMm: meshMm.sizeMm,
      effectiveSolidFraction,
    };
  }

  function isStlFile(file) {
    const name = (file && file.name ? file.name : "").toLowerCase();
    return name.endsWith(".stl");
  }

  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function waitForThreeStlReady(timeoutMs = 4000) {
    if (window.THREE && window.THREE.STLLoader) return Promise.resolve(true);
    if (window.__THREE_STL_READY__ && (!window.THREE || !window.THREE.STLLoader)) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("three-stlloader-ready", onReady);
        resolve(value);
      };

      const onReady = () => done(!!(window.THREE && window.THREE.STLLoader));
      window.addEventListener("three-stlloader-ready", onReady, { once: true });

      setTimeout(() => done(!!(window.THREE && window.THREE.STLLoader)), timeoutMs);
    });
  }

  function renderStlPreview(container, arrayBuffer, modelUnit) {
    if (!window.THREE || !window.THREE.STLLoader) {
      const note = document.createElement("div");
      note.className = "help";
      note.textContent = "3D preview unavailable (Three.js failed to load).";
      container.appendChild(note);
      return;
    }

    const loader = new window.THREE.STLLoader();
    const geometry = loader.parse(arrayBuffer);

    // Apply unit scaling so the view matches the chosen model units.
    const scale = UNIT_TO_MM[modelUnit] || 1;
    geometry.scale(scale, scale, scale);

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const width = 520;
    const height = 280;

    const renderer = new window.THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new window.THREE.Scene();

    const camera = new window.THREE.PerspectiveCamera(45, width / height, 0.1, 100000);

    const material = new window.THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      metalness: 0.05,
      roughness: 0.7,
    });

    const mesh = new window.THREE.Mesh(geometry, material);

    // Center mesh
    const box = geometry.boundingBox;
    const center = new window.THREE.Vector3();
    box.getCenter(center);
    mesh.position.sub(center);

    scene.add(mesh);

    scene.add(new window.THREE.AmbientLight(0xffffff, 0.65));
    const light = new window.THREE.DirectionalLight(0xffffff, 0.85);
    light.position.set(1, 1, 1);
    scene.add(light);

    const sphere = geometry.boundingSphere;
    const radius = sphere ? sphere.radius : 50;
    camera.position.set(0, 0, Math.max(radius * 2.6, 60));
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);

    const frame = document.createElement("div");
    frame.className = "stl-preview-canvas";
    frame.appendChild(renderer.domElement);
    container.appendChild(frame);
  }

  function renderFileCard(listEl, { file, estimate, modelUnit, arrayBuffer, totalCostCents, laborRatePerHour }) {
    const item = document.createElement("div");
    item.className = "stl-preview-item";

    const title = document.createElement("div");
    title.className = "stl-preview-title";
    title.textContent = file.name;
    item.appendChild(title);

    if (!isStlFile(file)) {
      const note = document.createElement("div");
      note.className = "stl-preview-metrics";
      note.textContent = "Preview/estimate available for STL files only.";
      item.appendChild(note);
      listEl.appendChild(item);
      return;
    }

    // Preview
    if (arrayBuffer) {
      renderStlPreview(item, arrayBuffer, modelUnit);
    }

    const metrics = document.createElement("div");
    metrics.className = "stl-preview-metrics";

    const volumeCm3 = estimate.modelVolumeMm3 / 1000;
    const size = estimate.sizeMm;

    const costCents = Number.isFinite(totalCostCents)
      ? totalCostCents
      : toCents(estimate.cost + (estimate.printSeconds / 3600) * (Number.isFinite(laborRatePerHour) ? laborRatePerHour : DEFAULT_LABOR_RATE_PER_HOUR));

    metrics.innerHTML =
      "<div><strong>Estimated print time:</strong> " +
      durationString(estimate.printSeconds) +
      "</div>" +
      "<div><strong>Estimated cost:</strong> " +
      formatUsd(fromCents(costCents)) +
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

    item.appendChild(metrics);
    listEl.appendChild(item);
  }

  async function buildPreviews() {
    const fileInput = document.getElementById("file");
    const unitSelect = document.getElementById("stlModelUnit");
    const materialSelect = document.getElementById("material");
    const listEl = document.getElementById("stlPreviewList");

    if (!fileInput || !unitSelect || !listEl) return;

    clearEl(listEl);

    const files = Array.from(fileInput.files || []);
    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "help";
      empty.textContent = "Select one or more files to see STL previews/estimates.";
      listEl.appendChild(empty);
      return;
    }

    const modelUnit = (unitSelect.value || "mm").trim();
    const settings = getDefaultEstimateSettings();

    const materialValue = materialSelect
      ? materialSelect.value || materialSelect.options?.[materialSelect.selectedIndex]?.text
      : "";
    const laborRatePerHour = getLaborRatePerHourFromMaterial(materialValue);

    const anyStl = files.some(isStlFile);
    if (anyStl) {
      const ready = await waitForThreeStlReady();
      if (!ready) {
        const warn = document.createElement("div");
        warn.className = "help";
        warn.textContent =
          "3D preview may be unavailable because Three.js/STLLoader did not load. If estimates show but no preview, check the browser console for a blocked CDN request.";
        listEl.appendChild(warn);
      }
    }

    let totalCostCents = 0;
    let totalSeconds = 0;

    for (const file of files) {
      if (!isStlFile(file)) {
        renderFileCard(listEl, { file, estimate: null, modelUnit, arrayBuffer: null });
        continue;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const meshRaw = parseSTL(arrayBuffer);
        const meshMm = convertMeshToMillimeters(meshRaw, modelUnit);
        const estimate = estimatePrint(meshMm, settings);
        totalSeconds += estimate.printSeconds;

        const laborCost = (estimate.printSeconds / 3600) * laborRatePerHour;
        const fileTotalCostCents = toCents(estimate.cost + laborCost);
        totalCostCents += fileTotalCostCents;

        renderFileCard(listEl, {
          file,
          estimate,
          modelUnit,
          arrayBuffer,
          totalCostCents: fileTotalCostCents,
          laborRatePerHour,
        });
      } catch (err) {
        const item = document.createElement("div");
        item.className = "stl-preview-item";
        const title = document.createElement("div");
        title.className = "stl-preview-title";
        title.textContent = file.name;
        const note = document.createElement("div");
        note.className = "stl-preview-metrics";
        note.textContent = "Could not preview/estimate this STL.";
        item.appendChild(title);
        item.appendChild(note);
        listEl.appendChild(item);
        console.error("STL preview/estimate failed", { file: file.name, err });
      }
    }

    if (anyStl) {
      const total = document.createElement("div");
      total.className = "stl-preview-item";
      const title = document.createElement("div");
      title.className = "stl-preview-title";
      title.textContent = "Estimated total (STL files)";
      const val = document.createElement("div");
      val.className = "stl-preview-metrics";

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

    if (fileInput) fileInput.addEventListener("change", buildPreviews);
    if (unitSelect) unitSelect.addEventListener("change", buildPreviews);
    if (materialSelect) materialSelect.addEventListener("change", buildPreviews);

    buildPreviews();
  });
})();
