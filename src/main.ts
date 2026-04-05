import "./styles.css";

import { exportDst } from "./dst";
import { contoursBounds, distance, pointInContours } from "./geometry";
import { buildStitchPlan } from "./stitch-generators";
import { renderPreview, type ViewportState } from "./renderer";
import { parseSvgDocument } from "./svg";
import type { Point, StitchPoint, SvgRegion, ThreadInfo } from "./types";

const PES_EXPORT_URL = import.meta.env.VITE_PES_EXPORT_URL || "/export/pes";
const PES_FALLBACK_URLS = ["http://127.0.0.1:8000/export/pes", "http://localhost:8000/export/pes"];

interface ImportedDesign {
  id: string;
  name: string;
}

interface AppState {
  designs: ImportedDesign[];
  baseRegions: SvgRegion[];
  regions: SvgRegion[];
  selectedRegionId: string | null;
  stitches: StitchPoint[];
  threads: ThreadInfo[];
  scaleFactor: number;
  viewport: ViewportState;
  viewMode: "design" | "stitch";
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found");
}

const state: AppState = {
  designs: [],
  baseRegions: [],
  regions: [],
  selectedRegionId: null,
  stitches: [],
  threads: [],
  scaleFactor: 1,
  viewport: {
    scale: 8,
    offsetX: 80,
    offsetY: 80,
  },
  viewMode: "design",
};

app.innerHTML = `
  <div class="app-shell">
    <aside class="panel">
      <header class="brand-header">
        <h1 class="brand-wordmark"><span class="word-open">Open</span> <span class="word-stitch">Stitch</span></h1>
        <p class="brand-tagline">Design to stitch in seconds</p>
      </header>
      
      <div class="panel-content">
        <!-- 1. Import Phase -->
        <section class="phase-section">
          <h2 class="phase-header">1. Import</h2>
          <div id="drop-zone" class="drop-zone">
            <div class="drop-zone-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </div>
            <strong>Click or drag SVG files here</strong>
            <p class="hint" style="margin: 4px 0 0;">Supports standard vector paths.</p>
            <input id="svg-upload" type="file" accept=".svg,image/svg+xml" multiple />
          </div>
          <button id="load-sample" class="secondary" style="width:100%">Load Sample Pattern</button>
          <div id="design-list"></div>
        </section>

        <!-- 2. Configure Phase -->
        <section class="phase-section">
          <h2 class="phase-header">2. Configure</h2>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 13px; font-weight: 500; color: var(--text-muted);">Bulk apply type:</span>
            <select id="bulk-stitch-type" style="width: auto; padding: 6px 12px; font-size: 13px;">
              <option value="">-- select --</option>
              <option value="fill">Fill</option>
              <option value="satin">Satin</option>
              <option value="run">Run</option>
            </select>
          </div>
          <div id="region-list"></div>
        </section>

        <!-- 3. Preview Stats -->
        <section class="phase-section">
          <h2 class="phase-header">3. Preview Stats</h2>
          <div class="stats-strip">
            <div class="stat-item">
              <strong id="stat-stitches">0</strong>
              <span class="meta">Stitches</span>
            </div>
            <div class="stats-divider"></div>
            <div class="stat-item">
              <strong id="stat-colors">0</strong>
              <span class="meta">Threads</span>
            </div>
            <div class="stats-divider"></div>
            <div class="stat-item">
              <strong><span id="stat-width">0</span> × <span id="stat-height">0</span></strong>
              <span class="meta">Size (mm)</span>
            </div>
          </div>
          <div class="size-config">
            <label>
              <div class="label-header"><span>Target Width</span></div>
              <input id="size-width" type="number" min="1" step="1" placeholder="mm" />
            </label>
            <label>
              <div class="label-header"><span>Target Height</span></div>
              <input id="size-height" type="number" min="1" step="1" placeholder="mm" />
            </label>
          </div>
        </section>

        <!-- 4. Export Phase -->
        <section class="phase-section" style="margin-top:auto">
          <h2 class="phase-header">4. Export</h2>
          <div class="export-card">
            <div class="export-actions">
              <button id="export-pes" class="primary">Export PES</button>
              <button id="export-dst" class="secondary">Export DST</button>
            </div>
            <p class="hint" style="text-align:center; margin:0">PES export uses local Python backend.</p>
          </div>
        </section>
      </div>
    </aside>

    <main class="canvas-panel">
      <div class="canvas-toolbar">
        <div class="toggle-group">
          <button id="view-design" class="toggle-btn active">Design View</button>
          <button id="view-stitch" class="toggle-btn">Stitch View</button>
        </div>
        <div style="display:flex; gap: 8px;">
          <button id="rebuild" class="icon-btn" title="Refresh/Rebuild">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          </button>
          <div class="zoom-controls">
            <button id="zoom-in" class="zoom-btn">+</button>
            <button id="reset-view" class="zoom-btn" title="Reset View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            </button>
            <button id="zoom-out" class="zoom-btn">-</button>
          </div>
        </div>
      </div>
      <div class="canvas-wrap">
        <canvas id="preview"></canvas>
      </div>
    </main>
  </div>
`;

