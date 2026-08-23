import {
  bootstrapDelvegen,
  listAlgorithms,
  listPostPasses,
  generateDungeon,
  computeMetrics,
  getAlgorithm,
} from "../index.js";
import type { GeneratedDungeon, GenerateOptions, ParamSpec, IntParamSpec, FloatParamSpec } from "../core/types.js";
import type { GenerationFrame } from "../core/recorder.js";
import { dungeonHash } from "../core/hash.js";
import { THEMES, applyTheme, getTheme } from "./themes.js";
import { MapRenderer, DEFAULT_OVERLAYS } from "../render/renderer.js";
import type { OverlayFlags, RenderModel } from "../render/renderer.js";
import { buildRenderModel, buildFrameModel } from "../render/model.js";
import type { DungeonDataPlus } from "../export/json.js";
import { buildNumericParam } from "./controls.js";
import { PostPanel } from "./postpanel.js";
import { buildOverlayPanel } from "./overlaypanel.js";
import { StepTransport } from "./stepper.js";
import { setupExportMenu } from "./exportmenu.js";
import { installShortcuts, setupHelpOverlay, nextThemeId } from "./shortcuts.js";
import {
  readShareHash,
  writeShareHash,
  type UiConfig,
  type SharePayload,
} from "./share.js";
import { presetsFor } from "./presets.js";
import { setupCompare, type CompareApi } from "./compare.js";
import { setupDistribution } from "./distribution.js";

bootstrapDelvegen();

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
const postRoot = $<HTMLDivElement>("post-root");
const overlaysRoot = $<HTMLDivElement>("overlays-root");
const stage = $<HTMLElement>("stage");
const stageView = $<HTMLElement>("stage-view");
const canvas = $<HTMLCanvasElement>("map-canvas");
const emptyState = $<HTMLDivElement>("empty-state");
const failureState = $<HTMLDivElement>("failure-state");
const failureMessage = $<HTMLParagraphElement>("failure-message");
const statusLine = $<HTMLDivElement>("status-line");
const metricsBody = $<HTMLTableElement>("metrics-table").tBodies[0]!;
const legendList = $<HTMLUListElement>("legend-list");

const stepModeBtn = $<HTMLButtonElement>("step-mode-btn");
const transportEl = $<HTMLElement>("transport");
const verifyBtn = $<HTMLButtonElement>("verify-determinism");
const selfcheckLine = $<HTMLDivElement>("selfcheck-line");
const helpOverlay = $<HTMLDivElement>("help-overlay");

const compareToggle = $<HTMLButtonElement>("compare-toggle");
const seedLockField = $<HTMLElement>("seed-lock-field");
const seedLockCheck = $<HTMLInputElement>("seed-lock");
const seedBackBtn = $<HTMLButtonElement>("seed-back");
const seedFwdBtn = $<HTMLButtonElement>("seed-forward");
const copyLinkBtn = $<HTMLButtonElement>("copy-link");
const presetsRow = $<HTMLDivElement>("presets-row");
const surpriseBtn = $<HTMLButtonElement>("surprise-btn");

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let currentDungeon: GeneratedDungeon | null = null;
/** Model currently painted (full model, an imported view, or a frame). */
let currentModel: RenderModel | null = null;
/** Full analysis model of the latest generation (legend/metrics source). */
let fullModel: RenderModel | null = null;
let regenTimer: number | undefined;
let stepMode = false;
let importedViewOnly = false;

const overlayFlags: OverlayFlags = { ...DEFAULT_OVERLAYS };
let recordedFrames: GenerationFrame[] = [];

/** Accessors for the current algorithm's parameter controls. */
const paramAccessors = new Map<string, ControlAccessor>();

const renderer = new MapRenderer(canvas, { x: 0, y: 0, zoom: 8 });

/* Feature-wave state: share link, compare mode, presets, seed history,
 * distribution sampler. Assigned during setup below. */
const initialShare = readShareHash();
let compareApi: CompareApi | null = null;
let distribution: { cancel(): void } | null = null;
let activeChip: HTMLElement | null = null;
let navigatingSeed = false;

