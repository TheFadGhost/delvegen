import {
  registerBuiltinAlgorithms,
  listAlgorithms,
  generateDungeon,
  computeMetrics,
  getAlgorithm,
} from "../index.js";
import type { GeneratedDungeon, ParamSpec } from "../core/types.js";
import { THEMES, applyTheme, getTheme } from "./themes.js";
import { MapRenderer, DEFAULT_OVERLAYS } from "../render/renderer.js";
import { buildRenderModel } from "../render/model.js";
import type { RenderModel } from "../render/renderer.js";

registerBuiltinAlgorithms();

/* ------------------------------------------------------------------ */
/* Element handles                                                     */
/* ------------------------------------------------------------------ */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const algorithmSelect = $<HTMLSelectElement>("algorithm-select");
const seedInput = $<HTMLInputElement>("seed-input");
const widthInput = $<HTMLInputElement>("width-input");
const heightInput = $<HTMLInputElement>("height-input");
const generateBtn = $<HTMLButtonElement>("generate-btn");
const themeSelect = $<HTMLSelectElement>("theme-select");
const paramsRoot = $<HTMLDivElement>("params-root");
const stage = $<HTMLElement>("stage");
const canvas = $<HTMLCanvasElement>("map-canvas");
const emptyState = $<HTMLDivElement>("empty-state");
const failureState = $<HTMLDivElement>("failure-state");
const failureMessage = $<HTMLParagraphElement>("failure-message");
const statusLine = $<HTMLDivElement>("status-line");
const metricsBody = $<HTMLTableElement>("metrics-table").tBodies[0]!;
const legendList = $<HTMLUListElement>("legend-list");

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let currentDungeon: GeneratedDungeon | null = null;
let currentModel: RenderModel | null = null;
let regenTimer: number | undefined;

const renderer = new MapRenderer(canvas, { x: 0, y: 0, zoom: 8 });

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

for (const def of listAlgorithms()) {
  const opt = document.createElement("option");
  opt.value = def.id;
  opt.textContent = def.name;
  algorithmSelect.appendChild(opt);
}

for (const t of THEMES) {
  const opt = document.createElement("option");
  opt.value = t.id;
  opt.textContent = t.name;
  themeSelect.appendChild(opt);
}

applyTheme(themeSelect.value || "dark");
buildParamPanel();
seedInput.value = randomSeed();

algorithmSelect.addEventListener("change", () => {
  buildParamPanel();
  scheduleRegenerate(0);
});

themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  redraw();
});

generateBtn.addEventListener("click", () => regenerate());

seedInput.addEventListener("change", () => scheduleRegenerate(0));
widthInput.addEventListener("input", () => scheduleRegenerate());
heightInput.addEventListener("input", () => scheduleRegenerate());

$("seed-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(seedInput.value);
    flashStatus(`seed "${seedInput.value}" copied`);
  } catch {
    flashStatus("clipboard unavailable");
  }
});
$("seed-dice").addEventListener("click", () => {
  seedInput.value = randomSeed();
  scheduleRegenerate(0);
});

/* ---------------- map interaction: pan + zoom ---------------- */

let dragging = false;
let lastPointer = { x: 0, y: 0 };

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastPointer = { x: e.clientX, y: e.clientY };
  canvas.classList.add("dragging");
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPointer.x;
  const dy = e.clientY - lastPointer.y;
  lastPointer = { x: e.clientX, y: e.clientY };
  renderer.panBy(-dx / renderer.camera.zoom, -dy / renderer.camera.zoom);
  clampAndRedraw();
});
canvas.addEventListener("pointerup", () => {
  dragging = false;
  canvas.classList.remove("dragging");
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.pow(1.15, -Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 40));
    renderer.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    clampAndRedraw();
  },
  { passive: false },
);

window.addEventListener("resize", redraw);

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (e.key === "g" || e.key === "G") {
    regenerate();
  }
});

