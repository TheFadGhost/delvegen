import { registerPostPass } from "../core/post-registry.js";
import { repairConnectivity } from "./repair.js";
import { pruneDeadEnds } from "./prune.js";
import { placeDoors } from "./doors.js";
import { thinWalls } from "./thinwalls.js";

export { repairConnectivity, pruneDeadEnds, placeDoors, thinWalls };

let registered = false;

/** Registers the four built-in post passes once; repeat calls are no-ops. */
export function registerPostPasses(): void {
  if (registered) return;
  registered = true;
  registerPostPass(repairConnectivity);
  registerPostPass(pruneDeadEnds);
  registerPostPass(placeDoors);
  registerPostPass(thinWalls);
}
