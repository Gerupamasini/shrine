// Bake photographic foliage cards from Poly Haven CC0 plant geometry.
// node tools/bake/bake-cards.mjs  ->  public/assets/foliage/*.png + cards.json
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { serve } from "./serve.mjs";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, ".cache/cards");
fs.mkdirSync(OUT, { recursive: true });
const C = "/.cache/polyhaven/foliage/";
const T = 30 * Math.PI / 180;
const wedge = (cx, y0, y1, r0 = 0.04) => [
  [Math.tan(T), 0, -1, -(Math.tan(T) * cx)], [Math.tan(T), 0, 1, -(Math.tan(T) * cx)],
  [1, 0, 0, -(cx + r0)], [0, 1, 0, -y0], [0, -1, 0, y1]];
function sprays(prefix, cx, height, radius, bands) {
  const views = [];
  bands.forEach(([a, b], bi) => {
    for (let k = 0; k < 3; k++)
      views.push({ name: `${prefix}-spray-${bi}${k}`, size: 512, half: radius * 0.5, center: [cx + radius * 0.5, (a + b) / 2, 0],
        planes: wedge(cx, a, b), rotY: k * 2.1 + bi * 0.7, pivot: [cx, 0, 0] });
  });
  views.push({ name: `${prefix}-rosette`, size: 1024, half: radius, center: [cx, height / 2, 0] });
  views.push({ name: `${prefix}-side`, size: 1024, half: height * 0.55, center: [cx, height / 2, 0], side: true, planes: [[0, 0, -1, 0.5], [-1, 0, 0, cx + 0.5], [1, 0, 0, -(cx - 0.5)]] });
  return views;
}
const jobs = [
  { url: C + "fir_sapling/fir_sapling_1k.gltf", alphaMaps: { fir_sapling_twigs: C + "fir_sapling/textures/fir_sapling_twigs_alpha_1k.png" },
    views: sprays("fir", 0, 1.29, 0.44, [[0.25, 0.62], [0.55, 0.9], [0.85, 1.15]]) },
  { url: C + "pine_sapling_small/pine_sapling_small_1k.gltf", alphaMaps: { pine_sapling_small_twig: C + "pine_sapling_small/textures/pine_sapling_small_twig_alpha_1k.png" },
    views: sprays("pine", 0.0, 1.28, 0.4, [[0.25, 0.7], [0.65, 1.0], [0.9, 1.3]]) },
  { url: C + "tree_small_02/tree_small_02_1k.gltf", alphaMaps: { tree_small_02_leaves: C + "tree_small_02/textures/tree_small_02_leaves_alpha_1k.png" },
    views: [
      ...[0, 1, 2, 3, 4, 5].map((k) => ({ name: `leaf-cluster-${k}`, size: 512, half: 0.75, center: [0.15 + Math.cos(k * 1.05) * 1.1, 3.6, 0.75 + Math.sin(k * 1.05) * 1.1],
        planes: [[0, 1, 0, -(2.9 + (k % 3) * 0.25)]] })),
      { name: "leaf-crown-top", size: 1024, half: 2.2, center: [0.15, 3, 0.75] },
      { name: "leaf-crown-side", size: 1024, half: 2.4, center: [0.15, 2.3, 0.75], side: true },
    ] },
];
const server = await serve();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5199/tools/bake/cards.html");
await page.waitForFunction(() => window.ready);
const index = {};
for (const job of jobs) {
  const res = await page.evaluate((j) => window.bake(j), job);
  for (const r of res) {
    for (const pass of ["albedo", "normal"])
      fs.writeFileSync(path.join(OUT, `${r.name}-${pass}.png`), Buffer.from(r[pass].split(",")[1], "base64"));
    index[r.name] = { source: job.url.split("/").slice(-2)[0], albedo: `${r.name}-albedo.png`, normal: `${r.name}-normal.png` };
    console.log("baked", r.name);
  }
}
fs.writeFileSync(path.join(OUT, "cards.json"), JSON.stringify(index, null, 1));
await browser.close();
server.close();
