import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  bootstrapDelvegen,
  generateDungeon,
  dungeonHash,
} from "../src/index.js";

bootstrapDelvegen();

/** Canonical size per algorithm id (mirrors scripts/matrix-check.mjs). */
export const CANONICAL_SIZES: Record<string, [number, number]> = {
  drunkard: [80, 50],
  bsp: [100, 70],
  "rooms-mst": [90, 60],
  cellular: [80, 50],
  wang: [66, 66],
};

const ALGORITHMS = Object.keys(CANONICAL_SIZES);
const SEEDS = ["alpha", "beta", "42", "delvegen"];

interface GoldenFile {
  [key: string]: string;
}

function loadGolden(): GoldenFile {
  // Compiled to dist/tests/*.js; the JSON lives beside the TS sources.
  const goldenPath = fileURLToPath(new URL("../../tests/golden.json", import.meta.url));
  return JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFile;
}

test("every algorithm x seed reproduces byte-identical dungeons and matches golden hashes", () => {
  const golden = loadGolden();
  const missingKeys: string[] = [];

  for (const algo of ALGORITHMS) {
    const [width, height] = CANONICAL_SIZES[algo] as [number, number];
    for (const seed of SEEDS) {
      const options = { algorithm: algo, seed, width, height };
      const first = generateDungeon({ ...options });
      const second = generateDungeon({ ...options });

      const hashA = dungeonHash(first);
      const hashB = dungeonHash(second);
      assert.strictEqual(
        hashA,
        hashB,
        `nondeterminism: ${algo}/${seed} produced ${hashA} then ${hashB}; ` +
          `same (algorithm, seed, params) must yield identical output`,
      );
      assert.ok(
        Buffer.from(first.grid.tiles).equals(Buffer.from(second.grid.tiles)),
        `nondeterminism: ${algo}/${seed} grid tile bytes differ between two runs`,
      );

      const key = `${algo}|${seed}`;
      const expected = golden[key];
      if (expected === undefined) {
        missingKeys.push(key);
        continue;
      }
      assert.strictEqual(
        hashA,
        expected,
        `golden hash mismatch for "${key}": got ${hashA}, expected ${expected}. ` +
          `If this change is intentional (PRNG, algorithm, or post-pass change), regenerate the baselines with:\n` +
          `  npm run golden:update -- --reason "<why the outputs changed>"\n` +
          `The updater rewrites tests/golden.json and appends a dated entry to tests/GOLDEN-LOG.md. ` +
          `Never hand-edit golden.json.`,
      );
    }
  }

  assert.deepStrictEqual(
    missingKeys,
    [],
    `tests/golden.json is missing keys: ${missingKeys.join(", ")}. ` +
      `Regenerate with: npm run golden:update -- --reason "initial baselines"`,
  );
});

test("golden.json covers every algorithm|seed pair in this suite", () => {
  const golden = loadGolden();
  const expectedKeys = ALGORITHMS.flatMap((a) => SEEDS.map((s) => `${a}|${s}`)).sort();
  assert.deepStrictEqual(
    Object.keys(golden).sort(),
    expectedKeys,
    "golden.json key set drifted from the determinism matrix",
  );
});
