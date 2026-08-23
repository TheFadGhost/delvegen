/**
 * Toolbar export dropdown: PNG / JSON / ASCII downloads plus JSON import.
 * The PNG painter is a simple flat rasterizer at a fixed tile size using
 * theme tile tokens only (no gradients, no shadows).
 */

import { Tile } from "../core/tile.js";
import type { GeneratedDungeon } from "../core/types.js";
import {
  exportDungeonJson,
  importDungeonJson,
  type DungeonDataPlus,
} from "../export/json.js";
import { exportAscii } from "../export/ascii.js";
import type { TilePalette } from "./themes.js";

const PNG_TILE = 8;

export interface ExportContext {
  /** Current generated dungeon (null before first generation). */
  getDungeon(): GeneratedDungeon | null;
  getPalette(): TilePalette;
  getAlgorithmId(): string;
  /** Display an imported dungeon read-only; throws -> status shows the error. */
  showImported(data: DungeonDataPlus, filename: string): void;
  reportError(message: string): void;
}

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "map";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Flat full-map painter at PNG_TILE px per tile, theme tokens only. */
export function paintMapCanvas(d: GeneratedDungeon, pal: TilePalette): HTMLCanvasElement {
  const ts = PNG_TILE;
  const cv = document.createElement("canvas");
  cv.width = d.grid.width * ts;
  cv.height = d.grid.height * ts;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;

  // Backdrop = wall mass.
  ctx.fillStyle = pal.wall;
  ctx.fillRect(0, 0, cv.width, cv.height);

  const barTh = Math.max(1, Math.round(ts * 0.4));
  const barOff = Math.floor((ts - barTh) / 2);

  for (let y = 0; y < d.grid.height; y++) {
    for (let x = 0; x < d.grid.width; x++) {
      const t = d.grid.get(x, y);
      if (t === Tile.Wall) continue;
      if (
        (d.entrance.x === x && d.entrance.y === y) ||
        (d.exit.x === x && d.exit.y === y)
      ) {
        continue; // markers drawn after terrain
      }
      switch (t) {
        case Tile.RoomFloor:
          ctx.fillStyle = pal.room;
          break;
        case Tile.CorridorFloor:
          ctx.fillStyle = pal.corridor;
          break;
        case Tile.Door:
          ctx.fillStyle = pal.doorFill;
          break;
        default:
          continue;
      }
      ctx.fillRect(x * ts, y * ts, ts, ts);

      if (t === Tile.Door) {
        // Bar runs across the passage: horizontal when floors sit N/S.
        const n = d.grid.walkableAt(x, y - 1);
        const s = d.grid.walkableAt(x, y + 1);
        ctx.fillStyle = pal.doorBar;
        if (n || s) {
          ctx.fillRect(x * ts, y * ts + barOff, ts, barTh);
        } else {
          ctx.fillRect(x * ts + barOff, y * ts, barTh, ts);
        }
      }
    }
  }

  const drawRing = (pos: { x: number; y: number }) => {
    const cx = pos.x * ts + ts / 2;
    const cy = pos.y * ts + ts / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.34, 0, Math.PI * 2);
    ctx.strokeStyle = pal.entrance;
    ctx.lineWidth = Math.max(1.5, ts * 0.12);
    ctx.stroke();
  };
  const drawDiamond = (pos: { x: number; y: number }) => {
    const cx = pos.x * ts + ts / 2;
    const cy = pos.y * ts + ts / 2;
    const r = ts * 0.36;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.strokeStyle = pal.exit;
    ctx.lineWidth = Math.max(1.5, ts * 0.12);
    ctx.stroke();
  };
  drawRing(d.entrance);
  drawDiamond(d.exit);
  return cv;
}

function requireDungeon(ctx: ExportContext): GeneratedDungeon | null {
  const d = ctx.getDungeon();
  if (!d) ctx.reportError("nothing to export yet — generate a map first");
  return d;
}

function baseName(ctx: ExportContext, d: GeneratedDungeon): string {
  return `delvegen-${sanitizeFilenamePart(d.algorithm)}-${sanitizeFilenamePart(d.seed)}`;
}

export function setupExportMenu(
  wrap: HTMLElement,
  button: HTMLButtonElement,
  menu: HTMLElement,
  fileInput: HTMLInputElement,
  ctx: ExportContext,
): void {
  const close = () => {
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    menu.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
  };
  const toggle = () => {
    if (menu.classList.contains("hidden")) open();
    else close();
  };

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!wrap.contains(e.target as Node)) close();
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  menu.querySelector<HTMLButtonElement>("#export-png")?.addEventListener("click", () => {
    close();
    const d = requireDungeon(ctx);
    if (!d) return;
    const cv = paintMapCanvas(d, ctx.getPalette());
    cv.toBlob((blob) => {
      if (!blob) {
        ctx.reportError("PNG encoding failed");
        return;
      }
      downloadBlob(blob, `${baseName(ctx, d)}.png`);
    }, "image/png");
  });

  menu.querySelector<HTMLButtonElement>("#export-json")?.addEventListener("click", () => {
    close();
    const d = requireDungeon(ctx);
    if (!d) return;
    const json = JSON.stringify(exportDungeonJson(d), null, 1);
    downloadBlob(new Blob([json], { type: "application/json" }), `${baseName(ctx, d)}.json`);
  });

  menu.querySelector<HTMLButtonElement>("#export-ascii")?.addEventListener("click", () => {
    close();
    const d = requireDungeon(ctx);
    if (!d) return;
    downloadBlob(
      new Blob([exportAscii(d)], { type: "text/plain;charset=utf-8" }),
      `${baseName(ctx, d)}.txt`,
    );
  });

  menu.querySelector<HTMLButtonElement>("#import-json")?.addEventListener("click", () => {
    close();
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const text = await file.text();
      const data = importDungeonJson(JSON.parse(text));
      ctx.showImported(data, file.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.reportError(`import failed — ${msg}`);
    }
  });
}
