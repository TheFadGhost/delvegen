import { Tile } from "../core/tile.js";
import { DIRS_4 } from "../core/geometry.js";
import type { DungeonGrid, Pos } from "../core/grid.js";
import type { PostPassDefinition } from "../core/types.js";

function isRoomFloor(grid: DungeonGrid, x: number, y: number): boolean {
  return grid.inBounds(x, y) && grid.get(x, y) === Tile.RoomFloor;
}

/**
 * Door placement.
 *
 * A corridor tile is a door candidate when exactly one of its 4-neighbours is
 * room floor, the neighbour opposite that room tile is NOT walkable (the
 * passage does not continue straight through), and neither perpendicular
 * neighbour is room floor — so doors sit in corridor mouths at room
 * boundaries, never inside rooms. Candidates are scanned row-major; each
 * becomes a Door with probability doorChance via ctx.rng.
 */
export const placeDoors: PostPassDefinition = {
  id: "doors",
  name: "Door placement",
  summary: "Drops doors into corridor mouths where passages meet rooms.",
  params: [
    {
      key: "doorChance",
      label: "Door chance %",
      description: "Probability that each corridor-mouth candidate gets a door.",
      type: "float",
      min: 0,
      max: 100,
      step: 5,
      default: 70,
    },
  ],

  apply(dungeon, ctx) {
    const grid = dungeon.grid;
    const p = ctx.num("doorChance") / 100;
    let placed = 0;

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) !== Tile.CorridorFloor) continue;

        // Exactly one room-floor neighbour identifies the room side.
        let roomDir = -1;
        let roomNeighbours = 0;
        for (let d = 0; d < DIRS_4.length; d++) {
          const dir = DIRS_4[d] as Pos;
          if (isRoomFloor(grid, x + dir.x, y + dir.y)) {
            roomDir = d;
            roomNeighbours += 1;
          }
        }
        if (roomNeighbours !== 1) continue;

        const opp = DIRS_4[(roomDir + 2) % 4] as Pos;
        const cw = DIRS_4[(roomDir + 1) % 4] as Pos;
        const ccw = DIRS_4[(roomDir + 3) % 4] as Pos;
        if (grid.walkableAt(x + opp.x, y + opp.y)) continue;
        if (isRoomFloor(grid, x + cw.x, y + cw.y)) continue;
        if (isRoomFloor(grid, x + ccw.x, y + ccw.y)) continue;

        if (ctx.rng.chance(p)) {
          grid.set(x, y, Tile.Door);
          placed += 1;
          if (placed % 25 === 0) ctx.record(`doors placed (${placed})`, dungeon);
        }
      }
    }

    ctx.record(`doors placed (${placed})`, dungeon);
  },
};
