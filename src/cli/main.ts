#!/usr/bin/env node
/**
 * Delvegen command-line interface.
 *
 *   delvegen generate | batch | algorithms | help
 *
 * stdout carries payload data only (maps, JSON, listings) so it can be piped;
 * human chatter and --stats go to stderr. Errors print as "delvegen: <msg>"
 * with exit code 2 (usage/validation), 3 (generation failed), 4 (batch
 * generation failure).
 */
import { writeFileSync } from "node:fs";
import { bootstrapDelvegen } from "../bootstrap.js";
import { computeMetrics } from "../analysis/metrics.js";
import type { DungeonMetrics } from "../analysis/metrics.js";
import { getAlgorithm, listAlgorithms } from "../core/algorithm-registry.js";
import {
  DelvegenError,
  ExportError,
  GenerationError,
  ValidationError,
} from "../core/errors.js";
import { generateDungeon, verifyFullyConnected } from "../core/generate.js";
import { dungeonHash } from "../core/hash.js";
import { getPostPass, listPostPasses } from "../core/post-registry.js";
import type { GenerateOptions, GeneratorDefinition, ParamSpec, PostPassConfig } from "../core/types.js";
import { exportAscii } from "../export/ascii.js";
import { exportDungeonJson } from "../export/json.js";
import { renderPng } from "../export/png.js";
import { getTheme } from "../ui/themes.js";
import {
  UsageError,
  coerceScalar,
  parseArgs,
  parseKeyValueList,
} from "./args.js";

const HELP = `delvegen - procedural dungeon generator

Usage: delvegen <command> [options...]

Commands:
  generate     Generate one dungeon and print or save it.
  batch        Run many seeds and write aggregated metrics JSON.
  algorithms   List registered algorithms with their parameters.
  help         Show this help.

Every option accepts both "--flag value" and "--flag=value".

generate:
  delvegen generate --algorithm <id> --seed <s> [--width N] [--height N]
      [--param key=value ...] [--post <spec> ...] [--format ascii|json|png]
      [--out <path>] [--stats] [--theme <themeId>] [--tile-size N]

  Defaults: width 80, height 50, format ascii.
  --algorithm   Generator id; see the "algorithms" command.
  --seed        Seed string for deterministic output.
  --param       Override an algorithm parameter; repeatable. Values parse as
                number, true/false, or plain string.
  --post        Enable a post-processing pass; repeatable. "doors" uses the
                pass defaults, "doors=k=v,k=v" overrides them. Omitting a
                pass leaves it off.
  --format      ascii -> map on stdout; json -> pretty "delvegen-dungeon"
                JSON on stdout; png -> PNG file, requires --out.
  --out         Output file path (required for png).
  --stats       Print one JSON line of metrics to stderr.
  --theme       PNG palette id: dark, light, high-contrast, relic.
  --tile-size   PNG pixels per tile (clamped to 1..32).

batch:
  delvegen batch --algorithm <id> [--seeds N] [--width N] [--height N]
      [--start-seed S] [--param key=value ...] [--out stats.json]

  Runs N generations (default 50) with seeds "<S>-<i>" for i = 0..N-1 and
  default parameters. Writes {"format":"delvegen-batch",...} aggregate
  metrics to --out, or to stdout when --out is omitted.

algorithms:
  delvegen algorithms

Exit codes:
  0  success
  2  usage or validation error
  3  generation failed after retries
  4  batch run had generation failures`;

/* ------------------------------------------------------------------ */
/* Flag tables                                                         */
/* ------------------------------------------------------------------ */

const VALUE = { takesValue: true };
const SWITCH = { takesValue: false };

const GENERATE_FLAGS = {
  algorithm: VALUE,
  seed: VALUE,
  width: VALUE,
  height: VALUE,
  param: VALUE,
  post: VALUE,
  format: VALUE,
  out: VALUE,
  stats: SWITCH,
  theme: VALUE,
  "tile-size": VALUE,
};

const BATCH_FLAGS = {
  algorithm: VALUE,
  seeds: VALUE,
  width: VALUE,
  height: VALUE,
  "start-seed": VALUE,
  param: VALUE,
  out: VALUE,
};

const NO_FLAGS = {};

/* ------------------------------------------------------------------ */
/* Entry point + error mapping                                         */
/* ------------------------------------------------------------------ */

