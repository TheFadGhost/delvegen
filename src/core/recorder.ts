import type { DungeonGrid, RoomRect } from "./grid.js";
import { ValidationError } from "./errors.js";

export interface GenerationFrame {
  /** Human-readable step label, e.g. "smoothing pass 2". */
  label: string;
  index: number;
  tiles: Uint8Array;
  rooms: RoomRect[];
}

const MAX_FRAMES = 2400;

/**
 * Records lightweight snapshots of the grid for the step-through visualizer.
 *
 * Memory contract: snapshots are plain Uint8Array copies (width*height bytes).
 * When the frame budget is exceeded we decimate stored history by dropping
 * every other retained frame and doubling the stride, so total memory stays
 * bounded (~MAX_FRAMES * width * height bytes) while the scrubber keeps a
 * uniform sampling of the whole run. `truncated` reports that sampling
 * happened; the final state is always recorded exactly.
 */
export class FrameRecorder {
  readonly frames: GenerationFrame[] = [];
  truncated = false;
  totalSteps = 0;
  private stride = 1;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  record(label: string, grid: DungeonGrid, rooms: readonly RoomRect[]): void {
    this.totalSteps++;
    const snapshot: GenerationFrame = {
      label,
      index: this.totalSteps,
      tiles: grid.tiles.slice(),
      rooms: rooms.map((r) => ({ ...r })),
    };

    if (this.frames.length >= MAX_FRAMES) {
      // Decimate: keep even-indexed frames, double the stride.
      const kept: GenerationFrame[] = [];
      for (let i = 0; i < this.frames.length; i += 2) kept.push(this.frames[i] as GenerationFrame);
      this.frames.length = 0;
      this.frames.push(...kept);
      this.stride *= 2;
      this.truncated = true;
    }

    // Store only every stride-th raw step; always store when it's the newest.
    if ((this.totalSteps - 1) % this.stride === 0 || this.frames.length === 0) {
      this.frames.push(snapshot);
    }
  }

  get frameCount(): number {
    return this.frames.length;
  }

  /** Drop all frames so a retried run starts clean. */
  reset(): void {
    this.frames.length = 0;
    this.totalSteps = 0;
    this.stride = 1;
    this.truncated = false;
  }
}
