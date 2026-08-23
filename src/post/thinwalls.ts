import { Tile } from "../core/tile.js";
import { DIRS_4 } from "../core/geometry.js";
import type { Pos } from "../core/grid.js";
import type { PostPassDefinition } from "../core/types.js";

/**
 * Wall thinning.
 *
 * Flood-fills 4-connected wall components that never touch the outer border
 * ring. A component of at most `minCluster` tiles that is fully enclosed by
 * walkable tiles (every 8-neighbour of every component tile is walkable) is
 * melted into corridor floor — stray wall pixels inside caves disappear while
 * the map edge can never be opened. Bigger or leaky clusters stay rock.
 */
export const thinWalls: PostPassDefinition = {
  id: "thin",
  name: "Wall thinning",
  summary: "Melts tiny fully-enclosed wall specks into floor; borders stay solid.",
  params: [
    {
      key: "minCluster",
      label: "Speck size limit",
      description: "Wall clusters up to this size (enclosed, off-border) become floor.",
      type: "int",
      min: 1,
      max: 20,
      step: 1,
      default: 2,
    },
  ],

  apply(dungeon, ctx) {
    const grid = dungeon.grid;
    const limit = ctx.num("minCluster");
    const seen = new Uint8Array(grid.width * grid.height);
    let removed = 0;

    for (let y = 1; y < grid.height - 1; y++) {
      for (let x = 1; x < grid.width - 1; x++) {
        if (seen[grid.index(x, y)] !== 0) continue;
        if (grid.get(x, y) !== Tile.Wall) continue;

        // Flood the wall component from this seed.
        const comp: Pos[] = [{ x, y }];
        seen[grid.index(x, y)] = 1;
        let head = 0;
        let touchesBorder = false;
        while (head < comp.length) {
          const c = comp[head++] as Pos;
          if (c.x === 0 || c.y === 0 || c.x === grid.width - 1 || c.y === grid.height - 1) {
            touchesBorder = true;
          }
          for (const dir of DIRS_4) {
            const nx = c.x + dir.x;
            const ny = c.y + dir.y;
            if (!grid.inBounds(nx, ny)) continue;
            const ni = grid.index(nx, ny);
            if (seen[ni] !== 0 || grid.get(nx, ny) !== Tile.Wall) continue;
            seen[ni] = 1;
            comp.push({ x: nx, y: ny });
          }
        }
        if (touchesBorder || comp.length > limit) continue;

        // Fully enclosed: every boundary tile outside the component (the
        // 8-neighbourhood minus fellow members) must be walkable.
        const members = new Set(comp.map((c) => grid.index(c.x, c.y)));
        let enclosed = true;
        outer: for (const c of comp) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (members.has(grid.index(c.x + dx, c.y + dy))) continue;
              if (!grid.walkableAt(c.x + dx, c.y + dy)) {
                enclosed = false;
                break outer;
              }
            }
          }
        }
        if (!enclosed) continue;

        for (const c of comp) grid.set(c.x, c.y, Tile.CorridorFloor);
        removed += comp.length;
      }
    }

    ctx.record(`removed ${removed} wall specks`, dungeon);
  },
};