function clampAndRedraw(): void {
  if (!currentModel) return;
  renderer.clampCamera(currentModel, stage.clientWidth, stage.clientHeight);
  redraw();
}

/* ------------------------------------------------------------------ */
/* Parameter panel                                                     */
/* ------------------------------------------------------------------ */

function buildParamPanel(): void {
  const def = getAlgorithm(algorithmSelect.value);
  paramsRoot.textContent = "";
  for (const spec of def.params) {
    paramsRoot.appendChild(buildParamControl(spec));
  }
}

function buildParamControl(spec: ParamSpec): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "param";

  switch (spec.type) {
    case "bool": {
      const labelRow = document.createElement("label");
      labelRow.className = "param-check";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = spec.default;
      check.dataset.paramKey = spec.key;
      check.addEventListener("change", () => scheduleRegenerate());
      const name = document.createElement("span");
      name.className = "param-name";
      name.textContent = spec.label;
      labelRow.append(check, name);
      wrap.appendChild(labelRow);
      break;
    }
    case "enum": {
      const labelRow = document.createElement("div");
      labelRow.className = "param-label-row";
      const name = document.createElement("span");
      name.className = "param-name";
      name.textContent = spec.label;
      labelRow.appendChild(name);
      const select = document.createElement("select");
      select.dataset.paramKey = spec.key;
      for (const o of spec.options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
      }
      select.value = spec.default;
      select.addEventListener("change", () => scheduleRegenerate());
      wrap.append(labelRow, select);
      break;
    }
    case "int":
    case "float": {
      const labelRow = document.createElement("div");
      labelRow.className = "param-label-row";
      const name = document.createElement("span");
      name.className = "param-name";
      name.textContent = spec.label;
      const value = document.createElement("span");
      value.className = "param-value";
      value.textContent = String(spec.default);
      labelRow.append(name, value);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(spec.min);
      slider.max = String(spec.max);
      slider.step = String(spec.step ?? (spec.type === "int" ? 1 : 0.01));
      slider.value = String(spec.default);
      slider.dataset.paramKey = spec.key;
      slider.setAttribute("aria-label", spec.label);

      const number = document.createElement("input");
      number.type = "number";
      number.min = String(spec.min);
      number.max = String(spec.max);
      number.step = String(spec.step ?? (spec.type === "int" ? 1 : 0.01));
      number.value = String(spec.default);
      number.setAttribute("aria-label", `${spec.label} numeric value`);

      const rangeNote = document.createElement("div");
      rangeNote.className = "param-range";
      rangeNote.textContent = `${spec.min} – ${spec.max}`;

      const sync = (v: number) => {
        value.textContent = formatValue(v, spec.type === "int");
        number.value = String(v);
        slider.value = String(v);
        scheduleRegenerate();
      };
      slider.addEventListener("input", () => sync(Number(slider.value)));
      number.addEventListener("input", () => {
        const v = Number(number.value);
        if (Number.isFinite(v)) {
          value.textContent = formatValue(v, spec.type === "int");
          slider.value = String(Math.min(spec.max, Math.max(spec.min, v)));
          scheduleRegenerate();
        }
      });

      const numRow = document.createElement("div");
      numRow.style.display = "flex";
      numRow.style.alignItems = "center";
      numRow.style.gap = "8px";
      numRow.append(slider, number);

      wrap.append(labelRow, numRow, rangeNote);
      break;
    }
  }

  const desc = document.createElement("div");
  desc.className = "param-desc";
  desc.textContent = spec.description;
  wrap.appendChild(desc);
  return wrap;
}

function formatValue(v: number, isInt: boolean): string {
  return isInt ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, "");
}

