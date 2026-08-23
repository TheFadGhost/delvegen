import { DungeonGrid, MIN_DIMENSION, MAX_DIMENSION } from "../core/grid.js";
import type { Pos, RoomRect } from "../core/grid.js";
import { Tile } from "../core/tile.js";
import { ExportError } from "../core/errors.js";
import type { DungeonData, GeneratedDungeon } from "../core/types.js";

/** JSON-safe, versioned serialization of a generated dungeon. */
export interface DungeonJsonV1 {
  format: "delvegen-dungeon";
  version: 1;
  algorithm: string;
  seed: string;
  width: number;
  height: number;
  tiles: number[][];
  rooms: RoomRect[];
  entrance: Pos | null;
  exit: Pos | null;
  meta: Record<string, string | number>;
}

export type DungeonDataPlus = DungeonData & {
  algorithm: string;
  seed: string;
  entrance: Pos | null;
  exit: Pos | null;
};

export function exportDungeonJson(d: GeneratedDungeon): DungeonJsonV1 {
  const tiles: number[][] = [];
  for (let y = 0; y < d.grid.height; y++) {
    const row: number[] = new Array(d.grid.width);
    for (let x = 0; x < d.grid.width; x++) row[x] = d.grid.get(x, y);
    tiles.push(row);
  }
  return {
    format: "delvegen-dungeon",
    version: 1,
    algorithm: d.algorithm,
    seed: d.seed,
    width: d.grid.width,
    height: d.grid.height,
    tiles,
    rooms: d.rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
    entrance: { x: d.entrance.x, y: d.entrance.y },
    exit: { x: d.exit.x, y: d.exit.y },
    meta: { ...d.meta },
  };
}

type Rec = Record<string, unknown>;

function asObject(v: unknown, what: string): Rec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ExportError(`${what}: expected an object`);
  }
  return v as Rec;
}

function asInt(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ExportError(`${what}: expected an integer, got ${describe(v)}`);
  }
  if (v < min || v > max) {
    throw new ExportError(`${what}: ${v} is out of range [${min}, ${max}]`);
  }
  return v;
}

function asString(v: unknown, what: string): string {
  if (typeof v !== "string") {
    throw new ExportError(`${what}: expected a string, got ${describe(v)}`);
  }
  return v;
}

function describe(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "an array";
  return "an object";
}

function asPosOrNull(v: unknown, what: string, width: number, height: number): Pos | null {
  if (v === null) return null;
  const o = asObject(v, what);
  return {
    x: asInt(o.x, `${what}.x`, 0, width - 1),
    y: asInt(o.y, `${what}.y`, 0, height - 1),
  };
}

/**
 * Validate untrusted JSON against the v1 schema and rebuild a DungeonData.
 * Every field is checked; any deviation throws ExportError with a precise
 * message naming the offending field.
 */
export function importDungeonJson(obj: unknown): DungeonDataPlus {
  const root = asObject(obj, "dungeon JSON");
  if (root.format !== "delvegen-dungeon") {
    throw new ExportError(
      `dungeon JSON: "format" must be "delvegen-dungeon", got ${describe(root.format)}`,
    );
  }
  if (root.version !== 1) {
    throw new ExportError(`dungeon JSON: unsupported version ${describe(root.version)}, expected 1`);
  }

  const algorithm = asString(root.algorithm, '"algorithm"');
  const seed = asString(root.seed, '"seed"');
  if (seed.length === 0) throw new ExportError('"seed": must not be empty');
  const width = asInt(root.width, '"width"', MIN_DIMENSION, MAX_DIMENSION);
  const height = asInt(root.height, '"height"', MIN_DIMENSION, MAX_DIMENSION);

  if (!Array.isArray(root.tiles)) {
    throw new ExportError(`"tiles": expected an array of rows, got ${describe(root.tiles)}`);
  }
  if (root.tiles.length !== height) {
    throw new ExportError(`"tiles": expected ${height} rows, got ${root.tiles.length}`);
  }
  const values: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: unknown = root.tiles[y];
    if (!Array.isArray(row)) {
      throw new ExportError(`tiles[${y}]: expected an array, got ${describe(row)}`);
    }
    if (row.length !== width) {
      throw new ExportError(`tiles[${y}]: has length ${row.length}, expected ${width}`);
    }
    const out: number[] = new Array(width);
    for (let x = 0; x < width; x++) {
      out[x] = asInt(row[x], `tiles[${y}][${x}]`, Tile.Wall, Tile.Door);
    }
    values.push(out);
  }

  if (!Array.isArray(root.rooms)) {
    throw new ExportError(`"rooms": expected an array, got ${describe(root.rooms)}`);
  }
  const rooms: RoomRect[] = root.rooms.map((raw, i) => {
    const o = asObject(raw, `rooms[${i}]`);
    const id = asInt(o.id, `rooms[${i}].id`, 0, Number.MAX_SAFE_INTEGER);
    const x = asInt(o.x, `rooms[${i}].x`, 0, width - 1);
    const y = asInt(o.y, `rooms[${i}].y`, 0, height - 1);
    const w = asInt(o.w, `rooms[${i}].w`, 1, width - x);
    const h = asInt(o.h, `rooms[${i}].h`, 1, height - y);
    return { id, x, y, w, h };
  });

  const entrance = asPosOrNull(root.entrance, '"entrance"', width, height);
  const exit = asPosOrNull(root.exit, '"exit"', width, height);

  const metaObj = asObject(root.meta, '"meta"');
  const meta: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(metaObj)) {
    if (typeof v === "string") {
      meta[k] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      meta[k] = v;
    } else {
      throw new ExportError(`meta["${k}"]: expected a string or finite number, got ${describe(v)}`);
    }
  }

  const grid = new DungeonGrid(width, height);
  for (let y = 0; y < height; y++) grid.tiles.set(values[y], y * width);

  return { grid, rooms, algorithm, seed, entrance, exit, meta };
}
