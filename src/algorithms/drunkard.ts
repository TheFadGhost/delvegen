import { DungeonGrid, type RoomRect, type Pos } from "../core/grid.js";
import { Tile } from "../core/tile.js";
import { ValidationError } from "../core/errors.js";
import { DIRS_4 } from "../core/geometry.js";
import type { GenerationContext, GeneratorDefinition } from "../core/types.js";

/**
 * Drunkard's walk.
 *
 * One or more walkers start at the map centre and stumble through solid rock,
 * carving floor behind them, until a target percentage of the map is open.
 * A straightness bias makes walkers keep their heading, trading tight knots
 * for longer winding passages. Every carved tile is adjacent to the tile it
 * was carved from, so output is connected by construction and needs no
 * repair pass.
 *
 * Produces: organic wholly-corridor caves with no rooms; classic early
 * roguelike feel.
 */
export const drunkardWalk: GeneratorDefinition = {
  id: "drunkard",
  name: "Drunkard's Walk",
  summary: "Organic winding tunnels carved by random walkers. No rooms.",
  technique:
    "A walker starts at the centre of a solid map. Each step it either keeps its current " +
    "heading (probability = Straightness) or picks a new cardinal direction, then moves one " +
    "tile, carving any rock it enters into floor. Carving stops when floor tiles reach the " +
    "coverage target or a hard step cap is hit (bounded termination). Extra walkers spawn on " +
    "already-carved floor at evenly spaced checkpoints: they can only extend existing floor, " +
    "so the result stays a single connected component.",
  params: [
    {
      key: "floorTargetPct",
      label: "Floor coverage %",
      description: "Target percentage of the map to carve open.",
      type: "float",
      min: 5,
      max: 70,
      step: 1,
      default: 38,
    },
    {
      key: "straightness",
      label: "Straightness",
      description: "How often walkers keep heading instead of turning.",
      type: "float",
      min: 0,
      max: 0.95,
      step: 0.05,
      default: 0.35,
    },
    {
      key: "walkers",
      label: "Walkers",
      description: "Number of staggered walkers carving the cave.",
      type: "int",
      min: 1,
      max: 4,
      default: 1,
    },
    {
      key: "borderWall",
      label: "Solid border",
      description: "Keep a one-tile wall ring around the map edge.",
      type: "bool",
      default: true,
    },
  ],

  validate(width, height, p) {
    const targetPct = p["floorTargetPct"] as number;
    const border = p["borderWall"] === true;
    if (border && (width - 2 < 3 || height - 2 < 3)) {
      throw new ValidationError(
        `Grid ${width}x${height} is too small for a solid border; disable "Solid border" ` +
          `or use at least 6x6.`,
      );
    }
    const capacity = border ? (width - 2) * (height - 2) : width * height;
    const needed = Math.ceil((targetPct / 100) * width * height);
    if (needed > capacity) {
      throw new ValidationError(
        `Floor coverage ${targetPct}% needs about ${needed} open tiles but only ${capacity} ` +
          `fit inside ${width}x${height}; lower coverage or enlarge the grid.`,
      );
    }
  },

  generate(ctx: GenerationContext) {
    const width = ctx.width;
    const height = ctx.height;
    const grid = new DungeonGrid(width, height, Tile.Wall);
    const rooms: RoomRect[] = [];

    const targetPct = ctx.num("floorTargetPct");
    const straightness = ctx.num("straightness");
    const walkerCount = ctx.num("walkers");
    const border = ctx.bool("borderWall");

    const minX = border ? 1 : 0;
    const minY = border ? 1 : 0;
    const maxX = border ? width - 2 : width - 1;
    const maxY = border ? height - 2 : height - 1;

    const target = Math.max(1, Math.round((width * height * targetPct) / 100));
    const stepCap = width * height * 60;

    let carved = 0;
    let steps = 0;

    const walkers: Pos[] = [{ x: Math.floor(width / 2), y: Math.floor(height / 2) }];
    const headings: number[] = [ctx.rng.int(0, 3)];
    grid.set(walkers[0]!.x, walkers[0]!.y, Tile.CorridorFloor);
    carved++;
    ctx.record("walker starts at centre", grid, rooms);

    const frameEvery = Math.max(1, Math.floor(target / 400));

    const spawnCheckpoints = new Set<number>();
    for (let i = 1; i < walkerCount; i++) {
      spawnCheckpoints.add(Math.floor(((stepCap / walkerCount) * i) | 0));
    }

    while (carved < target && steps < stepCap) {
      steps++;

      if (spawnCheckpoints.has(steps)) {
        // Spawn a new walker on random existing floor.
        let guard = 0;
        let spot: Pos | null = null;
        while (guard++ < 256) {
          const x = ctx.rng.int(minX, maxX);
          const y = ctx.rng.int(minY, maxY);
          if (grid.walkableAt(x, y)) {
            spot = { x, y };
            break;
          }
        }
        if (spot) {
          walkers.push(spot);
          headings.push(ctx.rng.int(0, 3));
          ctx.record(`walker ${walkers.length} spawns`, grid, rooms);
        }
      }

      for (let wIdx = 0; wIdx < walkers.length; wIdx++) {
        if (ctx.rng.chance(1 - straightness)) {
          headings[wIdx] = ctx.rng.int(0, 3);
        }
        const dir = DIRS_4[headings[wIdx] as number]!;
        const w = walkers[wIdx] as Pos;
        const nx = w.x + dir.x;
        const ny = w.y + dir.y;

        if (nx >= minX && ny >= minY && nx <= maxX && ny <= maxY) {
          w.x = nx;
          w.y = ny;
          if (grid.get(nx, ny) === Tile.Wall) {
            grid.set(nx, ny, Tile.CorridorFloor);
            carved++;
          }
        } else {
          // Bounce off the boundary: pick a fresh heading in place.
          headings[wIdx] = ctx.rng.int(0, 3);
        }
      }

      if (steps % frameEvery === 0 || carved >= target) {
        ctx.record(
          carved >= target ? "coverage reached" : `carving (${carved}/${target})`,
          grid,
          rooms,
        );
      }
    }

    if (carved < target) {
      throw new Error(
        `drunkard walk stalled: carved ${carved}/${target} tiles in ${stepCap} steps`,
      );
    }

    return {
      grid,
      rooms,
      meta: {
        steps,
        carvedTiles: carved,
        walkersUsed: walkers.length,
      },
    };
  },
};
