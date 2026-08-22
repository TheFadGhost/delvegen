/**
 * Tile terrain kinds stored in the grid. Walkable kinds are RoomFloor,
 * CorridorFloor and Door; Wall is solid rock.
 *
 * Entrance/exit/dead-ends/unreachable are NOT tile kinds: they are derived
 * overlays (positions or analysis results), so the grid stays a pure terrain
 * map and exports round-trip exactly.
 */
export const Tile = {
  Wall: 0,
  RoomFloor: 1,
  CorridorFloor: 2,
  Door: 3,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const TILE_COUNT = 4;

export function isWalkable(t: Tile): boolean {
  return t !== Tile.Wall;
}

/** Plain-text ASCII mapping used by the ASCII exporter/importer. */
export function asciiCharFor(t: Tile): string {
  switch (t) {
    case Tile.Wall:
      return "#";
    case Tile.RoomFloor:
      return ".";
    case Tile.CorridorFloor:
      return ",";
    case Tile.Door:
      return "+";
  }
}

export function tileFromAscii(ch: string): Tile | undefined {
  switch (ch) {
    case "#":
      return Tile.Wall;
    case ".":
      return Tile.RoomFloor;
    case ",":
      return Tile.CorridorFloor;
    case "+":
      return Tile.Door;
    default:
      return undefined;
  }
}
