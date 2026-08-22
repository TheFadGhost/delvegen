import type { TilePalette } from "../ui/themes.js";
import { Tile, isWalkable } from "../core/tile.js";
import type { Pos } from "../core/grid.js";

export interface OverlayFlags {
  doors: boolean;
  deadEnds: boolean;
  unreachable: boolean;
  markers: boolean;
}

export const DEFAULT_OVERLAYS: OverlayFlags = {
  doors: true,
  deadEnds: true,
  unreachable: true,
  markers: true,
};

/** What the painter draws. Kept plain so the CLI/PNG path can reuse it. */
export interface RenderModel {
  width: number;
  height: number;
  tiles: Uint8Array;
  entrance: Pos | null;
  exit: Pos | null;
  /** Walkable tiles with exactly one walkable neighbour (indices). */
  deadEnds: Int32Array | null;
  /** Per-tile region labels, -1 = wall; used to tint unreachable regions. */
  regionLabels: Int32Array | null;
  overlays: OverlayFlags;
}

export interface Camera {
  /** Camera top-left in world tile coordinates (float). */
  x: number;
  y: number;
  /** CSS pixels per tile. */
  zoom: number;
}

export class MapRenderer {
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    public camera: Camera,
  ) {}

  fit(model: RenderModel, viewportW: number, viewportH: number): void {
    const pad = 24;
    const zx = (viewportW - pad * 2) / model.width;
    const zy = (viewportH - pad * 2) / model.height;
    this.camera.zoom = Math.max(1, Math.min(zx, zy));
    this.camera.x = model.width / 2 - viewportW / (2 * this.camera.zoom);
    this.camera.y = model.height / 2 - viewportH / (2 * this.camera.zoom);
  }

  zoomAt(factor: number, screenX: number, screenY: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.camera.zoom = Math.min(32, Math.max(1, this.camera.zoom * factor));
    // Keep the world point under the cursor fixed.
    this.camera.x = before.x - screenX / this.camera.zoom;
    this.camera.y = before.y - screenY / this.camera.zoom;
  }

  panBy(dxTiles: number, dyTiles: number): void {
    this.camera.x += dxTiles;
    this.camera.y += dyTiles;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / this.camera.zoom + this.camera.x, y: sy / this.camera.zoom + this.camera.y };
  }

  clampCamera(model: RenderModel, viewportW: number, viewportH: number): void {
    const marginX = viewportW / this.camera.zoom / 2;
    const marginY = viewportH / this.camera.zoom / 2;
    this.camera.x = Math.min(model.width + marginX, Math.max(-marginX, this.camera.x));
    this.camera.y = Math.min(model.height + marginY, Math.max(-marginY, this.camera.y));
  }

  draw(
    model: RenderModel | null,
    palette: TilePalette,
    viewportW: number,
    viewportH: number,
  ): void {
    const cv = this.canvas;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const devW = Math.round(viewportW * this.dpr);
    const devH = Math.round(viewportH * this.dpr);
    if (cv.width !== devW || cv.height !== devH) {
      cv.width = devW;
      cv.height = devH;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.wall; // backdrop matches the wall mass
    ctx.fillRect(0, 0, devW, devH);

    if (!model) return;

    const scale = this.camera.zoom * this.dpr;
    // Snap camera origin to whole device pixels for crisp tiles.
    const ox = Math.round(-this.camera.x * scale);
    const oy = Math.round(-this.camera.y * scale);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);

    const x0 = Math.max(0, Math.floor(this.camera.x));
    const y0 = Math.max(0, Math.floor(this.camera.y));
    const x1 = Math.min(model.width, Math.ceil(this.camera.x + viewportW / this.camera.zoom) + 1);
    const y1 = Math.min(model.height, Math.ceil(this.camera.y + viewportH / this.camera.zoom) + 1);

    const pxPerTileDev = scale; // device px per tile
    const showDetail = pxPerTileDev >= 6;
    const showDot = pxPerTileDev >= 12;

    // Pass 1: tile fills.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = model.tiles[y * model.width + x] as number;
        switch (t) {
          case Tile.RoomFloor:
            ctx.fillStyle = palette.room;
            break;
          case Tile.CorridorFloor:
            ctx.fillStyle = palette.corridor;
            break;
          case Tile.Door:
            ctx.fillStyle = model.overlays.doors ? palette.doorFill : palette.corridor;
            break;
          default:
            continue; // wall is already the backdrop
        }
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Pass 2: detail marks.
    if (showDetail) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const t = model.tiles[y * model.width + x] as number;
          if (t === Tile.Wall && showDetail) {
            // Top-edge highlight only when open floor sits below.
            if (
              y + 1 < model.height &&
              (model.tiles[(y + 1) * model.width + x] as number) !== Tile.Wall
            ) {
              ctx.fillStyle = palette.wallEdge;
              ctx.fillRect(x, y + 1 - 0.18, 1, 0.18);
            }
          } else if (t === Tile.Door && model.overlays.doors) {
            drawDoorBar(ctx, model, x, y, palette);
          }
        }
      }
      if (showDot && model.overlays.deadEnds && model.deadEnds) {
        ctx.fillStyle = palette.markerInk;
        for (let i = 0; i < model.deadEnds.length; i++) {
          const idx = model.deadEnds[i] as number;
          const dx = idx % model.width;
          const dy = (idx / model.width) | 0;
          if (dx < x0 || dy < y0 || dx >= x1 || dy >= y1) continue;
          ctx.fillRect(dx + 0.4, dy + 0.4, 0.2, 0.2);
        }
      }
    }

    // Pass 3: unreachable hatching.
    if (model.overlays.unreachable && model.regionLabels) {
      drawUnreachable(ctx, model, palette, x0, y0, x1, y1);
    }

    // Pass 4: entrance/exit markers (shape-coded).
    if (model.overlays.markers) {
      const lw = Math.max(0.15, 2.5 / this.dpr / this.camera.zoom);
      if (model.entrance) {
        ctx.beginPath();
        ctx.arc(model.entrance.x + 0.5, model.entrance.y + 0.5, 0.34, 0, Math.PI * 2);
        ctx.strokeStyle = palette.entrance;
        ctx.lineWidth = lw * 1.4;
        ctx.stroke();
      }
      if (model.exit) {
        const cx = model.exit.x + 0.5;
        const cy = model.exit.y + 0.5;
        const r = 0.36;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.strokeStyle = palette.exit;
        ctx.lineWidth = lw * 1.4;
        ctx.stroke();
      }
    }
  }
}

