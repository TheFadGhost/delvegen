/**
 * URL sharing: the full generator config travels in the location hash.
 *
 * Canonical form is base64url-encoded JSON ({@link encodeConfig}); a
 * percent-encoded JSON mirror (`&j=...`) rides along so the hash stays
 * human-inspectable in address bars and logs. decodeConfig accepts either
 * part (or a bare payload) and is fully defensive: any garbage yields null
 * rather than throwing.
 *
 * Wire shape: { v:1, a:algorithm, w:width, h:height, s:seed,
 *               g:params, p:post, [cmp:1, f:"A"|"B", b:paneShare] }
 */

export interface UiConfig {
  algorithm: string;
  width: number;
  height: number;
  seed: string;
  params: Record<string, unknown>;
  post: Record<string, unknown>;
}

export interface PaneShare {
  a: string;
  w: number;
  h: number;
  s: string;
  g?: Record<string, unknown>;
  p?: Record<string, unknown>;
}

export interface SharePayload extends PaneShare {
  v: 1;
  /** Present only when comparison mode is active. */
  cmp?: 1;
  /** Focused pane key when cmp is set. */
  f?: "A" | "B";
  /** The non-focused pane's config when cmp is set. */
  b?: PaneShare;
}

export interface DecodedShare {
  config: UiConfig;
  cmp: { f: "A" | "B"; b: UiConfig } | null;
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4 !== 0) t += "=";
  const bin = atob(t);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Compact base64url token for a payload (canonical wire form). */
export function encodeConfig(payload: SharePayload): string {
  return b64urlEncode(JSON.stringify(payload));
}

/** Full hash string for a payload: canonical part + readable mirror. */
export function buildShareHash(payload: SharePayload): string {
  let mirror = "";
  try {
    mirror = `&j=${encodeURIComponent(JSON.stringify(payload))}`;
  } catch {
    mirror = "";
  }
  return `#g=${encodeConfig(payload)}${mirror}`;
}

/** Replace the current history entry's hash (no navigation, no scroll). */
export function writeShareHash(payload: SharePayload): void {
  try {
    window.history.replaceState(null, "", buildShareHash(payload));
  } catch {
    /* history API unavailable (sandboxed frame) — sharing silently off */
  }
}

export function readShareHash(): DecodedShare | null {
  return decodeConfig(window.location.hash);
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

/** Parse a hash (or bare payload) into a config; null on anything invalid. */
export function decodeConfig(hash: string | null | undefined): DecodedShare | null {
  if (!hash) return null;
  try {
    let raw = String(hash).trim();
    if (raw === "") return null;
    if (raw.startsWith("#")) raw = raw.slice(1);
    if (raw === "") return null;
    const parts = new URLSearchParams(raw);
    const candidates = [parts.get("g"), parts.get("d"), raw, ...parts.values()];
    for (const c of candidates) {
      const decoded = tryDecodeValue(c);
      if (decoded) return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

function tryDecodeValue(enc: string | null): DecodedShare | null {
  if (!enc) return null;
  try {
    return normalizePayload(JSON.parse(b64urlDecode(enc)));
  } catch {
    /* try the percent-JSON mirror */
  }
  try {
    return normalizePayload(JSON.parse(decodeURIComponent(enc)));
  } catch {
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampDim(v: number): number {
  return Math.min(512, Math.max(5, Math.round(v)));
}

function paneToUi(p: Record<string, unknown>): UiConfig | null {
  if (typeof p.a !== "string" || p.a === "") return null;
  if (typeof p.s !== "string" || p.s === "") return null;
  const w = Number(p.w);
  const h = Number(p.h);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return {
    algorithm: p.a,
    width: clampDim(w),
    height: clampDim(h),
    seed: p.s,
    params: isObj(p.g) ? { ...p.g } : {},
    post: isObj(p.p) ? { ...p.p } : {},
  };
}

function normalizePayload(o: unknown): DecodedShare | null {
  if (!isObj(o)) return null;
  if (o["v"] !== 1) return null;
  const config = paneToUi(o);
  if (!config) return null;
  let cmp: DecodedShare["cmp"] = null;
  if (o["cmp"] === 1 && isObj(o["b"])) {
    const b = paneToUi(o["b"]);
    if (b) cmp = { f: o["f"] === "B" ? "B" : "A", b };
  }
  return { config, cmp };
}

/* ------------------------------------------------------------------ */
/* Pane (de)hydration                                                  */
/* ------------------------------------------------------------------ */

export function paneToShare(c: UiConfig): PaneShare {
  return { a: c.algorithm, w: c.width, h: c.height, s: c.seed, g: c.params, p: c.post };
}
