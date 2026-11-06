// Capture review screenshots: node tools/shot.mjs out-dir name:place:az:pitch[:time] ...
import { chromium } from "playwright";
import fs from "node:fs";
const [out, ...views] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text().slice(0, 300)); });
const q = process.env.Q || "standard";
await page.goto(`http://127.0.0.1:${process.env.PORT || 5173}/?quality=${q}&capture`);
await page.waitForFunction(() => window.__satoyama?.ready || document.getElementById("error")?.hidden === false, null, { timeout: 600000 });
const err = await page.evaluate(() => document.getElementById("error")?.textContent);
if (err) console.log("APP ERROR", err);
await page.evaluate(() => { document.getElementById("welcome").hidden = true; document.body.classList.add("hide-ui"); });
if (process.env.PRE) console.log('PRE', await page.evaluate(process.env.PRE));
for (const v of views) {
  const [name, place, az, pitch, time] = v.split(":");
  const t0 = Date.now();
  await page.evaluate(([place, az, pitch, time]) => {
    const g = window.__satoyama;
    if (place.includes(",")) { const [x, y, z] = place.split(",").map(Number); g.setFree(true); g.place(x, y, z); } else g.teleport(place);
    g.lookCompass(+az, +pitch);
    if (time) g.setTime(+time);
    return g.renderFrames(+(window.__frames || 2));
  }, [place, az, pitch, time]);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
  const st = await page.evaluate(() => window.__satoyama.state);
  console.log(name, `${Date.now() - t0}ms`, JSON.stringify({ p: st.position.map((v) => +v.toFixed(1)), tris: st.triangles, calls: st.calls }));
}
console.log("errors:", errors.slice(0, 12));
await browser.close();