/* ------------------------------------------------------------------ */
/* Seed history                                                        */
/* ------------------------------------------------------------------ */

const seedHistory = {
  list: [] as string[],
  idx: -1,
  push(s: string): void {
    if (this.list[this.idx] === s) return; // regenerating the same seed
    this.list = this.list.slice(0, this.idx + 1);
    this.list.push(s);
    if (this.list.length > 50) this.list.shift();
    this.idx = this.list.length - 1;
  },
  back(): string | null {
    if (this.idx <= 0) return null;
    this.idx--;
    return this.list[this.idx] ?? null;
  },
  forward(): string | null {
    if (this.idx >= this.list.length - 1) return null;
    this.idx++;
    return this.list[this.idx] ?? null;
  },
};

function refreshSeedHistoryButtons(): void {
  seedBackBtn.disabled = !(seedHistory.idx > 0);
  seedFwdBtn.disabled = !(
    seedHistory.list.length > 0 && seedHistory.idx < seedHistory.list.length - 1
  );
}

/** Restore a seed and regenerate; the run must not re-push the seed. */
function navigateSeed(getter: () => string | null): void {
  const s = getter();
  if (s === null) return;
  navigatingSeed = true;
  try {
    clearActivePreset();
    seedInput.value = s;
    window.clearTimeout(regenTimer);
    regenerate();
  } finally {
    navigatingSeed = false;
  }
}

const stepTransport = new StepTransport({
  transport: transportEl,
  prevBtn: $<HTMLButtonElement>("step-prev"),
  playBtn: $<HTMLButtonElement>("step-play"),
  nextBtn: $<HTMLButtonElement>("step-next"),
  playIcon: $<HTMLElement>("play-icon"),
  pauseIcon: $<HTMLElement>("pause-icon"),
  scrubber: $<HTMLInputElement>("step-scrubber"),
  speedSelect: $<HTMLSelectElement>("step-speed"),
  labelEl: $("step-label"),
  onFrame: drawFrame,
});

const postPanel = new PostPanel(postRoot, () => {
  clearActivePreset();
  scheduleRegenerate();
});
buildOverlayPanel(overlaysRoot, overlayFlags, () => {
  fullModel = currentDungeon ? buildRenderModel(currentDungeon, overlayFlags) : null;
  if (fullModel) renderLegend(fullModel);
  compareApi?.rebuildOverlays();
  refreshDisplayedModel(true);
});

const help = setupHelpOverlay(helpOverlay, $<HTMLButtonElement>("help-close"));

setupExportMenu(
  $("export-wrap"),
  $<HTMLButtonElement>("export-btn"),
  $("export-menu"),
  $<HTMLInputElement>("import-file"),
  {
    getDungeon: () => currentDungeon,
    getPalette: () => getTheme(themeSelect.value).tiles,
    getAlgorithmId: () => algorithmSelect.value,
    showImported: displayImported,
    reportError: (msg) => {
      statusLine.textContent = msg;
    },
  },
);

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

/* Apply a shared-link config (decoded from the hash before first paint)
 * or fall back to defaults. */
if (initialShare) {
  algorithmSelect.value = initialShare.config.algorithm;
}
buildParamPanel(initialShare?.config.params);
if (initialShare) {
  widthInput.value = String(initialShare.config.width);
  heightInput.value = String(initialShare.config.height);
  seedInput.value = initialShare.config.seed;
  applyPostConfig(initialShare.config.post);
} else {
  seedInput.value = randomSeed();
}

compareApi = setupCompare({
  stageView,
  root: $("compare-root"),
  paneEls: { A: $("pane-a"), B: $("pane-b") },
  toggleBtn: compareToggle,
  lockField: seedLockField,
  lockCheck: seedLockCheck,
  readUI: readUiConfig,
  applyUI: writeUiConfig,
  overlayFlags: () => overlayFlags,
  palette: () => getTheme(themeSelect.value).tiles,
  recording: () => stepMode,
  focusedResult: (d, m) => {
    currentDungeon = d;
    currentModel = m;
    fullModel = m;
    importedViewOnly = false;
    recordedFrames = [];
    renderMetrics(d, 0);
    renderLegend(m);
  },
  onExit: () => regenerate(),
  afterGenerate,
});

