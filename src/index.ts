// Delvegen public library API.
//
// Headless usage:
//   import { generateDungeon, registerBuiltinAlgorithms, computeMetrics } from "delvegen";
//   registerBuiltinAlgorithms(); // once
//   const dungeon = generateDungeon({ algorithm: "drunkard", seed: "abc", width: 80, height: 50 });
//   const metrics = computeMetrics(dungeon);

export * from "./core/tile.js";
export * from "./core/rng.js";
export * from "./core/grid.js";
export * from "./core/geometry.js";
export * from "./core/errors.js";
export * from "./core/recorder.js";
export * from "./core/hash.js";
export * from "./core/types.js";
export * from "./core/algorithm-registry.js";
export * from "./core/post-registry.js";
export * from "./core/generate.js";

export { registerBuiltinAlgorithms } from "./algorithms/index.js";
export { registerPostPasses } from "./post/index.js";
export { bootstrapDelvegen } from "./bootstrap.js";
export { computeMetrics, type DungeonMetrics } from "./analysis/metrics.js";
export { labelRegions, type RegionLabeling } from "./analysis/regions.js";
