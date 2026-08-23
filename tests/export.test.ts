import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  bootstrapDelvegen,
  generateDungeon,
} from "../src/index.js";
import { exportAscii, importAscii } from "../src/export/ascii.js";
import { exportDungeonJson, importDungeonJson } from "../src/export/json.js";
import { renderPng } from "../src/export/png.js";
import type { GeneratedDungeon } from "../src/core/types.js";

bootstrapDelvegen();

/** One canonical dungeon shared by the whole file. */
const dungeon: GeneratedDungeon = generateDungeon({
  algorithm: "drunkard",
  seed: "exp",
  width: 40,
  height: 24,
});

/** 1-based (line, column) of a character offset in exported ASCII text. */
function lineColOf(text: string, idx: number): [number, number] {
  const before = text.slice(0, idx);
  const line = before.split("\n").length;
  const col = idx - (before.lastIndexOf("\n") + 1) + 1;
  return [line, col];
}

describe("ascii export/import", () => {
  it("round-trips byte-identically and preserves entrance/exit", () => {
    const text = exportAscii(dungeon);
    const parsed = importAscii(text);

    assert.deepStrictEqual(parsed.entrance, dungeon.entrance, "entrance marker lost in import");
    assert.deepStrictEqual(parsed.exit, dungeon.exit, "exit marker lost in import");
    assert.ok(
      Buffer.from(parsed.grid.tiles).equals(Buffer.from(dungeon.grid.tiles)),
      "grid bytes changed across ascii round trip",
    );

    const reexported = exportAscii({
      ...dungeon,
      grid: parsed.grid,
      entrance: parsed.entrance as { x: number; y: number },
      exit: parsed.exit as { x: number; y: number },
    });
    assert.strictEqual(reexported, text, "re-export must be byte-identical");
  });

  it("rejects unknown characters naming line and column", () => {
    const text = exportAscii(dungeon);
    const wallIdx = text.indexOf("#");
    assert.ok(wallIdx >= 0, "fixture must contain a wall tile to corrupt");
    const [line, col] = lineColOf(text, wallIdx);
    const corrupted = text.slice(0, wallIdx) + "?" + text.slice(wallIdx + 1);
    assert.throws(
      () => importAscii(corrupted),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(`unknown character "\\?" at line ${line}, column ${col}`));
        return true;
      },
    );
  });

  it("rejects duplicate entrance markers naming position", () => {
    const text = exportAscii(dungeon);
    // The import scan is row-major, so the SECOND-encountered '<' is the one
    // named in the error. Pick a wall tile that scans after the real entrance.
    const entranceIdx = text.indexOf("<");
    assert.ok(entranceIdx >= 0, "fixture must contain an entrance marker");
    let wallIdx = -1;
    for (let i = text.length - 1; i > entranceIdx; i--) {
      if (text[i] === "#") {
        wallIdx = i;
        break;
      }
    }
    assert.ok(wallIdx >= 0, "fixture must contain a wall tile after the entrance to overwrite");
    const [line, col] = lineColOf(text, wallIdx);
    const corrupted = text.slice(0, wallIdx) + "<" + text.slice(wallIdx + 1);
    assert.throws(
      () => importAscii(corrupted),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(`duplicate entrance '<' at line ${line}, column ${col}`));
        return true;
      },
    );
  });

  it("rejects nonrectangular input naming the ragged line", () => {
    const lines = exportAscii(dungeon).split("\n");
    lines[7] = (lines[7] as string) + "#";
    assert.throws(
      () => importAscii(lines.join("\n")),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /line 8 has length/);
        assert.match(err.message, /rectangular/);
        return true;
      },
    );
  });
});

