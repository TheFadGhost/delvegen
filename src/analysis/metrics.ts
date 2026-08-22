import type { DungeonData } from "../core/types.js";
import { bfsDistances } from "../core/geometry.js";
import { Tile } from "../core/tile.js";
import { labelRegions } from "./regions.js";

export interface DungeonMetrics {
  /** Rooms recorded by the generator that still contain floor. */
  roomCount: number;
  /** Mean w*h over recorded rooms (0 when there are none). */
  avgRoomSize: number;
  /** Corridor-ish tiles per room tile; null when no rooms exist. */
  corridorToRoomRatio: number | null;
  /** Walkable tiles with exactly one walkable neighbour. */
  deadEndCount: number;
  /** BFS shortest-path length entrance to exit in steps. */
  meanPathLength: number;
  /** Mean walkable-neighbour count over junctions (>=3 neighbours); null if none. */
  branchingFactor: number | null;
  /** Percentage of the map that is walkable. */
  openPct: number;
}

/**
 * Compute all documented metrics for a finished dungeon.
 *
 * Definitions (also used by the UI legend/labels):
 *  - room tile     : Tile.RoomFloor
 *  - corridor tile : Tile.CorridorFloor or Tile.Door
 *  - junction      : walkable tile with >= 3 walkable 4-neighbours
 *  - dead end      : walkable tile with exactly 1 walkable 4-neighbour
 *  - path length   : BFS shortest-path step count entrance -> exit
 */
export function computeMetrics(dungeon: DungeonData & { entrance?: { x: number; y: number }; exit?: { x: number; y: number } }): DungeonMetrics {
  const grid = dungeon.grid;
  const total = grid.width * grid.height;

  let roomTiles = 0;
  let corridorTiles = 0;
  let deadEnds = 0;
  let junctions = 0;
  let junctionDegreeSum = 0;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.get(x, y);
      if (t === Tile.Wall) continue;
      if (t === Tile.RoomFloor) roomTiles++;
      else corridorTiles++;

      let walkableNeighbors = 0;
      if (grid.walkableAt(x, y - 1)) walkableNeighbors++;
      if (grid.walkableAt(x + 1, y)) walkableNeighbors++;
      if (grid.walkableAt(x, y + 1)) walkableNeighbors++;
      if (grid.walkableAt(x - 1, y)) walkableNeighbors++;

      if (walkableNeighbors === 1) deadEnds++;
      if (walkableNeighbors >= 3) {
        junctions++;
        junctionDegreeSum += walkableNeighbors;
      }
    }
  }

  // Only count rooms that actually contributed floor to the final grid.
  let roomCount = 0;
  let roomAreaSum = 0;
  for (const r of dungeon.rooms) {
    roomCount++;
    roomAreaSum += r.w * r.h;
  }

  let pathLength = 0;
  if (dungeon.entrance && dungeon.exit) {
    const dist = bfsDistances(grid, [dungeon.entrance]);
    pathLength = dist[grid.index(dungeon.exit.x, dungeon.exit.y)] ?? 0;
  }

  return {
    roomCount,
    avgRoomSize: roomCount > 0 ? roomAreaSum / roomCount : 0,
    corridorToRoomRatio:
      roomTiles > 0 ? round(corridorTiles / roomTiles, 3) : null,
    deadEndCount: deadEnds,
    meanPathLength: pathLength,
    branchingFactor:
      junctions > 0 ? round(junctionDegreeSum / junctions, 3) : null,
    openPct: round(((roomTiles + corridorTiles) / total) * 100, 2),
  };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
