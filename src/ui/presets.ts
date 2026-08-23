/**
 * Curated per-algorithm presets. Every param value stays inside its spec's
 * declared range AND satisfies the algorithm's validate() cross-constraints
 * (bsp room caps, corridor-below-room-min, rooms-mst size caps) on default
 * or larger grids.
 */

export interface Preset {
  name: string;
  params: Record<string, number | boolean | string>;
  post?: Record<string, unknown>;
}

const PRESETS: Record<string, Preset[]> = {
  bsp: [
    {
      name: "Compact quarters",
      params: { minLeafSize: 12, roomPadding: 0, corridorWidth: 1, maxDepth: 9, roomMinSize: 3, roomMaxSize: 8 },
    },
    {
      name: "Grand halls",
      params: { minLeafSize: 20, roomPadding: 1, corridorWidth: 2, maxDepth: 4, roomMinSize: 4, roomMaxSize: 14 },
      post: { doors: true },
    },
    {
      name: "Maze-like",
      params: { minLeafSize: 8, roomPadding: 0, corridorWidth: 1, maxDepth: 10, roomMinSize: 3, roomMaxSize: 6 },
    },
  ],
  drunkard: [
    {
      name: "Winding warrens",
      params: { floorTargetPct: 30, straightness: 0.15, walkers: 1, borderWall: true },
    },
    {
      name: "Open caverns",
      params: { floorTargetPct: 60, straightness: 0.55, walkers: 2, borderWall: true },
    },
    {
      name: "Sparse threads",
      params: { floorTargetPct: 12, straightness: 0.75, walkers: 1, borderWall: true },
    },
  ],
  "rooms-mst": [
    {
      name: "Fortress plan",
      params: { roomCount: 8, roomMinSize: 6, roomMaxSize: 12, placementAttempts: 600, corridorWidth: 2, loopEdgePct: 0 },
      post: { doors: true },
    },
    {
      name: "Ruins sprawl",
      params: { roomCount: 30, roomMinSize: 3, roomMaxSize: 7, placementAttempts: 1200, corridorWidth: 1, loopEdgePct: 25 },
      post: { prune: true },
    },
    {
      name: "Looping city",
      params: { roomCount: 18, roomMinSize: 4, roomMaxSize: 9, placementAttempts: 800, corridorWidth: 1, loopEdgePct: 60 },
    },
  ],
  cellular: [
    {
      name: "Smooth caverns",
      params: { initialWallPct: 45, smoothingPasses: 5, birthLimit: 5, survivalLimit: 4, keepLargestOnly: true },
    },
    {
      name: "Rugged caves",
      params: { initialWallPct: 53, smoothingPasses: 3, birthLimit: 4, survivalLimit: 4, keepLargestOnly: true },
    },
    {
      name: "Swiss cheese",
      params: { initialWallPct: 40, smoothingPasses: 2, birthLimit: 6, survivalLimit: 3, keepLargestOnly: false },
    },
  ],
  wang: [
    {
      name: "Corridor lattice",
      params: { tileSize: "16", openness: 65, variantMix: "corridor" },
    },
    {
      name: "Chamber vaults",
      params: { tileSize: "16", openness: 40, variantMix: "chamber" },
      post: { doors: true },
    },
    {
      name: "Wild stitch",
      params: { tileSize: "16", openness: 85, variantMix: "varied" },
    },
  ],
};

export function presetsFor(algorithmId: string): Preset[] {
  return PRESETS[algorithmId] ?? [];
}
