import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DungeonGrid, Tile, GenerationError } from "../src/index.js";
import { computeMetrics } from "../src/analysis/metrics.js";
import { labelRegions } from "../src/analysis/regions.js";
import { farthestPair } from "../src/core/geometry.js";
import { verifyFullyConnected } from "../src/core/generate.js";
import type { DungeonData } from "../src/core/types.js";
import type { GeneratedDungeon } from "../src/core/types.js";

/** Fixture (a): 9x9 map, one-tile ring corridor along the border, interior solid rock. */
function ringGrid(): DungeonGrid {
  const g = new DungeonGrid(9, 9, Tile.Wall);
  for (let x = 0; x < 9; x++) {
    g.set(x, 0, Tile.CorridorFloor);
    g.set(x, 8, Tile.CorridorFloor);
  }
  for (let y = 0; y < 9; y++) {
    g.set(0, y, Tile.CorridorFloor);
    g.set(8, y, Tile.CorridorFloor);
  }
  return g;
}

/** Fixture (b): 22x5 map, straight one-tile corridor 20 tiles long. */
function corridorGrid(): DungeonGrid {
  const g = new DungeonGrid(22, 5, Tile.Wall);
  for (let x = 1; x <= 20; x++) g.set(x, 2, Tile.CorridorFloor);
  return g;
}

/** Fixture (c): 11x5 map, T junction: horizontal arm + one downward stub. */
function tJunctionGrid(): DungeonGrid {
  const g = new DungeonGrid(11, 5, Tile.Wall);
  for (let x = 1; x <= 9; x++) g.set(x, 2, Tile.CorridorFloor);
  g.set(5, 3, Tile.CorridorFloor);
  g.set(5, 4, Tile.CorridorFloor);
  return g;
}

function dataOf(
  grid: DungeonGrid,
  extra?: Partial<GeneratedDungeon>,
): DungeonData & Partial<GeneratedDungeon> {
  const pair = farthestPair(grid);
  return {
    grid,
    rooms: [],
    meta: {},
    algorithm: "fixture",
    seed: "fixture",
    entrance: pair ? pair[0] : undefined,
    exit: pair ? pair[1] : undefined,
    ...extra,
  };
}

describe("computeMetrics on hand-built fixtures", () => {
  it("ring corridor: no dead ends, exact openPct, perimeter-half path length", () => {
    const grid = ringGrid();
    // Hand count: ring has 9*4 - 4 corners counted twice = 32 open tiles of 81 total.
    const dungeon = dataOf(grid);
    const m = computeMetrics(dungeon);

    assert.strictEqual(m.deadEndCount, 0, "every ring tile has exactly 2 walkable neighbours");
    assert.strictEqual(m.openPct, 39.51, "32/81 = 39.506... -> 39.51");
    assert.strictEqual(m.branchingFactor, null, "no tile on a simple ring has >=3 neighbours");

    // Farthest pair on a 32-tile ring sits diametrically opposite:
    // BFS from the first tile (0,0) finds (8,8), and back again.
    assert.deepStrictEqual(dungeon.entrance, { x: 8, y: 8 });
    assert.deepStrictEqual(dungeon.exit, { x: 0, y: 0 });
    assert.strictEqual(m.meanPathLength, 16, "half the ring perimeter is 16 steps");

    assert.strictEqual(m.roomCount, 0);
    assert.strictEqual(m.avgRoomSize, 0);
    assert.strictEqual(m.corridorToRoomRatio, null);
  });

  it("straight 20-tile corridor: two dead ends, path length 19, no junctions", () => {
    const grid = corridorGrid();
    const m = computeMetrics(dataOf(grid));

    assert.strictEqual(m.deadEndCount, 2, "both corridor ends are dead ends");
    assert.strictEqual(m.meanPathLength, 19, "20 tiles -> 19 steps end to end");
    assert.strictEqual(m.branchingFactor, null);
    assert.strictEqual(m.openPct, 18.18, "20/110 = 18.1818... -> 18.18");
  });

  it("T junction: branchingFactor is exactly degreeSum/junctions = 3", () => {
    const grid = tJunctionGrid();
    const m = computeMetrics(dataOf(grid));

    // Exactly one junction: (5,2) with neighbours (4,2), (6,2), (5,3) -> degree 3.
    // Every other walkable tile has <=2 walkable neighbours, so 3/1 = 3.
    assert.strictEqual(m.branchingFactor, 3);
    assert.strictEqual(m.deadEndCount, 3, "arms end at (1,2), (9,2) and the stub tip (5,4)");
    assert.strictEqual(m.meanPathLength, 8, "(9,2) to (1,2) across the horizontal arm");
  });

  it("rooms-style fixture: avgRoomSize and corridorToRoomRatio match hand counts", () => {
    // 12x10 map. Room A (1,1)-(4,3) = 12 room tiles; Room B (8,6)-(10,7) = 6.
    const grid = new DungeonGrid(12, 10, Tile.Wall);
    grid.fillRect(1, 1, 4, 3, Tile.RoomFloor);
    grid.fillRect(8, 6, 3, 2, Tile.RoomFloor);
    // L corridor (horizontal-first) from A's right edge to B's top edge:
    // fills (5,2)..(8,2) then (8,3)..(8,5); endpoints land on existing floors.
    for (let x = 5; x <= 8; x++) grid.set(x, 2, Tile.CorridorFloor);
    for (let y = 3; y <= 5; y++) grid.set(8, y, Tile.CorridorFloor);

    // Hand count: roomTiles = 12 + 6 = 18; corridorTiles = 4 + 3 = 7.
    const dungeon: DungeonData = {
      grid,
      rooms: [
        { id: 1, x: 1, y: 1, w: 4, h: 3 },
        { id: 2, x: 8, y: 6, w: 3, h: 2 },
      ],
      meta: {},
    };
    const m = computeMetrics(dungeon);

    assert.strictEqual(m.roomCount, 2);
    assert.strictEqual(m.avgRoomSize, 9, "(12 + 6) / 2 rooms = 9");
    assert.strictEqual(m.corridorToRoomRatio, 0.389, "7 corridor tiles / 18 room tiles = 0.3888... -> 0.389");
    assert.strictEqual(m.openPct, 20.83, "25 walkable / 120 total = 20.8333... -> 20.83");
  });

  it("unreachable second pocket makes verifyFullyConnected throw GenerationError", () => {
    const grid = new DungeonGrid(10, 6, Tile.Wall);
    grid.fillRect(1, 1, 2, 2, Tile.CorridorFloor); // pocket A
    grid.fillRect(7, 3, 2, 2, Tile.CorridorFloor); // pocket B, separated by rock

    assert.strictEqual(labelRegions(grid).count, 2, "fixture must contain exactly two pockets");
    assert.throws(() => verifyFullyConnected(grid), GenerationError);
    assert.throws(() => verifyFullyConnected(grid), /unreachable region remains/);
  });
});