function collectParams(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const el of Array.from(paramsRoot.querySelectorAll("[data-param-key]"))) {
    const key = (el as HTMLElement).dataset.paramKey as string;
    if ((el as HTMLInputElement).type === "checkbox") {
      out[key] = (el as HTMLInputElement).checked;
    } else {
      const v = Number((el as HTMLInputElement).value);
      out[key] = Number.isFinite(v) ? v : (el as HTMLInputElement).value;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function scheduleRegenerate(delayMs = 140): void {
  window.clearTimeout(regenTimer);
  regenTimer = window.setTimeout(() => regenerate(), delayMs);
}

function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}

function regenerate(): void {
  window.clearTimeout(regenTimer);
  failureState.classList.add("hidden");

  let dungeon: GeneratedDungeon;
  try {
    const t0 = performance.now();
    dungeon = generateDungeon({
      algorithm: algorithmSelect.value,
      seed: seedInput.value.trim() || randomSeed(),
      width: Number(widthInput.value),
      height: Number(heightInput.value),
      params: collectParams(),
      post: {},
    });
    const ms = performance.now() - t0;
    currentDungeon = dungeon;
    currentModel = buildRenderModel(dungeon, DEFAULT_OVERLAYS);
    emptyState.classList.add("hidden");
    renderer.fit(currentModel, stage.clientWidth, stage.clientHeight);
    redraw();
    renderMetrics(dungeon, ms);
    renderLegend(currentModel);
    statusLine.textContent =
      `seed ${dungeon.seed} · ${dungeon.attemptsUsed} attempt(s) · ` +
      `${dungeon.grid.width}×${dungeon.grid.height}`;
  } catch (err) {
    currentDungeon = null;
    currentModel = null;
    failureMessage.textContent = err instanceof Error ? err.message : String(err);
    failureState.classList.remove("hidden");
    statusLine.textContent = "";
  }
}

/* ------------------------------------------------------------------ */
/* Metrics + legend                                                    */
/* ------------------------------------------------------------------ */

function fmt(n: number | null): string {
  if (n === null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function renderMetrics(d: GeneratedDungeon, ms: number): void {
  const m = computeMetrics(d);
  const rows: Array<[string, string]> = [
    ["Rooms", fmt(m.roomCount)],
    ["Avg room size", fmt(m.avgRoomSize)],
    ["Corridor/room", m.corridorToRoomRatio === null ? "—" : `${m.corridorToRoomRatio}`],
    ["Dead ends", fmt(m.deadEndCount)],
    ["Path length", fmt(m.meanPathLength)],
    ["Branch factor", m.branchingFactor === null ? "—" : `${m.branchingFactor}`],
    ["Open tiles", `${m.openPct}%`],
  ];
  metricsBody.replaceChildren(
    ...rows.map(([k, v]) => {
      const tr = document.createElement("tr");
      const tdK = document.createElement("td");
      tdK.className = "k";
      tdK.textContent = k;
      const tdV = document.createElement("td");
      tdV.className = "v";
      tdV.textContent = v;
      tr.append(tdK, tdV);
      return tr;
    }),
  );
  void ms;
}

interface LegendEntry {
  label: string;
  paint: (ctx: CanvasRenderingContext2D, size: number, dpr: number) => void;
  present: boolean;
}

function renderLegend(model: RenderModel): void {
  const pal = getTheme(themeSelect.value).tiles;
  const hasDoorTile = model.tiles.includes(3);
  const hasUnreachable =
    model.overlays.unreachable &&
    model.regionLabels !== null &&
    countDistinctRegions(model.regionLabels) > 1;

  const entries: LegendEntry[] = [
    {
      label: "Wall",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.wall;
        ctx.fillRect(0, 0, s * r, s * r);
        if (s * r >= 6) {
          ctx.fillStyle = pal.wallEdge;
          ctx.fillRect(0, s * r - Math.max(1, 0.18 * s * r), s * r, Math.max(1, 0.18 * s * r));
        }
      },
      present: true,
    },
    {
      label: "Room floor",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.room;
        ctx.fillRect(0, 0, s * r, s * r);
      },
      present: model.tiles.includes(1),
    },
    {
      label: "Corridor",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.corridor;
        ctx.fillRect(0, 0, s * r, s * r);
      },
      present: true,
    },
    {
      label: "Door",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.doorFill;
        ctx.fillRect(0, 0, s * r, s * r);
        ctx.fillStyle = pal.doorBar;
        ctx.fillRect(0, 0.3 * s * r, s * r, 0.4 * s * r);
      },
      present: hasDoorTile && model.overlays.doors,
    },
    {
      label: "Dead end",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.deadEnd;
        ctx.fillRect(0, 0, s * r, s * r);
        ctx.fillStyle = pal.markerInk;
        const c = s * r / 2;
        ctx.fillRect(c - s * r * 0.1, c - s * r * 0.1, s * r * 0.2, s * r * 0.2);
      },
      present: model.overlays.deadEnds && (model.deadEnds?.length ?? 0) > 0,
    },
    {
      label: "Entrance",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.corridor;
        ctx.fillRect(0, 0, s * r, s * r);
        ctx.beginPath();
        ctx.arc(s * r / 2, s * r / 2, s * r * 0.34, 0, Math.PI * 2);
        ctx.strokeStyle = pal.entrance;
        ctx.lineWidth = Math.max(1.5, s * r * 0.12);
        ctx.stroke();
      },
      present: model.entrance !== null,
    },
    {
      label: "Exit",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.corridor;
        ctx.fillRect(0, 0, s * r, s * r);
        const cx = s * r / 2, cy = s * r / 2, rad = s * r * 0.36;
        ctx.beginPath();
        ctx.moveTo(cx, cy - rad);
        ctx.lineTo(cx + rad, cy);
        ctx.lineTo(cx, cy + rad);
        ctx.lineTo(cx - rad, cy);
        ctx.closePath();
        ctx.strokeStyle = pal.exit;
        ctx.lineWidth = Math.max(1.5, s * r * 0.12);
        ctx.stroke();
      },
      present: model.exit !== null,
    },
    {
      label: "Unreachable",
      paint: (ctx, s, r) => {
        ctx.fillStyle = pal.unreachableTint;
        ctx.fillRect(0, 0, s * r, s * r);
        ctx.strokeStyle = pal.unreachableHatch;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, s * r);
        ctx.lineTo(s * r, 0);
        ctx.stroke();
      },
      present: hasUnreachable,
    },
  ];

  legendList.replaceChildren();
  const dpr = window.devicePixelRatio || 1;
  const size = 16;
  for (const entry of entries) {
    if (!entry.present) continue;
    const li = document.createElement("li");
    const sw = document.createElement("canvas");
    sw.width = size * dpr;
    sw.height = size * dpr;
    sw.style.width = `${size}px`;
    sw.style.height = `${size}px`;
    const ctx = sw.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    entry.paint(ctx, size, 1);
    const label = document.createElement("span");
    label.textContent = entry.label;
    li.append(sw, label);
    legendList.appendChild(li);
  }
}

function countDistinctRegions(labels: Int32Array): number {
  let max = -1;
  for (let i = 0; i < labels.length; i++) {
    if ((labels[i] as number) > max) max = labels[i] as number;
  }
  return max + 1;
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */

function redraw(): void {
  if (!currentModel) {
    renderer.draw(null, getTheme(themeSelect.value).tiles, stage.clientWidth, stage.clientHeight);
    return;
  }
  renderer.draw(
    currentModel,
    getTheme(themeSelect.value).tiles,
    stage.clientWidth,
    stage.clientHeight,
  );
}

function flashStatus(msg: string): void {
  statusLine.textContent = msg;
  window.setTimeout(() => {
    if (statusLine.textContent === msg) {
      statusLine.textContent = currentDungeon
        ? `seed ${currentDungeon.seed} · ${currentDungeon.attemptsUsed} attempt(s)`
        : "";
    }
  }, 1600);
}
