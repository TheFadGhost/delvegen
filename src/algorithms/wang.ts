import { DungeonGrid, type RoomRect } from "../core/grid.js";
import { Tile } from "../core/tile.js";
import { ValidationError } from "../core/errors.js";
import type { GenerationContext, GeneratorDefinition } from "../core/types.js";
import { WANG_PACK, assertPackValid, type WangTemplate } from "./wang-templates.js";

/* Edge bits shared with the template pack: bit0=N bit1=E bit2=S bit3=W. */
const EDGE_N = 1;
const EDGE_E = 2;
const EDGE_S = 4;
const EDGE_W = 8;

/** Template glyph -> terrain. */
const GLYPH_TILES: Record<string, Tile | undefined> = {
  "#": Tile.Wall,
  ".": Tile.RoomFloor,
  ",": Tile.CorridorFloor,
};

const CORRIDOR_HINT = /straight|corridor/;
const CHAMBER_HINT = /chamber|hall|room|pillars|alcove/;

/** Pack grouped by edge signature so stamping never scans the whole pack. */
const BY_SIGNATURE = new Map<number, WangTemplate[]>();
for (const tpl of WANG_PACK) {
  const list = BY_SIGNATURE.get(tpl.edges);
  if (list) list.push(tpl);
  else BY_SIGNATURE.set(tpl.edges, [tpl]);
}

function pickTemplate(edges: number, mix: string, ctx: GenerationContext): WangTemplate {
  const matches = BY_SIGNATURE.get(edges);
  if (!matches || matches.length === 0) {
    throw new Error(`wang stitch: no template covers edge signature ${edges}`);
  }
  let pool = matches;
  if (mix === "corridor") {
    const preferred = matches.filter((t) => CORRIDOR_HINT.test(t.name));
    if (preferred.length > 0) pool = preferred;
  } else if (mix === "chamber") {
    const preferred = matches.filter((t) => CHAMBER_HINT.test(t.name));
    if (preferred.length > 0) pool = preferred;
  }
  return ctx.rng.pick(pool);
}

/** Disjoint-set over cell ids that tracks how many groups remain. */
class ComponentSet {
  private readonly parent: Int32Array;
  components: number;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
    this.components = size;
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    while (this.parent[i] !== root) {
      const next = this.parent[i] as number;
      this.parent[i] = root;
      i = next;
    }
    return root;
  }

  /** Merges the sets holding a and b; true when two groups became one. */
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[rb] = ra;
    this.components--;
    return true;
  }
}

/**
 * Wang-tile-style template stitching.
 *
 * The map divides into 16x16 cells anchored at (1,1); leftover strips at the
 * right/bottom edges stay solid wall. Every interior edge between two cells
 * starts OPEN by lottery; a union-find repair pass flips just enough closed
 * edges to leave one connected group of cells. Each cell is then stamped from
 * a hand-drawn template matching its 4-bit open-edge signature - centred
 * openings on open edges make neighbouring stamps align seamlessly.
 *
 * Produces: blocky modular dungeons whose rooms, halls and corridors always
 * join up, no matter what the lottery did.
 */
