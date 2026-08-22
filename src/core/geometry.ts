import { DungeonGrid, type Pos } from "./grid.js";
import { Tile } from "./tile.js";
import type { Rng } from "./rng.js";

/** 4-connected neighbour offsets in stable order: N, E, S, W. */
export const DIRS_4: ReadonlyArray<Pos> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function centerOf(rect: { x: number; y: number; w: number; h: number }): Pos {
  return { x: Math.floor(rect.x + rect.w / 2), y: Math.floor(rect.y + rect.h / 2) };
}

/**
 * BFS distances over walkable tiles from every position in `starts`.
 * Returns an Int32Array of width*height with -1 for unreachable/wall tiles.
 */
export function bfsDistances(grid: DungeonGrid, starts: Pos[]): Int32Array {
  const dist = new Int32Array(grid.width * grid.height).fill(-1);
  const queue = new Int32Array(grid.width * grid.height);
  let head = 0;
  let tail = 0;
  for (const s of starts) {
    if (!grid.walkableAt(s.x, s.y)) continue;
    const idx = grid.index(s.x, s.y);
    if (dist[idx] !== -1) continue;
    dist[idx] = 0;
    queue[tail++] = idx;
  }
  while (head < tail) {
    const idx = queue[head++] as number;
    const x = idx % grid.width;
    const y = Math.floor(idx / grid.width);
    const d = dist[idx] as number + 1;
    for (const dir of DIRS_4) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (!grid.inBounds(nx, ny)) continue;
      const nIdx = ny * grid.width + nx;
      if (dist[nIdx] !== -1 || !grid.walkableAt(nx, ny)) continue;
      dist[nIdx] = d;
      queue[tail++] = nIdx;
    }
  }
  return dist;
}

/**
 * Deterministic farthest-pair selection among walkable tiles:
 * BFS from the first walkable tile in scan order to find A (max distance,
 * ties broken by lowest scan order), then BFS from A to find B the same way.
 */
export function farthestPair(grid: DungeonGrid): [Pos, Pos] | null {
  let first: Pos | null = null;
  outer: for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.walkableAt(x, y)) {
        first = { x, y };
        break outer;
      }
    }
  }
  if (!first) return null;
  const a = farthestFrom(grid, bfsDistances(grid, [first]));
  if (!a) return null;
  const b = farthestFrom(grid, bfsDistances(grid, [a]));
  if (!b) return null;
  return [a, b];
}

function farthestFrom(grid: DungeonGrid, dist: Int32Array): Pos | null {
  let bestD = -1;
  let bestIdx = -1;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i] as number;
    if (d > bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return { x: bestIdx % grid.width, y: Math.floor(bestIdx / grid.width) };
}

export interface CarveOptions {
  tile?: Tile;
  /** Corridor thickness (1 = single tile). */
  width?: number;
}

/** Carve a straight horizontal line, clamped to the grid. */
export function carveH(
  grid: DungeonGrid,
  x0: number,
  x1: number,
  y: number,
  opts: CarveOptions = {},
): void {
  const t = opts.tile ?? Tile.CorridorFloor;
  const w = Math.max(1, opts.width ?? 1);
  const from = Math.min(x0, x1);
  const to = Math.max(x0, x1);
  grid.fillRect(from, y, to - from + 1, w, t);
}

/** Carve a straight vertical line, clamped to the grid. */
export function carveV(
  grid: DungeonGrid,
  y0: number,
  y1: number,
  x: number,
  opts: CarveOptions = {},
): void {
  const t = opts.tile ?? Tile.CorridorFloor;
  const w = Math.max(1, opts.width ?? 1);
  const from = Math.min(y0, y1);
  const to = Math.max(y0, y1);
  grid.fillRect(x, from, w, to - from + 1, t);
}

/**
 * L-shaped corridor between two points. The elbow order is randomised by
 * `rng`, so the same endpoints can produce either bend direction.
 */
export function carveCorridorL(
  grid: DungeonGrid,
  a: Pos,
  b: Pos,
  rng: Rng,
  opts: CarveOptions = {},
): void {
  const horizontalFirst = rng.chance(0.5);
  if (horizontalFirst) {
    carveH(grid, a.x, b.x, a.y, opts);
    carveV(grid, a.y, b.y, b.x, opts);
  } else {
    carveV(grid, a.y, b.y, a.x, opts);
    carveH(grid, a.x, b.x, b.y, opts);
  }
}