function drawDoorBar(
  ctx: CanvasRenderingContext2D,
  model: RenderModel,
  x: number,
  y: number,
  palette: TilePalette,
): void {
  // Bar orientation: perpendicular to the opening. If floors sit N/S of the
  // door, the bar runs E/W... actually a door blocks passage, so the bar is
  // parallel to the wall line it sits in: horizontal bar when passage is
  // vertical (floors above/below), vertical bar when passage is horizontal.
  const n =
    y - 1 >= 0 && isWalkable((model.tiles[(y - 1) * model.width + x] ?? 0) as Tile);
  const s =
    y + 1 < model.height &&
    isWalkable((model.tiles[(y + 1) * model.width + x] ?? 0) as Tile);
  ctx.fillStyle = palette.doorBar;
  if (n || s) {
    ctx.fillRect(x, y + 0.3, 1, 0.4);
  } else {
    ctx.fillRect(x + 0.3, y, 0.4, 1);
  }
}

function drawUnreachable(
  ctx: CanvasRenderingContext2D,
  model: RenderModel,
  palette: TilePalette,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  if (!model.regionLabels || !model.entrance) return;
  const mainLabel =
    model.regionLabels[model.entrance.y * model.width + model.entrance.x] ?? -1;
  ctx.save();
  ctx.fillStyle = palette.unreachableTint;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * model.width + x;
      const label = model.regionLabels[idx] as number;
      if (label === -1 || label === mainLabel) continue;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 1;
    }
  }
  ctx.strokeStyle = palette.unreachableHatch;
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * model.width + x;
      const label = model.regionLabels[idx] as number;
      if (label === -1 || label === mainLabel) continue;
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + 1, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}
