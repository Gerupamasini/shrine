// Shadows while driving: frames from the chase camera every few steps along the prefectural road, to
// look for lag, offsets, flicker or jumps when the cached far cascades are redrawn.
//   node tools/perf/drive-shadows.mjs <out-dir>   (env: PORT, Q, W/H 960x540, STEPS 10, FRAMES 16)
import { chromium } from "playwright";
import fs from "node:fs";
const [out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W || 960), H = +(process.env.H || 540), Q = process.env.Q || "standard";
const STEPS = +(process.env.STEPS || 10), FRAMES = +(process.env.FRAMES || 16);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${process.env.PORT || 5173}/?quality=${Q}&capture&fixedres`);
await page.waitForFunction(() => window.__satoyama?.ready, null, { timeout: 900000 });
await page.evaluate(() => { document.getElementById("welcome").hidden = true; document.body.classList.add("hide-ui"); });
await page.evaluate(() => {
  const g = window.__satoyama; g.setFree(false); g.setTime(17.6); g.seatDriver(-60);
  const v = g.vehicleSystem; if (v.view !== "third") v.toggleView();
});
const log = [];
for (let f = 0; f < FRAMES; f++) {
  const st = await page.evaluate((n) => {
    const g = window.__satoyama, v = g.vehicleSystem, far0 = g.land.lighting.farDraws ?? 0;
    for (let i = 0; i < n; i++) v.step(1 / 60, { throttle: 1, steer: 0, brake: false });
    g.renderFrames(1);
    return { speed: v.state.speed, pos: v.state.position, far: (g.land.lighting.farDraws ?? 0) - far0 };
  }, STEPS);
  await page.screenshot({ path: `${out}/f${String(f).padStart(2, "0")}.png` });
  log.push(st);
  console.log(f, JSON.stringify(st));
}
fs.writeFileSync(`${out}/log.json`, JSON.stringify(log));
await browser.close();
