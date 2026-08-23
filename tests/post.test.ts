import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapDelvegen,
  generateDungeon,
  dungeonHash,
  DungeonGrid,
  Tile,
  createRng,
  makePostContext,
  labelRegions,
  resolveParams,
} from "../src/index.js";
import { verifyFullyConnected } from "../src/core/generate.js";
import { repairConnectivity } from "../src/post/repair.js";
import { pruneDeadEnds } from "../src/post/prune.js";
import { placeDoors } from "../src/post/doors.js";
import { thinWalls } from "../src/post/thinwalls.js";
import type { PostPassDefinition } from "../src/core/types.js";

bootstrapDelvegen();

function ctxFor(pass: PostPassDefinition, overrides: Record<string, unknown> = {}) {
  return makePostContext({
    rng: createRng("post-test", `ctx-${pass.id}`),
    params: resolveParams(pass.params, overrides),
    recorder: null,
  });
}

describe("repair pass", () => {
  it("joins two disjoint rooms into one region", () => {
    const grid = new DungeonGrid(20, 10, Tile.Wall);
    grid.fillRect(2, 2, 4, 3, Tile.RoomFloor); // room A
    grid.fillRect(13, 5, 4, 3, Tile.RoomFloor); // room B, no connection
    assert.strictEqual(labelRegions(grid).count, 2, "fixture starts disconnected");

    const dungeon = { grid, rooms: [], meta: {} };
    repairConnectivity.apply(dungeon, ctxFor(repairConnectivity));

    assert.strictEqual(labelRegions(grid).count, 1, "repair must leave a single region");
    verifyFullyConnected(grid);
  });
});

describe("prune pass", () => {
  /**
   * 15x7 fixture: 3x3 room on the left feeding a corridor east with two
   * dead-end stubs (up at x=5, down at x=8) and a bare end at x=14.
   */
  function stubFixture(): DungeonGrid {
    const grid = new DungeonGrid(15, 7, Tile.Wall);
    grid.fillRect(1, 2, 3, 3, Tile.RoomFloor); // room (1..3, 2..4)
    for (let x = 4; x <= 14; x++) grid.set(x, 3, Tile.CorridorFloor); // main corridor
    grid.set(5, 2, Tile.CorridorFloor);
    grid.set(5, 1, Tile.CorridorFloor); // up-stub
    grid.set(8, 4, Tile.CorridorFloor);
    grid.set(8, 5, Tile.CorridorFloor); // down-stub
    return grid;
  }

  it("depth 6 removes stubs, keeps RoomFloor, keeps connectivity", () => {
    const grid = stubFixture();
    const dungeon = { grid, rooms: [], meta: {} };
    pruneDeadEnds.apply(dungeon, ctxFor(pruneDeadEnds, { pruneDepth: 6 }));

    // Both stub tips and their necks must be gone.
    for (const [x, y] of [[5, 1], [5, 2], [8, 4], [8, 5]] as const) {
      assert.strictEqual(grid.get(x, y), Tile.Wall, `stub tile (${x},${y}) should be pruned to wall`);
    }
    // Room floors untouched.
    for (let y = 2; y <= 4; y++) {
      for (let x = 1; x <= 3; x++) {
        assert.strictEqual(
          grid.get(x, y),
          Tile.RoomFloor,
          `room tile (${x},${y}) must never be pruned`,
        );
      }
    }
    // Still one connected region containing the room.
    assert.strictEqual(labelRegions(grid).count, 1, "pruning must not disconnect the map");
    verifyFullyConnected(grid);
  });

  it("depth 0 is a no-op", () => {
    const grid = stubFixture();
    const before = Buffer.from(grid.tiles).slice();
    pruneDeadEnds.apply({ grid, rooms: [], meta: {} }, ctxFor(pruneDeadEnds, { pruneDepth: 0 }));
    assert.ok(Buffer.from(grid.tiles).equals(before), "pruneDepth=0 must not change any tile");
  });
});

describe("doors pass", () => {
  /** Room (2..5, 2..4) with two single-tile corridor mouths: (6,3) east, (3,1) north. */
  function mouthFixture(): DungeonGrid {
    const grid = new DungeonGrid(12, 9, Tile.Wall);
    grid.fillRect(2, 2, 4, 3, Tile.RoomFloor);
    grid.set(6, 3, Tile.CorridorFloor); // east mouth (dead-ends behind it)
    grid.set(3, 1, Tile.CorridorFloor); // north mouth (dead-ends above it)
    return grid;
  }

  it("doorChance=100 converts every candidate mouth to a Door", () => {
    const grid = mouthFixture();
    placeDoors.apply({ grid, rooms: [], meta: {} }, ctxFor(placeDoors, { doorChance: 100 }));
    assert.strictEqual(grid.get(6, 3), Tile.Door, "east mouth should become a door");
    assert.strictEqual(grid.get(3, 1), Tile.Door, "north mouth should become a door");
    assert.strictEqual(labelRegions(grid).count, 1);
    verifyFullyConnected(grid); // doors are walkable: connectivity preserved
  });

  it("doorChance=0 leaves all candidates as corridor", () => {
    const grid = mouthFixture();
    placeDoors.apply({ grid, rooms: [], meta: {} }, ctxFor(placeDoors, { doorChance: 0 }));
    assert.strictEqual(grid.get(6, 3), Tile.CorridorFloor);
    assert.strictEqual(grid.get(3, 1), Tile.CorridorFloor);
    assert.strictEqual(grid.count(Tile.Door), 0);
  });
});

describe("thin pass", () => {
  it("melts a single enclosed wall speck with minCluster=1 but never the border ring", () => {
    const grid = new DungeonGrid(9, 9, Tile.CorridorFloor);
    grid.set(4, 4, Tile.Wall); // interior speck, fully surrounded by floor
    grid.set(7, 0, Tile.Wall); // wall ON the border ring

    thinWalls.apply({ grid, rooms: [], meta: {} }, ctxFor(thinWalls, { minCluster: 1 }));

    assert.strictEqual(grid.get(4, 4), Tile.CorridorFloor, "enclosed speck should melt to corridor");
    assert.strictEqual(grid.get(7, 0), Tile.Wall, "border ring tiles must stay solid rock");
    verifyFullyConnected(grid);
  });
});

describe("full post pipeline", () => {
  it("drunkard + repair/prune/doors/thin is deterministic across runs", () => {
    const options = {
      algorithm: "drunkard",
      seed: "p",
      width: 64,
      height: 48,
      post: { repair: true, prune: true, doors: true, thin: true },
    };
    const a = generateDungeon(options);
    const b = generateDungeon(options);
    assert.strictEqual(
      dungeonHash(a),
      dungeonHash(b),
      `pipeline hashes differ: ${dungeonHash(a)} vs ${dungeonHash(b)}`,
    );
    assert.strictEqual(labelRegions(a.grid).count, 1, "pipeline output must be fully connected");
  });
});
