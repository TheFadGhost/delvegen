import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapDelvegen,
  generateDungeon,
  labelRegions,
} from "../src/index.js";
import { DEFAULT_MAX_ATTEMPTS } from "../src/core/generate.js";

bootstrapDelvegen();

/**
 * Connectivity guarantee: for N=60 random seeds per algorithm the finished
 * dungeon (post pipeline included) must be a single walkable region and must
 * succeed within the default attempt budget.
 */
const N = 60;

const CANONICAL_SIZES: Record<string, [number, number]> = {
  drunkard: [80, 50],
  bsp: [100, 70],
  "rooms-mst": [90, 60],
  cellular: [80, 50],
  wang: [66, 66],
};

for (const [algo, size] of Object.entries(CANONICAL_SIZES)) {
  const [width, height] = size as [number, number];
  it(`connectivity guarantee holds over N=${N} random seeds per algorithm: ${algo}`, () => {
    for (let i = 0; i < N; i++) {
      const seed = `conn-${i}`;
      const dungeon = generateDungeon({ algorithm: algo, seed, width, height });
      const regions = labelRegions(dungeon.grid);
      assert.strictEqual(
        regions.count,
        1,
        `${algo} seed "${seed}" (${width}x${height}): expected 1 connected region, got ${regions.count}`,
      );
      assert.ok(
        dungeon.attemptsUsed <= DEFAULT_MAX_ATTEMPTS,
        `${algo} seed "${seed}": attemptsUsed=${dungeon.attemptsUsed} exceeds budget ${DEFAULT_MAX_ATTEMPTS}`,
      );
    }
  });
}
