/**
 * Regenerates tests/golden.json from the current generator output and appends
 * a dated entry to tests/GOLDEN-LOG.md.
 *
 * Usage:
 *   npm run golden:update -- --reason "why the baselines changed"
 *
 * Exits 1 without a non-empty --reason so baselines can never drift silently.
 */
import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bootstrapDelvegen,
  generateDungeon,
  dungeonHash,
} from "../src/index.js";

const CANONICAL_SIZES: Record<string, [number, number]> = {
  drunkard: [80, 50],
  bsp: [100, 70],
  "rooms-mst": [90, 60],
  cellular: [80, 50],
  wang: [66, 66],
};
const SEEDS = ["alpha", "beta", "42", "delvegen"];

function parseReason(): string | null {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--reason") return (argv[i + 1] as string | undefined) ?? null;
    if (arg.startsWith("--reason=")) return arg.slice("--reason=".length);
  }
  return null;
}

const reason = parseReason();
if (reason === null || reason.trim().length === 0) {
  console.error(
    "ERROR: a non-empty --reason is required.\n" +
      'Usage: npm run golden:update -- --reason "why the baselines changed"',
  );
  process.exit(1);
}

bootstrapDelvegen();

const golden: Record<string, string> = {};
for (const [algo, size] of Object.entries(CANONICAL_SIZES)) {
  const [width, height] = size as [number, number];
  for (const seed of SEEDS) {
    const dungeon = generateDungeon({ algorithm: algo, seed, width, height });
    golden[`${algo}|${seed}`] = dungeonHash(dungeon);
  }
}

const testsDir = fileURLToPath(new URL("../../tests/", import.meta.url));
const goldenPath = `${testsDir}golden.json`;
const logPath = `${testsDir}GOLDEN-LOG.md`;

writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n", "utf8");

if (!existsSync(logPath)) {
  appendFileSync(
    logPath,
    "# Golden baseline change log\n\n" +
      "One line per regeneration of tests/golden.json. Newest last.\n\n",
    "utf8",
  );
}
appendFileSync(
  logPath,
  `- ${new Date().toISOString()} - ${reason.trim()} - ${Object.keys(golden).length} baselines regenerated\n`,
  "utf8",
);

console.log(`Wrote ${Object.keys(golden).length} baselines to ${goldenPath}`);
console.log(`Logged reason to ${logPath}`);
