// Minimal static server for offline bake pages (repo root, localhost only).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".bin": "application/octet-stream", ".gltf": "model/gltf+json", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream" };
export function serve(port = 5199) {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}
