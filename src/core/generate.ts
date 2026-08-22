import { createRng } from "./rng.js";
import { FrameRecorder } from "./recorder.js";
import { DungeonGrid } from "./grid.js";
import { ValidationError, GenerationError } from "./errors.js";
import { resolveParams, makeGenerationContext, makePostContext } from "./types.js";
import type {
  GeneratedDungeon,
  GenerateOptions,
  GenerationContext,
  ResolvedParams,
} from "./types.js";
import { getAlgorithm } from "./algorithm-registry.js";
import { getPostPass, POST_PASS_ORDER } from "./post-registry.js";
import type { DungeonData } from "./types.js";
import { bfsDistances, farthestPair } from "./geometry.js";

export const DEFAULT_MAX_ATTEMPTS = 12;

/**
 * The one-call generation pipeline:
 *
 *   validate → [attempt: generate → post-process → verify connectivity]
 *             → place entrance/exit deterministically
 *
 * The connectivity guarantee: after the repair pass every walkable tile must
 * be reachable from the entrance. Verification is a flood fill over the final
 * grid. A failing attempt retries on a derived RNG stream; exceeding
 * maxAttempts raises GenerationError rather than returning a broken dungeon.
 */
export function generateDungeon(options: GenerateOptions): GeneratedDungeon {
  const def = getAlgorithm(options.algorithm);

  const width = options.width;
  const height = options.height;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new ValidationError(`width/height must be integers, got ${width}x${height}`);
  }
  // Dimension bounds are enforced by DungeonGrid's constructor below.
  new DungeonGrid(width, height); // validation only

  if (options.seed === "" || options.seed === null || options.seed === undefined) {
    throw new ValidationError("Seed must not be empty");
  }

  const params: ResolvedParams = resolveParams(def.params, options.params ?? {});
  def.validate(width, height, params);

  const postConfigs = normalizePostConfigs(options.post ?? {});
  // Validate all post-pass params up front so user errors never burn attempts.
  for (const [id, cfg] of Object.entries(postConfigs)) {
    const pass = getPostPass(id);
    const overrides = cfg === true ? {} : cfg;
    resolveParams(pass.params, overrides);
  }

  const recorder =
    options.recordFrames === true ? new FrameRecorder(width, height) : null;

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ValidationError(`maxAttempts must be a positive integer, got ${maxAttempts}`);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng(String(options.seed), `attempt-${attempt}`);
    const ctx: GenerationContext = makeGenerationContext({
      width,
      height,
      params,
      rng,
      recorder,
    });

    try {
      const data = def.generate(ctx);
      applyPostPasses(data, String(options.seed), postConfigs, recorder);
      verifyFullyConnected(data.grid);

      const pair = farthestPair(data.grid);
      if (!pair) throw new GenerationError("dungeon contains no walkable tiles");

      return {
        ...data,
        algorithm: def.id,
        seed: String(options.seed),
        entrance: pair[0],
        exit: pair[1],
        attemptsUsed: attempt + 1,
        frames: recorder ?? undefined,
        request: options,
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err; // user error: no retry
      lastError = err;
      recorder?.reset(); // a retried run must not keep stale frames
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new GenerationError(
    `Generation failed after ${maxAttempts} attempts (seed "${String(options.seed)}", ` +
      `algorithm "${def.id}"). Last error: ${detail}. Try different parameters.`,
  );
}

function normalizePostConfigs(
  post: Record<string, unknown>,
): Record<string, true | Record<string, unknown>> {
  const out: Record<string, true | Record<string, unknown>> = {};
  for (const [id, cfg] of Object.entries(post)) {
    getPostPass(id); // throws on unknown id
    if (cfg === false || cfg === undefined || cfg === null) continue;
    out[id] = cfg === true ? true : (cfg as Record<string, unknown>);
  }
  return out;
}

function applyPostPasses(
  data: DungeonData,
  seed: string,
  configs: Record<string, true | Record<string, unknown>>,
  recorder: FrameRecorder | null,
): void {
  for (const id of POST_PASS_ORDER) {
    const cfg = configs[id];
    if (!cfg) continue;
    const pass = getPostPass(id);
    const params = resolveParams(pass.params, cfg === true ? {} : cfg);
    const ctx = makePostContext({
      rng: createRng(seed, `post-${id}`),
      params,
      recorder,
    });
    pass.apply(data, ctx);
  }
}

/** Flood fill from the first walkable tile; every walkable tile must be reached. */
export function verifyFullyConnected(grid: DungeonGrid): void {
  const start = findFirstWalkable(grid);
  if (!start) throw new GenerationError("grid has no walkable tiles at all");
  const dist = bfsDistances(grid, [start]);
  for (let i = 0; i < dist.length; i++) {
    const walkable = (grid.tiles[i] as number) !== 0;
    if (walkable && (dist[i] as number) === -1) {
      throw new GenerationError("connectivity verification failed: unreachable region remains");
    }
  }
}

function findFirstWalkable(grid: DungeonGrid) {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.walkableAt(x, y)) return { x, y };
    }
  }
  return null;
}
