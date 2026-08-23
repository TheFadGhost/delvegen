// Full-matrix sanity: every algorithm x post-pass combo must be deterministic
// and produce a single connected region.
import { bootstrapDelvegen, generateDungeon, labelRegions, dungeonHash } from "../dist/src/index.js";

bootstrapDelvegen();

const ALGOS = ["drunkard", "bsp", "rooms-mst", "cellular", "wang"];
const SIZES = {
  drunkard: [80, 50],
  bsp: [100, 70],
  "rooms-mst": [90, 60],
  cellular: [80, 50],
  wang: [66, 66],
};
const POSTS = [
  {},
  { repair: true },
  { repair: true, prune: true },
  { repair: true, prune: true, doors: true },
  { repair: true, prune: true, doors: true, thin: true },
];

let failures = 0;
for (const algo of ALGOS) {
  const [w, h] = SIZES[algo];
  for (let pi = 0; pi < POSTS.length; pi++) {
    for (const seed of ["alpha", "beta", "gamma", "42"]) {
      try {
        const a = generateDungeon({ algorithm: algo, seed, width: w, height: h, post: structuredClone(POSTS[pi]) });
        const b = generateDungeon({ algorithm: algo, seed, width: w, height: h, post: structuredClone(POSTS[pi]) });
        if (dungeonHash(a) !== dungeonHash(b)) throw new Error(`nondeterministic ${algo} ${seed} post${pi}`);
        if (labelRegions(a.grid).count !== 1) throw new Error(`regions!=1 ${algo} ${seed} post${pi}`);
      } catch (e) {
        failures++;
        console.log(`FAIL ${algo} seed=${seed} post=${pi}:`, e instanceof Error ? e.message : e);
      }
    }
  }
}
console.log(failures === 0 ? "MATRIX OK (5 algos x 5 posts x 4 seeds)" : `MATRIX FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
