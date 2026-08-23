import { deflateSync } from "node:zlib";
import type { GeneratedDungeon } from "../core/types.js";
import { Tile } from "../core/tile.js";
import { getTheme } from "../ui/themes.js";
import type { Theme } from "../ui/themes.js";

export interface PngRenderOptions {
  /** Pixels per tile. Default 8, clamped to 1..32. */
  tileSize?: number;
  /** Theme id; unknown ids fall back to the first theme. Default "dark". */
  themeId?: string;
  /** Device scale hint. Intentionally ignored. */
  scale?: number;
}

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [255, 0, 255];
  const n = parseInt(m[1], 16);
  return [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

interface Palette {
  wall: Rgb;
  room: Rgb;
  corridor: Rgb;
  doorFill: Rgb;
  doorBar: Rgb;
  entrance: Rgb;
  exit: Rgb;
}

function paletteFor(theme: Theme): Palette {
  const t = theme.tiles;
  return {
    wall: hexToRgb(t.wall),
    room: hexToRgb(t.room),
    corridor: hexToRgb(t.corridor),
    doorFill: hexToRgb(t.doorFill),
    doorBar: hexToRgb(t.doorBar),
    entrance: hexToRgb(t.entrance),
    exit: hexToRgb(t.exit),
  };
}

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

// Standard PNG CRC-32 (reflected polynomial 0xEDB88320), table-driven.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Chunk layout: [u32 BE length][4-byte ascii type][data][u32 BE crc(type+data)].
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Rasterize the dungeon to PNG bytes. Base terrain plus entrance/exit markers
 * only — dead ends and unreachable overlays are skipped in the CLI renderer.
 */
export function renderPng(d: GeneratedDungeon, opts?: PngRenderOptions): Uint8Array {
  let ts = opts?.tileSize ?? 8;
  if (!Number.isFinite(ts)) ts = 8;
  ts = Math.round(ts);
  ts = Math.min(32, Math.max(1, ts));
  const pal = paletteFor(getTheme(opts?.themeId ?? "dark"));

  const gw = d.grid.width;
  const gh = d.grid.height;
  const w = gw * ts;
  const h = gh * ts;

  // Rasterize as RGBA, then strip alpha into RGB scanlines below.
  const rgba = new Uint8Array(w * h * 4);
  const px = (x: number, y: number, c: Rgb): void => {
    const i = (y * w + x) * 4;
    rgba[i] = c[0];
    rgba[i + 1] = c[1];
    rgba[i + 2] = c[2];
    rgba[i + 3] = 255;
  };
  const fillTile = (tx: number, ty: number, c: Rgb): void => {
    for (let y = 0; y < ts; y++) {
      for (let x = 0; x < ts; x++) px(tx * ts + x, ty * ts + y, c);
    }
  };

  // Bar thickness ~40% of the tile, centered.
  const barTh = Math.max(1, Math.round(ts * 0.4));
  const barOff = Math.floor((ts - barTh) / 2);

  for (let ty = 0; ty < gh; ty++) {
    for (let tx = 0; tx < gw; tx++) {
      const tile = d.grid.get(tx, ty);
      if (
        d.entrance.x === tx && d.entrance.y === ty ||
        d.exit.x === tx && d.exit.y === ty
      ) continue; // markers drawn after terrain

      switch (tile) {
        case Tile.Wall:
          fillTile(tx, ty, pal.wall);
          break;
        case Tile.RoomFloor:
          fillTile(tx, ty, pal.room);
          break;
        case Tile.CorridorFloor:
          fillTile(tx, ty, pal.corridor);
          break;
        case Tile.Door: {
          fillTile(tx, ty, pal.doorFill);
          // Horizontal bar when the passage runs vertically through the door.
          const verticalPassage =
            d.grid.walkableAt(tx, ty - 1) && d.grid.walkableAt(tx, ty + 1);
          const horizontalPassage =
            d.grid.walkableAt(tx - 1, ty) && d.grid.walkableAt(tx + 1, ty);
          if (verticalPassage || !horizontalPassage) {
            for (let y = barOff; y < barOff + barTh; y++) {
              for (let x = 0; x < ts; x++) px(tx * ts + x, ty * ts + y, pal.doorBar);
            }
          } else {
            for (let y = 0; y < ts; y++) {
              for (let x = barOff; x < barOff + barTh; x++) {
                px(tx * ts + x, ty * ts + y, pal.doorBar);
              }
            }
          }
          break;
        }
      }
    }
  }

  // Markers overwrite whatever terrain sits beneath them.
  const drawMarker = (pos: { x: number; y: number }, color: Rgb, shape: "ring" | "diamond"): void => {
    fillTile(pos.x, pos.y, pal.corridor);
    const half = ts / 2;
    for (let py = 0; py < ts; py++) {
      for (let pxx = 0; pxx < ts; pxx++) {
        // Tile-normalized distance from the tile center.
        const nx = (pxx + 0.5 - half) / ts;
        const ny = (py + 0.5 - half) / ts;
        const dist =
          shape === "ring"
            ? Math.sqrt(nx * nx + ny * ny)
            : Math.abs(nx) + Math.abs(ny); // L1 norm approximates a diamond outline
        if (dist >= 0.28 && dist <= 0.42) px(pos.x * ts + pxx, pos.y * ts + py, color);
      }
    }
  };
  drawMarker(d.entrance, pal.entrance, "ring");
  drawMarker(d.exit, pal.exit, "diamond");

  // RGBA raster -> RGB scanlines with filter byte 0 per row.
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      raw[o++] = rgba[s];
      raw[o++] = rgba[s + 1];
      raw[o++] = rgba[s + 2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method 0
  ihdr[12] = 0; // no interlace

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
