// Time of one physics step (Rapier world.step) at each scene - what every frame of walking or
// driving pays, standing still included.   node tools/perf/physics-step.mjs <out.json>  (PORT)
import { chromium } from "playwright";
import fs from "node:fs";
const [out] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`http://127.0.0.1:${process.env.PORT || 5173}/?quality=standard&capture&fixedres`);
await page.waitForFunction(() => window.__satoyama?.ready, null, { timeout: 900000 });
const res = await page.evaluate(() => {
  const g = window.__satoyama, w = g.vehicleSystem.walker, out = {};
  const road = (id) => g.world.roads.find((r) => r.id === id).points;
  const spots = { village: "village", tanada: "tanada", forest: "road:east-forest", river: "river", lookout: "lookout" };
  for (const [name, spot] of Object.entries(spots)) {
    g.setFree(false);
    if (spot.startsWith("road:")) { const p = road(spot.slice(5)), k = Math.floor(p.length / 2); g.place(p[k][0], p[k][1] + 1.7, p[k][2]); }
    else g.teleport(spot);
    const ms = [];
    for (let i = 0; i < 120; i++) { const t = performance.now(); w.move({ x: 0, y: 0, z: 0, lengthSq: () => 0 }, 1 / 60, false); ms.push(performance.now() - t); }
    ms.sort((a, b) => a - b);
    out[name] = { median: ms[60], p95: ms[114], colliders: w.world.colliders.len(), trunks: w.trunkColliders ?? null };
  }
  // driving: the car's step on the prefectural road
  g.seatDriver(20);
  const v = g.vehicleSystem, ms = [];
  for (let i = 0; i < 120; i++) { const t = performance.now(); v.step(1 / 60, { throttle: 1, steer: 0, brake: false }); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  out.cockpit = { median: ms[60], p95: ms[114], colliders: w.world.colliders.len(), trunks: w.trunkColliders ?? null };
  return out;
});
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await browser.close();
