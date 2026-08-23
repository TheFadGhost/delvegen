/**
 * Hand-drawn 16x16 templates for Wang-style stitching.
 *
 * Glyphs: '#' = wall, '.' = room floor, ',' = corridor floor.
 * Edge bits: bit0=N bit1=E bit2=S bit3=W; a set bit marks an OPEN edge.
 *
 * Template contract (enforced by validatePack()):
 *  - every OPEN edge carries a centred 4-tile-wide floor opening (cols/rows
 *    6..9) touching that edge, so adjacent stamped cells align seamlessly;
 *  - every WALL edge is sealed: no floor anywhere along that border line;
 *  - all floor inside a template hangs together in one 4-connected blob.
 */

export interface WangTemplate {
  name: string;
  edges: number;
  pattern: readonly string[];
}

const SIZE = 16;
const OPEN_START = 6;
const OPEN_END = 9; // inclusive: centred 4-tile window

interface EdgeSpec {
  bit: number;
  name: string;
  line: "row" | "col";
  at: number;
}

const EDGES: readonly EdgeSpec[] = [
  { bit: 1, name: "N", line: "row", at: 0 },
  { bit: 2, name: "E", line: "col", at: SIZE - 1 },
  { bit: 4, name: "S", line: "row", at: SIZE - 1 },
  { bit: 8, name: "W", line: "col", at: 0 },
];

