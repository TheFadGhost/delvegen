import { DungeonGrid, MIN_DIMENSION, MAX_DIMENSION } from "../core/grid.js";
import type { Pos } from "../core/grid.js";
import { Tile, asciiCharFor, tileFromAscii } from "../core/tile.js";
import { ExportError } from "../core/errors.js";
import type { GeneratedDungeon } from "../core/types.js";

/**
 * Render the dungeon as plain text: '#' wall, '.' room floor, ',' corridor,
 * '+' door. The entrance tile renders '<' and the exit '>' regardless of the
 * terrain beneath them (both are walkable in practice).
 */
export function exportAscii(d: GeneratedDungeon): string {
  const rows: string[] = [];
  for (let y = 0; y < d.grid.height; y++) {
    let row = "";
    for (let x = 0; x < d.grid.width; x++) {
      if (d.entrance.x === x && d.entrance.y === y) {
        row += "<";
      } else if (d.exit.x === x && d.exit.y === y) {
        row += ">";
      } else {
        row += asciiCharFor(d.grid.get(x, y));
      }
    }
    rows.push(row);
  }
  return rows.join("\n");
}

export interface AsciiImportResult {
  grid: DungeonGrid;
  entrance: Pos | null;
  exit: Pos | null;
}

/**
 * Parse exported ASCII back into a grid. '<'/'>' become CorridorFloor with
 * their positions recorded. Throws ExportError on ragged rows, unknown
 * characters, duplicate markers, or dimensions outside MIN/MAX bounds.
 */
export function importAscii(text: string): AsciiImportResult {
  if (typeof text !== "string") {
    throw new ExportError(`ASCII import: expected a string, got ${typeof text}`);
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // A single trailing newline is a line terminator, not an empty extra row.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    throw new ExportError("ASCII import: input contains no rows");
  }

  const height = lines.length;
  const width = lines[0].length;
  for (let y = 1; y < height; y++) {
    if (lines[y].length !== width) {
      throw new ExportError(
        `ASCII import: line ${y + 1} has length ${lines[y].length}, expected ${width} (map must be rectangular)`,
      );
    }
  }
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new ExportError(
      `ASCII import: grid ${width}x${height} is below minimum ${MIN_DIMENSION}x${MIN_DIMENSION}`,
    );
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new ExportError(
      `ASCII import: grid ${width}x${height} exceeds maximum ${MAX_DIMENSION}x${MAX_DIMENSION}`,
    );
  }

  const grid = new DungeonGrid(width, height);
  let entrance: Pos | null = null;
  let exit: Pos | null = null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = lines[y][x];
      if (ch === "<" || ch === ">") {
        if (ch === "<") {
          if (entrance) {
            throw new ExportError(
              `ASCII import: duplicate entrance '<' at line ${y + 1}, column ${x + 1}`,
            );
          }
          entrance = { x, y };
        } else {
          if (exit) {
            throw new ExportError(
              `ASCII import: duplicate exit '>' at line ${y + 1}, column ${x + 1}`,
            );
          }
          exit = { x, y };
        }
        grid.set(x, y, Tile.CorridorFloor);
        continue;
      }
      const tile = tileFromAscii(ch);
      if (tile === undefined) {
        throw new ExportError(
          `ASCII import: unknown character "${ch}" at line ${y + 1}, column ${x + 1}`,
        );
      }
      grid.set(x, y, tile);
    }
  }
  return { grid, entrance, exit };
}