distribution = setupDistribution($<HTMLDetailsElement>("dist-details"), {
  fixed: () => {
    const c = readUiConfig();
    return {
      algorithm: c.algorithm,
      width: c.width,
      height: c.height,
      params: c.params,
      post: c.post,
    };
  },
});

// A decoded share link may carry comparison state; restore it last so all
// modules are wired.
if (initialShare?.cmp) compareApi.restore(initialShare.cmp);

refreshSeedHistoryButtons();

algorithmSelect.addEventListener("change", () => {
  clearActivePreset();
  buildParamPanel();
  scheduleRegenerate(0);
});

themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  redraw();
  compareApi?.redrawAll();
});

generateBtn.addEventListener("click", () => regenerate());

seedInput.addEventListener("change", () => {
  clearActivePreset();
  scheduleRegenerate(0);
});
widthInput.addEventListener("input", () => {
  clearActivePreset();
  scheduleRegenerate();
});
heightInput.addEventListener("input", () => {
  clearActivePreset();
  scheduleRegenerate();
});

async function copySeed(): Promise<void> {
  try {
    await navigator.clipboard.writeText(seedInput.value);
    flashStatus(`seed "${seedInput.value}" copied`);
  } catch {
    flashStatus("clipboard unavailable");
  }
}

$("seed-copy").addEventListener("click", () => void copySeed());
$("seed-dice").addEventListener("click", () => {
  clearActivePreset();
  seedInput.value = randomSeed();
  scheduleRegenerate(0);
});

/* ---------------- copy link (URL sharing) ---------------- */

copyLinkBtn.addEventListener("click", () => {
  writeShareHash(sharePayload());
  const href = window.location.href;
  const clip = navigator.clipboard;
  if (clip && typeof clip.writeText === "function") {
    clip
      .writeText(href)
      .then(
        () => flashStatus("link copied"),
        () => flashStatus("clipboard unavailable"),
      )
      .catch(() => flashStatus("clipboard unavailable"));
  } else {
    flashStatus("clipboard unavailable");
  }
});

stepModeBtn.addEventListener("click", () => setStepMode(!stepMode));

function setStepMode(on: boolean): void {
  if (on && compareApi?.isActive()) compareApi.exit(); // modes are exclusive
  stepMode = on;
  stepModeBtn.setAttribute("aria-pressed", String(on));
  if (on) {
    // Entering step mode records the next runs; re-record immediately so
    // there is something to scrub.
    if (currentDungeon || !failureState.classList.contains("hidden")) regenerate();
  } else {
    stepTransport.hide();
    transportEl.classList.add("hidden");
    importedViewOnly = false;
    if (currentDungeon) {
      fullModel = buildRenderModel(currentDungeon, overlayFlags);
      refreshDisplayedModel(false);
      statusLine.textContent = defaultStatus();
    }
  }
}

compareToggle.addEventListener("click", () => {
  if (!compareApi!.isActive() && stepMode) setStepMode(false);
  compareApi!.toggle();
});

