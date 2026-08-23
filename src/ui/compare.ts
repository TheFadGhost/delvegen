/**
 * Comparison mode: the stage splits into two independently configured panes,
 * each with its own canvas, MapRenderer and slim metrics strip. The left
 * parameter panel always edits the FOCUSED pane; clicking a pane focuses it.
 * Generate regenerates BOTH panes from their own configs; a shared-seed lock
 * propagates seed edits to both panes while enabled.
 */

import { computeMetrics, generateDungeon } from "../index.js";
import type { GeneratedDungeon, GenerateOptions, PostPassConfig } from "../core/types.js";
import { MapRenderer } from "../render/renderer.js";
import type { OverlayFlags, RenderModel } from "../render/renderer.js";
import { buildRenderModel } from "../render/model.js";
import type { TilePalette } from "./themes.js";
import type { SharePayload, UiConfig } from "./share.js";
import { paneToShare } from "./share.js";

type PaneKey = "A" | "B";

interface Pane {
  key: PaneKey;
  root: HTMLElement;
  wrap: HTMLElement;
  canvas: HTMLCanvasElement;
  strip: HTMLElement;
  renderer: MapRenderer;
  config: UiConfig;
  dungeon: GeneratedDungeon | null;
  model: RenderModel | null;
}

export interface CompareDeps {
  /** Single-pane view (hidden while compare is active). */
  stageView: HTMLElement;
  /** #compare-root hosting both panes. */
  root: HTMLElement;
  paneEls: Record<PaneKey, HTMLElement>;
  toggleBtn: HTMLButtonElement;
  lockField: HTMLElement;
  lockCheck: HTMLInputElement;
  readUI(): UiConfig;
  applyUI(cfg: UiConfig): void;
  overlayFlags(): OverlayFlags;
  palette(): TilePalette;
  recording(): boolean;
  /** Focused pane finished: refresh right-panel metrics + legend. */
  focusedResult(d: GeneratedDungeon, m: RenderModel): void;
  /** Compare turned off; caller repaints the single view. */
  onExit(): void;
  afterGenerate(seed: string | null): void;
}

export interface CompareApi {
  isActive(): boolean;
  toggle(): void;
  exit(opts?: { regenerate?: boolean }): void;
  restore(cmp: { f: "A" | "B"; b: UiConfig }): void;
  regenerateAll(): void;
  redrawAll(): void;
  rebuildOverlays(): void;
  payload(): SharePayload;
}

function cloneConfig(c: UiConfig): UiConfig {
  return JSON.parse(JSON.stringify(c)) as UiConfig;
}

const PLACEHOLDER_CONFIG: UiConfig = {
  algorithm: "",
  width: 80,
  height: 50,
  seed: "",
  params: {},
  post: {},
};

