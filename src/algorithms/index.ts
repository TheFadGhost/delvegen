import { registerAlgorithm } from "../core/algorithm-registry.js";
import { drunkardWalk } from "./drunkard.js";

export { drunkardWalk };

export function registerBuiltinAlgorithms(): void {
  registerAlgorithm(drunkardWalk);
}
