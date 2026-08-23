// Scratch verification for src/algorithms/cellular.ts (run after `npm run build`).
import { createRng } from "../dist/src/core/rng.js";
import { resolveParams, makeGenerationContext } from "../dist/src/core/types.js";
import { FrameRecorder } from "../dist/src/core/recorder.js";
import { ValidationError } from "../dist/src/core/errors.js";
import { Tile } from "../dist/src/core/tile.js";
import { labelRegions } from "../dist/src/analysis/regions.js";
import { cellularCave } from "../dist/src/algorithms/cellular.js";

function run(seed, width, height, overrides = {}, recordFrames = false) {
  const params = resolveParams(cellularCave.params, overrides);
  const recorder = recordFrames ? new FrameRecorder(width, height) : null;
  const rng = createRng(seed);
  const ctx = makeGenerationContext({ width, height, params, rng, recorder });
  return cellularCave.generate(ctx);
}

function regionSizes(grid) {
  const { labels, count } = labelRegions(grid);
  const sizes = new Array(count).fill(0);
  for (const l of labels) if (l !== -1) sizes[l]++;
  return sizes;
}

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

// 1. Default run on 80x50 seed "alpha": fast, walkable tiles exist.
const t0 = performance.now();
const a = run("alpha", 80, 50);
const elapsedMs = performance.now() - t0;
let walkable = 0;
for (const t of a.grid.tiles) if (t !== Tile.Wall) walkable++;
check(`default run finishes fast (${elapsedMs.toFixed(1)} ms < 2000)`, elapsedMs < 2000);
check(`produces walkable tiles (${walkable} of ${a.grid.tiles.length})`, walkable > 0);
check("meta.passes === 5", a.meta.passes === 5);

// wallPctFinal matches actual wall share rounded to 1 decimal.
{
  let walls = 0;
  for (const t of a.grid.tiles) if (t === Tile.Wall) walls++;
  const expect = Math.round((walls / a.grid.tiles.length) * 1000) / 10;
  check(`meta.wallPctFinal === ${expect}`, a.meta.wallPctFinal === expect);
}

// Border ring fully solid.
let borderSolid = true;
for (let x = 0; x < 80; x++) {
  if (a.grid.get(x, 0) !== Tile.Wall || a.grid.get(x, 49) !== Tile.Wall) borderSolid = false;
}
for (let y = 0; y < 50; y++) {
  if (a.grid.get(0, y) !== Tile.Wall || a.grid.get(79, y) !== Tile.Wall) borderSolid = false;
}
check("border ring is solid Wall", borderSolid);

// 2. Determinism: same seed twice -> identical buffers.
const b = run("alpha", 80, 50);
check(
  'two runs with seed "alpha" are byte-identical',
  Buffer.from(a.grid.tiles).equals(Buffer.from(b.grid.tiles)),
);
const c = run("beta", 80, 50);
check(
  'different seed "beta" differs',
  !Buffer.from(a.grid.tiles).equals(Buffer.from(c.grid.tiles)),
);

// 3. validate(): tiny grids throw ValidationError.
for (const [w, h] of [[7, 7], [8, 7], [6, 20]]) {
  try {
    cellularCave.validate(w, h, {});
    check(`validate(${w}x${h}) throws ValidationError`, false);
  } catch (err) {
    check(
      `validate(${w}x${h}) throws ValidationError`,
      err instanceof ValidationError && err.message.includes("8x8"),
    );
  }
}
try {
  cellularCave.validate(8, 8, {});
  check("validate(8x8) accepts", true);
} catch {
  check("validate(8x8) accepts", false);
}

// 4. keepLargestOnly=true yields exactly 1 walkable region.
const k = run("alpha", 80, 50, { keepLargestOnly: true });
const kSizes = regionSizes(k.grid);
check(`keepLargestOnly -> exactly 1 region (got ${kSizes.length})`, kSizes.length === 1);
check("keepLargestOnly still has walkable tiles", kSizes[0] > 0);

// 5. Default leaves pockets: >= 1 regions, every region size >= 1.
const dSizes = regionSizes(a.grid);
check(`default yields >= 1 regions (got ${dSizes.length})`, dSizes.length >= 1);
check("every default region size >= 1", dSizes.every((s) => s >= 1));
console.log(`      default region count: ${dSizes.length}, sizes: [${dSizes.join(", ")}]`);

// 6. Frames: paced well under budget, labels in order.
run("alpha", 80, 50, {}, true);
const rec2 = new FrameRecorder(120, 90);
{
  const params = resolveParams(cellularCave.params, {});
  const ctx = makeGenerationContext({
    width: 120,
    height: 90,
    params,
    rng: createRng("alpha"),
    recorder: rec2,
  });
  cellularCave.generate(ctx);
}
const labels = rec2.frames.map((f) => f.label);
check(`frame count small (${rec2.frameCount} <= 2000)`, rec2.frameCount <= 2000);
check(
  `frame labels ordered (${JSON.stringify(labels)})`,
  labels[0] === "seed noise (45%)" &&
    labels[1] === "smoothing pass 1" &&
    labels[5] === "smoothing pass 5" &&
    labels.length === 6,
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