const regionList = document.querySelector<HTMLDivElement>("#region-list")!;
const designList = document.querySelector<HTMLDivElement>("#design-list")!;
const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const upload = document.querySelector<HTMLInputElement>("#svg-upload")!;
const dropZone = document.querySelector<HTMLDivElement>("#drop-zone")!;
const loadSampleButton = document.querySelector<HTMLButtonElement>("#load-sample")!;
const rebuildButton = document.querySelector<HTMLButtonElement>("#rebuild")!;
const exportDstButton = document.querySelector<HTMLButtonElement>("#export-dst")!;
const exportPesButton = document.querySelector<HTMLButtonElement>("#export-pes")!;
const bulkStitchTypeSelect = document.querySelector<HTMLSelectElement>("#bulk-stitch-type")!;
const viewDesignBtn = document.querySelector<HTMLButtonElement>("#view-design")!;
const viewStitchBtn = document.querySelector<HTMLButtonElement>("#view-stitch")!;

const statStitches = document.querySelector<HTMLElement>("#stat-stitches")!;
const statColors = document.querySelector<HTMLElement>("#stat-colors")!;
const statWidth = document.querySelector<HTMLElement>("#stat-width")!;
const statHeight = document.querySelector<HTMLElement>("#stat-height")!;
const sizeWidthInput = document.querySelector<HTMLInputElement>("#size-width")!;
const sizeHeightInput = document.querySelector<HTMLInputElement>("#size-height")!;

function cloneRegions(regions: SvgRegion[]): SvgRegion[] {
  return regions.map((region) => ({
    ...region,
    points: region.points.map((point) => ({ ...point })),
    contours: region.contours.map((contour) => contour.map((point) => ({ ...point }))),
    params: { ...region.params },
  }));
}

function nextDesignId() {
  return `design-${crypto.randomUUID()}`;
}

function tagRegions(regions: SvgRegion[], designId: string, designName: string): SvgRegion[] {
  return regions.map((region, index) => ({
    ...region,
    id: `${designId}-region-${index + 1}`,
    designId,
    designName,
  }));
}

