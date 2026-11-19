// Same-condition captures for before/after comparison: overall view, terrace edges, inside the
// forest, the village, the driver's seat.   node tools/perf/compare-shots.mjs <out-dir>
// env: PORT (5173), Q (standard), W/H (1280x720), TIME (18)
import { chromium } from "playwright";
import fs from "node:fs";
const [out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W || 1280), H = +(process.env.H || 720), Q = process.env.Q || "standard", TIME = +(process.env.TIME || 18);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 400)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 5173}/?quality=${Q}&capture&fixedres`);
await page.waitForFunction(() => window.__satoyama?.ready || document.getElementById("error")?.hidden === false, null, { timeout: 900000 });
await page.evaluate(() => { document.getElementById("welcome").hidden = true; document.body.classList.add("hide-ui"); });
const VIEWS = [
  ["overall", "lookout", 225, -9],
  ["overall-west", "lookout", 268, -6],
  ["terrace-edge", "tanada", 70, -9],
  ["terrace-low", "-262,0,236", 300, -4],
  ["paddies", "paddies", 255, -2],
  ["forest-inside", "road:east-forest", 0, -4],
  ["village", "village", 12, 1],
  ["river", "river", 352, -9],
];
const ONLY = process.env.VIEWS?.split(",");
for (const [name, place, az, pitch] of VIEWS.filter(([n]) => !ONLY || ONLY.includes(n))) {
  const st = await page.evaluate(({ place, az, pitch, TIME }) => {
    const g = window.__satoyama;
    g.setFree(true);
    if (place.startsWith("road:")) {
      const p = g.world.roads.find((r) => r.id === place.slice(5)).points, k = Math.floor(p.length / 2), q = p[k + 3];
      g.place(p[k][0], p[k][1] + 1.7, p[k][2]);
      g.lookCompass(Math.atan2(q[0] - p[k][0], -(q[2] - p[k][2])) * 180 / Math.PI, pitch);
    } else if (place.includes(",")) {
      const [x, , z] = place.split(",").map(Number);
      g.place(x, g.land.world.height.sample(x, z) + 1.7, z);
      g.lookCompass(az, pitch);
    } else { g.teleport(place); g.lookCompass(az, pitch); }
    g.setTime(TIME);
    g.renderFrames(3);
    return g.state;
  }, { place, az, pitch, TIME });
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
  console.log(name, JSON.stringify({ p: st.position.map((v) => +v.toFixed(1)), tris: st.triangles, calls: st.calls }));
}
// the driver's seat on the prefectural road
if (!ONLY || ONLY.includes("cockpit")) await page.evaluate(({ TIME }) => { const g = window.__satoyama; g.setFree(false); g.seatDriver(20); g.setTime(TIME); return g.renderFrames(3); }, { TIME });
if (!ONLY || ONLY.includes("cockpit")) {
  await page.screenshot({ path: `${out}/cockpit.png`, timeout: 600000 });
  console.log("cockpit", JSON.stringify(await page.evaluate(() => window.__satoyama.state.vehicle.position)));
}
console.log("errors:", errors.slice(0, 10));
await browser.close();
