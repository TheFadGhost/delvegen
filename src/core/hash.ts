import type { DungeonData } from "./types.js";
import { asciiCharFor } from "./tile.js";

/**
 * Deterministic content fingerprint of a dungeon (seed-independent — two
 * different seeds can legitimately collide in output, that is fine).
 *
 * Two 32-bit FNV-1a lanes over: dimensions, tile bytes, room rects,
 * entrance/exit. Pure integer math → identical on every platform.
 */
export function dungeonHash(d: DungeonData & { entrance?: { x: number; y: number }; exit?: { x: number; y: number } }): string {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x01000193 | 0;
  const mix = (byte: number) => {
    h1 = Math.imul(h1 ^ (byte & 0xff), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (byte & 0xff), 0x85ebca6b) >>> 0;
  };
  const mixInt = (v: number) => {
    // Mix as signed 32-bit little-endian bytes.
    const x = v | 0;
    mix(x & 0xff);
    mix((x >>> 8) & 0xff);
    mix((x >>> 16) & 0xff);
    mix((x >>> 24) & 0xff);
  };
  mixInt(d.grid.width);
  mixInt(d.grid.height);
  for (let i = 0; i < d.grid.tiles.length; i++) mix(d.grid.tiles[i] as number);
  mixInt(d.rooms.length);
  for (const r of d.rooms) {
    mixInt(r.id);
    mixInt(r.x);
    mixInt(r.y);
    mixInt(r.w);
    mixInt(r.h);
  }
  if (d.entrance && d.exit) {
    mixInt(d.entrance.x);
    mixInt(d.entrance.y);
    mixInt(d.exit.x);
    mixInt(d.exit.y);
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Stable ASCII rendering used by golden tests and debugging. */
export function dungeonAscii(d: DungeonData): string {
  const rows: string[] = [];
  for (let y = 0; y < d.grid.height; y++) {
    let row = "";
    for (let x = 0; x < d.grid.width; x++) row += asciiCharFor(d.grid.get(x, y));
    rows.push(row);
  }
  return rows.join("\n");
}
