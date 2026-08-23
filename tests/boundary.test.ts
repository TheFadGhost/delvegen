import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapDelvegen,
  generateDungeon,
  DungeonGrid,
  labelRegions,
  ValidationError,
  GenerationError,
} from "../src/index.js";

bootstrapDelvegen();

function assertSingleRegion(algo: string, setting: string, grid: DungeonGrid): void {
  assert.strictEqual(
    labelRegions(grid).count,
    1,
    `${algo} with ${setting} produced a disconnected dungeon`,
  );
}

describe("boundary and validation", () => {
  it("grid constructor enforces MIN_DIMENSION 5", () => {
    assert.throws(() => new DungeonGrid(4, 10), ValidationError);
    assert.throws(() => new DungeonGrid(10, 4), /too small/);
    assert.throws(() => new DungeonGrid(4, 4), ValidationError);
    assert.doesNotThrow(() => new DungeonGrid(5, 5));
  });

  it("grid constructor enforces MAX_DIMENSION 512", () => {
    assert.throws(() => new DungeonGrid(513, 100), ValidationError);
    assert.throws(() => new DungeonGrid(100, 513), /too large/);
    assert.doesNotThrow(() => new DungeonGrid(512, 512));
  });

  it("cellular rejects grids below its 8x8 minimum", () => {
    assert.throws(
      () => generateDungeon({ algorithm: "cellular", seed: "s", width: 7, height: 7 }),
      ValidationError,
    );
    assert.throws(
      () => generateDungeon({ algorithm: "cellular", seed: "s", width: 7, height: 7 }),
      /at least 8x8/,
    );
  });

  it("wang rejects grids below its 34x34 minimum", () => {
    assert.throws(
      () => generateDungeon({ algorithm: "wang", seed: "s", width: 33, height: 33 }),
      ValidationError,
    );
    assert.throws(
      () => generateDungeon({ algorithm: "wang", seed: "s", width: 33, height: 33 }),
      /34x34/,
    );
  });

  it("wang rejects grids below its 34x34 minimum", () => {
    assert.throws(
      () => generateDungeon({ algorithm: "wang", seed: "s", width: 33, height: 33 }),
      ValidationError,
    );
    assert.throws(
      () => generateDungeon({ algorithm: "wang", seed: "s", width: 33, height: 33 }),
      /34x34/,
    );
  });

  it("bsp roomMaxSize larger than the leaf capacity names the offending param", () => {
    // minLeafSize default 16, padding default 1 -> cap = 16 - 2*1 - 2 = 12.
    assert.throws(
      () =>
        generateDungeon({
          algorithm: "bsp",
          seed: "s",
          width: 100,
          height: 70,
          params: { roomMaxSize: 20 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError, `expected ValidationError, got ${String(err)}`);
        assert.match(err.message, /Room max size/);
        return true;
      },
    );
  });

  it("bsp corridorWidth >= roomMinSize names the offending param", () => {
    assert.throws(
      () =>
        generateDungeon({
          algorithm: "bsp",
          seed: "s",
          width: 100,
          height: 70,
          params: { corridorWidth: 3, roomMinSize: 3 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Corridor width/);
        return true;
      },
    );
  });

  it("rooms-mst corridorWidth >= roomMinSize names the offending param", () => {
    assert.throws(
      () =>
        generateDungeon({
          algorithm: "rooms-mst",
          seed: "s",
          width: 90,
          height: 60,
          params: { corridorWidth: 3, roomMinSize: 3 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Corridor width/);
        return true;
      },
    );
  });

  it("drunkard floorTargetPct beyond capacity on a tiny grid names the offending param", () => {
    // 6x6 with border: capacity = 4*4 = 16; 70% of 36 tiles needs 26.
    assert.throws(
      () =>
        generateDungeon({
          algorithm: "drunkard",
          seed: "s",
          width: 6,
          height: 6,
          params: { floorTargetPct: 70 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Floor coverage/);
        return true;
      },
    );
  });

  it("rooms-mst roomMaxSize larger than the grid allows names the offending param", () => {
    // 9x9 grid -> sizeCap = min(9,9) - 4 = 5; default roomMaxSize is 9.
    assert.throws(
      () => generateDungeon({ algorithm: "rooms-mst", seed: "s", width: 9, height: 9 }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Room max size/);
        return true;
      },
    );
  });

  it("rooms-mst roomCount=0 fails bounded retries with GenerationError, not a crash or hang", () => {
    assert.throws(
      () =>
        generateDungeon({
          algorithm: "rooms-mst",
          seed: "zero-rooms",
          width: 90,
          height: 60,
          params: { roomCount: 0 },
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof GenerationError,
          `expected GenerationError from the retry budget, got ${String(err)}`,
        );
        assert.match(err.message, /failed after/);
        return true;
      },
    );
  });

  it("drunkard degenerate extremes terminate: floorTargetPct=5 and =70 on 40x30", () => {
    for (const pct of [5, 70]) {
      const d = generateDungeon({
        algorithm: "drunkard",
        seed: `edge-${pct}`,
        width: 40,
        height: 30,
        params: { floorTargetPct: pct },
      });
      assertSingleRegion("drunkard", `floorTargetPct=${pct}`, d.grid);
    }
  });

  it("cellular degenerate extremes terminate: smoothingPasses=1 and =8", () => {
    for (const passes of [1, 8]) {
      const d = generateDungeon({
        algorithm: "cellular",
        seed: `smooth-${passes}`,
        width: 80,
        height: 50,
        params: { smoothingPasses: passes },
      });
      assertSingleRegion("cellular", `smoothingPasses=${passes}`, d.grid);
    }
  });

  it("wang degenerate extremes terminate: openness=20 and =90", () => {
    for (const openness of [20, 90]) {
      const d = generateDungeon({
        algorithm: "wang",
        seed: `open-${openness}`,
        width: 66,
        height: 66,
        params: { openness },
      });
      assertSingleRegion("wang", `openness=${openness}`, d.grid);
    }
  });

  it("bsp maxDepth=10 on 100x70 completes under 5 seconds", { timeout: 5000 }, () => {
    const dungeon = generateDungeon({
      algorithm: "bsp",
      seed: "deep",
      width: 100,
      height: 70,
      params: { maxDepth: 10 },
    });
    assert.strictEqual(labelRegions(dungeon.grid).count, 1);
  });

  it("rooms-mst degenerate extremes terminate: loopEdgePct=0 and =100", () => {
    for (const loopEdgePct of [0, 100]) {
      const d = generateDungeon({
        algorithm: "rooms-mst",
        seed: `loop-${loopEdgePct}`,
        width: 90,
        height: 60,
        params: { loopEdgePct },
      });
      assertSingleRegion("rooms-mst", `loopEdgePct=${loopEdgePct}`, d.grid);
    }
  });
});
