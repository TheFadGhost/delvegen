import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRng } from "../src/core/rng.js";
import { DelvegenError } from "../src/core/errors.js";

/**
 * The first 8 floats of createRng("golden-seed"), frozen forever.
 * If these ever change, the PRNG's output contract changed and every
 * golden baseline in tests/golden.json is invalidated too.
 */
const GOLDEN_SEED_FIRST_8 = [
  0.3404297854285687,
  0.4650939921848476,
  0.5458960018586367,
  0.4465967321302742,
  0.2316798979882151,
  0.9815973683726043,
  0.5768890748731792,
  0.013662693556398153,
];

function drawN(rng: ReturnType<typeof createRng>, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.next());
  return out;
}

describe("Rng", () => {
  it("first 8 floats of the golden seed match the frozen literals", () => {
    const rng = createRng("golden-seed");
    for (let i = 0; i < GOLDEN_SEED_FIRST_8.length; i++) {
      assert.strictEqual(
        rng.next(),
        GOLDEN_SEED_FIRST_8[i],
        `float #${i + 1} of createRng("golden-seed") changed; ` +
          `the PRNG stream moved, so tests/golden.json baselines must be regenerated ` +
          `(npm run golden:update -- --reason "...") only after verifying the change is intended`,
      );
    }
  });

  it("two Rngs with the same seed produce identical 1000-draw sequences", () => {
    const a = drawN(createRng("twin-seed"), 1000);
    const b = drawN(createRng("twin-seed"), 1000);
    assert.deepStrictEqual(a, b, "same seed must replay the exact same float stream");
  });

  it("different seeds produce different sequences", () => {
    const a = drawN(createRng("seed-a"), 64);
    const b = drawN(createRng("seed-b"), 64);
    assert.notDeepStrictEqual(a, b);
  });

  it("fork(label) is reproducible: same seed+label gives the same child sequence", () => {
    const parent = createRng("fork-parent");
    const child1 = parent.fork("left-arm");
    const child2 = createRng("fork-parent").fork("left-arm");
    assert.deepStrictEqual(
      drawN(child1, 200),
      drawN(child2, 200),
      "fork from the same parent state with the same label must be reproducible",
    );
  });

  it("fork(label) children are independent of later parent consumption", () => {
    const parent = createRng("fork-order");
    const early = parent.fork("child");
    const earlySeq = drawN(early, 100);
    drawN(parent, 500); // burn parent draws after forking
    const late = createRng("fork-order").fork("child");
    // A fork taken at the initial state must equal the historical one.
    assert.deepStrictEqual(drawN(late, 100), earlySeq);
  });

  it("drawing from a forked child does not disturb the parent stream", () => {
    const p1 = createRng("undisturbed");
    const child = p1.fork("noisy-child");
    drawN(child, 50);
    const expected = drawN(createRng("undisturbed"), 10);
    assert.deepStrictEqual(drawN(p1, 10), expected, "parent stream must be untouched by child draws");
  });

  it("int() stays within [min, max] inclusive and eventually hits both endpoints", () => {
    const rng = createRng("int-bounds");
    let minSeen = Infinity;
    let maxSeen = -Infinity;
    const lo = -3;
    const hi = 7;
    for (let i = 0; i < 20000; i++) {
      const v = rng.int(lo, hi);
      assert.ok(
        Number.isInteger(v) && v >= lo && v <= hi,
        `int(${lo}, ${hi}) returned ${v} on draw ${i}; value escaped its inclusive bounds`,
      );
      if (v < minSeen) minSeen = v;
      if (v > maxSeen) maxSeen = v;
    }
    assert.strictEqual(minSeen, lo, "20000 draws never hit the lower endpoint");
    assert.strictEqual(maxSeen, hi, "20000 draws never hit the upper endpoint");
  });

  it("shuffle preserves the multiset of elements", () => {
    const rng = createRng("shuffler");
    const original = Array.from({ length: 24 }, (_, i) => i - 12);
    const copy = [...original];
    const shuffled = rng.shuffle(copy);
    assert.strictEqual(shuffled, copy, "shuffle mutates and returns the same array");
    assert.deepStrictEqual([...shuffled].sort((a, b) => a - b), original, "sorted shuffle != sorted original");
  });

  it("pick throws DelvegenError on an empty array", () => {
    const rng = createRng("picker");
    assert.throws(() => rng.pick([]), DelvegenError);
    assert.throws(() => rng.pick([]), /empty/i);
  });

  it("pick returns only elements of the array", () => {
    const rng = createRng("picker-2");
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 200; i++) {
      const picked = rng.pick(items);
      assert.ok(items.includes(picked), `pick returned "${picked}", not present in input`);
    }
  });

  it("chance(0) is always false and chance(1) is always true", () => {
    const rng = createRng("chancer");
    for (let i = 0; i < 500; i++) {
      if (rng.chance(0)) throw new Error(`chance(0) returned true on draw ${i}`);
      if (!rng.chance(1)) throw new Error(`chance(1) returned false on draw ${i}`);
    }
  });

  it("empty seed string throws DelvegenError", () => {
    assert.throws(() => createRng(""), DelvegenError);
    assert.throws(() => createRng(""), /non-empty/);
  });
});
