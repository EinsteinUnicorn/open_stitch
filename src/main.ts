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
};

app.innerHTML = `
  <div class="app-shell">
    <aside class="panel">
      <div class="title">
        <h1>Embroidery Digitizer</h1>
        <p>Minimal SVG-to-stitch MVP with fill, satin, run, DST export, and PES export via Python.</p>
      </div>

      <section class="toolbar">
        <h2>SVG Import</h2>
        <label>
          Load SVG
          <input id="svg-upload" type="file" accept=".svg,image/svg+xml" multiple />
        </label>
        <div class="toolbar-actions">
          <button id="load-sample" class="secondary">Load Sample</button>
          <button id="rebuild">Rebuild Stitches</button>
        </div>
      </section>

      <section class="toolbar">
        <h2>Imported Files</h2>
        <p class="hint">Each imported file can be removed without affecting the others.</p>
        <div id="design-list"></div>
      </section>

      <section class="stats">
        <h2>Pattern Stats</h2>
        <div class="stats-grid">
          <div><span class="meta">Regions</span><strong id="stat-regions">0</strong></div>
          <div><span class="meta">Stitches</span><strong id="stat-stitches">0</strong></div>
          <div><span class="meta">Color Stops</span><strong id="stat-colors">0</strong></div>
          <div><span class="meta">Commands</span><strong id="stat-commands">0</strong></div>
        </div>
      </section>

      <section class="toolbar">
        <h2>Design Size</h2>
        <div class="stats-grid">
          <div><span class="meta">Width</span><strong id="stat-width">0 mm</strong></div>
          <div><span class="meta">Height</span><strong id="stat-height">0 mm</strong></div>
          <div><span class="meta">Scale</span><strong id="stat-scale">100%</strong></div>
          <div><span class="meta">Inches</span><strong id="stat-inches">0 × 0</strong></div>
        </div>
        <label>
          Target width (mm)
          <input id="size-width" type="number" min="1" step="1" />
        </label>
        <label>
          Target height (mm)
          <input id="size-height" type="number" min="1" step="1" />
        </label>
        <p class="hint">Resizing is uniform to preserve the patch proportions and stitch layout.</p>
      </section>

      <section>
        <h2>Regions</h2>
        <p class="hint">Click a patch in the canvas or select a region here to adjust stitch direction and density.</p>
        <div id="region-list"></div>
      </section>

      <section class="toolbar">
        <h2>Export</h2>
        <div class="export-actions">
          <button id="export-dst">Export DST</button>
          <button id="export-pes" class="secondary">Export PES</button>
        </div>
        <p class="hint">PES export uses the backend endpoint at <code>${PES_EXPORT_URL}</code>.</p>
      </section>
    </aside>

    <section class="canvas-panel">
      <div class="canvas-overlay">
        <button id="zoom-in">+</button>
        <button id="zoom-out">-</button>
        <button id="reset-view">Reset View</button>
      </div>
      <div class="canvas-wrap">
        <canvas id="preview"></canvas>
      </div>
    </section>
  </div>
`;

const regionList = document.querySelector<HTMLDivElement>("#region-list")!;
const designList = document.querySelector<HTMLDivElement>("#design-list")!;
const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const upload = document.querySelector<HTMLInputElement>("#svg-upload")!;
const loadSampleButton = document.querySelector<HTMLButtonElement>("#load-sample")!;
const rebuildButton = document.querySelector<HTMLButtonElement>("#rebuild")!;
const exportDstButton = document.querySelector<HTMLButtonElement>("#export-dst")!;
const exportPesButton = document.querySelector<HTMLButtonElement>("#export-pes")!;

const statRegions = document.querySelector<HTMLElement>("#stat-regions")!;
const statStitches = document.querySelector<HTMLElement>("#stat-stitches")!;
const statColors = document.querySelector<HTMLElement>("#stat-colors")!;
const statCommands = document.querySelector<HTMLElement>("#stat-commands")!;
const statWidth = document.querySelector<HTMLElement>("#stat-width")!;
const statHeight = document.querySelector<HTMLElement>("#stat-height")!;
const statScale = document.querySelector<HTMLElement>("#stat-scale")!;
const statInches = document.querySelector<HTMLElement>("#stat-inches")!;
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
  draw();
}

