/**
 * Step-through transport: docked at the bottom of the stage in layout flow.
 * Owns the recorded frame list, scrubbing, and requestAnimationFrame-paced
 * playback. Rendering of a given frame is delegated via onFrame.
 */

import type { GenerationFrame } from "../core/recorder.js";

export interface StepTransportOptions {
  transport: HTMLElement;
  prevBtn: HTMLButtonElement;
  playBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  playIcon: HTMLElement;
  pauseIcon: HTMLElement;
  scrubber: HTMLInputElement;
  speedSelect: HTMLSelectElement;
  labelEl: HTMLElement;
  /** Called whenever the displayed frame index changes. */
  onFrame: (index: number) => void;
}

/** Base pacing: 30 fps equivalent at 1x, scaled by the speed control. */
const BASE_FRAME_MS = 1000 / 30;

export class StepTransport {
  private frames: GenerationFrame[] = [];
  private index = 0;
  private playing = false;
  private rafId: number | undefined;
  private lastTick = 0;
  private accumulator = 0;

  private readonly opts: StepTransportOptions;
  private readonly reducedMotion: MediaQueryList;

  constructor(opts: StepTransportOptions) {
    this.opts = opts;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion.addEventListener?.("change", () => this.stopPlayback());

    this.opts.prevBtn.addEventListener("click", () => this.stepBy(-1));
    this.opts.nextBtn.addEventListener("click", () => this.stepBy(1));
    this.opts.playBtn.addEventListener("click", () => this.togglePlay());
    this.opts.scrubber.addEventListener("input", () => {
      this.stopPlayback(); // dragging scrubs instantly; manual input pauses
      this.goto(Number(this.opts.scrubber.value));
    });
    this.opts.speedSelect.addEventListener("change", () => {
      // A speed change while playing just re-paces the loop.
      this.lastTick = performance.now();
      this.accumulator = 0;
    });
  }

  get isReducedMotion(): boolean {
    return this.reducedMotion.matches;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get currentIndex(): number {
    return this.index;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Install a new recording and reset the transport state. */
  load(frames: GenerationFrame[]): void {
    this.frames = frames;
    this.stopPlayback();
    const n = frames.length;
    this.opts.scrubber.max = String(Math.max(0, n - 1));
    this.opts.scrubber.value = "0";
    this.opts.labelEl.textContent = "";
    if (n > 0) {
      // Reduced motion never auto-plays: park on the final state instead.
      if (this.isReducedMotion) {
        this.goto(n - 1);
      } else {
        this.goto(0);
        this.startPlayback();
      }
    } else {
      this.opts.onFrame(-1);
    }
  }

  hide(): void {
    this.stopPlayback();
    this.frames = [];
    this.opts.labelEl.textContent = "";
  }

  stepBy(delta: number): void {
    this.stopPlayback();
    this.goto(this.index + delta);
  }

  togglePlay(): void {
    if (this.isReducedMotion || this.frames.length < 2) return;
    if (this.playing) {
      this.stopPlayback();
    } else {
      // Restarting from the end replays from the top once, then stops there.
      if (this.index >= this.frames.length - 1) this.goto(0);
      this.startPlayback();
    }
  }

  private goto(i: number): void {
    const n = this.frames.length;
    if (n === 0) return;
    this.index = Math.min(n - 1, Math.max(0, i));
    this.opts.scrubber.value = String(this.index);
    this.opts.labelEl.textContent = this.frames[this.index]?.label ?? "";
    this.setPlayIcon(this.playing);
    this.opts.onFrame(this.index);
  }

  private startPlayback(): void {
    if (this.playing || this.frames.length < 2) return;
    this.playing = true;
    this.setPlayIcon(true);
    this.lastTick = performance.now();
    this.accumulator = 0;
    const tick = (now: number) => {
      if (!this.playing) return;
      const speed = Number(this.opts.speedSelect.value) || 1;
      const interval = BASE_FRAME_MS / speed;
      this.accumulator += now - this.lastTick;
      this.lastTick = now;
      let advanced = false;
      while (this.accumulator >= interval && this.index < this.frames.length - 1) {
        this.accumulator -= interval;
        advanced = true;
        this.index += 1;
      }
      if (advanced) {
        this.opts.scrubber.value = String(this.index);
        this.opts.labelEl.textContent = this.frames[this.index]?.label ?? "";
        this.opts.onFrame(this.index);
      }
      if (this.index >= this.frames.length - 1) {
        // End of run: playback stops on the final frame, nothing loops.
        this.playing = false;
        this.setPlayIcon(false);
        this.opts.onFrame(this.index);
        return;
      }
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopPlayback(): void {
    this.playing = false;
    if (this.rafId !== undefined) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
    this.setPlayIcon(false);
  }

  private setPlayIcon(playing: boolean): void {
    this.opts.playIcon.style.display = playing ? "none" : "";
    this.opts.pauseIcon.style.display = playing ? "" : "none";
    this.opts.playBtn.title = playing ? "Pause" : "Play";
  }
}
