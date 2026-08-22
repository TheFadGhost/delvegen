// Headless browser smoke test: page loads, generation runs, canvas paints.
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const LOG = "smoke-ui.log";
const say = (m) => {
  appendFileSync(LOG, m + "\n");
};
writeFileSync(LOG, "");

const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: "8123" },
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

  await page.goto("http://localhost:8123/", { timeout: 15000 });
  say("page loaded");
  await page.waitForSelector("#algorithm-select option", { state: "attached" });
  const emptyVisible = await page.isVisible("#empty-state");
  say(`empty state visible: ${emptyVisible}`);

  await page.click("#generate-btn");
  await page.waitForSelector("#status-line:not(:empty)");
  const status = await page.textContent("#status-line");
  say(`status: ${status.trim()}`);

  const painted = await page.evaluate(() => {
    const cv = document.getElementById("map-canvas");
    const ctx = cv.getContext("2d");
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const distinct = new Set();
    for (let i = 0; i < data.length; i += 400) {
      distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return distinct.size;
  });
  say(`distinct colours on canvas: ${painted}`);
  if (painted < 3) throw new Error("canvas appears unpainted");

  const metricCount = await page.locator("#metrics-table tr").count();
  say(`metric rows: ${metricCount}`);
  if (metricCount < 7) throw new Error("metrics not populated");

  const legendRows = await page.locator("#legend-list li").count();
  say(`legend rows: ${legendRows}`);

  await page.selectOption("#theme-select", "light");
  await page.waitForTimeout(150);
  await page.selectOption("#theme-select", "dark");
  say("theme switch ok");

  await page.evaluate(() => {
    const slider = document.querySelector('#params-root input[type="range"]');
    slider.value = "60";
    slider.dispatchEvent(new Event("input"));
  });
  await page.waitForTimeout(400);
  const status2 = await page.textContent("#status-line");
  say(`after param change: ${status2.trim()}`);

  await page.screenshot({ path: "shots/ui-smoke.png" });
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
  say("UI SMOKE OK");
}
process.exit(exitCode);