export function setupCompare(deps: CompareDeps): CompareApi {
  const panes: Record<PaneKey, Pane> = {
    A: makePane("A", deps.paneEls.A),
    B: makePane("B", deps.paneEls.B),
  };
  let active = false;
  let focused: PaneKey = "A";

  const other = (k: PaneKey): PaneKey => (k === "A" ? "B" : "A");

  function makePane(key: PaneKey, rootEl: HTMLElement): Pane {
    const id = key.toLowerCase();
    const canvas = rootEl.querySelector<HTMLCanvasElement>(`#pane-canvas-${id}`)!;
    const strip = rootEl.querySelector<HTMLElement>(`#pane-strip-${id}`)!;
    const wrap = rootEl.querySelector<HTMLElement>(".pane-canvas-wrap")!;
    const renderer = new MapRenderer(canvas, { x: 0, y: 0, zoom: 8 });
    const pane: Pane = {
      key,
      root: rootEl,
      wrap,
      canvas,
      strip,
      renderer,
      config: cloneConfig(PLACEHOLDER_CONFIG),
      dungeon: null,
      model: null,
    };
    rootEl.addEventListener("pointerdown", () => setFocused(key));
    attachControls(pane);
    return pane;
  }

  /** Per-pane pan + zoom, mirroring the single-view canvas controls. */
  function attachControls(p: Pane): void {
    let dragging = false;
    let last = { x: 0, y: 0 };
    p.canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      p.canvas.classList.add("dragging");
      p.canvas.setPointerCapture(e.pointerId);
    });
    p.canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      p.renderer.panBy(-dx / p.renderer.camera.zoom, -dy / p.renderer.camera.zoom);
    });
    p.canvas.addEventListener("pointerup", () => {
      dragging = false;
      p.canvas.classList.remove("dragging");
    });
    p.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = p.canvas.getBoundingClientRect();
        const factor = Math.pow(1.15, -Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 40));
        p.renderer.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false },
    );
  }

  function setFocused(k: PaneKey): void {
    if (!active || k === focused) return;
    // Commit any pending panel edits to the pane we are leaving.
    panes[focused].config = deps.readUI();
    focused = k;
    deps.applyUI(panes[k].config);
    updateFocusOutline();
  }

  function updateFocusOutline(): void {
    for (const key of ["A", "B"] as PaneKey[]) {
      panes[key].root.classList.toggle("focused", active && key === focused);
    }
  }

  function setActiveDom(on: boolean): void {
    deps.root.classList.toggle("hidden", !on);
    deps.stageView.classList.toggle("hidden", on);
    deps.toggleBtn.setAttribute("aria-pressed", String(on));
    deps.lockCheck.disabled = !on;
    deps.lockField.classList.toggle("disabled-field", !on);
    updateFocusOutline();
  }

  function fitDraw(p: Pane): void {
    if (!p.model) return;
    p.renderer.fit(p.model, p.wrap.clientWidth, p.wrap.clientHeight);
    draw(p);
  }

  function draw(p: Pane): void {
    p.renderer.draw(
      p.model,
      deps.palette(),
      p.wrap.clientWidth,
      p.wrap.clientHeight,
    );
  }

  function toOptions(c: UiConfig): GenerateOptions {
    return {
      algorithm: c.algorithm,
      seed: c.seed,
      width: c.width,
      height: c.height,
      params: cloneConfig(c).params,
      post: cloneConfig(c).post as Record<string, PostPassConfig>,
      recordFrames: deps.recording(),
    };
  }

  function stripMetrics(p: Pane, d: GeneratedDungeon): void {
    const m = computeMetrics(d);
    const cell = (k: string, v: string): HTMLElement => {
      const frag = document.createElement("span");
      frag.className = "strip-cell";
      const lab = document.createElement("span");
      lab.className = "sk";
      lab.textContent = k;
      const val = document.createElement("span");
      val.className = "sv";
      val.textContent = v;
      frag.append(lab, val);
      return frag;
    };
    const sep = (): HTMLElement => {
      const s = document.createElement("span");
      s.className = "sep";
      s.textContent = "|";
      return s;
    };
    p.strip.classList.remove("error");
    p.strip.replaceChildren(
      cell("Rooms", String(m.roomCount)),
      sep(),
      cell("Dead ends", String(m.deadEndCount)),
      sep(),
      cell("Path", String(m.meanPathLength)),
      sep(),
      cell("Open", `${m.openPct}%`),
    );
  }

  function stripError(p: Pane, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    p.strip.classList.add("error");
    p.strip.textContent = `generation failed — ${msg}`;
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  function isActive(): boolean {
    return active;
  }

  function enable(): void {
    if (active) return;
    panes.A.config = deps.readUI();
    panes.B.config = cloneConfig(panes.A.config); // pane B clones current config
    focused = "A";
    active = true;
    setActiveDom(true);
    regenerateAll();
  }

  function exit(opts?: { regenerate?: boolean }): void {
    if (!active) return;
    active = false;
    setActiveDom(false);
    if (opts?.regenerate !== false) {
      // Single-pane view shows the focused pane's config.
      deps.applyUI(panes[focused].config);
      deps.onExit();
    }
  }

  function toggle(): void {
    if (active) exit();
    else enable();
  }

  function restore(cmp: { f: "A" | "B"; b: UiConfig }): void {
    panes.A.config = deps.readUI(); // UI already carries pane A from the hash
    panes.B.config = cloneConfig(cmp.b);
    focused = cmp.f === "B" ? "B" : "A";
    active = true;
    setActiveDom(true);
    if (focused === "B") deps.applyUI(panes[focused].config);
    regenerateAll();
  }

  function regenerateAll(): void {
    const fk = focused;
    // The left panel edits the focused pane: fold its live state in first.
    panes[fk].config = deps.readUI();
    if (deps.lockCheck.checked && panes[fk].config.seed !== "") {
      panes[other(fk)].config.seed = panes[fk].config.seed;
    }

    let okD: GeneratedDungeon | null = null;
    let okM: RenderModel | null = null;
    for (const key of ["A", "B"] as PaneKey[]) {
      const p = panes[key];
      try {
        const d = generateDungeon(toOptions(p.config));
        p.dungeon = d;
        p.model = buildRenderModel(d, deps.overlayFlags());
        fitDraw(p);
        stripMetrics(p, d);
        if (key === fk) {
          okD = d;
          okM = p.model;
        }
      } catch (err) {
        p.dungeon = null;
        p.model = null;
        p.renderer.draw(null, deps.palette(), p.wrap.clientWidth, p.wrap.clientHeight);
        stripError(p, err);
      }
    }
    if (okD && okM) deps.focusedResult(okD, okM);
    deps.afterGenerate(okD ? okD.seed : null);
  }

  function redrawAll(): void {
    for (const key of ["A", "B"] as PaneKey[]) draw(panes[key]);
  }

  function rebuildOverlays(): void {
    let focusedOk = false;
    for (const key of ["A", "B"] as PaneKey[]) {
      const p = panes[key];
      if (!p.dungeon) continue;
      p.model = buildRenderModel(p.dungeon, deps.overlayFlags());
      draw(p);
      if (p.model && key === focused) focusedOk = true;
    }
    const f = panes[focused];
    if (focusedOk && f.dungeon && f.model) deps.focusedResult(f.dungeon, f.model);
  }

  function payload(): SharePayload {
    const f = panes[focused].config;
    return {
      v: 1,
      a: f.algorithm,
      w: f.width,
      h: f.height,
      s: f.seed,
      g: f.params,
      p: f.post,
      cmp: 1,
      f: focused,
      b: paneToShare(panes[other(focused)].config),
    };
  }

  return {
    isActive,
    toggle,
    exit,
    restore,
    regenerateAll,
    redrawAll,
    rebuildOverlays,
    payload,
  };
}
