/**
 * Minimal zero-dependency static server for development.
 *   /          -> public/
 *   /dist/...  -> dist/
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 8123);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    let rel;
    if (url.pathname.startsWith("/dist/")) {
      rel = url.pathname.slice(1);
    } else {
      rel = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
    }
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root, "public", "index.html")) {
      throw new Error("traversal");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`delvegen dev server: http://localhost:${port}`);
});
