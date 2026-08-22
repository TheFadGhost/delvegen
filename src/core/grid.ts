import { Tile } from "./tile.js";
import { ValidationError } from "./errors.js";

export interface Pos {
  x: number;
  y: number;
}

export interface RoomRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The tile grid. A thin typed wrapper over a Uint8Array of Tile values with
 * bounds-checked accessors and bulk helpers used by every algorithm.
 */
export class DungeonGrid {
  readonly tiles: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: Tile = Tile.Wall,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      throw new ValidationError(`Grid dimensions must be integers, got ${width}x${height}`);
    }
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw new ValidationError(
        `Grid too small: minimum is ${MIN_DIMENSION}x${MIN_DIMENSION}, got ${width}x${height}`,
      );
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new ValidationError(
        `Grid too large: maximum is ${MAX_DIMENSION}x${MAX_DIMENSION}, got ${width}x${height}`,
      );
    }
    this.tiles = new Uint8Array(width * height);
    if (fill !== Tile.Wall) this.tiles.fill(fill);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Tile {
    return this.tiles[this.index(x, y)] as Tile;
  }

  set(x: number, y: number, t: Tile): void {
    if (!this.inBounds(x, y)) return; // clamping write: algorithms carve past edges freely
    this.tiles[this.index(x, y)] = t;
  }

  walkableAt(x: number, y: number): boolean {
    return this.inBounds(x, y) && (this.tiles[this.index(x, y)] as Tile) !== Tile.Wall;
  }

  fillRect(x: number, y: number, w: number, h: number, t: Tile): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      this.tiles.fill(t, yy * this.width + x0, yy * this.width + x1);
    }
  }

  clone(): DungeonGrid {
    const copy = new DungeonGrid(this.width, this.height);
    copy.tiles.set(this.tiles);
    return copy;
  }

  /** Count tiles equal to `t`. */
  count(t: Tile): number {
    let n = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      if ((this.tiles[i] as Tile) === t) n++;
    }
    return n;
  }
}

export const MIN_DIMENSION = 5;
export const MAX_DIMENSION = 512;

/** Validate a width/height pair coming from user input. */
export function assertDimensions(width: number, height: number): void {
  // Constructing a grid runs the same checks; do it cheaply without allocating.
  new DungeonGrid(width, height);
}
