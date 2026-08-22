import type { PostPassDefinition } from "./types.js";
import { DelvegenError } from "./errors.js";

/**
 * Canonical application order for post-processing passes. Connectivity
 * repair runs FIRST (guarantee one region before anything else), dead-end
 * pruning second, doors third, wall thinning last (visual cleanup that must
 * not affect topology).
 */
export const POST_PASS_ORDER = ["repair", "prune", "doors", "thin"] as const;
export type PostPassId = (typeof POST_PASS_ORDER)[number];

const registry = new Map<string, PostPassDefinition>();

export function registerPostPass(def: PostPassDefinition): void {
  if (registry.has(def.id)) throw new DelvegenError(`Post pass id already registered: ${def.id}`);
  registry.set(def.id, def);
}

export function getPostPass(id: string): PostPassDefinition {
  const def = registry.get(id);
  if (!def) {
    throw new DelvegenError(
      `Unknown post pass "${id}". Available: ${[...registry.keys()].join(", ") || "(none registered)"}`,
    );
  }
  return def;
}

/** All registered passes in canonical pipeline order. */
export function listPostPasses(): PostPassDefinition[] {
  return POST_PASS_ORDER.map((id) => registry.get(id)).filter(
    (d): d is PostPassDefinition => d !== undefined,
  );
}
