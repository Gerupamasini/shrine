// node tools/house-lab/shot.mjs out-dir "name:x,y,z:az:pitch[:time]" ...   (env HOUSES=..., W, H, PORT)
import { chromium } from "playwright";
import fs from "node:fs";
const [out, ...views] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text().slice(0, 3000)); });
const q = new URLSearchParams({ capture: "1", ...(process.env.HOUSES ? { houses: process.env.HOUSES } : {}), ...(process.env.NOAO ? { noao: "1" } : {}) });
await page.goto(`http://127.0.0.1:${process.env.PORT || 5173}/tools/house-lab/?${q}`);
await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 300000 }).catch(() => {});
for (const v of views) {
  const [name, pos, az, pitch, time] = v.split(":");
  const [x, y, z] = pos.split(",").map(Number);
  const t0 = Date.now();
  const info = await page.evaluate(([x, y, z, az, pitch, time]) => {
    const l = window.__lab;
    if (time) l.setTime(+time);
    l.view(x, y, z, +az, +pitch);
    return l.frames(2);
  }, [x, y, z, az, pitch, time]);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, `${Date.now() - t0}ms`, JSON.stringify(info));
}
console.log("errors:", errors.filter((e) => !/deprecated/.test(e)).slice(0, 8));
await browser.close();