function refreshStats() {
  const bounds = designBounds(state.regions);
  statRegions.textContent = String(state.regions.length);
  statStitches.textContent = String(state.stitches.filter((stitch) => stitch.cmd === "stitch").length);
  statColors.textContent = String(state.threads.length);
  statCommands.textContent = String(state.stitches.length);
  statWidth.textContent = `${bounds.width.toFixed(1)} mm`;
  statHeight.textContent = `${bounds.height.toFixed(1)} mm`;
  statScale.textContent = `${Math.round(state.scaleFactor * 100)}%`;
  statInches.textContent = `${(bounds.width / 25.4).toFixed(2)} × ${(bounds.height / 25.4).toFixed(2)}`;
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
  renderPreview(canvas, state.regions, state.stitches, state.threads, state.selectedRegionId, state.viewport);
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
        <div>
          <h3>${region.name}</h3>
          <span class="badge">${region.closed ? "Closed" : "Open"} ${region.sourceType}</span>
        </div>
        <span class="swatch" style="background:${region.color}"></span>
      </div>
      ${region.designName ? `<p class="meta">${region.designName}</p>` : ""}
      <label>
        Stitch type
        <select data-field="stitchType">
          <option value="fill" ${region.stitchType === "fill" ? "selected" : ""}>Fill</option>
          <option value="satin" ${region.stitchType === "satin" ? "selected" : ""}>Satin</option>
          <option value="run" ${region.stitchType === "run" ? "selected" : ""}>Run</option>
        </select>
      </label>
      ${isFill || isSatin ? `
      <label>
        Spacing (${region.params.spacing.toFixed(1)} mm)
        <input data-field="spacing" type="range" min="0.3" max="3" step="0.1" value="${region.params.spacing}" />
      </label>
      <label>
        Angle (${region.params.angle.toFixed(0)}°)
        <input data-field="angle" type="range" min="0" max="180" step="5" value="${region.params.angle}" />
      </label>
      ` : ""}
      ${isSatin ? `
      <label>
        Satin width (${region.params.satinWidth.toFixed(1)} mm)
        <input data-field="satinWidth" type="range" min="0.8" max="10" step="0.2" value="${region.params.satinWidth}" />
      </label>
      <label>
        Max satin width (${region.params.maxSatinWidth.toFixed(1)} mm)
        <input data-field="maxSatinWidth" type="range" min="1" max="20" step="0.5" value="${region.params.maxSatinWidth}" />
      </label>
      ` : ""}
      ${isRun ? `
      <label>
        Run thickness (${region.params.runWidth.toFixed(1)} mm)
        <input data-field="runWidth" type="range" min="0.4" max="4" step="0.2" value="${region.params.runWidth}" />
      </label>
      ` : ""}
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

upload.addEventListener("change", async () => {
  const files = Array.from(upload.files ?? []);
  if (files.length === 0) {
    return;
  }
  for (const file of files) {
    const svgText = await file.text();
    addDesign(file.name, parseSvgDocument(svgText));
  }
  upload.value = "";
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

sizeWidthInput.addEventListener("change", () => {
  resizeFromWidth(Number(sizeWidthInput.value));
});

sizeHeightInput.addEventListener("change", () => {
  resizeFromHeight(Number(sizeHeightInput.value));
});

document.querySelector<HTMLButtonElement>("#zoom-in")!.addEventListener("click", () => {
  state.viewport.scale *= 1.2;
  draw();
});
document.querySelector<HTMLButtonElement>("#zoom-out")!.addEventListener("click", () => {
  state.viewport.scale /= 1.2;
  draw();
});
document.querySelector<HTMLButtonElement>("#reset-view")!.addEventListener("click", () => {
  state.viewport = { scale: 8, offsetX: 80, offsetY: 80 };
  draw();
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
