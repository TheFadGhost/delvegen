// Scratch verification for the bsp + rooms-mst algorithms (run after npm build).
import { performance } from "node:perf_hooks";
import { createRng } from "../dist/src/core/rng.js";
import { resolveParams, makeGenerationContext } from "../dist/src/core/types.js";
import { FrameRecorder } from "../dist/src/core/recorder.js";
import { labelRegions } from "../dist/src/analysis/regions.js";
import { ValidationError } from "../dist/src/core/errors.js";
import { bspSplit } from "../dist/src/algorithms/bsp.js";
import { roomsMst } from "../dist/src/algorithms/rooms-mst.js";

const WIDTH = 80;
const HEIGHT = 50;
const SEED = "alpha";

function run(def, { overrides = {}, record = false } = {}) {
  const params = resolveParams(def.params, overrides);
  const rng = createRng(SEED, def.id);
  const recorder = record ? new FrameRecorder(WIDTH, HEIGHT) : null;
  const ctx = makeGenerationContext({ width: WIDTH, height: HEIGHT, params, rng, recorder });
  const started = performance.now();
  const data = def.generate(ctx);
  return { data, recorder, elapsedMs: performance.now() - started };
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
}

for (const def of [bspSplit, roomsMst]) {
  console.log(`\n== ${def.id} ==`);
  const a = run(def);
  check("finishes <2s", a.elapsedMs < 2000, `${a.elapsedMs.toFixed(1)}ms`);
  const regions = labelRegions(a.data.grid).count;
  check("exactly 1 region", regions === 1, `regions=${regions}`);
  const b = run(def);
  check(
    "deterministic tiles across runs",
    Buffer.from(a.data.grid.tiles).equals(Buffer.from(b.data.grid.tiles)),
  );
  const framed = run(def, { record: true });
  check(
    "frames under 2000",
    framed.recorder.frameCount < 2000,
    `frames=${framed.recorder.frameCount}`,
  );
  console.log(`   meta=${JSON.stringify(framed.data.meta)} rooms=${framed.data.rooms.length}`);

  // Stress combos must stay fast and connected too.
  const stressOverrides =
    def === bspSplit
      ? { minLeafSize: 8, maxDepth: 10, corridorWidth: 3 }
      : { roomCount: 60, placementAttempts: 2000, loopEdgePct: 100 };
  const stress = run(def, { overrides: stressOverrides });
  check("stress finishes <2s", stress.elapsedMs < 2000, `${stress.elapsedMs.toFixed(1)}ms`);
  check(
    "stress exactly 1 region",
    labelRegions(stress.data.grid).count === 1,
    `rooms=${stress.data.rooms.length}`,
  );
}

console.log("\n== validation ==");

function expectValidationError(name, fn) {
  try {
    fn();
    check(name, false, "no error thrown");
  } catch (err) {
    check(name, err instanceof ValidationError, `${err.constructor.name}: ${err.message}`);
  }
}

expectValidationError("bsp grid too small for minLeafSize", () => {
  bspSplit.validate(14, 14, resolveParams(bspSplit.params));
});
expectValidationError("bsp roomMaxSize exceeds leaf budget", () => {
  bspSplit.validate(80, 50, resolveParams(bspSplit.params, { roomMaxSize: 20, roomPadding: 4 }));
});
expectValidationError("bsp corridorWidth swallows roomMinSize", () => {
  bspSplit.validate(80, 50, resolveParams(bspSplit.params, { corridorWidth: 3, roomMinSize: 3 }));
});
expectValidationError("rooms-mst roomMaxSize exceeds grid", () => {
  roomsMst.validate(20, 20, resolveParams(roomsMst.params, { roomMaxSize: 24 }));
});
expectValidationError("rooms-mst corridorWidth swallows roomMinSize", () => {
  roomsMst.validate(80, 50, resolveParams(roomsMst.params, { corridorWidth: 3, roomMinSize: 3 }));
});

// roomCount=0 passes validate but generate must report clearly so the pipeline retries.
try {
  const result = run(roomsMst, { overrides: { roomCount: 0 } });
  check(
    "rooms-mst roomCount=0 errors clearly",
    false,
    `returned meta=${JSON.stringify(result.data.meta)}`,
  );
} catch (err) {
  check(
    "rooms-mst roomCount=0 errors clearly",
    !(err instanceof ValidationError) && String(err.message).includes("produced no rooms"),
    err.message,
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
