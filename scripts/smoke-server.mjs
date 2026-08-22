// In-process smoke test of the dev server + module graph. Exits when done.
const { spawn } = await import("node:child_process");
const { once } = await import("node:events");

const child = spawn(process.execPath, ["scripts/serve.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));

try {
  // wait for listen line
  const start = Date.now();
  while (!out.includes("http://") && Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  for (const p of ["/", "/dist/src/ui/main.js", "/style.css"]) {
    const res = await fetch(`http://localhost:8123${p}`);
    const body = await res.text();
    console.log(`${p} -> ${res.status} ${body.length}B ${res.headers.get("content-type")}`);
  }
} finally {
  child.kill();
}
console.log("SERVER SMOKE OK");
