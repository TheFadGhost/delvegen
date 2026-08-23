import { DungeonGrid, type RoomRect } from "../core/grid.js";
import { Tile } from "../core/tile.js";
import { ValidationError } from "../core/errors.js";
import { labelRegions } from "../analysis/regions.js";
import type { GenerationContext, GeneratorDefinition } from "../core/types.js";

/**
 * Cellular automata cave.
 *
 * The map starts as random noise (each interior tile is wall or floor by coin
 * flip behind a solid one-tile border) and is then smoothed by repeated
 * generations of the classic birth/survival rule. Noise congeals into round
 * open caverns joined by natural chokepoints; lone pixels and hairline cracks
 * disappear within a few passes.
 *
 * Produces: organic wholly-cavern caves with no rooms; smooth blob-like
 * chambers typical of Brogue-style levels.
 */
export const cellularCave: GeneratorDefinition = {
  id: "cellular",
  name: "Cellular Caves",
  summary: "Random noise smoothed into caverns by cellular automata. No rooms.",
  technique:
    "Seeding: every interior tile becomes wall with probability = Initial wall % (a one-tile " +
    "solid border ring is always kept). Smoothing: for Smoothing passes iterations, all " +
    "interior tiles are updated simultaneously against the previous generation's state, " +
    "counting walls among the 8 surrounding neighbours (out-of-range neighbours count as " +
    "walls): a tile that IS wall in the previous generation stays wall when its wall-neighbour " +
    "count >= Survival limit and opens otherwise; a tile that is floor becomes wall when its " +
    "wall-neighbour count >= Birth limit and stays open otherwise. Both thresholds range 0..8. " +
    "Because updates are simultaneous there is no scan-direction bias. Fill pockets: when " +
    "\"Keep largest only\" is enabled a flood fill labels the walkable regions and every region " +
    "except the largest (ties broken by earliest position in scan order) is re-sealed to wall; " +
    "when disabled the extra pockets are left for the pipeline repair pass.",
  params: [
    {
      key: "initialWallPct",
      label: "Initial wall %",
      description: "Chance each interior tile starts as wall before smoothing.",
      type: "float",
      min: 30,
      max: 70,
      step: 1,
      default: 45,
    },
    {
      key: "smoothingPasses",
      label: "Smoothing passes",
      description: "How many automata generations to apply.",
      type: "int",
      min: 1,
      max: 8,
      step: 1,
      default: 5,
    },
    {
      key: "birthLimit",
      label: "Birth limit",
      description: "Open tile turns to wall at this many wall neighbours (0-8).",
      type: "int",
      min: 0,
      max: 8,
      step: 1,
      default: 5,
    },
    {
      key: "survivalLimit",
      label: "Survival limit",
      description: "Wall tile stays wall at this many wall neighbours (0-8).",
      type: "int",
      min: 0,
      max: 8,
      step: 1,
      default: 4,
    },
    {
      key: "keepLargestOnly",
      label: "Keep largest only",
      description: "Seal every walkable pocket except the largest cavern.",
      type: "bool",
      default: true,
    },
  ],

  validate(width, height) {
    if (width < 8 || height < 8) {
      throw new ValidationError(
        `Grid ${width}x${height} is too small for cave smoothing; cellular automata need ` +
          `at least 8x8 to grow coherent caverns.`,
      );
    }
  },

  generate(ctx: GenerationContext) {
    const width = ctx.width;
    const height = ctx.height;
    const grid = new DungeonGrid(width, height, Tile.Wall);
    const rooms: RoomRect[] = [];

    const initialPct = ctx.num("initialWallPct");
    const passes = ctx.num("smoothingPasses");
    const birthLimit = ctx.num("birthLimit");
    const survivalLimit = ctx.num("survivalLimit");
    const keepLargestOnly = ctx.bool("keepLargestOnly");

    // Seed: pure noise over the interior; the border ring stays solid rock.
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        grid.set(x, y, ctx.rng.chance(initialPct / 100) ? Tile.Wall : Tile.CorridorFloor);
      }
    }
    ctx.record(`seed noise (${initialPct}%)`, grid, rooms);

    // Smooth: simultaneous birth/survival update over the previous generation.
    const next = new Uint8Array(width * height);
    for (let pass = 1; pass <= passes; pass++) {
      next.set(grid.tiles);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let wallNb = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (!grid.inBounds(nx, ny) || grid.get(nx, ny) === Tile.Wall) wallNb++;
            }
          }
          const wasWall = grid.get(x, y) === Tile.Wall;
          const isWall = wasWall ? wallNb >= survivalLimit : wallNb >= birthLimit;
          next[grid.index(x, y)] = isWall ? Tile.Wall : Tile.CorridorFloor;
        }
      }
      grid.tiles.set(next);
      ctx.record(`smoothing pass ${pass}`, grid, rooms);
    }

    if (keepLargestOnly) {
      const { labels, count } = labelRegions(grid);
      const sizes = new Int32Array(count);
      for (let i = 0; i < labels.length; i++) {
        const l = labels[i] as number;
        if (l !== -1) sizes[l]++;
      }
      // Region ids follow first-tile scan order, so ">" keeps the earliest on ties.
      let best = -1;
      let bestSize = -1;
      for (let id = 0; id < count; id++) {
        if ((sizes[id] as number) > bestSize) {
          bestSize = sizes[id] as number;
          best = id;
        }
      }
      for (let i = 0; i < labels.length; i++) {
        if ((labels[i] as number) !== -1 && (labels[i] as number) !== best) {
          grid.tiles[i] = Tile.Wall;
        }
      }
      ctx.record("fill pockets (kept largest)", grid, rooms);
    }

    return {
      grid,
      rooms,
      meta: {
        passes,
        wallPctFinal: Math.round((grid.count(Tile.Wall) / (width * height)) * 1000) / 10,
      },
    };
  },
};