function main(argv: readonly string[]): void {
  bootstrapDelvegen();

  const [command, ...rest] = argv;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    if (command === undefined) {
      process.stderr.write(HELP + "\n");
      process.exitCode = 2;
    } else {
      process.stdout.write(HELP + "\n");
    }
    return;
  }

  switch (command) {
    case "generate":
      cmdGenerate(rest);
      break;
    case "batch":
      cmdBatch(rest);
      break;
    case "algorithms":
      cmdAlgorithms();
      break;
    default:
      throw new UsageError(
        `unknown command "${command}" (try "generate", "batch", "algorithms", or "help")`,
      );
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (
    err instanceof UsageError ||
    err instanceof ValidationError ||
    err instanceof ExportError ||
    (err instanceof DelvegenError && !(err instanceof GenerationError))
  ) {
    process.stderr.write(`delvegen: ${err.message}\n`);
    process.exitCode = 2;
  } else if (err instanceof GenerationError) {
    process.stderr.write(`delvegen: ${err.message}\n`);
    process.exitCode = 3;
  } else {
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Look up an algorithm, mapping unknown ids to a clean usage error. */
function getAlgorithmDef(id: string): GeneratorDefinition {
  try {
    return getAlgorithm(id);
  } catch {
    throw new UsageError(
      `unknown algorithm "${id}" (available: ${listAlgorithms().map((d) => d.id).join(", ")})`,
    );
  }
}

/** The library clamps numeric params into range; the CLI rejects instead. */
function guardNumericRanges(
  specs: readonly ParamSpec[],
  overrides: Record<string, unknown>,
  context: string,
): void {
  for (const key of Object.keys(overrides)) {
    const spec = specs.find((s) => s.key === key);
    if (!spec) continue; // unknown keys surface via resolveParams' message
    if (spec.type !== "int" && spec.type !== "float") continue;
    const value = overrides[key];
    if (typeof value !== "number") continue; // non-numbers surface in resolveParams
    if (value < spec.min || value > spec.max) {
      throw new UsageError(
        `${context}${spec.label}: ${value} is out of range [${spec.min}..${spec.max}]`,
      );
    }
  }
}

function parsePostSpecs(list: readonly string[]): Record<string, PostPassConfig> {
  const out: Record<string, PostPassConfig> = {};
  for (const spec of list) {
    const eq = spec.indexOf("=");
    const id = eq === -1 ? spec : spec.slice(0, eq);
    const pass = (() => {
      try {
        return getPostPass(id);
      } catch {
        throw new UsageError(
          `unknown post pass "${id}" (available: ${listPostPasses().map((p) => p.id).join(", ")})`,
        );
      }
    })();
    if (eq === -1) {
      out[id] = true;
      continue;
    }
    const overrides: Record<string, unknown> = {};
    const rest = spec.slice(eq + 1);
    if (rest.trim() !== "") {
      for (const pair of rest.split(",")) {
        const i = pair.indexOf("=");
        if (i === -1) {
          throw new UsageError(`invalid --post override "${pair}", expected key=value`);
        }
        overrides[pair.slice(0, i)] = coerceScalar(pair.slice(i + 1));
      }
    }
    guardNumericRanges(pass.params, overrides, `post pass "${id}": `);
    out[id] = overrides;
  }
  return out;
}

function writeFileOrThrow(path: string, data: Uint8Array | string): void {
  try {
    writeFileSync(path, data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ExportError(`cannot write "${path}": ${detail}`);
  }
}

/* ------------------------------------------------------------------ */
/* generate                                                            */
/* ------------------------------------------------------------------ */

function cmdGenerate(argv: readonly string[]): void {
  const args = parseArgs(argv, GENERATE_FLAGS);

  const algorithm = args.requireSingle("algorithm");
  const seed = args.requireSingle("seed");
  const width = args.intOption("width") ?? 80;
  const height = args.intOption("height") ?? 50;

  const format = args.single("format") ?? "ascii";
  if (format !== "ascii" && format !== "json" && format !== "png") {
    throw new UsageError(`--format must be ascii, json, or png (got "${format}")`);
  }
  const out = args.single("out");
  if (format === "png" && !out) {
    throw new UsageError("--format png requires --out <path>");
  }

  const tileSize = args.intOption("tile-size");
  const themeId = args.single("theme");

  const params = parseKeyValueList(args.list("param"), "param");
  const def = getAlgorithmDef(algorithm);
  guardNumericRanges(def.params, params, "");

  const options: GenerateOptions = {
    algorithm,
    seed,
    width,
    height,
    params,
    post: parsePostSpecs(args.list("post")),
  };

  const dungeon = generateDungeon(options);

  if (format === "ascii") {
    process.stdout.write(exportAscii(dungeon) + "\n");
  } else if (format === "json") {
    process.stdout.write(JSON.stringify(exportDungeonJson(dungeon), null, 2) + "\n");
  } else {
    if (themeId !== undefined && getTheme(themeId).id !== themeId) {
      process.stderr.write(`delvegen: warning: unknown theme "${themeId}", using "dark"\n`);
    }
    const png = renderPng(dungeon, {
      ...(tileSize !== undefined ? { tileSize } : {}),
      ...(themeId !== undefined ? { themeId } : {}),
    });
    writeFileOrThrow(out as string, png);
    process.stderr.write(`delvegen: wrote ${(out as string)} (${png.length} bytes)\n`);
  }

  if (args.has("stats")) {
    const stats = {
      algorithm: dungeon.algorithm,
      seed: dungeon.seed,
      hash: dungeonHash(dungeon),
      ...computeMetrics(dungeon),
    };
    process.stderr.write(JSON.stringify(stats) + "\n");
  }
}

/* ------------------------------------------------------------------ */
/* algorithms                                                          */
/* ------------------------------------------------------------------ */

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function rangeText(spec: ParamSpec): string {
  if (spec.type === "int" || spec.type === "float") return `${spec.min}..${spec.max}`;
  if (spec.type === "enum") return spec.options.map((o) => o.value).join("|");
  return "-";
}

function cmdAlgorithms(): void {
  const defs = listAlgorithms();

  const rows: Array<{ id: string; name: string; summary: string; params: ParamSpec[] }> = defs.map(
    (d) => ({ id: d.id, name: d.name, summary: d.summary, params: [...d.params] }),
  );

  const idW = Math.max(...rows.map((r) => r.id.length));
  const nameW = Math.max(...rows.map((r) => r.name.length));
  const allParams = rows.flatMap((r) => r.params);
  const keyW = Math.max(...allParams.map((p) => p.key.length));
  const typeW = Math.max(...allParams.map((p) => p.type.length));
  const rangeW = Math.max(...allParams.map((p) => rangeText(p).length));

  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as (typeof rows)[number];
    lines.push(`${pad(row.id, idW)}  ${pad(row.name, nameW)}  ${row.summary}`);
    for (const p of row.params) {
      lines.push(
        `  ${pad(p.key, keyW)}  ${pad(p.type, typeW)}  ${pad(rangeText(p), rangeW)}  ${String(p.default)}`,
      );
    }
    if (i < rows.length - 1) lines.push("");
  }
  process.stdout.write(lines.join("\n") + "\n");
}

/* ------------------------------------------------------------------ */
/* batch                                                               */
/* ------------------------------------------------------------------ */

interface MetricAggregate {
  min: number;
  max: number;
  mean: number;
}

/** Per-metric min/max/mean; null metric values are treated as absent. */
function aggregateMetrics(samples: DungeonMetrics[]): Record<string, MetricAggregate> {
  const keys = new Set<string>();
  for (const sample of samples) {
    for (const key of Object.keys(sample)) keys.add(key);
  }
  const out: Record<string, MetricAggregate> = {};
  for (const key of keys) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for (const sample of samples) {
      const v = (sample as unknown as Record<string, unknown>)[key];
      if (typeof v !== "number") continue; // null stays out of the aggregate
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n += 1;
    }
    if (n === 0) continue;
    out[key] = { min, max, mean: Math.round((sum / n) * 1e6) / 1e6 };
  }
  return out;
}

function cmdBatch(argv: readonly string[]): void {
  const args = parseArgs(argv, BATCH_FLAGS);

  const algorithm = args.requireSingle("algorithm");
  const count = args.intOption("seeds") ?? 50;
  if (!Number.isInteger(count) || count < 1) {
    throw new UsageError(`--seeds expects a positive integer, got ${count}`);
  }
  const width = args.intOption("width") ?? 80;
  const height = args.intOption("height") ?? 50;
  const startSeed = args.single("start-seed") ?? "0";
  const out = args.single("out");

  const params = parseKeyValueList(args.list("param"), "param");
  const def = getAlgorithmDef(algorithm);
  guardNumericRanges(def.params, params, "");

  const samples: DungeonMetrics[] = [];
  let connectivityFailures = 0;
  let failures = 0;
  let firstFailure: string | null = null;

  for (let i = 0; i < count; i++) {
    const seed = `${startSeed}-${i}`;
    try {
      const dungeon = generateDungeon({ algorithm, seed, width, height, params });
      try {
        verifyFullyConnected(dungeon.grid);
      } catch {
        connectivityFailures += 1; // pipeline guarantee says this stays 0
      }
      samples.push(computeMetrics(dungeon));
    } catch (err) {
      failures += 1;
      if (firstFailure === null) {
        firstFailure = `${seed}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  if (failures > 0) {
    process.stderr.write(
      `delvegen: batch failed for ${failures}/${count} generations (first: ${firstFailure})\n`,
    );
    process.exitCode = 4;
    return;
  }

  const report = {
    format: "delvegen-batch",
    version: 1,
    algorithm,
    count,
    width,
    height,
    connectivityFailures,
    metrics: aggregateMetrics(samples),
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  if (out !== undefined) {
    writeFileOrThrow(out, json);
    process.stderr.write(`delvegen: wrote ${out}\n`);
  } else {
    process.stdout.write(json);
  }
}
