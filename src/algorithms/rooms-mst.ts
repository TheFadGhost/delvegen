import { DungeonGrid, type RoomRect } from "../core/grid.js";
import { Tile } from "../core/tile.js";
import { ValidationError } from "../core/errors.js";
import { carveCorridorL, manhattan, centerOf } from "../core/geometry.js";
import type { GenerationContext, GeneratorDefinition } from "../core/types.js";

/**
 * Random rooms + Prim minimum spanning tree.
 *
 * Rooms are rejection-placed at random sizes and positions with a one-tile
 * moat between neighbours. Prim's algorithm then grows a minimum spanning
 * tree over room centres using Manhattan distance (ties broken toward lower
 * room ids), and each tree edge becomes an L-corridor, so the map is fully
 * connected by construction. A slice of the remaining short non-tree edges is
 * finally added back as extra corridors to create loops.
 *
 * Produces: scattered rectangular rooms with tree-shaped corridors plus a
 * tunable sprinkle of shortcut loops.
 */
export const roomsMst: GeneratorDefinition = {
  id: "rooms-mst",
  name: "Rooms + MST",
  summary: "Scattered non-overlapping rooms linked by a minimum spanning tree.",
  technique:
    "Rooms are placed by rejection sampling: each attempt rolls a random size and top-left " +
    "corner that keeps a one-tile wall border, and accepts only when the candidate inflated " +
    "by one tile overlaps no existing room; placement stops when the quota or the attempt " +
    "budget runs out. Prim's algorithm then grows a minimum spanning tree over the room " +
    "centres weighted by Manhattan distance, preferring lower-id rooms on equal cost so the " +
    "tree is deterministic. Every spanning-tree edge is carved as an L-corridor, which alone " +
    "guarantees full connectivity. Finally, leftover non-tree edges are sorted by length " +
    "(then id order) and the shortest Loop edge % of them are carved too, adding cycles for " +
    "less tree-like navigation.",
  params: [
    {
      key: "roomCount",
      label: "Room count",
      description: "Number of rooms to place before connecting them.",
      type: "int",
      min: 0,
      max: 60,
      step: 1,
      default: 12,
    },
    {
      key: "roomMinSize",
      label: "Room min size",
      description: "Lower bound of each room's width and height.",
      type: "int",
      min: 3,
      max: 10,
      step: 1,
      default: 4,
    },
    {
      key: "roomMaxSize",
      label: "Room max size",
      description: "Upper bound of each room's width and height.",
      type: "int",
      min: 4,
      max: 24,
      step: 1,
      default: 9,
    },
    {
      key: "placementAttempts",
      label: "Placement attempts",
      description: "Total placement rolls before giving up on filling the quota.",
      type: "int",
      min: 50,
      max: 2000,
      step: 1,
      default: 400,
    },
    {
      key: "corridorWidth",
      label: "Corridor width",
      description: "Thickness of connecting corridors in tiles.",
      type: "int",
      min: 1,
      max: 3,
      step: 1,
      default: 1,
    },
    {
      key: "loopEdgePct",
      label: "Loop edge %",
      description: "Percentage of leftover short edges added as loop corridors.",
      type: "float",
      min: 0,
      max: 100,
      step: 5,
      default: 15,
    },
  ],

  validate(width, height, p) {
    const roomMin = p["roomMinSize"] as number;
    const roomMax = p["roomMaxSize"] as number;
    const corridorWidth = p["corridorWidth"] as number;
    const sizeCap = Math.min(width, height) - 4;
    if (roomMax > sizeCap) {
      throw new ValidationError(
        `Room max size ${roomMax} exceeds ${sizeCap}, the largest room that fits ` +
          `${width}x${height} with a wall border; lower "Room max size" (min 4) or enlarge ` +
          `the grid.`,
      );
    }
    if (corridorWidth >= roomMin) {
      throw new ValidationError(
        `Corridor width ${corridorWidth} must stay below Room min size ${roomMin} ` +
          `(valid 1-${roomMin - 1}) or corridors would swallow whole rooms.`,
      );
    }
  },

  generate(ctx: GenerationContext) {
    const width = ctx.width;
    const height = ctx.height;
    const grid = new DungeonGrid(width, height, Tile.Wall);
    const rooms: RoomRect[] = [];

    const roomCount = ctx.num("roomCount");
    const roomMin = ctx.num("roomMinSize");
    const roomMax = ctx.num("roomMaxSize");
    const placementAttempts = ctx.num("placementAttempts");
    const corridorWidth = ctx.num("corridorWidth");
    const loopEdgePct = ctx.num("loopEdgePct");

    /* ---------------------------------------------------------------- */
    /* Phase 1: rejection-place rooms with a one-tile moat               */
    /* ---------------------------------------------------------------- */

    /** True when the candidate inflated by 1 tile touches an existing room. */
    const conflicts = (x: number, y: number, w: number, h: number): boolean =>
      rooms.some(
        (r) => x - 1 < r.x + r.w && x + w + 1 > r.x && y - 1 < r.y + r.h && y + h + 1 > r.y,
      );

    let attempts = 0;
    while (rooms.length < roomCount && attempts < placementAttempts) {
      attempts++;
      const wHi = Math.max(roomMin, Math.min(roomMax, width - 2));
      const hHi = Math.max(roomMin, Math.min(roomMax, height - 2));
      const w = Math.min(width - 2, ctx.rng.int(roomMin, wHi));
      const h = Math.min(height - 2, ctx.rng.int(roomMin, hHi));
      const x = ctx.rng.int(1, width - 1 - w);
      const y = ctx.rng.int(1, height - 1 - h);
      if (conflicts(x, y, w, h)) continue;

      grid.fillRect(x, y, w, h, Tile.RoomFloor);
      rooms.push({ id: rooms.length + 1, x, y, w, h });
      ctx.record(`place room ${rooms.length} (attempt ${attempts})`, grid, rooms);
    }

    if (rooms.length === 0) {
      // Deliberately a plain Error: validate() passes for these inputs, the
      // pipeline treats it like any other failed generation attempt.
      throw new Error("rooms-mst produced no rooms");
    }

    /* ---------------------------------------------------------------- */
    /* Phase 2: Prim MST over Manhattan centre distances                 */
    /* ---------------------------------------------------------------- */

    const centers = rooms.map(centerOf);
    const bestCost = new Array<number>(rooms.length).fill(Infinity);
    const bestFrom = new Array<number>(rooms.length).fill(-1);
    const inTree = new Array<boolean>(rooms.length).fill(false);
    const treeEdges: Array<[number, number]> = [];
    bestCost[0] = 0;

    for (let grown = 0; grown < rooms.length; grown++) {
      // Cheapest frontier room wins; strict < keeps the lower id on ties.
      let u = -1;
      for (let i = 0; i < rooms.length; i++) {
        if (!inTree[i] && (u === -1 || bestCost[i] < bestCost[u])) u = i;
      }
      inTree[u] = true;
      if (bestFrom[u] >= 0) {
        treeEdges.push([Math.min(u, bestFrom[u]), Math.max(u, bestFrom[u])]);
      }
      for (let v = 0; v < rooms.length; v++) {
        if (inTree[v]) continue;
        const d = manhattan(centers[u], centers[v]);
        if (d < bestCost[v] || (d === bestCost[v] && bestFrom[v] >= 0 && u < bestFrom[v])) {
          bestCost[v] = d;
          bestFrom[v] = u;
        }
      }
    }

    ctx.record("spanning tree complete", grid, rooms);

    /* ---------------------------------------------------------------- */
    /* Phase 3: carve one L-corridor per spanning-tree edge              */
    /* ---------------------------------------------------------------- */

    for (const [a, b] of treeEdges) {
      carveCorridorL(grid, centers[a], centers[b], ctx.rng, { width: corridorWidth });
    }

    /* ---------------------------------------------------------------- */
    /* Phase 4: loop edges — shortest non-tree links first               */
    /* ---------------------------------------------------------------- */

    const treeKey = new Set(treeEdges.map(([a, b]) => a * rooms.length + b));
    const candidates: Array<{ a: number; b: number; d: number }> = [];
    for (let a = 0; a < rooms.length; a++) {
      for (let b = a + 1; b < rooms.length; b++) {
        if (!treeKey.has(a * rooms.length + b)) {
          candidates.push({ a, b, d: manhattan(centers[a], centers[b]) });
        }
      }
    }
    candidates.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);

    const loopBudget = Math.ceil((candidates.length * loopEdgePct) / 100);
    const loopEvery = Math.max(1, Math.ceil(loopBudget / 150));
    let loopsAdded = 0;
    for (const edge of candidates) {
      if (loopsAdded >= loopBudget) break;
      loopsAdded++;
      carveCorridorL(grid, centers[edge.a], centers[edge.b], ctx.rng, { width: corridorWidth });
      if (loopsAdded % loopEvery === 0 || loopsAdded === loopBudget) {
        ctx.record(`add loop edge ${loopsAdded}`, grid, rooms);
      }
    }

    return {
      grid,
      rooms,
      meta: {
        roomsPlaced: rooms.length,
        attemptsUsed: attempts,
        treeEdges: treeEdges.length,
        loopEdges: loopsAdded,
      },
    };
  },
};