describe("json export/import", () => {
  it("deep round-trips with meta intact", () => {
    const doc = exportDungeonJson(dungeon);
    const back = importDungeonJson(JSON.parse(JSON.stringify(doc)));
    const reexported = exportDungeonJson(back as unknown as GeneratedDungeon);
    assert.deepStrictEqual(reexported, doc, "export -> import -> export must deep-equal");

    // Meta specifically: drunkard records numeric steps/carvedTiles/walkersUsed.
    assert.ok(Object.keys(doc.meta).length > 0, "fixture meta should not be empty");
    assert.deepStrictEqual(reexported.meta, doc.meta);
    assert.strictEqual(reexported.algorithm, "drunkard");
    assert.strictEqual(reexported.seed, "exp");
  });

  it("corrupt payloads each throw ExportError with distinct messages", () => {
    const base = exportDungeonJson(dungeon);

    const tileValue9 = structuredClone(base);
    (tileValue9.tiles[0] as number[])[0] = 9;

    const shortRow = structuredClone(base);
    (shortRow.tiles[0] as number[]).pop();

    const wrongFormat = structuredClone(base);
    (wrongFormat as unknown as Record<string, unknown>)["format"] = "not-a-delvegen-dungeon";

    const version2 = structuredClone(base);
    (version2 as unknown as Record<string, unknown>)["version"] = 2;

    const cases: Array<[string, unknown, RegExp]> = [
      ["tile value 9", tileValue9, /tiles\[0\]\[0\]/],
      ["short row", shortRow, /tiles\[0\]: has length/],
      ["wrong format field", wrongFormat, /"format" must be "delvegen-dungeon"/],
      ["version 2", version2, /unsupported version 2/],
    ];

    const messages: string[] = [];
    for (const [label, payload, pattern] of cases) {
      assert.throws(
        () => importDungeonJson(payload),
        (err: unknown) => {
          assert.ok(err instanceof Error, `${label}: expected an ExportError`);
          assert.match(err.message, pattern, `${label}: message should name the offending field`);
          return true;
        },
        label,
      );
      try {
        importDungeonJson(payload);
      } catch (err) {
        messages.push((err as Error).message);
      }
    }
    assert.strictEqual(
      new Set(messages).size,
      messages.length,
      `each corruption mode must produce a DISTINCT message, got: ${messages.join(" | ")}`,
    );
  });
});

describe("png renderer", () => {
  it("emits a valid PNG: signature, IHDR dimensions for tileSize 8, inflating IDAT", () => {
    const png = Buffer.from(renderPng(dungeon, { tileSize: 8 }));

    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      "missing PNG signature",
    );

    // Chunk layout: signature(8) | IHDR chunk(4 len + 4 type + 13 data + 4 crc).
    assert.strictEqual(png.toString("latin1", 12, 16), "IHDR");
    const w = dungeon.grid.width * 8; // 320
    const h = dungeon.grid.height * 8; // 192
    assert.strictEqual(png.readUInt32BE(8), 13, "IHDR data length must be 13");
    assert.strictEqual(png.readUInt32BE(16), w, "IHDR width = gridWidth * tileSize");
    assert.strictEqual(png.readUInt32BE(20), h, "IHDR height = gridHeight * tileSize");
    assert.strictEqual(png[24], 8, "bit depth");
    assert.strictEqual(png[25], 2, "color type truecolor RGB");

    // Second chunk is IDAT.
    const idatLenOffset = 8 + 25;
    const idatDataOffset = idatLenOffset + 8;
    assert.strictEqual(png.toString("latin1", idatLenOffset + 4, idatLenOffset + 8), "IDAT");
    const idatLen = png.readUInt32BE(idatLenOffset);
    const inflated = inflateSync(png.subarray(idatDataOffset, idatDataOffset + idatLen));
    const expectedRaw = h * (w * 3 + 1); // filter byte + RGB stride per row
    assert.strictEqual(
      inflated.length,
      expectedRaw,
      `inflated IDAT must be ${expectedRaw} bytes (${h} rows x (1 + ${w}*3))`,
    );

    // Trailer chunk (after IDAT data + its 4-byte CRC).
    const iendOffset = idatDataOffset + idatLen + 4;
    assert.strictEqual(png.readUInt32BE(iendOffset), 0, "IEND data length must be 0");
    assert.strictEqual(png.toString("latin1", iendOffset + 4, iendOffset + 8), "IEND");
  });
});
