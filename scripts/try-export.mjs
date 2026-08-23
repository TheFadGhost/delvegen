// Scratch verification for the export modules (run after npm run build).
import { inflateSync } from "node:zlib";
import { registerBuiltinAlgorithms } from "../dist/src/algorithms/index.js";
import { generateDungeon } from "../dist/src/core/generate.js";
import { ExportError } from "../dist/src/core/errors.js";
import { exportAscii, importAscii } from "../dist/src/export/ascii.js";
import { exportDungeonJson, importDungeonJson } from "../dist/src/export/json.js";
import { renderPng } from "../dist/src/export/png.js";
import { getTheme } from "../dist/src/ui/themes.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
}
function expectExportError(name, fn) {
  try {
    fn();
    check(name, false, "no error thrown");
  } catch (err) {
    check(name, err instanceof ExportError, `${err.constructor.name}: ${err.message}`);
  }
}

registerBuiltinAlgorithms();
const dungeon = generateDungeon({ algorithm: "drunkard", seed: "exp", width: 40, height: 24 });
console.log(
  `generated ${dungeon.algorithm} seed=${dungeon.seed} ` +
    `${dungeon.grid.width}x${dungeon.grid.height} entrance=(${dungeon.entrance.x},${dungeon.entrance.y}) exit=(${dungeon.exit.x},${dungeon.exit.y})`,
);

/* ------------------------------------------------------------------ */
/* 1. ASCII round trip                                                 */
/* ------------------------------------------------------------------ */
const ascii1 = exportAscii(dungeon);
const parsed = importAscii(ascii1);
const reparsed = importAscii(ascii1); // determinism sanity
const reexported = exportAscii({
  ...dungeon,
  grid: parsed.grid,
  entrance: parsed.entrance,
  exit: parsed.exit,
});
check("ascii round trip identical", reexported === ascii1);
check(
  "entrance preserved",
  parsed.entrance &&
    parsed.entrance.x === dungeon.entrance.x &&
    parsed.entrance.y === dungeon.entrance.y,
);
check(
  "exit preserved",
  parsed.exit && parsed.exit.x === dungeon.exit.x && parsed.exit.y === dungeon.exit.y,
);
check(
  "grid dims + terrain equal",
  parsed.grid.width === dungeon.grid.width &&
    parsed.grid.height === dungeon.grid.height &&
    Buffer.from(parsed.grid.tiles).equals(Buffer.from(reparsed.grid.tiles)),
);
const lines = ascii1.split("\n");
check(
  "markers present in ascii",
  lines[dungeon.entrance.y][dungeon.entrance.x] === "<" &&
    lines[dungeon.exit.y][dungeon.exit.x] === ">",
);

expectExportError("ascii unknown char names line/column", () =>
  importAscii(ascii1.replace("<", "?")),
);
expectExportError("ascii duplicate entrance rejected", () => importAscii(ascii1 + "\n" + ascii1));
expectExportError("ascii ragged row rejected", () => importAscii(ascii1 + "x"));
expectExportError("ascii too small rejected", () => importAscii("#.+#\n<..>\n"));

/* ------------------------------------------------------------------ */
/* 2. JSON round trip + corruption tests                               */
/* ------------------------------------------------------------------ */
const j1 = JSON.parse(JSON.stringify(exportDungeonJson(dungeon)));
const imported = importDungeonJson(j1);
const j2 = exportDungeonJson({
  ...dungeon,
  grid: imported.grid,
  rooms: imported.rooms,
  algorithm: imported.algorithm,
  seed: imported.seed,
  entrance: imported.entrance ?? dungeon.entrance,
  exit: imported.exit ?? dungeon.exit,
  meta: imported.meta,
});
const j3 = exportDungeonJson(
  (() => {
    const again = importDungeonJson(j2);
    return {
      ...dungeon,
      grid: again.grid,
      rooms: again.rooms,
      meta: again.meta,
      entrance: again.entrance ?? dungeon.entrance,
      exit: again.exit ?? dungeon.exit,
    };
  })(),
);
check("json double round trip deep-equal", JSON.stringify(j2) === JSON.stringify(j1) && JSON.stringify(j3) === JSON.stringify(j1));

const corruptBase = JSON.parse(JSON.stringify(j1));
corruptBase.tiles[5].length = Math.max(0, corruptBase.tiles[5].length - 1);
expectExportError("json truncated tiles row throws", () => importDungeonJson(corruptBase));

const badValue = JSON.parse(JSON.stringify(j1));
badValue.tiles[7][9] = 9;
expectExportError("json tile value 9 throws", () => importDungeonJson(badValue));

const badFormat = JSON.parse(JSON.stringify(j1));
badFormat.format = "not-delvegen";
expectExportError("json wrong format string throws", () => importDungeonJson(badFormat));

