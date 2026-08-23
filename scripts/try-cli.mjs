// Verification harness for the Delvegen CLI (run after npm run build).
// Spawns node dist/src/cli/main.js with various arguments and checks
// stdout/stderr/exit codes against the CLI contract.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportDungeonJson, importDungeonJson } from "../dist/src/export/json.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(root, "dist", "src", "cli", "main.js");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
}

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const tmp = mkdtempSync(path.join(tmpdir(), "delvegen-cli-"));

try {
  /* 2. generate ascii ------------------------------------------------ */
  const a = run(["generate", "--algorithm", "drunkard", "--seed", "alpha"]);
  check("ascii: exit 0", a.code === 0, `code=${a.code} stderr=${a.stderr}`);
  check("ascii: charset /^[#,.<>\\n,]+$/", /^[#,.<>\n,]+$/.test(a.stdout));
  const asciiLines = a.stdout.split("\n");
  const asciiRows = asciiLines.filter((l) => l.length > 0);
  check(
    "ascii: exactly 50 lines x 80 chars",
    asciiRows.length === 50 && asciiRows.every((l) => l.length === 80),
    `rows=${asciiRows.length} widths=${[...new Set(asciiRows.map((l) => l.length))].join(",")}`,
  );
  check("ascii: trailing newline only", asciiLines[asciiLines.length - 1] === "");
  check("ascii: entrance '<' present", a.stdout.includes("<"));
  check("ascii: stdout-only payload (silent stderr)", a.stderr === "");

  /* 3. generate json -------------------------------------------------- */
  const j = run([
    "generate",
    "--algorithm",
    "rooms-mst",
    "--seed",
    "b",
    "--width",
    "60",
    "--height",
    "50",
    "--param",
    "roomCount=5",
    "--format",
    "json",
  ]);
  check("json: exit 0", j.code === 0, `code=${j.code} stderr=${j.stderr}`);
  let parsed = null;
  let parseError = "";
  try {
    parsed = JSON.parse(j.stdout);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  check("json: parseable", parsed !== null, parseError);
  check(
    "json: format delvegen-dungeon v1",
    !!parsed && parsed.format === "delvegen-dungeon" && parsed.version === 1,
  );
  check(
    "json: tiles 50 rows of 60",
    !!parsed &&
      Array.isArray(parsed.tiles) &&
      parsed.tiles.length === 50 &&
      parsed.tiles.every((row) => Array.isArray(row) && row.length === 60),
  );

  /* 4. json round trip through importDungeonJson ---------------------- */
  if (parsed) {
    const imported = importDungeonJson(JSON.parse(JSON.stringify(parsed)));
    const reexported = exportDungeonJson({
      grid: imported.grid,
      rooms: imported.rooms,
      meta: imported.meta,
      algorithm: imported.algorithm,
      seed: imported.seed,
      entrance: imported.entrance,
      exit: imported.exit,
    });
    check(
      "json round trip: importDungeonJson -> exportDungeonJson equal",
      JSON.stringify(reexported) === JSON.stringify(parsed),
    );
  } else {
    check("json round trip: importDungeonJson -> exportDungeonJson equal", false, "no parsed json");
  }

  /* 5. generate png ---------------------------------------------------- */
  const pngPath = path.join(tmp, "tmp.png");
  const g = run([
    "generate",
    "--algorithm",
    "cellular",
    "--seed",
    "c",
    "--format",
    "png",
    "--out",
    pngPath,
  ]);
  check("png: exit 0", g.code === 0, `code=${g.code} stderr=${g.stderr}`);
  const pngBytes = existsSync(pngPath) ? readFileSync(pngPath) : Buffer.alloc(0);
  check("png: nonzero size", pngBytes.length > 0, `${pngBytes.length} bytes`);
  check(
    "png: signature bytes",
    pngBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );

  /* 6. error cases ------------------------------------------------------ */
  const badAlgo = run(["generate", "--algorithm", "nope", "--seed", "x"]);
  check("bad algorithm: exit 2", badAlgo.code === 2, `code=${badAlgo.code}`);
  check("bad algorithm: stderr names it", badAlgo.stderr.includes('"nope"'), badAlgo.stderr);
  check(
    "bad algorithm: clean message (delvegen:, no stack)",
    badAlgo.stderr.startsWith("delvegen:") && !badAlgo.stderr.includes("    at "),
  );

  const typoParam = run(["generate", "--algorithm", "rooms-mst", "--seed", "x", "--param", "roomsCount=5"]);
  check("typo param: exit 2", typoParam.code === 2, typoParam.stderr);
  check("typo param: names key", /Unknown parameter/i.test(typoParam.stderr), typoParam.stderr);

  const oobParam = run(["generate", "--algorithm", "drunkard", "--seed", "x", "--param", "floorTargetPct=500"]);
  check("out-of-range param: exit 2", oobParam.code === 2, oobParam.stderr);
  check("out-of-range param: mentions range", /\bout of range\b/i.test(oobParam.stderr), oobParam.stderr);

  const tinyWidth = run(["generate", "--algorithm", "cellular", "--seed", "x", "--width", "3"]);
  check("width 3: exit 2", tinyWidth.code === 2, tinyWidth.stderr);

  const pngNoOut = run(["generate", "--algorithm", "drunkard", "--seed", "x", "--format", "png"]);
  check("png without --out: exit 2 + message", pngNoOut.code === 2 && pngNoOut.stderr.includes("--out"), pngNoOut.stderr);

  const unknownFlag = run(["generate", "--algorithm", "drunkard", "--seed", "x", "--frobnicate", "1"]);
  check("unknown flag: exit 2 + named", unknownFlag.code === 2 && unknownFlag.stderr.includes("--frobnicate"), unknownFlag.stderr);

  const missingValue = run(["generate", "--algorithm"]);
  check("missing value: exit 2", missingValue.code === 2, missingValue.stderr);

  /* 7. batch ------------------------------------------------------------ */
  const statsPath = path.join(tmp, "stats.json");
  const b = run(["batch", "--algorithm", "rooms-mst", "--seeds", "12", "--out", statsPath]);
  check("batch: exit 0", b.code === 0, `code=${b.code} stderr=${b.stderr}`);
  let stats = null;
  try {
    stats = JSON.parse(readFileSync(statsPath, "utf8"));
  } catch {}
  check("batch: stats.json written + parseable", stats !== null);
  check("batch: header fields", !!stats && stats.format === "delvegen-batch" && stats.version === 1 && stats.algorithm === "rooms-mst");
  check("batch: count 12", !!stats && stats.count === 12);
  check("batch: connectivityFailures === 0", !!stats && stats.connectivityFailures === 0);
  const expectedAggregates = ["roomCount", "avgRoomSize", "corridorToRoomRatio", "deadEndCount", "meanPathLength", "branchingFactor", "openPct"];
  const presentAggs = expectedAggregates.filter((k) => {
    const agg = stats?.metrics?.[k];
    return agg && typeof agg.min === "number" && typeof agg.max === "number" && typeof agg.mean === "number";
  });
  check(
    "batch: metric aggregates present",
    ["roomCount", "avgRoomSize", "deadEndCount", "meanPathLength", "openPct"].every((k) => presentAggs.includes(k)),
    `present=[${presentAggs.join(",")}]`,
  );

  const bStdout = run(["batch", "--algorithm", "drunkard", "--seeds", "3", "--start-seed", "7"]);
  const bStdoutOk =
    bStdout.code === 0 &&
    (() => {
      try {
        const doc = JSON.parse(bStdout.stdout);
        return doc.count === 3 && doc.connectivityFailures === 0;
      } catch {
        return false;
      }
    })();
  check("batch stdout mode: parseable JSON, count 3", bStdoutOk, bStdout.stderr);

  /* 8. --stats ----------------------------------------------------------- */
  const s = run(["generate", "--algorithm", "bsp", "--seed", "s1", "--stats"]);
  check("stats: exit 0", s.code === 0, s.stderr);
  const statLine = s.stderr.split("\n").map((l) => l.trim()).find((l) => l.startsWith("{"));
  let statObj = null;
  try {
    statObj = JSON.parse(statLine ?? "");
  } catch {}
  check("stats: stderr JSON line has deadEndCount", statObj !== null && "deadEndCount" in statObj, statLine);
  check(
    "stats: carries algorithm/seed/hash",
    !!statObj && statObj.algorithm === "bsp" && statObj.seed === "s1" && typeof statObj.hash === "string" && statObj.hash.length === 16,
    statLine,
  );
  check("stats: stdout still pure map", /^[#,.<>\n,]+$/.test(s.stdout));

  /* --post spec forms ----------------------------------------------------- */
  const postPlain = run(["generate", "--algorithm", "rooms-mst", "--seed", "d", "--post", "doors"]);
  check("--post doors: exit 0", postPlain.code === 0, postPlain.stderr);
  const postOverride = run(["generate", "--algorithm", "rooms-mst", "--seed", "d", "--post", "doors=doorChance=100"]);
  check("--post doors=doorChance=100: exit 0", postOverride.code === 0, postOverride.stderr);
  const postBadId = run(["generate", "--algorithm", "rooms-mst", "--seed", "d", "--post", "frobnicate"]);
  check("--post unknown id: exit 2 + named", postBadId.code === 2 && postBadId.stderr.includes("frobnicate"), postBadId.stderr);

  /* 9. algorithms listing --------------------------------------------------- */
  const al = run(["algorithms"]);
  check("algorithms: exit 0", al.code === 0);
  const fiveIds = ["drunkard", "bsp", "rooms-mst", "cellular", "wang"];
  check(
    "algorithms: lists five ids",
    fiveIds.every((id) => al.stdout.split("\n").some((line) => line.startsWith(id))),
    al.stdout.split("\n")[0],
  );
  check("algorithms: no color codes", !/\[[\d;]*m/.test(al.stdout));

  /* help ---------------------------------------------------------------- */
  const h = run(["help"]);
  check("help: exit 0 on stdout", h.code === 0 && h.stdout.includes("Usage:"));
  const noArgs = run([]);
  check("no args: usage error exit 2", noArgs.code === 2 && noArgs.stderr.includes("Usage:"));

  /* determinism ---------------------------------------------------------- */
  const d1 = run(["generate", "--algorithm", "wang", "--seed", "det", "--format", "json"]);
  const d2 = run(["generate", "--algorithm", "wang", "--seed", "det", "--format", "json"]);
  check("determinism: identical output across runs", d1.stdout === d2.stdout && d1.code === 0 && d2.code === 0);

  // Keep a sample listing for eyeballing.
  console.log("\n--- algorithms output sample ---");
  console.log(al.stdout);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL CLI CHECKS PASSED" : `\n${failures} CLI CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