verifyBtn.addEventListener("click", () => {
  selfcheckLine.classList.remove("ok", "fail");
  selfcheckLine.textContent = "checking…";
  try {
    const opts = collectGenerateOptions(false);
    const a = generateDungeon(opts);
    const b = generateDungeon(opts);
    const ha = dungeonHash(a);
    const hb = dungeonHash(b);
    if (ha === hb) {
      selfcheckLine.classList.add("ok");
      selfcheckLine.textContent = `byte-identical · hash ${ha}`;
    } else {
      selfcheckLine.classList.add("fail");
      selfcheckLine.textContent = `hash mismatch: ${ha} vs ${hb}`;
    }
  } catch (err) {
    selfcheckLine.classList.add("fail");
    selfcheckLine.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
});

$("help-btn").addEventListener("click", () => help.toggle());

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

window.addEventListener("resize", () => {
  redraw();
  compareApi?.redrawAll();
});

installShortcuts({
  generate: () => regenerate(),
  copySeed: () => copySeed(),
  cycleTheme: () => {
    themeSelect.value = nextThemeId(themeSelect.value);
    applyTheme(themeSelect.value);
    redraw();
    compareApi?.redrawAll();
    flashStatus(`theme: ${getTheme(themeSelect.value).name}`);
  },
  zoomCenter: (factor) => {
    renderer.zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2);
    clampAndRedraw();
  },
  panCamera: (dxPx, dyPx) => {
    renderer.panBy(dxPx / renderer.camera.zoom, dyPx / renderer.camera.zoom);
    clampAndRedraw();
  },
  toggleHelp: () => help.toggle(),
  closeHelp: () => help.close(),
  isStepMode: () => stepMode,
  transportPlayPause: () => stepTransport.togglePlay(),
  transportStep: (delta) => stepTransport.stepBy(delta),
});

/* Capture-phase extras: Alt+Arrow seed history and Esc leaving compare
 * mode. Runs before the bubble-phase shortcut handler; Escape is forwarded
 * to it (help-close wins while the modal is open). */
document.addEventListener(
  "keydown",
  (e) => {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      e.stopPropagation();
      navigateSeed(e.key === "ArrowLeft" ? () => seedHistory.back() : () => seedHistory.forward());
      return;
    }
    if (
      e.key === "Escape" &&
      helpOverlay.classList.contains("hidden") &&
      compareApi?.isActive()
    ) {
      e.stopPropagation();
      compareApi.exit();
    }
  },
  true,
);

function clampAndRedraw(): void {
  if (!currentModel) return;
  renderer.clampCamera(currentModel, stageView.clientWidth, stageView.clientHeight);
  redraw();
}

/* ------------------------------------------------------------------ */
/* Parameter panel                                                     */
/* ------------------------------------------------------------------ */

interface ControlAccessor {
  get(): unknown;
  set(v: unknown): void;
}

function paramTouched(): void {
  clearActivePreset();
  scheduleRegenerate();
}

function buildParamPanel(values?: Record<string, unknown>): void {
  const def = getAlgorithm(algorithmSelect.value);
  paramsRoot.textContent = "";
  paramAccessors.clear();
  for (const spec of def.params) {
    paramsRoot.appendChild(buildParamControl(spec));
  }
  if (values) setParamValues(values);
  renderPresets();
}

function setParamValues(values: Record<string, unknown>): void {
  for (const [key, v] of Object.entries(values)) {
    paramAccessors.get(key)?.set(v);
  }
}

function buildParamControl(spec: ParamSpec): HTMLElement {
  switch (spec.type) {
    case "bool": {
      const wrap = document.createElement("div");
      wrap.className = "param";
      const labelRow = document.createElement("label");
      labelRow.className = "param-check";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = spec.default;
      check.addEventListener("change", () => paramTouched());
      const name = document.createElement("span");
      name.className = "param-name";
      name.textContent = spec.label;
      labelRow.append(check, name);
      wrap.appendChild(labelRow);
      paramAccessors.set(spec.key, {
        get: () => check.checked,
        set: (v) => {
          check.checked = v === true;
        },
      });
      return wrap;
    }
    case "enum": {
      const wrap = document.createElement("div");
      wrap.className = "param";
      const labelRow = document.createElement("div");
      labelRow.className = "param-label-row";
      const name = document.createElement("span");
      name.className = "param-name";
      name.textContent = spec.label;
      labelRow.appendChild(name);
      const select = document.createElement("select");
      for (const o of spec.options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
      }
      select.value = spec.default;
      select.addEventListener("change", () => paramTouched());
      wrap.append(labelRow, select);
      paramAccessors.set(spec.key, {
        get: () => select.value,
        set: (v) => {
          select.value = String(v);
        },
      });
      appendDescription(wrap, spec.description);
      return wrap;
    }
    case "int":
    case "float": {
      const ctrl = buildNumericParam(spec, () => paramTouched());
      ctrl.root.dataset.paramKey = spec.key;
      const numberEl = ctrl.root.querySelector<HTMLInputElement>('input[type="number"]')!;
      const rangeEl = ctrl.root.querySelector<HTMLInputElement>('input[type="range"]')!;
      const valueEl = ctrl.root.querySelector<HTMLElement>(".param-value")!;
      paramAccessors.set(spec.key, {
        get: () => ctrl.getValue(),
        set: (v) => {
          const n =
            typeof v === "number" && Number.isFinite(v) ? v : (spec.default as number);
          const s = String(n);
          numberEl.value = s;
          rangeEl.value = s;
          valueEl.textContent = fmtNum(n);
        },
      });
      appendDescription(ctrl.root, spec.description);
      return ctrl.root;
    }
  }
}

