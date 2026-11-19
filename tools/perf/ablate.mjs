// GPU cost per system by ablation: hide one system at a time and time the passes again.
//   node tools/perf/ablate.mjs <out.json> <scene>   (scene: a landmark name; dev server on PORT)
// env: Q, W/H (640x360), FRAMES (1)
import { chromium } from "playwright";
import fs from "node:fs";
const [out, place = "village", az, pitch] = process.argv.slice(2);
const W = +(process.env.W || 640), H = +(process.env.H || 360), Q = process.env.Q || "standard", N = +(process.env.FRAMES || 1);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${process.env.PORT || 5173}/?quality=${Q}&capture&fixedres`);
await page.waitForFunction(() => window.__satoyama?.ready, null, { timeout: 900000 });
await page.evaluate(() => { document.getElementById("welcome").hidden = true; document.body.classList.add("hide-ui"); });
const res = await page.evaluate(({ place, az, pitch, N }) => {
  const g = window.__satoyama;
  g.setFree(true);
  g.teleport(place);
  if (az !== undefined) g.lookCompass(+az, +pitch);
  g.setTime(18);
  // group the scene's drawables by system (object name, else material hook key)
  const key = (o) => {
    if (o.name) return o.name.replace(/_\d+(_lod\d)?$/, "$1").replace(/^(props)\/.*/, "$1").replace(/^architecture\/.*#shadow$/, "arch-shadow").replace(/^architecture\/.*/, "architecture").replace(/^(sugi|hinoki|akamatsu|broadleaf|keyaki|bamboo)_lod\d$/, "trees");
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const k = (m?.customProgramCacheKey?.() ?? "").split("|").pop() ?? "";
    return k && !k.includes("(") && !k.includes("{") ? k : m?.type ?? o.type;
  };
  const groups = new Map();
  g.scene.traverse((o) => { if (o.isMesh || o.isLine || o.isPoints) { const k = key(o); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); } });
  let warm = 1;
  const run = () => {
    const r = g.profile({ mode: "idle", frames: N, warm, stageSync: true });
    warm = 0;
    const avg = (s) => r.records.reduce((a, x) => a + (x.stages[s] ?? 0), 0) / r.records.length;
    return { main: avg("main"), shadow: avg("shadow"), frame: r.records.reduce((a, x) => a + x.ms, 0) / r.records.length };
  };
  const all = run();
  const rows = [];
  for (const [k, list] of groups) {
    // (layers, not visibility: several systems set their meshes' visibility every frame)
    const was = list.map((o) => o.layers.mask);
    list.forEach((o) => (o.layers.mask = 0));
    const r = run();
    list.forEach((o, i) => (o.layers.mask = was[i]));
    rows.push({ system: k, objects: list.length, main: all.main - r.main, shadow: all.shadow - r.shadow });
  }
  rows.sort((a, b) => b.main - a.main);
  return { all, rows };
}, { place, az, pitch, N });
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log("all", JSON.stringify(res.all));
for (const r of res.rows) console.log(r.system.padEnd(28), String(r.objects).padStart(5), r.main.toFixed(0).padStart(7), r.shadow.toFixed(0).padStart(7));
await browser.close();
