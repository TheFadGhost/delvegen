import { Tile } from "../core/tile.js";
import { DIRS_4 } from "../core/geometry.js";
import type { Pos } from "../core/grid.js";
import type { PostPassDefinition } from "../core/types.js";

/**
 * Dead-end pruning.
 *
 * A corridor or door tile with exactly one walkable 4-neighbour is a dead
 * end. Each sweep collects every dead end, then removes them all
 * simultaneously — removing leaves never disconnects the rest of the map.
 * Room floors are never pruned, so rooms survive even when fully boxed in.
 */
export const pruneDeadEnds: PostPassDefinition = {
  id: "prune",
  name: "Dead-end pruning",
  summary: "Trims corridor/door dead ends sweep by sweep. Rooms stay untouched.",
  params: [
    {
      key: "pruneDepth",
      label: "Prune depth",
      description: "Maximum number of trimming sweeps (0 disables).",
      type: "int",
      min: 0,
      max: 40,
      step: 1,
      default: 6,
    },
  ],

  apply(dungeon, ctx) {
    const grid = dungeon.grid;
    const depth = ctx.num("pruneDepth");

    for (let k = 1; k <= depth; k++) {
      // Collect first, remove after: simultaneous removal keeps connectivity.
      const doomed: Pos[] = [];
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          const t = grid.get(x, y);
          if (t !== Tile.CorridorFloor && t !== Tile.Door) continue;
          let walkableNeighbours = 0;
          for (const dir of DIRS_4) {
            if (grid.walkableAt(x + dir.x, y + dir.y)) walkableNeighbours += 1;
          }
          if (walkableNeighbours === 1) doomed.push({ x, y });
        }
      }
      if (doomed.length === 0) break;
      for (const p of doomed) grid.set(p.x, p.y, Tile.Wall);
      ctx.record(`prune pass ${k} (removed ${doomed.length})`, dungeon);
    }
  },
};