expectExportError("json null input throws", () => importDungeonJson(null));
expectExportError("json string input throws", () => importDungeonJson("{}"));

/* ------------------------------------------------------------------ */
/* 3. PNG verification                                                 */
/* ------------------------------------------------------------------ */
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function crc32(bytes) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

for (const tileSize of [undefined, 4]) {
  const png = Buffer.from(renderPng(dungeon, tileSize ? { tileSize } : undefined));
  const ts = tileSize ?? 8;
  const W = dungeon.grid.width * ts;
  const H = dungeon.grid.height * ts;

  const sigOk =
    png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71 &&
    png[4] === 13 && png[5] === 10 && png[6] === 26 && png[7] === 10;
  check(`png signature ok (tileSize=${ts})`, sigOk);

  let off = 8;
  const idatParts = [];
  let dims = null;
  let allCrcsOk = true;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    const crcExpected = png.readUInt32BE(off + 8 + len);
    const crcActual = crc32(png.subarray(off + 4, off + 8 + len));
    if (crcActual !== crcExpected) allCrcsOk = false;
    if (type === "IHDR") {
      dims = [data.readUInt32BE(0), data.readUInt32BE(4)];
      check(
        `IHDR bitdepth/color/compression (tileSize=${ts})`,
        data[8] === 8 && data[9] === 2 && data[10] === 0 && data[11] === 0 && data[12] === 0,
      );
    }
    if (type === "IDAT") idatParts.push(data);
    if (type === "IEND") {
      off += 12;
      break;
    }
    off += 12 + len;
  }
  check(`png chunk CRCs valid (tileSize=${ts})`, allCrcsOk);
  check(`IHDR dims correct (tileSize=${ts})`, !!dims && dims[0] === W && dims[1] === H, `dims=${dims}`);

  const raw = inflateSync(Buffer.concat(idatParts));
  check(
    `IDAT inflates to exact size (tileSize=${ts})`,
    raw.length === H * (W * 3 + 1),
    `${raw.length} vs ${H * (W * 3 + 1)}`,
  );

  // Pixel color checks: pick a wall tile and a room-floor tile away from markers.
  const theme = getTheme("dark");
  const findTile = (t, avoidMarkers) => {
    for (let y = 0; y < dungeon.grid.height; y++) {
      for (let x = 0; x < dungeon.grid.width; x++) {
        if (dungeon.grid.get(x, y) !== t) continue;
        if (
          avoidMarkers &&
          ((x === dungeon.entrance.x && y === dungeon.entrance.y) ||
            (x === dungeon.exit.x && y === dungeon.exit.y))
        )
          continue;
        return [x, y];
      }
    }
    return null;
  };
  const stride = W * 3 + 1;
  const pixelAt = (pxX, pxY) => {
    const rowStart = pxY * stride;
    if (raw[rowStart] !== 0) throw new Error("unexpected nonzero filter byte");
    const base = rowStart + 1 + pxX * 3;
    return [raw[base], raw[base + 1], raw[base + 2]];
  };
  const wallPos = findTile(0, true);
  // Drunkard carves only corridors; accept either walkable floor kind.
  const roomPos = findTile(1, true) ?? findTile(2, true);
  const roomKind = findTile(1, true) ? theme.tiles.room : theme.tiles.corridor;
  const wallPix = pixelAt(wallPos[0] * ts + Math.floor(ts / 2), wallPos[1] * ts + Math.floor(ts / 2));
  const roomPix = pixelAt(roomPos[0] * ts + Math.floor(ts / 2), roomPos[1] * ts + Math.floor(ts / 2));
  const wallExp = hexRgb(theme.tiles.wall);
  const roomExp = hexRgb(roomKind);
  check(
    `wall pixel matches palette (tileSize=${ts})`,
    wallPix[0] === wallExp[0] && wallPix[1] === wallExp[1] && wallPix[2] === wallExp[2],
    `got ${wallPix} want ${wallExp}`,
  );
  check(
    `room pixel matches palette (tileSize=${ts})`,
    roomPix[0] === roomExp[0] && roomPix[1] === roomExp[1] && roomPix[2] === roomExp[2],
    `got ${roomPix} want ${roomExp}`,
  );

  // Entrance ring should contain its marker color; center stays corridor.
  const entCenter = pixelAt(dungeon.entrance.x * ts + Math.floor(ts / 2), dungeon.entrance.y * ts + Math.floor(ts / 2));
  const corExp = hexRgb(theme.tiles.corridor);
  check(
    `entrance center is corridor color (tileSize=${ts})`,
    entCenter[0] === corExp[0] && entCenter[1] === corExp[1] && entCenter[2] === corExp[2],
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