export const wangStitch: GeneratorDefinition = {
  id: "wang",
  name: "Wang Template Stitch",
  summary: "Hand-drawn 16x16 room tiles stitched together by matching doors.",
  technique:
    "The grid divides into 16x16 template cells starting at (1,1) (right/bottom leftover " +
    "strips remain solid wall). Phase 1, edge lottery: every interior edge between two " +
    "cells starts OPEN with probability Openness%, boundary edges stay sealed. Phase 2, " +
    "link components: a union-find tracks which cells are joined through open edges; " +
    "while more than one group remains, the first closed edge in a fixed scan order whose " +
    "sides belong to different groups is flipped open. This provably terminates because " +
    "every flip merges exactly two groups. Phase 3, stamping: each cell's four edges read " +
    "as a 4-bit signature (bit0=N bit1=E bit2=S bit3=W, set = open) and select a matching " +
    "template from the pack; templates guarantee centred 4-wide openings on open edges and " +
    "fully sealed wall edges, so adjacent stamps line up without seams. Variant Mix biases " +
    "the template draw toward corridors or chambers. Phase 4, rooms: maximal axis-aligned " +
    "rectangles of room floor (at least 3x3) are harvested greedily for room metrics.",
  params: [
    {
      key: "tileSize",
      label: "Tile size",
      description: "Edge length of the stitched template cells.",
      type: "enum",
      options: [{ value: "16", label: "16" }],
      default: "16",
    },
    {
      key: "openness",
      label: "Openness %",
      description: "Chance an interior edge starts open before repair links the rest.",
      type: "float",
      min: 20,
      max: 90,
      step: 1,
      default: 55,
    },
    {
      key: "variantMix",
      label: "Variant mix",
      description: "Bias the template draw: all-round, corridor-heavy or chamber-heavy.",
      type: "enum",
      options: [
        { value: "varied", label: "Varied" },
        { value: "corridor", label: "Corridors" },
        { value: "chamber", label: "Chambers" },
      ],
      default: "varied",
    },
  ],

  validate(width, height) {
    if (width < 34 || height < 34) {
      throw new ValidationError(
        `Grid ${width}x${height} is too small for template stitching; wang needs at least ` +
          `34x34 so two cells fit.`,
      );
    }
  },

  generate(ctx: GenerationContext) {
    assertPackValid();

    const width = ctx.width;
    const height = ctx.height;
    const grid = new DungeonGrid(width, height, Tile.Wall);
    const rooms: RoomRect[] = [];

    const cell = Number(ctx.str("tileSize"));
    const openness = ctx.num("openness");
    const mix = ctx.str("variantMix");

    // Cells are laid out from (1,1) while they fully fit inside the border.
    const cols = Math.floor((width - 1) / cell);
    const rows = Math.floor((height - 1) / cell);

    /* Edge grids. vert[col][row] sits between cell columns col-1 and col
     * (col 0 / col cols are the map boundary); horiz[row][col] likewise. */
    const vert = new Uint8Array((cols + 1) * rows);
    const horiz = new Uint8Array((rows + 1) * cols);
    const vi = (col: number, row: number): number => col * rows + row;
    const hi = (row: number, col: number): number => row * cols + col;
    const cellId = (col: number, row: number): number => row * cols + col;

    // Phase 1: edge lottery over interior edges in a fixed order.
    for (let col = 0; col <= cols; col++) {
      for (let row = 0; row < rows; row++) {
        const boundary = col === 0 || col === cols;
        vert[vi(col, row)] = !boundary && ctx.rng.chance(openness / 100) ? 1 : 0;
      }
    }
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col < cols; col++) {
        const boundary = row === 0 || row === rows;
        horiz[hi(row, col)] = !boundary && ctx.rng.chance(openness / 100) ? 1 : 0;
      }
    }
    ctx.record(`edge lottery (${openness}% open)`, grid, rooms);

    // Seed the union-find with everything the lottery already joined.
    const groups = new ComponentSet(cols * rows);
    for (let col = 1; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        if (vert[vi(col, row)] === 1) groups.union(cellId(col - 1, row), cellId(col, row));
      }
    }
    for (let row = 1; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (horiz[hi(row, col)] === 1) groups.union(cellId(col, row - 1), cellId(col, row));
      }
    }

    // Phase 2: repair - flip the first separating closed edge until one group
    // remains. Deterministic order: vertical edges column-major top-to-bottom,
    // then horizontal edges row-major left-to-right.
    let linksAdded = 0;
    ctx.record(`link components (${groups.components} groups)`, grid, rooms);
    while (groups.components > 1) {
      let merged = false;
      for (let col = 1; col < cols && !merged; col++) {
        for (let row = 0; row < rows && !merged; row++) {
          if (
            vert[vi(col, row)] === 0 &&
            groups.union(cellId(col - 1, row), cellId(col, row))
          ) {
            vert[vi(col, row)] = 1;
            linksAdded++;
            merged = true;
          }
        }
      }
      for (let row = 1; row < rows && !merged; row++) {
        for (let col = 0; col < cols && !merged; col++) {
          if (
            horiz[hi(row, col)] === 0 &&
            groups.union(cellId(col, row - 1), cellId(col, row))
          ) {
            horiz[hi(row, col)] = 1;
            linksAdded++;
            merged = true;
          }
        }
      }
      if (!merged) throw new Error("wang stitch: repair could not link remaining components");
      ctx.record("link components", grid, rooms);
    }

    // Phase 3: stamp one template per cell from its final 4-bit signature.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const edges =
          (horiz[hi(r, c)] === 1 ? EDGE_N : 0) |
          (vert[vi(c + 1, r)] === 1 ? EDGE_E : 0) |
          (horiz[hi(r + 1, c)] === 1 ? EDGE_S : 0) |
          (vert[vi(c, r)] === 1 ? EDGE_W : 0);
        const tpl = pickTemplate(edges, mix, ctx);
        const ox = 1 + c * cell;
        const oy = 1 + r * cell;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const glyph = tpl.pattern[y]!.charAt(x);
            const tile = GLYPH_TILES[glyph];
            if (tile === undefined) {
              throw new Error(`wang stitch: bad glyph "${glyph}" in template "${tpl.name}"`);
            }
            grid.set(ox + x, oy + y, tile);
          }
        }
      }
      ctx.record(`stamp row ${r}`, grid, rooms);
    }

    // Phase 4: harvest maximal axis-aligned RoomFloor rects (>= 3x3).
    const claimed = new Uint8Array(width * height);
    let nextId = 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grid.tiles[y * width + x] !== Tile.RoomFloor) continue;
        if (claimed[y * width + x] === 1) continue;
        let w = 0;
        while (
          x + w < width &&
          grid.tiles[y * width + x + w] === Tile.RoomFloor &&
          claimed[y * width + x + w] === 0
        ) {
          w++;
        }
        let h = 0;
        grow: while (y + h < height) {
          for (let dx = 0; dx < w; dx++) {
            const idx = (y + h) * width + x + dx;
            if (grid.tiles[idx] !== Tile.RoomFloor || claimed[idx] === 1) break grow;
          }
          h++;
        }
        if (w >= 3 && h >= 3) {
          for (let yy = y; yy < y + h; yy++) {
            claimed.fill(1, yy * width + x, yy * width + x + w);
          }
          rooms.push({ id: nextId++, x, y, w, h });
        }
        x += w;
      }
    }

    return {
      grid,
      rooms,
      meta: { cells: cols * rows, linksAdded },
    };
  },
};
