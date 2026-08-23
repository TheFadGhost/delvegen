import { carveH, carveV, manhattan } from "../core/geometry.js";
import type { Pos } from "../core/grid.js";
import { labelRegions } from "../analysis/regions.js";
import type { PostPassDefinition } from "../core/types.js";

/**
 * Region connectivity repair.
 *
 * While more than one walkable region exists, the largest region (ties: lower
 * region id) is the main region. The closest main/foreign tile pair by
 * Manhattan distance (ties: first found scanning y then x) is joined with a
 * deterministic L-corridor — horizontal-first when |dx| >= |dy|, else
 * vertical-first. Every connection merges at least one region into main, so
 * the region count strictly decreases and the loop terminates.
 */
export const repairConnectivity: PostPassDefinition = {
  id: "repair",
  name: "Region connectivity repair",
  summary: "Joins disjoint walkable regions with L-corridors until one remains.",
  params: [],

  apply(dungeon, ctx) {
    const grid = dungeon.grid;
    let regions = labelRegions(grid);

    while (regions.count > 1) {
      const { labels, count } = regions;

      // Largest region is main; ties go to the lower region id.
      const sizes = new Array<number>(count).fill(0);
      for (const l of labels) if (l >= 0) sizes[l] += 1;
      let main = 0;
      for (let r = 1; r < count; r++) if (sizes[r] > sizes[main]) main = r;

      // Partition walkable tiles into main/foreign sets in scan order.
      const mainTiles: Pos[] = [];
      const foreignTiles: Pos[] = [];
      const foreignLabel: number[] = [];
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          const l = labels[grid.index(x, y)];
          if (l < 0) continue;
          if (l === main) {
            mainTiles.push({ x, y });
          } else {
            foreignTiles.push({ x, y });
            foreignLabel.push(l);
          }
        }
      }

      // Main-set extents power a safe lower-bound skip in the search below.
      let minX = Number.MAX_SAFE_INTEGER;
      let maxX = -Number.MAX_SAFE_INTEGER;
      let minY = Number.MAX_SAFE_INTEGER;
      let maxY = -Number.MAX_SAFE_INTEGER;
      for (const t of mainTiles) {
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
      }

      // Closest pair by Manhattan distance; strict improvement keeps the
      // first-found pair in scan order on ties.
      let bestD = Number.MAX_SAFE_INTEGER;
      let bestAi = 0;
      let bestBi = 0;
      for (let bi = 0; bi < foreignTiles.length; bi++) {
        const b = foreignTiles[bi] as Pos;
        const lowerBound =
          Math.max(minX - b.x, b.x - maxX, 0) + Math.max(minY - b.y, b.y - maxY, 0);
        if (lowerBound >= bestD) continue;
        for (let ai = 0; ai < mainTiles.length; ai++) {
          const d = manhattan(mainTiles[ai] as Pos, b);
          if (d < bestD) {
            bestD = d;
            bestAi = ai;
            bestBi = bi;
          }
        }
      }
      const a = mainTiles[bestAi] as Pos;
      const b = foreignTiles[bestBi] as Pos;

      // Deterministic L-shape: horizontal-first when |dx| >= |dy|.
      if (Math.abs(a.x - b.x) >= Math.abs(a.y - b.y)) {
        carveH(grid, a.x, b.x, a.y);
        carveV(grid, a.y, b.y, b.x);
      } else {
        carveV(grid, a.y, b.y, a.x);
        carveH(grid, a.x, b.x, b.y);
      }

      ctx.record(`connect region ${foreignLabel[bestBi]}`, dungeon);
      regions = labelRegions(grid);
    }
  },
};
