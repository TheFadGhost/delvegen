// Feature-wave 3 smoke test: compare mode, presets + surprise, seed history,
// URL sharing, distribution histograms.
// Mechanics mirror scripts/smoke-ui.mjs / smoke-ui2.mjs (spawn server,
// playwright, log, finally kill, ALWAYS process.exit).
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const LOG = "smoke-ui3.log";
const say = (m) => {
  appendFileSync(LOG, m + "\n");
};
writeFileSync(LOG, "");

const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: "8125" },
});
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));

const errors = [];
let exitCode = 0;
let browser;
try {
  const t0 = Date.now();
  while (!serverOut.includes("http://")) {
    if (Date.now() - t0 > 8000) throw new Error(`server did not start: ${serverOut}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  say("server up");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto("http://localhost:8125/", { timeout: 15000 });
  say("page loaded");
  await page.waitForSelector("#algorithm-select option", { state: "attached" });

  const waitForStatusContains = async (needle, timeout = 8000) => {
    await page.waitForFunction(
      (n) => (document.getElementById("status-line").textContent ?? "").includes(n),
      needle,
      { timeout },
    );
  };

  /* -- compare mode ------------------------------------------------- */
  if (await page.isVisible("#compare-root")) throw new Error("compare root visible before toggle");
  await page.click("#compare-toggle");
  await page.waitForSelector("#compare-root:not(.hidden)");
  const paneCount = await page.locator("#compare-root canvas").count();
  say(`panes after toggle: ${paneCount}`);
  if (paneCount !== 2) throw new Error(`expected two canvases, got ${paneCount}`);

  await page.click("#generate-btn");
  await page.waitForFunction(() =>
    ((document.getElementById("pane-strip-a")?.textContent ?? "") +
      (document.getElementById("pane-strip-b")?.textContent ?? "")).includes("Rooms"),
  );
  say("both strips populated");

  const painted = await page.evaluate(() => {
    const distinct = (cv) => {
      const ctx = cv.getContext("2d");
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const set = new Set();
      for (let i = 0; i < data.length; i += 400) set.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return set.size;
    };
    return [distinct(document.getElementById("pane-canvas-a")), distinct(document.getElementById("pane-canvas-b"))];
  });
  say(`distinct colours per pane: ${painted.join(", ")}`);
  if (painted[0] <= 2 || painted[1] <= 2) throw new Error("a compare pane appears unpainted");

  const stripA = ((await page.textContent("#pane-strip-a")) ?? "").trim();
  const stripB = ((await page.textContent("#pane-strip-b")) ?? "").trim();
  say(`strip A: ${stripA}`);
  say(`strip B: ${stripB}`);
  if (!/Rooms\s*\d/.test(stripA) || !/Rooms\s*\d/.test(stripB)) throw new Error("metrics strip malformed");

  /* -- focus switch repaints panel ----------------------------------- */
  const seedA = await page.inputValue("#seed-input");
  await page.evaluate(() => document.getElementById("pane-b").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  // Pane B cloned pane A's seed; editing the seed now must not change pane A.
  await page.fill("#seed-input", "focuscheck");
  await page.waitForTimeout(300);
  const focusedClass = await page.getAttribute("#pane-b", "class");
  if (!(focusedClass ?? "").includes("focused")) throw new Error("pane B did not take focus");
  await page.click("#generate-btn");
  await page.waitForFunction(
    () => !(document.getElementById("pane-strip-b")?.textContent ?? "").includes("failed"),
  );
  await page.click("#pane-a");
  await page.fill("#seed-input", seedA);
  await page.waitForTimeout(250);
  say("focus switching ok");

  /* -- Escape exits compare ------------------------------------------ */
  await page.keyboard.press("Escape");
  await page.waitForSelector("#compare-root.hidden", { state: "attached" });
  const singleVisible = await page.isVisible("#map-canvas");
  say(`escape restores single view: ${singleVisible}`);
  if (!singleVisible) throw new Error("single canvas not visible after Escape");

  /* -- preset chips --------------------------------------------------- */
  await page.selectOption("#algorithm-select", "bsp");
  await waitForStatusContains("seed", 10000).catch(() => {});
  const snapBefore = await page.evaluate(() => {
    const vals = [...document.querySelectorAll('#params-root input[type="number"]')].map((i) => i.value);
    const posts = [...document.querySelectorAll('#post-root input[type="checkbox"]')].map((c) => c.checked);
    return JSON.stringify({ vals, posts });
  });
  const chipCount = await page.locator(".chip").count();
  say(`preset chips: ${chipCount}`);
  if (chipCount !== 3) throw new Error(`expected 3 chips for bsp, got ${chipCount}`);
  await page.locator(".chip").nth(1).click(); // "Grand halls"
  await page.waitForTimeout(400);
  const snapAfter = await page.evaluate(() => {
    const vals = [...document.querySelectorAll('#params-root input[type="number"]')].map((i) => i.value);
    const posts = [...document.querySelectorAll('#post-root input[type="checkbox"]')].map((c) => c.checked);
    return JSON.stringify({ vals, posts });
  });
  say(`preset changed params: ${snapBefore !== snapAfter}`);
  if (snapBefore === snapAfter) throw new Error("preset chip did not change any param value");
  const chipActive = await page.locator(".chip.active").count();
  if (chipActive !== 1) throw new Error("clicked chip is not highlighted active");

  /* -- distribution histograms ---------------------------------------- */
  await page.click("#dist-details summary");
  await page.click("#sample-btn");
  await page.waitForFunction(
    () => document.querySelectorAll("#dist-charts svg").length === 3,
    null,
    { timeout: 15000 },
  );
  const progressText = ((await page.textContent("#dist-progress")) ?? "").trim();
  say(`distribution progress: ${progressText}`);
  if (!progressText.includes("40")) throw new Error(`unexpected progress text "${progressText}"`);

  /* -- seed history ---------------------------------------------------- */
  const setSeed = async (v) => {
    await page.fill("#seed-input", v);
    await page.dispatchEvent("#seed-input", "change");
    await waitForStatusContains(v, 10000);
  };
  await setSeed("hist-alpha");
  await setSeed("hist-beta");
  let fwdDisabled = (await page.getAttribute("#seed-forward", "disabled")) !== null;
  say(`forward disabled at newest: ${fwdDisabled}`);
  if (!fwdDisabled) throw new Error("forward should be disabled at the newest seed");
  await page.click("#seed-back");
  await waitForStatusContains("hist-alpha", 10000);
  const backValue = await page.inputValue("#seed-input");
  say(`back restored seed: ${backValue}`);
  if (backValue !== "hist-alpha") throw new Error(`back gave "${backValue}", expected hist-alpha`);
  fwdDisabled = (await page.getAttribute("#seed-forward", "disabled")) !== null;
  if (fwdDisabled) throw new Error("forward should be enabled after going back");

  /* -- surprise me ------------------------------------------------------ */
  const s0 = await page.inputValue("#seed-input");
  await page.click("#surprise-btn");
  await page.waitForTimeout(400);
  const s1 = await page.inputValue("#seed-input");
  say(`surprise seed ${s0} -> ${s1}`);
  if (s1 === s0) throw new Error("surprise me did not roll a fresh seed");

  /* -- copy link + hash round trip --------------------------------------- */
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click("#copy-link");
  await page.waitForTimeout(200);
  const hash = await page.evaluate(() => location.hash);
  say(`hash written: ${hash.slice(0, 60)}…`);
  if (!hash.startsWith("#g=")) throw new Error(`hash lacks payload prefix: ${hash}`);
  if (!(hash.includes("v%3A1") || hash.includes("%22v%22"))) {
    throw new Error(`hash lacks encoded version marker: ${hash.slice(0, 80)}`);
  }
  const expectedSeed = await page.inputValue("#seed-input");
  const href = await page.evaluate(() => location.href);
  let clipOk = false;
  try {
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    clipOk = clip === href;
  } catch {
    clipOk = false;
  }
  const flashText = ((await page.textContent("#status-line")) ?? "").trim();
  say(`clipboard round trip: ${clipOk}; flash: "${flashText}"`);
  if (!clipOk && !flashText.includes("copied")) throw new Error("clipboard write did not succeed");

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#algorithm-select option", { state: "attached" });
  const restoredSeed = await page.inputValue("#seed-input");
  say(`restored seed from hash: ${restoredSeed}`);
  if (restoredSeed !== expectedSeed) {
    throw new Error(`reload lost config: "${restoredSeed}" != "${expectedSeed}"`);
  }

  await page.screenshot({ path: "shots/ui-smoke3.png" });
} catch (err) {
  errors.push(err.message);
  exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  server.kill();
}

if (errors.length) {
  say("BROWSER ERRORS:");
  for (const e of errors) say(` - ${e}`);
  exitCode = 1;
} else if (exitCode === 0) {
  say("UI3 SMOKE OK");
}
process.exit(exitCode);