function designBounds(regions: SvgRegion[]) {
  const contours = regions.flatMap((region) => region.contours);
  if (contours.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  const bounds = contoursBounds(contours);
  return {
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function scaleRegions(regions: SvgRegion[], scaleFactor: number): SvgRegion[] {
  const bounds = designBounds(regions);
  const scalePoint = (point: Point): Point => ({
    x: bounds.minX + (point.x - bounds.minX) * scaleFactor,
    y: bounds.minY + (point.y - bounds.minY) * scaleFactor,
  });

  return regions.map((region) => ({
    ...region,
    points: region.points.map(scalePoint),
    contours: region.contours.map((contour) => contour.map(scalePoint)),
    params: {
      ...region.params,
      spacing: Math.max(0.3, region.params.spacing * scaleFactor),
      runWidth: Math.max(0.4, region.params.runWidth * scaleFactor),
      satinWidth: Math.max(0.8, region.params.satinWidth * scaleFactor),
    },
  }));
}

function applyScale(scaleFactor: number) {
  state.scaleFactor = scaleFactor;
  state.regions = scaleRegions(cloneRegions(state.baseRegions), scaleFactor);
  rebuild();
  renderDesignList();
  renderRegionControls();
}

function renderDesignList() {
  designList.innerHTML = "";
  if (state.designs.length === 0) {
    designList.innerHTML = `<p class="hint">No files imported yet.</p>`;
    return;
  }

  state.designs.forEach((design) => {
    const count = state.regions.filter((region) => region.designId === design.id).length;
    const card = document.createElement("div");
    card.className = "design-card";
    card.innerHTML = `
      <div>
        <strong>${design.name}</strong>
        <div class="meta">${count} region${count === 1 ? "" : "s"}</div>
      </div>
      <button class="danger" type="button">Delete</button>
    `;
    card.querySelector<HTMLButtonElement>("button")!.addEventListener("click", () => {
      removeDesign(design.id);
    });
    designList.appendChild(card);
  });
}

function focusSelectedRegionCard() {
  if (!state.selectedRegionId) {
    return;
  }
  const card = regionList.querySelector<HTMLElement>(`.region-card[data-region-id="${state.selectedRegionId}"]`);
  card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function getCanvasPoint(event: PointerEvent): Point {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left - state.viewport.offsetX) / state.viewport.scale,
    y: (event.clientY - bounds.top - state.viewport.offsetY) / state.viewport.scale,
  };
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return distance(point, start);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, {
    x: start.x + dx * t,
    y: start.y + dy * t,
  });
}

function hitTestRegion(point: Point): string | null {
  for (let index = state.regions.length - 1; index >= 0; index -= 1) {
    const region = state.regions[index];
    if (region.closed && pointInContours(point, region.contours)) {
      return region.id;
    }
    if (!region.closed) {
      const hit = region.contours.some((contour) =>
        contour.some((vertex, vertexIndex) => {
          if (vertexIndex === 0) {
            return false;
          }
          return pointToSegmentDistance(point, contour[vertexIndex - 1], vertex) <= 1.5;
        }),
      );
      if (hit) {
        return region.id;
      }
    }
  }
  return null;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = bounds.width * ratio;
  canvas.height = bounds.height * ratio;
  const context = canvas.getContext("2d");
  if (context) {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  zoomToFit();
}

function refreshStats() {
  const bounds = designBounds(state.regions);
  statStitches.textContent = String(state.stitches.filter((stitch) => stitch.cmd === "stitch").length.toLocaleString());
  statColors.textContent = String(state.threads.length);
  statWidth.textContent = bounds.width.toFixed(1);
  statHeight.textContent = bounds.height.toFixed(1);
  sizeWidthInput.value = bounds.width > 0 ? bounds.width.toFixed(1) : "";
  sizeHeightInput.value = bounds.height > 0 ? bounds.height.toFixed(1) : "";
}

function rebuild() {
  const plan = buildStitchPlan(state.regions);
  state.stitches = plan.stitches;
  state.threads = plan.threads;
  refreshStats();
  draw();
}

function draw() {
  renderPreview(canvas, state.regions, state.stitches, state.threads, state.selectedRegionId, state.viewport, state.viewMode);
}

function renderRegionControls() {
  regionList.innerHTML = "";
  for (const region of state.regions) {
    const isFill = region.stitchType === "fill";
    const isSatin = region.stitchType === "satin";
    const isRun = region.stitchType === "run";
    const card = document.createElement("div");
    card.className = `region-card${region.id === state.selectedRegionId ? " selected" : ""}`;
    card.dataset.regionId = region.id;
    card.innerHTML = `
      <div class="region-header">
        <div class="region-title">
          <div class="swatch" style="background:${region.color}"></div>
          <div>
            <h3>${region.name}</h3>
            ${region.designName ? `<div class="meta">${region.designName}</div>` : ""}
          </div>
        </div>
        <span class="badge">${region.closed ? "Path" : "Polyl."}</span>
      </div>
      <div class="region-params">
        <label>
          <div class="label-header"><span>Stitch type</span></div>
          <select data-field="stitchType">
            <option value="fill" ${region.stitchType === "fill" ? "selected" : ""}>Fill</option>
            <option value="satin" ${region.stitchType === "satin" ? "selected" : ""}>Satin</option>
            <option value="run" ${region.stitchType === "run" ? "selected" : ""}>Run</option>
          </select>
        </label>
        ${isFill || isSatin ? `
        <label>
          <div class="label-header"><span>Spacing</span> <span class="label-value">${region.params.spacing.toFixed(1)} mm</span></div>
          <input data-field="spacing" type="range" min="0.3" max="3" step="0.1" value="${region.params.spacing}" />
        </label>
        <label>
          <div class="label-header"><span>Angle</span> <span class="label-value">${region.params.angle.toFixed(0)}°</span></div>
          <input data-field="angle" type="range" min="0" max="180" step="5" value="${region.params.angle}" />
        </label>
        ` : ""}
        ${isSatin ? `
        <label>
          <div class="label-header"><span>Satin width</span> <span class="label-value">${region.params.satinWidth.toFixed(1)} mm</span></div>
          <input data-field="satinWidth" type="range" min="0.8" max="10" step="0.2" value="${region.params.satinWidth}" />
        </label>
        <label>
          <div class="label-header"><span>Max satin width</span> <span class="label-value">${region.params.maxSatinWidth.toFixed(1)} mm</span></div>
          <input data-field="maxSatinWidth" type="range" min="1" max="20" step="0.5" value="${region.params.maxSatinWidth}" />
        </label>
        ` : ""}
        ${isRun ? `
        <label>
          <div class="label-header"><span>Run thickness</span> <span class="label-value">${region.params.runWidth.toFixed(1)} mm</span></div>
          <input data-field="runWidth" type="range" min="0.4" max="4" step="0.2" value="${region.params.runWidth}" />
        </label>
        ` : ""}
      </div>
    `;
    card.addEventListener("click", () => {
      state.selectedRegionId = region.id;
      renderRegionControls();
      draw();
      focusSelectedRegionCard();
    });

    card.querySelector<HTMLSelectElement>('select[data-field="stitchType"]')!.addEventListener("change", (event) => {
      region.stitchType = (event.currentTarget as HTMLSelectElement).value as SvgRegion["stitchType"];
      rebuild();
      renderRegionControls();
    });
    card.querySelector<HTMLInputElement>('input[data-field="spacing"]')?.addEventListener("input", (event) => {
      region.params.spacing = Number((event.currentTarget as HTMLInputElement).value);
      rebuild();
      renderRegionControls();
    });
    card.querySelector<HTMLInputElement>('input[data-field="angle"]')?.addEventListener("input", (event) => {
      region.params.angle = Number((event.currentTarget as HTMLInputElement).value);
      rebuild();
      renderRegionControls();
    });
    card.querySelector<HTMLInputElement>('input[data-field="satinWidth"]')?.addEventListener("input", (event) => {
      region.params.satinWidth = Number((event.currentTarget as HTMLInputElement).value);
      rebuild();
      renderRegionControls();
    });
    card.querySelector<HTMLInputElement>('input[data-field="maxSatinWidth"]')?.addEventListener("input", (event) => {
      region.params.maxSatinWidth = Number((event.currentTarget as HTMLInputElement).value);
      rebuild();
      renderRegionControls();
    });
    card.querySelector<HTMLInputElement>('input[data-field="runWidth"]')?.addEventListener("input", (event) => {
      region.params.runWidth = Number((event.currentTarget as HTMLInputElement).value);
      rebuild();
      renderRegionControls();
    });
    regionList.appendChild(card);
  }
}

function syncRegions() {
  state.regions = scaleRegions(cloneRegions(state.baseRegions), state.scaleFactor);
  if (state.selectedRegionId && !state.regions.some((region) => region.id === state.selectedRegionId)) {
    state.selectedRegionId = state.regions[0]?.id ?? null;
  }
}

function addDesign(name: string, regions: SvgRegion[]) {
  const designId = nextDesignId();
  const tagged = tagRegions(regions, designId, name);
  state.designs.push({ id: designId, name });
  state.baseRegions = [...state.baseRegions, ...cloneRegions(tagged)];
  syncRegions();
  state.selectedRegionId = tagged[0]?.id ?? state.selectedRegionId;
  renderDesignList();
  renderRegionControls();
  rebuild();
}

function removeDesign(designId: string) {
  state.designs = state.designs.filter((design) => design.id !== designId);
  state.baseRegions = state.baseRegions.filter((region) => region.designId !== designId);
  syncRegions();
  renderDesignList();
  renderRegionControls();
  rebuild();
}

function resizeFromWidth(widthMm: number) {
  const base = designBounds(state.baseRegions);
  if (base.width <= 0 || widthMm <= 0) {
    return;
  }
  applyScale(widthMm / base.width);
}

function resizeFromHeight(heightMm: number) {
  const base = designBounds(state.baseRegions);
  if (base.height <= 0 || heightMm <= 0) {
    return;
  }
  applyScale(heightMm / base.height);
}

async function loadSample() {
  const response = await fetch("/samples/flower.svg");
  const svgText = await response.text();
  addDesign("flower.svg", parseSvgDocument(svgText));
  zoomToFit();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportPes() {
  const payload = JSON.stringify({
    stitches: state.stitches,
    threads: state.threads,
  });
  const endpoints = [PES_EXPORT_URL, ...PES_FALLBACK_URLS.filter((url) => url !== PES_EXPORT_URL)];
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: payload,
      });
      if (!response.ok) {
        const message = await response.text();
        failures.push(`${endpoint}: ${message || response.statusText || "request failed"}`);
        continue;
      }
      const blob = await response.blob();
      downloadBlob(blob, "pattern.pes");
      return;
    } catch (error) {
      failures.push(`${endpoint}: ${error instanceof Error ? error.message : "network error"}`);
    }
  }

  throw new Error(
    [
      "PES export could not reach the Python exporter.",
      "Start it with: source .venv/bin/activate && python backend/server.py",
      failures.length > 0 ? `Tried: ${failures.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function handleFileLoads(files: File[]) {
  if (files.length === 0) return;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.svg')) continue;
    try {
      const svgText = await file.text();
      addDesign(file.name, parseSvgDocument(svgText));
    } catch (e) {
      console.warn("Failed to load SVG", file.name, e);
    }
  }
  zoomToFit();
}

upload.addEventListener("change", async () => {
  const files = Array.from(upload.files ?? []);
  await handleFileLoads(files);
  upload.value = "";
});

// Drag and drop handlers
["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
});

["dragenter", "dragover"].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    dropZone.classList.add("drag-active");
  });
});

["dragleave", "drop"].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    dropZone.classList.remove("drag-active");
  });
});

dropZone.addEventListener("drop", async (e) => {
  const files = Array.from(e.dataTransfer?.files || []);
  await handleFileLoads(files);
});

loadSampleButton.addEventListener("click", () => {
  void loadSample();
});
rebuildButton.addEventListener("click", rebuild);
exportDstButton.addEventListener("click", () => {
  downloadBlob(exportDst(state.stitches), "pattern.dst");
});
exportPesButton.addEventListener("click", () => {
  void exportPes().catch((error: unknown) => {
    window.alert(error instanceof Error ? error.message : "PES export failed");
  });
});

viewDesignBtn.addEventListener("click", () => {
  state.viewMode = "design";
  viewDesignBtn.classList.add("active");
  viewStitchBtn.classList.remove("active");
  draw();
});

viewStitchBtn.addEventListener("click", () => {
  state.viewMode = "stitch";
  viewStitchBtn.classList.add("active");
  viewDesignBtn.classList.remove("active");
  draw();
});

bulkStitchTypeSelect.addEventListener("change", (e) => {
  const type = (e.currentTarget as HTMLSelectElement).value as SvgRegion["stitchType"] | "";
  if (!type) return;
  state.regions.forEach((region) => {
    region.stitchType = type;
  });
  bulkStitchTypeSelect.value = "";
  rebuild();
  renderRegionControls();
});

sizeWidthInput.addEventListener("change", () => {
  resizeFromWidth(Number(sizeWidthInput.value));
});

sizeHeightInput.addEventListener("change", () => {
  resizeFromHeight(Number(sizeHeightInput.value));
});

function zoomToFit() {
  const bounds = designBounds(state.regions);
  if (bounds.width <= 0 || bounds.height <= 0) return;
  
  const padding = 40;
  const canvasBounds = canvas.getBoundingClientRect();
  const availableWidth = canvasBounds.width - padding * 2;
  const availableHeight = canvasBounds.height - padding * 2;
  
  if (availableWidth <= 0 || availableHeight <= 0) return;
  
  const scaleX = availableWidth / bounds.width;
  const scaleY = availableHeight / bounds.height;
  const newScale = Math.min(scaleX, Math.min(scaleY, 20)); // Cap max zoom
  
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;
  
  const offsetX = (canvasBounds.width / 2) - (centerX * newScale);
  const offsetY = (canvasBounds.height / 2) - (centerY * newScale);
  
  state.viewport = { scale: newScale, offsetX, offsetY };
  draw();
}

document.querySelector<HTMLButtonElement>("#zoom-in")!.addEventListener("click", () => {
  state.viewport.scale *= 1.2;
  draw();
});
document.querySelector<HTMLButtonElement>("#zoom-out")!.addEventListener("click", () => {
  state.viewport.scale /= 1.2;
  draw();
});
document.querySelector<HTMLButtonElement>("#reset-view")!.addEventListener("click", () => {
  zoomToFit();
});

let isPanning = false;
let dragStart: Point | null = null;
let lastPan = { x: 0, y: 0 };
canvas.addEventListener("pointerdown", (event) => {
  isPanning = true;
  lastPan = { x: event.clientX, y: event.clientY };
  dragStart = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!isPanning) {
    return;
  }
  state.viewport.offsetX += event.clientX - lastPan.x;
  state.viewport.offsetY += event.clientY - lastPan.y;
  lastPan = { x: event.clientX, y: event.clientY };
  draw();
});
canvas.addEventListener("pointerup", (event) => {
  if (dragStart && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 6) {
    const regionId = hitTestRegion(getCanvasPoint(event));
    if (regionId) {
      state.selectedRegionId = regionId;
      renderRegionControls();
      draw();
      focusSelectedRegionCard();
    }
  }
  isPanning = false;
  dragStart = null;
});
canvas.addEventListener("pointerleave", () => {
  isPanning = false;
  dragStart = null;
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.08 : 0.92;
  state.viewport.scale *= factor;
  draw();
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
renderDesignList();
void loadSample();
