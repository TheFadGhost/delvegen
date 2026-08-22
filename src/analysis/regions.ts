import type { DungeonGrid } from "../core/grid.js";

export interface RegionLabeling {
  /** Per-tile region id, -1 for wall tiles. */
  labels: Int32Array;
  /** Number of distinct walkable regions. */
  count: number;
}

/** Flood-fill labelling of 4-connected walkable regions. */
export function labelRegions(grid: DungeonGrid): RegionLabeling {
  const labels = new Int32Array(grid.width * grid.height).fill(-1);
  let count = 0;
  const queue = new Int32Array(grid.width * grid.height);

  for (let startIdx = 0; startIdx < labels.length; startIdx++) {
    if ((labels[startIdx] as number) !== -1 || !grid.walkableAt(startIdx % grid.width, Math.floor(startIdx / grid.width))) {
      continue;
    }
    const id = count++;
    let head = 0;
    let tail = 0;
    labels[startIdx] = id;
    queue[tail++] = startIdx;
    while (head < tail) {
      const idx = queue[head++] as number;
      const x = idx % grid.width;
      const y = (idx / grid.width) | 0;
      // 4-connected: N, E, S, W
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 1 ? 1 : d === 3 ? -1 : 0);
        const ny = y + (d === 0 ? -1 : d === 2 ? 1 : 0);
        if (!grid.inBounds(nx, ny)) continue;
        const nIdx = ny * grid.width + nx;
        if ((labels[nIdx] as number) !== -1 || !grid.walkableAt(nx, ny)) continue;
        labels[nIdx] = id;
        queue[tail++] = nIdx;
      }
    }
  }
  return { labels, count };
}
