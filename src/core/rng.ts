import { DelvegenError } from "./errors.js";

/**
 * Deterministic PRNG contract.
 *
 * Rules every consumer MUST follow:
 *  - never use Math.random() anywhere in library code;
 *  - all randomness flows from an Rng instance so that (seed, params) fully
 *    determine output on every platform ("byte-identical" guarantee);
 *  - algorithms that need independent streams call rng.fork(label).
 *
 * Implementation: FNV-1a hashes the seed string into four 32-bit words via
 * splitmix32, then xoshiro128** produces the stream. Pure integer math only,
 * so sequences are identical across platforms and JS engines.
 */
export interface Rng {
  /** Canonical seed string this generator was created from. */
  readonly seedString: string;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  /** True with probability p (p is clamped to [0,1]). */
  chance(p: number): boolean;
  /** Uniform element of items. Throws if empty. */
  pick<T>(items: readonly T[]): T;
  /** In-place Fisher-Yates shuffle. Returns the same array. */
  shuffle<T>(items: T[]): T[];
  /** Independent derived stream; same seed+label always yields the same child. */
  fork(label: string): Rng;
}

/** FNV-1a 32-bit over a UTF-8-ish string. Deterministic everywhere. */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code > 0x7f) {
      // encode as UTF-8 bytes to be independent of engine string internals
      if (code > 0x7ff) {
        h = mix(h, 0xe0 | (code >> 12));
        h = mix(h, 0x80 | ((code >> 6) & 0x3f));
      } else {
        h = mix(h, 0xc0 | (code >> 6));
      }
      h = mix(h, 0x80 | (code & 0x3f));
    } else {
      h = mix(h, code);
    }
  }
  return h >>> 0;
}

function mix(h: number, byte: number): number {
  h ^= byte & 0xff;
  return Math.imul(h, 0x01000193) >>> 0;
}

/** splitmix32: expands one word into a well-distributed word. */
function splitmix32(state: number): number {
  state = (state + 0x9e3779b9) | 0;
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

class Xoshiro implements Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(
    readonly seedString: string,
    salt: string,
  ) {
    const base = `${seedString}|${salt}`;
    const sm = fnv1a32(base) | 1;
    // Chain splitmix32 through its own output: calling it four times with the
    // same word yields four IDENTICAL state words, and a uniform xoshiro128**
    // state makes the first two outputs provably equal.
    this.s0 = splitmix32(sm);
    this.s1 = splitmix32(this.s0);
    this.s2 = splitmix32(this.s1);
    this.s3 = splitmix32(this.s2);
    // All-zero state is invalid for xoshiro128**; nudge deterministically.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = this.s1 = this.s2 = this.s3 = 0x9e3779b9;
    }
  }

  next(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0) / 4294967296;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  int(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new DelvegenError(`Rng.int requires integers, got [${minInclusive}, ${maxInclusive}]`);
    }
    if (maxInclusive < minInclusive) {
      throw new DelvegenError(`Rng.int range invalid: [${minInclusive}, ${maxInclusive}]`);
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(this.next() * span);
  }

  chance(p: number): boolean {
    if (!(p >= 0)) return false;
    if (p > 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new DelvegenError("Rng.pick called with an empty array");
    return items[this.int(0, items.length - 1)] as T;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  fork(label: string): Rng {
    return createRng(this.seedString, `${label}#${this.s0}:${this.s1}:${this.s2}:${this.s3}`);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function createRng(seed: string | number, salt = ""): Rng {
  const seedString = String(seed);
  if (seedString.length === 0) throw new DelvegenError("Seed must be a non-empty string");
  return new Xoshiro(seedString, salt);
}
