import type { DungeonGrid, RoomRect, Pos } from "./grid.js";
import { ValidationError } from "./errors.js";
import type { Rng } from "./rng.js";
import type { FrameRecorder } from "./recorder.js";

/* ------------------------------------------------------------------ */
/* Parameters                                                          */
/* ------------------------------------------------------------------ */

export interface BaseParamSpec {
  key: string;
  label: string;
  description: string;
}

export interface IntParamSpec extends BaseParamSpec {
  type: "int";
  min: number;
  max: number;
  step?: number;
  default: number;
}

export interface FloatParamSpec extends BaseParamSpec {
  type: "float";
  min: number;
  max: number;
  step?: number;
  default: number;
}

export interface BoolParamSpec extends BaseParamSpec {
  type: "bool";
  default: boolean;
}

export interface EnumParamSpec extends BaseParamSpec {
  type: "enum";
  options: ReadonlyArray<{ value: string; label: string }>;
  default: string;
}

export type ParamSpec = IntParamSpec | FloatParamSpec | BoolParamSpec | EnumParamSpec;

/** Fully-resolved parameters (defaults merged in). */
export type ResolvedParams = Record<string, number | boolean | string>;

/** Merge a param list with user overrides, clamping numbers into range. */
export function resolveParams(
  specs: readonly ParamSpec[],
  overrides?: Record<string, unknown>,
): ResolvedParams {
  const out: ResolvedParams = {};
  for (const spec of specs) {
    const raw = overrides?.[spec.key];
    if (raw === undefined || raw === null) {
      out[spec.key] = spec.default;
      continue;
    }
    switch (spec.type) {
      case "int":
      case "float": {
        const num = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(num)) {
          throw new ValidationError(`${spec.label}: expected a number, got "${String(raw)}"`);
        }
        const clamped = Math.min(spec.max, Math.max(spec.min, num));
        out[spec.key] = spec.type === "int" ? Math.round(clamped) : clamped;
        break;
      }
      case "bool": {
        if (typeof raw !== "boolean") {
          throw new ValidationError(`${spec.label}: expected true or false`);
        }
        out[spec.key] = raw;
        break;
      }
      case "enum": {
        const value = String(raw);
        if (!spec.options.some((o) => o.value === value)) {
          const allowed = spec.options.map((o) => o.value).join(", ");
          throw new ValidationError(`${spec.label}: "${value}" is not one of: ${allowed}`);
        }
        out[spec.key] = value;
        break;
      }
    }
  }
  // Reject unknown keys so typos surface instead of silently doing nothing.
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (!specs.some((s) => s.key === key)) {
        throw new ValidationError(`Unknown parameter "${key}"`);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Generation contracts                                                */
/* ------------------------------------------------------------------ */

export interface GenerationContext {
  width: number;
  height: number;
  /** Validated, fully-resolved parameters for THIS algorithm. */
  params: ResolvedParams;
  rng: Rng;
  /** Null when the caller did not ask for frame recording. */
  recorder: FrameRecorder | null;
  /** Convenience: record current state when recording is active. */
  record(label: string, grid: DungeonGrid, rooms: readonly RoomRect[]): void;
  /** Typed param accessors (values were validated by resolveParams). */
  num(key: string): number;
  bool(key: string): boolean;
  str(key: string): string;
}

export function makeGenerationContext(
  base: Omit<GenerationContext, "record" | "num" | "bool" | "str">,
): GenerationContext {
  return {
    ...base,
    record(label, grid, rooms) {
      base.recorder?.record(label, grid, rooms);
    },
    num(key) {
      return base.params[key] as number;
    },
    bool(key) {
      return base.params[key] as boolean;
    },
    str(key) {
      return base.params[key] as string;
    },
  };
}

export interface DungeonData {
  grid: DungeonGrid;
  rooms: RoomRect[];
  /** Free-form algorithm notes surfaced in the UI/metrics. */
  meta: Record<string, number | string>;
}

export interface GeneratorDefinition {
  id: string;
  name: string;
  /** One-liner shown in the picker. */
  summary: string;
  /** Multi-paragraph technique explanation for docs/UI info panel. */
  technique: string;
  params: readonly ParamSpec[];
  /**
   * Throw ValidationError (naming the parameter and its valid range) when
   * this width/height/params combination cannot work.
   */
  validate(width: number, height: number, params: ResolvedParams): void;
  generate(ctx: GenerationContext): DungeonData;
}

export interface PostPassDefinition {
  id: string;
  name: string;
  summary: string;
  params: readonly ParamSpec[];
  /** May mutate the dungeon in place. */
  apply(dungeon: DungeonData, ctx: PostContext): void;
}

export interface PostContext {
  rng: Rng;
  params: ResolvedParams;
  recorder?: FrameRecorder | null;
  record(label: string, dungeon: DungeonData): void;
  num(key: string): number;
  bool(key: string): boolean;
}

export function makePostContext(
  base: Omit<PostContext, "record" | "num" | "bool">,
): PostContext {
  return {
    ...base,
    record(label, dungeon) {
      base.recorder?.record(label, dungeon.grid, dungeon.rooms);
    },
    num(key) {
      return base.params[key] as number;
    },
    bool(key) {
      return base.params[key] as boolean;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Requests / results                                                  */
/* ------------------------------------------------------------------ */

/** Per-post-pass config: `true` enables with defaults, object enables with overrides. */
export type PostPassConfig = boolean | Record<string, unknown>;

export interface GenerateOptions {
  algorithm: string;
  seed: string | number;
  width: number;
  height: number;
  /** Overrides for the algorithm's own params. Unknown keys are rejected. */
  params?: Record<string, unknown>;
  /** Keyed by post-pass id. Order of application is fixed by the pipeline. */
  post?: Record<string, PostPassConfig>;
  /** Capture per-step frames for the step-through visualizer. */
  recordFrames?: boolean;
  /** Bounded retry budget for the connectivity guarantee. Default 12. */
  maxAttempts?: number;
}

export interface GeneratedDungeon extends DungeonData {
  algorithm: string;
  seed: string;
  entrance: Pos;
  exit: Pos;
  attemptsUsed: number;
  /** Present only when request.recordFrames was set. */
  frames?: FrameRecorder;
  request: GenerateOptions;
}
