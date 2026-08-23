import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapDelvegen,
  generateDungeon,
  getAlgorithm,
  resolveParams,
  DungeonGrid,
  FrameRecorder,
  DelvegenError,
  ValidationError,
} from "../src/index.js";

bootstrapDelvegen();

describe("registry and parameter resolution", () => {
  it("unknown algorithm id throws naming the available ids", () => {
    assert.throws(
      () => generateDungeon({ algorithm: "definitely-not-real", seed: "x", width: 40, height: 24 }),
      (err: unknown) => {
        assert.ok(err instanceof DelvegenError);
        assert.match(err.message, /Unknown algorithm "definitely-not-real"/);
        for (const id of ["drunkard", "bsp", "rooms-mst", "cellular", "wang"]) {
          assert.ok(err.message.includes(id), `message should list available id "${id}": ${err.message}`);
        }
        return true;
      },
    );
  });

  it("resolveParams clamps numeric overrides into range", () => {
    const specs = getAlgorithm("drunkard").params;
    // floorTargetPct float range [5, 70]
    const high = resolveParams(specs, { floorTargetPct: 999 });
    assert.strictEqual(high["floorTargetPct"], 70, "float above max must clamp to max");
    const low = resolveParams(specs, { floorTargetPct: -30 });
    assert.strictEqual(low["floorTargetPct"], 5, "float below min must clamp to min");
    // walkers int range [1, 4]
    const walkers = resolveParams(specs, { walkers: 99 });
    assert.strictEqual(walkers["walkers"], 4, "int above max must clamp to max");
    const tiny = resolveParams(specs, { walkers: -7 });
    assert.strictEqual(tiny["walkers"], 1, "int below min must clamp to min");
  });

  it("resolveParams rounds int overrides", () => {
    const specs = getAlgorithm("drunkard").params;
    const roundedDown = resolveParams(specs, { walkers: 2.4 });
    assert.strictEqual(roundedDown["walkers"], 2, "int override 2.4 should round to 2");
    const roundedUp = resolveParams(specs, { walkers: 2.5 });
    assert.strictEqual(roundedUp["walkers"], 3, "int override 2.5 should round to 3");
  });

  it("resolveParams rejects unknown override keys naming the key", () => {
    const specs = getAlgorithm("drunkard").params;
    assert.throws(
      () => resolveParams(specs, { floorTargetPercentage: 50 }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Unknown parameter "floorTargetPercentage"/);
        return true;
      },
    );
  });

  it("resolveParams fills defaults when no overrides given", () => {
    const specs = getAlgorithm("bsp").params;
    const resolved = resolveParams(specs, {});
    for (const spec of specs) {
      assert.ok(spec.key in resolved, `missing default for ${spec.key}`);
      assert.strictEqual(resolved[spec.key], spec.default);
    }
  });
});

describe("generateDungeon input validation", () => {
  it("rejects an empty seed", () => {
    assert.throws(
      () => generateDungeon({ algorithm: "drunkard", seed: "", width: 40, height: 24 }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Seed must not be empty/);
        return true;
      },
    );
  });

  it("rejects non-integer dimensions", () => {
    assert.throws(
      () => generateDungeon({ algorithm: "drunkard", seed: "x", width: 40.5, height: 24 }),
      ValidationError,
    );
    assert.throws(
      () => generateDungeon({ algorithm: "drunkard", seed: "x", width: 40, height: 24.5 }),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /must be integers/);
        return true;
      },
    );
  });

  it("rejects maxAttempts < 1", () => {
    for (const bad of [0, -3]) {
      assert.throws(
        () =>
          generateDungeon({
            algorithm: "drunkard",
            seed: "x",
            width: 40,
            height: 24,
            maxAttempts: bad,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.message, /maxAttempts must be a positive integer/);
          return true;
        },
      );
    }
  });
});

describe("frame recording", () => {
  it("recordFrames:true returns frames with frameCount>0 and a defined truncated flag", () => {
    const dungeon = generateDungeon({
      algorithm: "drunkard",
      seed: "frames",
      width: 40,
      height: 24,
      recordFrames: true,
    });
    assert.ok(dungeon.frames, "frames recorder missing despite recordFrames:true");
    assert.ok(dungeon.frames.frameCount > 0, "no frames recorded");
    assert.strictEqual(typeof dungeon.frames.truncated, "boolean");
    const last = dungeon.frames.frames[dungeon.frames.frames.length - 1];
    assert.ok(last, "recorder must keep at least one frame");
    assert.ok(
      Buffer.from(last!.tiles).equals(Buffer.from(dungeon.grid.tiles)),
      "final frame must match the finished grid",
    );
  });

  it("FrameRecorder decimation keeps memory bounded over 6000 records", () => {
    const recorder = new FrameRecorder(10, 10);
    const grid = new DungeonGrid(10, 10);
    for (let i = 0; i < 6000; i++) recorder.record(`step ${i}`, grid, []);

    assert.strictEqual(recorder.totalSteps, 6000, "every raw step must be counted");
    assert.ok(
      recorder.frames.length <= 2400,
      `decimation failed: ${recorder.frames.length} frames retained (budget 2400)`,
    );
    assert.strictEqual(recorder.truncated, true, "decimated history must set truncated=true");

    assert.strictEqual(recorder.truncated, true, "decimated history must set truncated=true");

    // History stays uniformly sampled: even under heavy decimation the tail
    // of the run is still present (stride 4 over the last ~1200 steps).
    const last = recorder.frames[recorder.frames.length - 1];
    assert.ok(last, "recorder must never empty its history");
    assert.ok(last!.index > 5000, `tail sampling lost: newest frame index ${last!.index}`);
  });

  it("reset() clears frames, counters and the truncated flag", () => {
    const recorder = new FrameRecorder(10, 10);
    const grid = new DungeonGrid(10, 10);
    recorder.record("only", grid, []);
    recorder.reset();
    assert.strictEqual(recorder.frameCount, 0);
    assert.strictEqual(recorder.totalSteps, 0);
    assert.strictEqual(recorder.truncated, false);
  });
});
