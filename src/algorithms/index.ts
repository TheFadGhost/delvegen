import { registerAlgorithm } from "../core/algorithm-registry.js";
import { drunkardWalk } from "./drunkard.js";
import { bspSplit } from "./bsp.js";
import { roomsMst } from "./rooms-mst.js";
import { cellularCave } from "./cellular.js";
import { wangStitch } from "./wang.js";

export { drunkardWalk, bspSplit, roomsMst, cellularCave, wangStitch };

export function registerBuiltinAlgorithms(): void {
  registerAlgorithm(drunkardWalk);
  registerAlgorithm(bspSplit);
  registerAlgorithm(roomsMst);
  registerAlgorithm(cellularCave);
  registerAlgorithm(wangStitch);
}