function appendDescription(wrap: HTMLElement, description: string): void {
  const desc = document.createElement("div");
  desc.className = "param-desc";
  desc.textContent = description;
  wrap.appendChild(desc);
}

function collectParams(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, accessor] of paramAccessors) out[key] = accessor.get();
  return out;
}

/* ------------------------------------------------------------------ */
/* Presets + surprise                                                  */
/* ------------------------------------------------------------------ */

function renderPresets(): void {
  presetsRow.textContent = "";
  activeChip = null;
  for (const preset of presetsFor(algorithmSelect.value)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = preset.name;
    chip.addEventListener("click", () => {
      setParamValues(preset.params);
      applyPostConfig(preset.post ?? {});
      setActivePresetChip(chip);
      window.clearTimeout(regenTimer);
      regenerate();
    });
    presetsRow.appendChild(chip);
  }
}

function setActivePresetChip(chip: HTMLElement): void {
  clearActivePreset();
  activeChip = chip;
  chip.classList.add("active");
}

/** Any manual tweak clears the active preset highlight. */
function clearActivePreset(): void {
  if (!activeChip) return;
  activeChip.classList.remove("active");
  activeChip = null;
}

surpriseBtn.addEventListener("click", () => {
  const def = getAlgorithm(algorithmSelect.value);
  const rnd: Record<string, number | boolean> = {};
  for (const spec of def.params) {
    if (spec.type === "int") rnd[spec.key] = randInt(spec.min, spec.max);
    else if (spec.type === "float") {
      rnd[spec.key] = Math.round((spec.min + Math.random() * (spec.max - spec.min)) * 100) / 100;
    } else if (spec.type === "bool") {
      rnd[spec.key] = Math.random() < 0.5;
    }
  }
  setParamValues(rnd);
  const posts: Record<string, unknown> = {};
  for (const pass of listPostPasses()) {
    if (Math.random() < 0.5) posts[pass.id] = true; // enabled with default params
  }
  applyPostConfig(posts);
  clearActivePreset();
  seedInput.value = randomSeed(); // fresh dice seed
  window.clearTimeout(regenTimer);
  regenerate();
});

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* ------------------------------------------------------------------ */
/* Shared config <-> panel (compare focus switches, share links)       */
/* ------------------------------------------------------------------ */

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

function readUiConfig(): UiConfig {
  return {
    algorithm: algorithmSelect.value,
    width: Number(widthInput.value),
    height: Number(heightInput.value),
    seed: seedInput.value.trim(),
    params: collectParams(),
    post: postPanel.collect(),
  };
}

function writeUiConfig(cfg: UiConfig): void {
  if (algorithmSelect.value !== cfg.algorithm) {
    algorithmSelect.value = cfg.algorithm;
    buildParamPanel(cfg.params);
  } else {
    setParamValues(cfg.params);
  }
  widthInput.value = String(cfg.width);
  heightInput.value = String(cfg.height);
  seedInput.value = cfg.seed;
  applyPostConfig(cfg.post);
  clearActivePreset();
}

/**
 * Push a post-pass config into the PostPanel DOM without touching
 * postpanel.ts: rows are in registry order, numeric controls inside each row
 * match the pass's numeric specs by index.
 */
