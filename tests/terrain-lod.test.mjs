// The terrain's display LOD (src/world/rtin.ts): error-bounded, crack-free between blocks of one
// level, and simpler where the ground is flat - without touching the collision heightfield.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtin-"));
await build({ entryPoints: ["src/world/rtin.ts"], bundle: true, format: "esm", platform: "node", outfile: path.join(dir, "rtin.mjs"), logLevel: "error" });
const { rtinErrors, rtinBlock } = await import(path.join(dir, "rtin.mjs"));

const data = JSON.parse(fs.readFileSync("public/world/scene.json", "utf8"));
const raw = fs.readFileSync("public/world/heightmap.r16");
const n = data.resolution, E = data.extent, { minHeight, range } = data.heightEncoding;
const heights = new Float32Array(n * n);
for (let i = 0; i < n * n; i++) heights[i] = (raw.readUInt16LE(i * 2) / 65535) * range + minHeight;
const h = { data: heights, n, extent: E, spacing: E / (n - 1), cell: (i, j) => heights[Math.min(Math.max(j, 0), n - 1) * n + Math.min(Math.max(i, 0), n - 1)] };
const s = h.spacing, half = E / 2;
const err = rtinErrors(h);

/** worst height difference between the mesh and the grid at every grid vertex the triangles cover */
function worst(m) {
  let w = 0;
  const P = m.position, I = m.index;
  for (let k = 0; k < m.triangles * 3; k += 3) {
    const v = [I[k], I[k + 1], I[k + 2]].map((q) => [Math.round((P[q * 3] + half) / s), Math.round((P[q * 3 + 2] + half) / s), P[q * 3 + 1]]);
    const [[x0, z0, y0], [x1, z1, y1], [x2, z2, y2]] = v;
    const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    for (let j = Math.min(z0, z1, z2); j <= Math.max(z0, z1, z2); j++)
      for (let i = Math.min(x0, x1, x2); i <= Math.max(x0, x1, x2); i++) {
        const a = ((z1 - z2) * (i - x2) + (x2 - x1) * (j - z2)) / det, b = ((z2 - z0) * (i - x2) + (x0 - x2) * (j - z2)) / det, c = 1 - a - b;
        if (a < -1e-9 || b < -1e-9 || c < -1e-9) continue;
        w = Math.max(w, Math.abs(a * y0 + b * y1 + c * y2 - h.cell(i, j)));
      }
  }
  return w;
}
function edge(m, fixed, value) {
  const out = new Set(), P = m.position;
  for (let v = 0; v < P.length / 3; v++) {
    const i = Math.round((P[v * 3] + half) / s), j = Math.round((P[v * 3 + 2] + half) / s);
    if (Math.abs(P[v * 3 + 1] - h.cell(i, j)) > 1e-4) continue;   // skirt
    if (fixed === "i" && i === value) out.add(j);
    if (fixed === "j" && j === value) out.add(i);
  }
  return [...out].sort((a, b) => a - b).join(",");
}

test("terrain LOD: within about twice the requested height error everywhere", () => {
  for (const e of [0.015, 0.12, 0.5]) {
    let w = 0;
    for (let bj = 0; bj < 14; bj += 3) for (let bi = 0; bi < 14; bi += 3) w = Math.max(w, worst(rtinBlock(h, err, bi * 128, bj * 128, 128, e, 1)));
    assert.ok(w <= e * 2.2, `error ${e}: worst ${w.toFixed(3)} m`);
  }
});

test("terrain LOD: neighbouring blocks at one level share their edge vertices (no cracks)", () => {
  for (const e of [0.015, 0.25])
    for (let bj = 0; bj < 13; bj += 2)
      for (let bi = 0; bi < 13; bi += 2) {
        const a = rtinBlock(h, err, bi * 128, bj * 128, 128, e, 1), r = rtinBlock(h, err, (bi + 1) * 128, bj * 128, 128, e, 1), d = rtinBlock(h, err, bi * 128, (bj + 1) * 128, 128, e, 1);
        assert.equal(edge(a, "i", (bi + 1) * 128), edge(r, "i", (bi + 1) * 128), `block ${bi},${bj} east edge at ${e}`);
        assert.equal(edge(a, "j", (bj + 1) * 128), edge(d, "j", (bj + 1) * 128), `block ${bi},${bj} south edge at ${e}`);
      }
  // a 300 m group and its four blocks agree along the group's outer edge
  const g = rtinBlock(h, err, 512, 512, 256, 0.25, 1), b = rtinBlock(h, err, 768, 512, 128, 0.25, 1);
  const inB = (list) => list.split(",").filter((j) => +j <= 640).join(",");
  assert.equal(inB(edge(g, "i", 768)), edge(b, "i", 768));
});

test("terrain LOD: flat paddies collapse, bund crests and terrace steps stay within the error", () => {
  // the valley floor block under the paddies: far fewer triangles than the grid even at 1.5 cm, and
  // every grid vertex - crests and steps included - within the error of the mesh
  const x = data.landmarks.paddies[0], z = data.landmarks.paddies[2];
  const bi = Math.floor((x + half) / s / 128), bj = Math.floor((z + half) / s / 128);
  for (const [e, share] of [[0.015, 0.75], [0.06, 0.45]]) {
    const m = rtinBlock(h, err, bi * 128, bj * 128, 128, e, 1);
    assert.ok(m.triangles < 128 * 128 * 2 * share, `paddy block at ${e}: ${m.triangles} triangles`);
    assert.ok(worst(m) <= e * 2.2, `paddy block at ${e}: worst ${worst(m).toFixed(3)} m`);
  }
});
