// Scratch verification for src/post/* (run after `npm run build`).
import { DungeonGrid } from "../dist/src/core/grid.js";
import { Tile } from "../dist/src/core/tile.js";
import { createRng } from "../dist/src/core/rng.js";
import { makePostContext, resolveParams } from "../dist/src/core/types.js";
import { FrameRecorder } from "../dist/src/core/recorder.js";
import { labelRegions } from "../dist/src/analysis/regions.js";
import { POST_PASS_ORDER, getPostPass, listPostPasses } from "../dist/src/core/post-registry.js";
import {
  registerPostPasses,
  repairConnectivity,
  pruneDeadEnds,
  placeDoors,
  thinWalls,
} from "../dist/src/post/index.js";
import { registerBuiltinAlgorithms } from "../dist/src/algorithms/index.js";
import { generateDungeon } from "../dist/src/core/generate.js";
import { dungeonHash } from "../dist/src/core/hash.js";

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

function regionCount(grid) {
  return labelRegions(grid).count;
}
function deadEndCount(grid) {
  let n = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.get(x, y);
      if (t !== Tile.CorridorFloor && t !== Tile.Door) continue;
      let w = 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (grid.walkableAt(x + dx, y + dy)) w++;
      }
      if (w === 1) n++;
    }
  }
  return n;
}

function runPass(def, grid, overrides = {}, seed = "post-seed") {
  const recorder = new FrameRecorder(grid.width, grid.height);
  const data = { grid, rooms: [], meta: {} };
  const ctx = makePostContext({
    rng: createRng(seed),
    params: resolveParams(def.params, overrides),
    recorder,
  });
  def.apply(data, ctx);
  return { data, labels: recorder.frames.map((f) => f.label) };
}

/* ---------------------------------------------------------------- */
/* Registry                                                          */
/* ---------------------------------------------------------------- */
registerBuiltinAlgorithms();
registerPostPasses();
registerPostPasses(); // idempotency: double call must not throw
check(
  "registry order matches POST_PASS_ORDER",
  JSON.stringify(listPostPasses().map((p) => p.id)) === JSON.stringify(POST_PASS_ORDER),
);

/* ---------------------------------------------------------------- */
/* (a) repair: two rooms + corridor + isolated pocket -> 1 region    */
/* ---------------------------------------------------------------- */
function repairFixture() {
  const g = new DungeonGrid(21, 21, Tile.Wall);
  g.fillRect(2, 2, 5, 5, Tile.RoomFloor); // room A x2..6 y2..6
  g.fillRect(14, 2, 5, 5, Tile.RoomFloor); // room B x14..18 y2..6
  g.fillRect(7, 4, 7, 1, Tile.CorridorFloor); // spine x7..13 y4
  g.set(10, 15, Tile.CorridorFloor); // isolated pocket at (10,15)
  return g;
}
{
  const g = repairFixture();
  check("fixture (a) starts with 2 regions", regionCount(g) === 2);
  const { labels } = runPass(getPostPass("repair"), g);
  check("(a) repaired to exactly 1 region", regionCount(g) === 1);
  check(`(a) frame recorded ("connect region ..."): ${JSON.stringify(labels)}`, labels.length === 1 && labels[0] === "connect region 1");
  check("(a) carved corridor tile (10,10) is CorridorFloor", g.get(10, 10) === Tile.CorridorFloor);

  const g2 = repairFixture();
  runPass(repairConnectivity, g2, {}, "post-seed");
  check(
    "(a) deterministic across runs",
    Buffer.from(g.tiles).equals(Buffer.from(g2.tiles)),
  );
}

/* ---------------------------------------------------------------- */
/* (b) prune: corridor with L-shaped stubs, depth 6                  */
/* ---------------------------------------------------------------- */
function pruneFixture() {
  const g = new DungeonGrid(21, 21, Tile.Wall);
  g.fillRect(2, 2, 4, 4, Tile.RoomFloor); // room A x2..5 y2..5
  g.fillRect(16, 2, 4, 4, Tile.RoomFloor); // room B x16..19 y2..5
  g.fillRect(6, 3, 10, 1, Tile.CorridorFloor); // spine x6..15 y3
  g.fillRect(9, 4, 1, 6, Tile.CorridorFloor); // stub down x9 y4..9
  g.fillRect(13, 4, 1, 4, Tile.CorridorFloor); // stub down x13 y4..7
  g.fillRect(14, 7, 4, 1, Tile.CorridorFloor); // L foot x14..17 y7
  return g;
}
{
  const g = pruneFixture();
  const before = deadEndCount(g);
  let roomFloors = 0;
  for (const t of g.tiles) if (t === Tile.RoomFloor) roomFloors++;

  const { labels } = runPass(pruneDeadEnds, g, { pruneDepth: 6 });

  check("(b) still 1 region after pruning", regionCount(g) === 1);
  check(`(b) dead ends reduced (${before} -> ${deadEndCount(g)})`, deadEndCount(g) < before);
  let roomFloorsAfter = 0;
  for (const t of g.tiles) if (t === Tile.RoomFloor) roomFloorsAfter++;
  check("(b) rooms untouched (RoomFloor count preserved)", roomFloorsAfter === roomFloors);
  check("(b) stub tips removed", g.get(9, 9) === Tile.Wall && g.get(17, 7) === Tile.Wall && g.get(9, 4) === Tile.Wall);
  check("(b) spine intact", g.get(6, 3) === Tile.CorridorFloor && g.get(15, 3) === Tile.CorridorFloor);
  check(
    `(b) frames labelled per sweep: ${labels[0]}, ${labels[labels.length - 1]}`,
    labels.length > 0 && labels[0].startsWith("prune pass 1 (removed") && labels[labels.length - 1].startsWith("prune pass 6 (removed"),
  );

  const g0 = pruneFixture();
  runPass(pruneDeadEnds, g0, { pruneDepth: 0 });
  check(
    "(b) depth 0 is a no-op",
    Buffer.from(g0.tiles).equals(Buffer.from(pruneFixture().tiles)),
  );
}

