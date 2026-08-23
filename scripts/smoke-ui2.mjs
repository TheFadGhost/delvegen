// Feature-wave smoke test: post-processing panel, overlays, step-mode
// transport, export/import menu, shortcuts/help, determinism self-check.
// Mechanics mirror scripts/smoke-ui.mjs (spawn server, playwright, log,
// finally kill, ALWAYS process.exit).
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const LOG = "smoke-ui2.log";
const say = (m) => {
  appendFileSync(LOG, m + "\n");
};
writeFileSync(LOG, "");

const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: "8124" },
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto("http://localhost:8124/", { timeout: 15000 });
  say("page loaded");
  await page.waitForSelector("#algorithm-select option", { state: "attached" });
  const postRows = await page.locator("#post-root > .param").count();
  say(`post pass rows: ${postRows}`);
  if (postRows !== 4) throw new Error(`expected 4 post passes, got ${postRows}`);
  const overlayChecks = await page.locator("#overlays-root input[type=checkbox]").count();
  say(`overlay checkboxes: ${overlayChecks}`);
  if (overlayChecks !== 4) throw new Error(`expected 4 overlay checkboxes, got ${overlayChecks}`);

  /* -- step mode ------------------------------------------------- */
  await page.click("#step-mode-btn");
  const pressed = await page.getAttribute("#step-mode-btn", "aria-pressed");
  if (pressed !== "true") throw new Error("step mode button did not toggle on");

  await page.click("#generate-btn");
  await page.waitForSelector("#transport:not(.hidden)", { timeout: 5000 });
  say("transport visible");

  // Scrub to the middle frame; manual input pauses autoplay.
  await page.evaluate(() => {
    const s = document.getElementById("step-scrubber");
    s.value = String(Math.floor(Number(s.max) / 2));
    s.dispatchEvent(new Event("input"));
  });
  const midLabel = (await page.textContent("#step-label")) ?? "";
  say(`mid-frame label: "${midLabel.trim()}"`);
  if (midLabel.trim().length === 0) throw new Error("frame label empty at mid scrub");

  // Jump to the final frame; status must report completion.
  await page.evaluate(() => {
    const s = document.getElementById("step-scrubber");
    s.value = s.max;
    s.dispatchEvent(new Event("input"));
  });
  await page.waitForFunction(
    () => (document.getElementById("status-line").textContent ?? "").includes("complete"),
  );
  const endStatus = ((await page.textContent("#status-line")) ?? "").trim();
  say(`end status: ${endStatus}`);
  if (!endStatus.includes("complete")) throw new Error("status lacks 'complete' at last frame");

  /* -- reduced motion hides play ---------------------------------- */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const playVisible = await page.isVisible("#step-play");
  say(`play visible under reduced motion: ${playVisible}`);
  if (playVisible) throw new Error("play button should be hidden under prefers-reduced-motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  /* -- rooms-mst + doors pass -> legend Door row ------------------- */
  await page.selectOption("#algorithm-select", "rooms-mst");
  await page.click("#post-check-doors");
  await page.click("#generate-btn");
  await page.waitForSelector("#status-line:not(:empty)");
  await page.waitForTimeout(200);
  const legendTexts = await page.locator("#legend-list li span").allTextContents();
  say(`legend rows: ${legendTexts.join(", ")}`);
  if (!legendTexts.includes("Door")) throw new Error("legend missing Door row with doors enabled");

  /* -- export JSON download ---------------------------------------- */
  await page.click("#export-btn");
  await page.waitForSelector("#export-menu:not(.hidden)");
  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.click("#export-json"),
  ]);
  const jsonName = jsonDownload.suggestedFilename();
  say(`json download: ${jsonName}`);
  if (!jsonName.endsWith(".json")) throw new Error(`unexpected json filename ${jsonName}`);
  const jsonPath = await jsonDownload.path();
  const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  if (parsed.format !== "delvegen-dungeon") {
    throw new Error(`exported format is ${parsed.format}, expected delvegen-dungeon`);
  }
  say(`exported grid ${parsed.width}x${parsed.height} ok`);

  /* -- PNG download fires ------------------------------------------ */
  await page.click("#export-btn");
  await page.waitForSelector("#export-menu:not(.hidden)");
  const [pngDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.click("#export-png"),
  ]);
  const pngName = pngDownload.suggestedFilename();
  say(`png download: ${pngName}`);
  if (!/^delvegen-.+\.png$/.test(pngName)) throw new Error(`unexpected png filename ${pngName}`);

  /* -- import JSON (round-trip the exported file) ------------------- */
  await page.click("#export-btn");
  await page.waitForSelector("#export-menu:not(.hidden)");
  await page.setInputFiles("#import-file", jsonPath);
  await page.waitForFunction(() =>
    (document.getElementById("status-line").textContent ?? "").includes("view-only"),
  );
  const importedStatus = ((await page.textContent("#status-line")) ?? "").trim();
  say(`import status: ${importedStatus}`);

  /* -- keyboard shortcut G changes status -------------------------- */
  const beforeG = await page.textContent("#status-line");
  await page.keyboard.press("g");
  await page.waitForFunction((prev) => {
    return (document.getElementById("status-line").textContent ?? "") !== prev;
  }, beforeG);
  say(`after G: ${(await page.textContent("#status-line")).trim()}`);

  /* -- help overlay ------------------------------------------------ */
  await page.keyboard.press("?");
  await page.waitForSelector("#help-overlay:not(.hidden)");
  say("help opened");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#help-overlay.hidden", { state: "attached" });
  say("help closed via Esc");

  /* -- determinism self-check --------------------------------------- */
  await page.click("#verify-determinism");
  await page.waitForFunction(() =>
    (document.getElementById("selfcheck-line").textContent ?? "").includes("byte-identical"),
  );
  const selfcheck = ((await page.textContent("#selfcheck-line")) ?? "").trim();
  say(`self-check: ${selfcheck}`);

  await page.screenshot({ path: "shots/ui-smoke2.png" });
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
  say("UI2 SMOKE OK");
}
process.exit(exitCode);
