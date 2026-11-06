// Physics smoke test: walk the 200 steps from the foot torii to the precinct and back.
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("http://127.0.0.1:5173/?capture&quality=low");
await page.waitForFunction(() => window.__satoyama?.ready, null, { timeout: 600000 });
const r = await page.evaluate(() => {
  const g = window.__satoyama, out = [];
  g.teleport("foot");
  out.push(["start", g.state.position.map((v) => +v.toFixed(2)), g.state.grounded]);
  // walk east (+x) up the stair at walking pace
  for (let k = 0; k < 14; k++) { const p = g.walk(1, 0, 600, false); out.push(["up", p.map((v) => +v.toFixed(2)), g.state.grounded]); }
  // into the precinct towards the haiden; it must block us
  const p2 = g.walk(1, 0, 1200, true); out.push(["haiden", p2.map((v) => +v.toFixed(2))]);
  g.teleport("shrine");
  for (let k = 0; k < 8; k++) { const p = g.walk(-1, 0, 600, true); out.push(["down", p.map((v) => +v.toFixed(2)), g.state.grounded]); }
  return out;
});
for (const l of r) console.log(JSON.stringify(l));
await browser.close();
