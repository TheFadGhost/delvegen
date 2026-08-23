/**
 * Right-panel Distribution section: reruns the CURRENT algorithm + params
 * across 40 synthetic seeds ("sample-0".."sample-39") without frame
 * recording, chunked through setTimeout so the UI thread stays alive, then
 * renders three flat SVG histograms (10 buckets between observed min..max).
 *
 * Nothing is stored globally: all state lives in the closure. A run token
 * cancels any in-flight sampling when the user regenerates or starts a new
 * sample run.
 */

import { computeMetrics, generateDungeon } from "../index.js";
import type { PostPassConfig } from "../core/types.js";

export interface FixedConfig {
  algorithm: string;
  width: number;
  height: number;
  params: Record<string, unknown>;
  post: Record<string, unknown>;
}

export interface DistributionDeps {
  /** Snapshot of the config to hold fixed while seeds vary. */
  fixed(): FixedConfig;
}

const TOTAL = 40;
const CHUNK = 4;

export function setupDistribution(
  details: HTMLDetailsElement,
  deps: DistributionDeps,
): { cancel(): void } {
  details.textContent = "";

  const summary = document.createElement("summary");
  summary.className = "section-title";
  summary.textContent = "Distribution";

  const intro = document.createElement("p");
  intro.className = "dist-intro";
  intro.textContent = "fixed params, varying seed";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "sample-btn";
  btn.className = "wide-btn";
  btn.textContent = "Sample 40 seeds";

  const progress = document.createElement("div");
  progress.id = "dist-progress";
  progress.className = "dist-progress";
  progress.setAttribute("role", "status");

  const charts = document.createElement("div");
  charts.id = "dist-charts";
  charts.className = "dist-charts";

  details.append(summary, intro, btn, progress, charts);

  let token = 0;

  btn.addEventListener("click", () => {
    run(++token);
  });

  function cancel(): void {
    token++; // any in-flight batch loop sees the stale token and stops
  }

  function run(myToken: number): void {
    const fx = deps.fixed();
    const params = cloneData(fx.params);
    const post = cloneData(fx.post);
    const open: number[] = [];
    const path: number[] = [];
    const dead: number[] = [];

    charts.replaceChildren();
    progress.textContent = `sampling 0/${TOTAL}`;

    let i = 0;
    const step = (): void => {
      if (myToken !== token) return; // cancelled by regenerate / new run
      for (let k = 0; k < CHUNK && i < TOTAL; k++, i++) {
        try {
          const d = generateDungeon({
            algorithm: fx.algorithm,
            seed: `sample-${i}`,
            width: fx.width,
            height: fx.height,
            params: cloneData(params),
            post: cloneData(post) as Record<string, PostPassConfig>,
            recordFrames: false,
          });
          const m = computeMetrics(d);
          open.push(m.openPct);
          path.push(m.meanPathLength);
          dead.push(m.deadEndCount);
        } catch (err) {
          if (myToken !== token) return;
          progress.textContent =
            `failed at sample-${i}: ${err instanceof Error ? err.message : String(err)}`;
          return;
        }
      }
      if (myToken !== token) return;
      progress.textContent = `sampling ${i}/${TOTAL}`;
      if (i < TOTAL) window.setTimeout(step, 0);
      else finish(open, path, dead);
    };
    window.setTimeout(step, 0);
  }

  function finish(open: number[], path: number[], dead: number[]): void {
    progress.textContent = `${TOTAL} seeds sampled`;
    charts.replaceChildren(
      histBlock(open, "Open %"),
      histBlock(path, "Path length"),
      histBlock(dead, "Dead ends"),
    );
  }

  return { cancel };
}

/* ------------------------------------------------------------------ */
/* Histogram rendering                                                 */
/* ------------------------------------------------------------------ */

function cloneData<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

function histBlock(values: number[], title: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "hist";

  const t = document.createElement("div");
  t.className = "hist-title";
  t.textContent = title;

  const axis = document.createElement("div");
  axis.className = "hist-axis";
  const lo = document.createElement("span");
  const hi = document.createElement("span");
  lo.textContent = values.length ? fmt(Math.min(...values)) : "—";
  hi.textContent = values.length ? fmt(Math.max(...values)) : "—";
  axis.append(lo, hi);

  wrap.append(t, histogramSvg(values), axis);
  return wrap;
}

const NS = "http://www.w3.org/2000/svg";

function histogramSvg(values: number[]): SVGSVGElement {
  const W = 220;
  const H = 48;
  const TOP = 4;
  const BOTTOM = 44; // bars sit on this line

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "hist-svg");
  svg.setAttribute("aria-hidden", "true");

  const base = document.createElementNS(NS, "line");
  base.setAttribute("x1", "2");
  base.setAttribute("x2", String(W - 2));
  base.setAttribute("y1", "46.5");
  base.setAttribute("y2", "46.5");
  base.setAttribute("class", "base");
  svg.appendChild(base);

  if (values.length === 0) return svg;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const bins = new Array<number>(10).fill(0);
  for (const v of values) {
    let b = span > 0 ? Math.floor(((v - min) / span) * 10) : 0;
    if (b < 0) b = 0;
    if (b > 9) b = 9;
    bins[b]!++;
  }
  const peak = Math.max(...bins, 1);
  const pad = 2;
  const gap = 2;
  const bw = (W - pad * 2 - gap * 9) / 10;
  const plot = BOTTOM - TOP;

  bins.forEach((count, i) => {
    const h = (count / peak) * plot;
    if (h <= 0) return;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(pad + i * (bw + gap)));
    r.setAttribute("y", String(BOTTOM - h));
    r.setAttribute("width", String(bw));
    r.setAttribute("height", String(h));
    r.setAttribute("class", "bar");
    svg.appendChild(r);
  });
  return svg;
}
