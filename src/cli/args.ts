/**
 * Minimal hand-rolled argv parser for the Delvegen CLI.
 *
 * Supports "--flag value" and "--flag=value". A flag may be repeated; values
 * accumulate in order and `single()` returns the last occurrence. No
 * dependencies, no reflection — just tokens in, lookups out.
 */

/** CLI usage problem: bad flag, missing value, malformed entry. Exit code 2. */
export class UsageError extends Error {}

export interface FlagSpec {
  /** False = presence-only switch (e.g. --stats). */
  readonly takesValue: boolean;
}

export interface ParsedArgs {
  /** True when the flag appeared at least once. */
  has(name: string): boolean;
  /** Last value for the flag, or undefined when absent. */
  single(name: string): string | undefined;
  /** Last value, or UsageError naming the flag when absent/empty. */
  requireSingle(name: string): string;
  /** Every value for a repeatable flag, in order. */
  list(name: string): string[];
  /** Integer option with fallback; non-integer text is a usage error. */
  intOption(name: string): number | undefined;
}

const INT_RE = /^[+-]?\d+$/;

export function parseArgs(
  argv: readonly string[],
  flags: Readonly<Record<string, FlagSpec>>,
): ParsedArgs {
  const store = new Map<string, string[]>();
  const push = (name: string, value: string): void => {
    const existing = store.get(name);
    if (existing) existing.push(value);
    else store.set(name, [value]);
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (!token.startsWith("--")) {
      throw new UsageError(`unexpected argument "${token}" (options start with --)`);
    }
    let name = token.slice(2);
    let inline: string | undefined;
    const eq = name.indexOf("=");
    if (eq !== -1) {
      inline = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    const spec = flags[name];
    if (!spec) throw new UsageError(`unknown option "--${name}"`);

    if (!spec.takesValue) {
      if (inline !== undefined) {
        throw new UsageError(`option "--${name}" does not take a value`);
      }
      push(name, "");
      continue;
    }

    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new UsageError(`option "--${name}" requires a value`);
      }
      value = next;
      i += 1;
    }
    push(name, value);
  }

  return {
    has: (name) => store.has(name),
    single: (name) => {
      const values = store.get(name);
      return values ? (values[values.length - 1] as string) : undefined;
    },
    requireSingle: (name) => {
      const v = (() => {
        const values = store.get(name);
        return values ? (values[values.length - 1] as string) : undefined;
      })();
      if (v === undefined || v === "") {
        throw new UsageError(`missing required option "--${name}"`);
      }
      return v;
    },
    list: (name) => store.get(name) ?? [],
    intOption: (name) => {
      const values = store.get(name);
      if (!values) return undefined;
      const v = values[values.length - 1] as string;
      if (!INT_RE.test(v)) {
        throw new UsageError(`option "--${name}" expects an integer, got "${v}"`);
      }
      return Number(v);
    },
  };
}

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * CLI scalar coercion shared by --param and --post overrides:
 * "12" -> 12, "-3.5e2" -> -350, "true"/"false" -> boolean, else raw string.
 */
export function coerceScalar(raw: string): number | boolean | string {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && NUMBER_RE.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/** Parse repeated "key=value" entries into an override object. */
export function parseKeyValueList(entries: readonly string[], flag: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      throw new UsageError(`invalid --${flag} entry "${entry}", expected key=value`);
    }
    out[entry.slice(0, eq)] = coerceScalar(entry.slice(eq + 1));
  }
  return out;
}
