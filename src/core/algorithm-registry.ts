import type { GeneratorDefinition } from "./types.js";
import { DelvegenError } from "./errors.js";

const registry = new Map<string, GeneratorDefinition>();
const order: string[] = [];

export function registerAlgorithm(def: GeneratorDefinition): void {
  if (registry.has(def.id)) throw new DelvegenError(`Algorithm id already registered: ${def.id}`);
  registry.set(def.id, def);
  order.push(def.id);
}

export function getAlgorithm(id: string): GeneratorDefinition {
  const def = registry.get(id);
  if (!def) {
    throw new DelvegenError(
      `Unknown algorithm "${id}". Available: ${order.join(", ") || "(none registered)"}`,
    );
  }
  return def;
}

export function listAlgorithms(): GeneratorDefinition[] {
  return order.map((id) => registry.get(id) as GeneratorDefinition);
}
