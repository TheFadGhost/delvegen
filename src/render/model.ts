import { isWalkable, type Tile } from "../core/tile.js";
import type { GeneratedDungeon } from "../core/types.js";
import { labelRegions } from "../analysis/regions.js";
import type { OverlayFlags, RenderModel } from "./renderer.js";

/** Derive everything the painter needs from a generated dungeon. */
export function buildRenderModel(
  dungeon: GeneratedDungeon,
  overlays: OverlayFlags,
): RenderModel {
  const grid = dungeon.grid;
  const w = grid.width;
  const h = grid.height;

  const deadEnds: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWalkable(grid.tiles[y * w + x] as Tile)) continue;
      let n = 0;
      if (grid.walkableAt(x, y - 1)) n++;
      if (grid.walkableAt(x + 1, y)) n++;
      if (grid.walkableAt(x, y + 1)) n++;
      if (grid.walkableAt(x - 1, y)) n++;
      if (n === 1) deadEnds.push(y * w + x);
    }
  }

  let regionLabels: Int32Array | null = null;
  if (overlays.unreachable) {
    regionLabels = labelRegions(grid).labels;
  }

  return {
    width: w,
    height: h,
    tiles: grid.tiles,
    entrance: dungeon.entrance,
    exit: dungeon.exit,
    deadEnds: Int32Array.from(deadEnds),
    regionLabels,
    overlays,
  };
}

/**
 * Painter-ready model for a single recorded generation frame. Analysis
 * overlays (entrance/exit markers, dead-end marks, region hatching) are
 * null during step-through — they only exist for the finished map.
 */
export function buildFrameModel(
  frameTiles: Uint8Array,
  width: number,
  height: number,
  overlays: OverlayFlags,
): RenderModel {
  return {
    width,
    height,
    tiles: frameTiles,
    entrance: null,
    exit: null,
    deadEnds: null,
    regionLabels: null,
    overlays,
  };
}