/* ---------------------------------------------------------------- */
/* (c) doors: corridor hugging a room wall, chance 100 vs 0          */
/* ---------------------------------------------------------------- */
function doorsFixture() {
  const g = new DungeonGrid(21, 21, Tile.Wall);
  g.fillRect(2, 2, 5, 5, Tile.RoomFloor); // room x2..6 y2..6
  g.fillRect(7, 4, 1, 9, Tile.CorridorFloor); // corridor column x7 y4..12
  return g;
}
{
  // Candidates: (7,4),(7,5),(7,6) each have one RoomFloor neighbour (west),
  // solid east opposite, non-room perpendiculars.
  const g100 = doorsFixture();
  const { labels: labels100 } = runPass(placeDoors, g100, { doorChance: 100 });
  check("(c) chance 100 places doors in the mouth", g100.get(7, 4) === Tile.Door && g100.get(7, 5) === Tile.Door && g100.get(7, 6) === Tile.Door);
  check("(c) far corridor end untouched", g100.get(7, 12) === Tile.CorridorFloor);
  check(`(c) final frame counts placements: ${labels100.at(-1)}`, labels100.at(-1) === "doors placed (3)");

  const g0 = doorsFixture();
  const { labels: labels0 } = runPass(placeDoors, g0, { doorChance: 0 });
  let anyDoor = false;
  for (const t of g0.tiles) if (t === Tile.Door) anyDoor = true;
  check("(c) chance 0 leaves grid unchanged", !anyDoor && Buffer.from(g0.tiles).equals(Buffer.from(doorsFixture().tiles)));
  check(`(c) chance 0 frame: ${labels0.at(-1)}`, labels0.at(-1) === "doors placed (0)");
}

/* ---------------------------------------------------------------- */
/* (d) thin: stray wall pixel melts, border ring untouched           */
/* ---------------------------------------------------------------- */
function caveFixture() {
  const g = new DungeonGrid(21, 21, Tile.Wall);
  g.fillRect(1, 1, 19, 19, Tile.CorridorFloor); // open interior, wall border ring
  g.set(10, 10, Tile.Wall); // single stray wall pixel mid-cave
  g.set(5, 5, Tile.Wall); // two-tile horizontal speck
  g.set(6, 5, Tile.Wall);
  g.set(1, 3, Tile.Wall); // stray touching the border ring via (0,3)
  return g;
}
{
  const g = caveFixture();
  const { labels } = runPass(thinWalls, g, { minCluster: 1 });
  check("(d) stray pixel melted to floor", g.get(10, 10) === Tile.CorridorFloor);
  check("(d) 2-tile speck kept at minCluster 1", g.get(5, 5) === Tile.Wall && g.get(6, 5) === Tile.Wall);
  check("(d) border-adjacent stray kept", g.get(1, 3) === Tile.Wall);
  let borderSolid = true;
  for (let i = 0; i < 21; i++) {
    if (g.get(i, 0) !== Tile.Wall || g.get(i, 20) !== Tile.Wall || g.get(0, i) !== Tile.Wall || g.get(20, i) !== Tile.Wall) borderSolid = false;
  }
  check("(d) border ring untouched", borderSolid);
  check(`(d) frame reports removals: ${labels.at(-1)}`, labels.at(-1) === "removed 1 wall specks");

  const g2 = caveFixture();
  runPass(thinWalls, g2, { minCluster: 2 });
  check("(d) default limit also melts the 2-tile speck", g2.get(5, 5) === Tile.CorridorFloor && g2.get(6, 5) === Tile.CorridorFloor);
  check("(d) still 1 region after melting", regionCount(g2) === 1);
}

/* ---------------------------------------------------------------- */
/* Full pipeline sanity                                              */
/* ---------------------------------------------------------------- */
{
  const opts = {
    algorithm: "drunkard",
    seed: "p",
    width: 64,
    height: 48,
    post: { repair: true, prune: true, doors: true, thin: true },
  };
  const d1 = generateDungeon(opts);
  const d2 = generateDungeon(opts);
  check("pipeline succeeds with all four passes", d1.grid.count(Tile.Wall) > 0);
  check(`pipeline: 1 region (got ${regionCount(d1.grid)})`, regionCount(d1.grid) === 1);
  check(`pipeline: deterministic hash (${dungeonHash(d1)})`, dungeonHash(d1) === dungeonHash(d2));
  check("pipeline: attemptsUsed === 1", d1.attemptsUsed === 1);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