function applyPostConfig(cfg: Record<string, unknown>): void {
  const passes = listPostPasses();
  const rows = Array.from(postRoot.children) as HTMLElement[];
  passes.forEach((def, i) => {
    const row = rows[i];
    if (!row) return;
    const check = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!check) return;
    const wanted = cfg[def.id];
    const on = wanted !== undefined && wanted !== false;
    check.checked = on;
    const paramsDiv = row.querySelector<HTMLElement>(".post-params");
    paramsDiv?.classList.toggle("hidden", !on);
    if (on && wanted !== true && typeof wanted === "object" && wanted !== null) {
      const obj = wanted as Record<string, unknown>;
      const numericSpecs = def.params.filter(
        (p): p is IntParamSpec | FloatParamSpec => p.type === "int" || p.type === "float",
      );
      const ctrls = paramsDiv ? (Array.from(paramsDiv.children) as HTMLElement[]) : [];
      numericSpecs.forEach((sp, j) => {
        const el = ctrls[j];
        if (!el) return;
        const v = obj[sp.key];
        if (typeof v !== "number" || !Number.isFinite(v)) return;
        setNumericDom(el, sp.type === "int" ? Math.round(v) : v);
      });
    }
  });
}

function setNumericDom(paramEl: HTMLElement, v: number): void {
  const numberEl = paramEl.querySelector<HTMLInputElement>('input[type="number"]');
  const rangeEl = paramEl.querySelector<HTMLInputElement>('input[type="range"]');
  const valueEl = paramEl.querySelector<HTMLElement>(".param-value");
  if (numberEl) numberEl.value = String(v);
  if (rangeEl) rangeEl.value = String(v);
  if (valueEl) valueEl.textContent = fmtNum(v);
}

seedBackBtn.addEventListener("click", () => navigateSeed(() => seedHistory.back()));
seedFwdBtn.addEventListener("click", () => navigateSeed(() => seedHistory.forward()));

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

function collectGenerateOptions(recordFrames: boolean): GenerateOptions {
  return {
    algorithm: algorithmSelect.value,
    seed: seedInput.value.trim() || randomSeed(),
    width: Number(widthInput.value),
    height: Number(heightInput.value),
    params: collectParams(),
    post: postPanel.collect(),
    recordFrames,
  };
}

function sharePayload(): SharePayload {
  if (compareApi?.isActive()) return compareApi.payload();
  const c = readUiConfig();
  return { v: 1, a: c.algorithm, w: c.width, h: c.height, s: c.seed, g: c.params, p: c.post };
}

/** Bookkeeping after any successful generate (either mode). */
function afterGenerate(actualSeed: string | null): void {
  if (actualSeed !== null && !navigatingSeed) seedHistory.push(actualSeed);
  refreshSeedHistoryButtons();
  writeShareHash(sharePayload()); // hash tracks every generate automatically
}

function regenerate(): void {
  window.clearTimeout(regenTimer);
  distribution?.cancel(); // sampling aborts when the user regenerates
  if (compareApi?.isActive()) {
    compareApi.regenerateAll(); // both panes from their own configs
    return;
  }

  failureState.classList.add("hidden");
  selfcheckLine.classList.remove("ok", "fail");
  selfcheckLine.textContent = "";

  let dungeon: GeneratedDungeon;
  let ms: number;
  try {
    const t0 = performance.now();
    dungeon = generateDungeon(collectGenerateOptions(stepMode));
    ms = performance.now() - t0;
  } catch (err) {
    currentDungeon = null;
    currentModel = null;
    fullModel = null;
    recordedFrames = [];
    stepTransport.hide();
    transportEl.classList.add("hidden");
    failureMessage.textContent = err instanceof Error ? err.message : String(err);
    failureState.classList.remove("hidden");
    statusLine.textContent = "";
    return;
  }

  currentDungeon = dungeon;
  importedViewOnly = false;
  fullModel = buildRenderModel(dungeon, overlayFlags);
  emptyState.classList.add("hidden");

  if (stepMode) {
    // Transport joins the layout flow first, so fitting sees the final
    // canvas-area size and the map never jumps.
    recordedFrames = dungeon.frames?.frames ?? [];
    transportEl.classList.remove("hidden");
    stepTransport.load(recordedFrames);
    currentModel =
      recordedFrames.length > 0
        ? buildFrameModel(
            recordedFrames[recordedFrames.length - 1]!.tiles,
            dungeon.grid.width,
            dungeon.grid.height,
            overlayFlags,
          )
        : fullModel;
  } else {
    recordedFrames = [];
    stepTransport.hide();
    transportEl.classList.add("hidden");
    currentModel = fullModel;
    statusLine.textContent =
      `seed ${dungeon.seed} · ${dungeon.attemptsUsed} attempt(s) · ` +
      `${dungeon.grid.width}×${dungeon.grid.height}`;
  }

  renderer.fit(currentModel, stageView.clientWidth, stageView.clientHeight);
  redraw();
  renderMetrics(dungeon, ms);
  renderLegend(fullModel);
  if (stepMode) statusLine.textContent = stepCompleteStatus();
  afterGenerate(dungeon.seed);
}

