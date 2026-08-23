import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createRng } from "../dist/src/core/rng.js";
import { resolveParams, makeGenerationContext } from "../dist/src/core/types.js";
import { FrameRecorder } from "../dist/src/core/recorder.js";
import { ValidationError } from "../dist/src/core/errors.js";
import { labelRegions } from "../dist/src/analysis/regions.js";
import { wangStitch } from "../dist/src/algorithms/wang.js";
import { WANG_PACK, assertPackValid } from "../dist/src/algorithms/wang-templates.js";

function buildContext(width, height, overrides = {}, recorder = null) {
  const params = resolveParams(wangStitch.params, overrides);
  return makeGenerationContext({
    width,
    height,
    params,
    rng: createRng("wtest", "wang"),
    recorder,
  });
}

// 1. Pack validity.
assertPackValid();
const sigs = new Set(WANG_PACK.map((t) => t.edges));
assert.equal(sigs.size, 16, "all 16 signatures covered");
console.log(`pack valid: ${WANG_PACK.length} templates, signatures ${[...sigs].sort((a, b) => a - b).join(",")}`);

// 2. Main run: 80x50 seed "wtest", timed, recorded.
const rec = new FrameRecorder(80, 50);
const t0 = performance.now();
const d1 = wangStitch.generate(buildContext(80, 50, {}, rec));
const ms = performance.now() - t0;
assert.ok(ms < 2000, `generation took ${ms.toFixed(1)}ms (budget 2000ms)`);
assert.equal(labelRegions(d1.grid).count, 1, "80x50 is one connected region");
assert.ok(d1.rooms.length > 0, "rooms harvested");
assert.equal(d1.meta.cells, 12); // cols=4, rows=3
assert.ok(rec.totalSteps < 2000, `frames under budget (${rec.totalSteps})`);
console.log(
  `80x50 ok: ${ms.toFixed(1)}ms, regions=1, rooms=${d1.rooms.length}, ` +
    `cells=${d1.meta.cells}, linksAdded=${d1.meta.linksAdded}, frames=${rec.totalSteps}`,
);

// 3. Determinism: same seed -> identical buffers.
const d2 = wangStitch.generate(buildContext(80, 50));
assert.ok(Buffer.from(d2.grid.tiles).equals(Buffer.from(d1.grid.tiles)), "deterministic output");

// 4. Odd sizes: leftover strips stay wall, still one region.
for (const [w, h] of [
  [66, 66],
  [40, 40],
]) {
  const d = wangStitch.generate(buildContext(w, h));
  assert.equal(labelRegions(d.grid).count, 1, `${w}x${h} one region`);
  const lastX = Math.floor((w - 1) / 16) * 16;
  const lastY = Math.floor((h - 1) / 16) * 16;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > lastX || y > lastY) {
        assert.equal(d.grid.get(x, y), 0, `leftover strip wall at ${x},${y}`);
      }
    }
  }
  console.log(`${w}x${h} ok: regions=1, strips solid, cells=${d.meta.cells}, linksAdded=${d.meta.linksAdded}`);
}

// 5. Too small throws ValidationError.
assert.throws(() => wangStitch.validate(33, 33, resolveParams(wangStitch.params)), ValidationError);
console.log("33x33 rejected with ValidationError");

// 6. Variant mixes stay connected.
for (const mix of ["corridor", "chamber", "varied"]) {
  const d = wangStitch.generate(buildContext(80, 50, { variantMix: mix }));
  assert.equal(labelRegions(d.grid).count, 1, `mix "${mix}" one region`);
}
console.log('variant mixes corridor/chamber/varied: all one region');

// 7. Openness extremes stay connected.
for (const openness of [20, 90]) {
  const d = wangStitch.generate(buildContext(120, 90, { openness }));
  assert.equal(labelRegions(d.grid).count, 1, `openness ${openness} one region`);
  console.log(`openness ${openness}: ok (linksAdded=${d.meta.linksAdded})`);
}

console.log("ALL CHECKS PASSED");