export const WANG_PACK: readonly WangTemplate[] = [
  {
    name: "sealed bedrock",
    edges: 0,
    pattern: [
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
    ],
  },
  {
    name: "north alcove chamber",
    edges: 1,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "####........####",
      "####........####",
      "##..........####",
      "##..........####",
      "####..........##",
      "####..........##",
      "####........####",
      "####........####",
      "################",
      "################",
      "################",
      "################",
    ],
  },
  {
    name: "east alcove chamber",
    edges: 2,
    pattern: [
      "################",
      "################",
      "########..######",
      "########..######",
      "####........####",
      "####........####",
      "####............",
      "####............",
      "####............",
      "####............",
      "####........####",
      "####........####",
      "######..########",
      "######..########",
      "################",
      "################",
    ],
  },
  {
    name: "south alcove chamber",
    edges: 4,
    pattern: [
      "################",
      "################",
      "################",
      "################",
      "####........####",
      "####........####",
      "####..........##",
      "####..........##",
      "##..........####",
      "##..........####",
      "####........####",
      "####........####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
  {
    name: "west alcove chamber",
    edges: 8,
    pattern: [
      "################",
      "################",
      "######..########",
      "######..########",
      "####........####",
      "####........####",
      "............####",
      "............####",
      "............####",
      "............####",
      "####........####",
      "####........####",
      "########..######",
      "########..######",
      "################",
      "################",
    ],
  },
  {
    name: "straight NS corridor",
    edges: 5,
    pattern: [
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
      "######,,,,######",
    ],
  },
  {
    name: "straight EW corridor",
    edges: 10,
    pattern: [
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
      ",,,,,,,,,,,,,,,,",
      ",,,,,,,,,,,,,,,,",
      ",,,,,,,,,,,,,,,,",
      ",,,,,,,,,,,,,,,,",
      "################",
      "################",
      "################",
      "################",
      "################",
      "################",
    ],
  },
  {
    name: "pillared NS hall",
    edges: 5,
    pattern: [
      "#####......#####",
      "#####......#####",
      "#####......#####",
      "#####......#####",
      "#####.#..#.#####",
      "#####.#..#.#####",
      "#####......#####",
      "#####......#####",
      "#####......#####",
      "#####......#####",
      "#####.#..#.#####",
      "#####.#..#.#####",
      "#####......#####",
      "#####......#####",
      "#####......#####",
      "#####......#####",
    ],
  },
  {
    name: "pillared EW hall",
    edges: 10,
    pattern: [
      "################",
      "################",
      "################",
      "################",
      "################",
      "................",
      "....##....##....",
      "................",
      "................",
      "....##....##....",
      "................",
      "################",
      "################",
      "################",
      "################",
      "################",
    ],
  },
  {
    name: "bent NE passage",
    edges: 3,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "####........####",
      "####........####",
      "####............",
      "####............",
      "####............",
      "####............",
      "####........####",
      "####........####",
      "################",
      "################",
      "################",
      "################",
    ],
  },
  {
    name: "bent SE passage",
    edges: 6,
    pattern: [
      "################",
      "################",
      "################",
      "################",
      "####........####",
      "####........####",
      "####............",
      "####............",
      "####............",
      "####............",
      "####........####",
      "####........####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
  {
    name: "bent SW passage",
    edges: 12,
    pattern: [
      "################",
      "################",
      "################",
      "################",
      "####........####",
      "####........####",
      "............####",
      "............####",
      "............####",
      "............####",
      "####........####",
      "####........####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
  {
    name: "bent NW passage",
    edges: 9,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "####........####",
      "####........####",
      "............####",
      "............####",
      "............####",
      "............####",
      "####........####",
      "####........####",
      "################",
      "################",
      "################",
      "################",
    ],
  },
  {
    name: "T junction NES",
    edges: 7,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "####........####",
      "####........####",
      "####............",
      "####............",
      "####............",
      "####............",
      "####........####",
      "####........####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
  {
    name: "T junction ESW",
    edges: 14,
    pattern: [
      "################",
      "################",
      "################",
      "################",
      "####........####",
      "####........####",
      "................",
      "................",
      "................",
      "................",
      "####........####",
      "####........####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
  {
    name: "T junction NSW",
    edges: 13,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "####........####",
      "####........####",
      "............####",
      "............####",
      "............####",
      "............####",
      "####........####",
      "####........####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
  {
    name: "T junction NEW",
    edges: 11,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "####........####",
      "####........####",
      "................",
      "................",
      "................",
      "................",
      "####........####",
      "####........####",
      "################",
      "################",
      "################",
      "################",
    ],
  },
  {
    name: "crossroads hall",
    edges: 15,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "####........####",
      "####........####",
      "................",
      "................",
      "................",
      "................",
      "####........####",
      "####........####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
  {
    name: "diamond cross hall",
    edges: 15,
    pattern: [
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "#####......#####",
      ",,,,........,,,,",
      ",,,..........,,,",
      ",,,..........,,,",
      ",,,,........,,,,",
      "#####......#####",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
      "######....######",
    ],
  },
];

/**
 * Checks every template against the stitching contract and throws an Error
 * listing every problem found (row counts, row lengths, invalid glyphs, open
 * edges without a centred opening, wall edges touched by floor, disconnected
 * floor, uncovered signatures).
 */
export function validatePack(): void {
  const problems: string[] = [];
  const covered = new Set<number>();

  WANG_PACK.forEach((tpl, index) => {
    const tag = `"${tpl.name}" (pack entry ${index})`;
    if (tpl.pattern.length !== SIZE) {
      problems.push(`${tag}: has ${tpl.pattern.length} rows, expected ${SIZE}`);
      return;
    }

    let structural = false;
    const floor: boolean[][] = [];
    for (let y = 0; y < SIZE; y++) {
      const row = tpl.pattern[y] as string;
      if (row.length !== SIZE) {
        problems.push(`${tag}: row ${y} is ${row.length} chars, expected ${SIZE}`);
        structural = true;
        continue;
      }
      const cells: boolean[] = [];
      for (let x = 0; x < SIZE; x++) {
        const ch = row.charAt(x);
        if (ch !== "#" && ch !== "." && ch !== ",") {
          problems.push(`${tag}: row ${y} col ${x} has invalid glyph "${ch}"`);
          structural = true;
          cells.push(false);
        } else {
          cells.push(ch !== "#");
        }
      }
      floor.push(cells);
    }
    if (structural) return;

    for (const edge of EDGES) {
      const open = (tpl.edges & edge.bit) !== 0;
      const touchesEdge = (): boolean => {
        for (let k = OPEN_START; k <= OPEN_END; k++) {
          const x = edge.line === "row" ? k : edge.at;
          const y = edge.line === "row" ? edge.at : k;
          if (floor[y]![x]) return true;
        }
        return false;
      };
      const anyFloorOnEdge = (): boolean => {
        for (let k = 0; k < SIZE; k++) {
          const x = edge.line === "row" ? k : edge.at;
          const y = edge.line === "row" ? edge.at : k;
          if (floor[y]![x]) return true;
        }
        return false;
      };
      if (open && !touchesEdge()) {
        problems.push(`${tag}: open ${edge.name} edge has no floor opening touching it`);
      }
      if (!open && anyFloorOnEdge()) {
        problems.push(`${tag}: wall ${edge.name} edge has floor touching it`);
      }
    }

    // All floor must hang together so stitched cells cannot split the dungeon
    // into separate walkable regions.
    let totalFloor = 0;
    let start = -1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (floor[y]![x]) {
          totalFloor++;
          if (start < 0) start = y * SIZE + x;
        }
      }
    }
    if (totalFloor > 0 && start >= 0) {
      const seen = new Uint8Array(SIZE * SIZE);
      const stack = [start];
      seen[start] = 1;
      let reached = 0;
      while (stack.length > 0) {
        const idx = stack.pop() as number;
        reached++;
        const cx = idx % SIZE;
        const cy = (idx / SIZE) | 0;
        const neighbours = [
          [cx, cy - 1],
          [cx + 1, cy],
          [cx, cy + 1],
          [cx - 1, cy],
        ];
        for (const [nx, ny] of neighbours) {
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
          const nIdx = ny * SIZE + nx;
          if (seen[nIdx] === 0 && floor[ny]![nx]) {
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
      if (reached < totalFloor) {
        problems.push(
          `${tag}: floor splits into disconnected groups (${reached}/${totalFloor} reachable)`,
        );
      }
    }

    covered.add(tpl.edges & 15);
  });

  for (let sig = 0; sig < 16; sig++) {
    if (!covered.has(sig)) problems.push(`no template covers edge signature ${sig}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `WANG_PACK is invalid (${problems.length} problem(s)):\n  - ${problems.join("\n  - ")}`,
    );
  }
}

/** Re-runs the pack self-check; throws Error when anything is off. */
export function assertPackValid(): void {
  validatePack();
}

// Fail fast at load: a broken pack would corrupt every generated dungeon.
validatePack();