function stepCompleteStatus(): string {
  const n = recordedFrames.length;
  const sampled = currentDungeon?.frames?.truncated ? " (sampled)" : "";
  return `generation complete · ${n} frames${sampled}`;
}

function defaultStatus(): string {
  if (!currentDungeon) return "";
  if (stepMode && recordedFrames.length > 0) return stepCompleteStatus();
  return `seed ${currentDungeon.seed} · ${currentDungeon.attemptsUsed} attempt(s)`;
}

/** Paint the recorded frame at `index` (step-through rendering). */
function drawFrame(index: number): void {
  const frame = recordedFrames[index];
  if (!frame || !currentDungeon) return;
  currentModel = buildFrameModel(
    frame.tiles,
    currentDungeon.grid.width,
    currentDungeon.grid.height,
    overlayFlags,
  );
  redraw();
}

/** Repaint whatever should be on screen now (overlay/theme/state changes). */
function refreshDisplayedModel(rebuildFrame: boolean): void {
  if (!currentDungeon) return;
  if (stepMode && recordedFrames.length > 0) {
    if (rebuildFrame) {
      const i = Math.max(0, stepTransport.currentIndex);
      const frame = recordedFrames[i];
      if (frame) {
        currentModel = buildFrameModel(
          frame.tiles,
          currentDungeon.grid.width,
          currentDungeon.grid.height,
          overlayFlags,
        );
      }
    }
  } else {
    currentModel = fullModel ?? buildRenderModel(currentDungeon, overlayFlags);
  }
  redraw();
}

/* ---------------- imported (view-only) dungeons ---------------- */

function displayImported(data: DungeonDataPlus, filename: string): void {
  compareApi?.exit({ regenerate: false }); // imports show in the single view
  failureState.classList.add("hidden");
  // View-only: the imported grid renders as-is; Generate replaces it.
  const view = data as unknown as GeneratedDungeon;
  view.attemptsUsed = 0;
  importedViewOnly = true;

  currentDungeon = view;
  recordedFrames = [];
  stepTransport.hide();
  transportEl.classList.add("hidden");
  fullModel = buildRenderModel(view, overlayFlags);
  currentModel = fullModel;
  emptyState.classList.add("hidden");

  renderer.fit(currentModel, stageView.clientWidth, stageView.clientHeight);
  redraw();
  renderMetrics(view, 0);
  renderLegend(fullModel);
  statusLine.textContent = `imported ${filename} · view-only · next Generate discards`;
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
  renderer.draw(
    currentModel,
    getTheme(themeSelect.value).tiles,
    stageView.clientWidth,
    stageView.clientHeight,
  );
}

function flashStatus(msg: string): void {
  statusLine.textContent = msg;
  window.setTimeout(() => {
    if (statusLine.textContent === msg) {
      statusLine.textContent = importedViewOnly ? msg : defaultStatus();
    }
  }, 1600);
}
