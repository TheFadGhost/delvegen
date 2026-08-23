import { registerBuiltinAlgorithms } from "./algorithms/index.js";
import { registerPostPasses } from "./post/index.js";

/**
 * Register every built-in algorithm and post-processing pass.
 * Idempotent; call once at library/app/CLI startup.
 */
export function bootstrapDelvegen(): void {
  registerBuiltinAlgorithms();
  registerPostPasses();
}
