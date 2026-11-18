// Frame profile of fixed scenes and motions (see docs/PERFORMANCE_BUDGET.md).
//   node tools/perf/profile.mjs <out.json> [scene,...]     (dev server on PORT, default 5173)
// env: Q=standard|low|high, W/H viewport (1280x720), FRAMES=idle,turn,move (20,40,40), WARM (5),
//      STAGESYNC=1: wait for the GPU after every stage (GPU time per pass) instead of only per frame
//      MODES=idle,turn,move: which motions to run
import { chromium } from "playwright";
import fs from "node:fs";
const [out, only] = process.argv.slice(2);
const W = +(process.env.W || 1280), H = +(process.env.H || 720), Q = process.env.Q || "standard";
const [FI, FT, FM] = (process.env.FRAMES || "20,40,40").split(",").map(Number);
const WARM = +(process.env.WARM ?? 5);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 400)); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${process.env.PORT || 5173}/?quality=${Q}&capture&fixedres`);
await page.waitForFunction(() => window.__satoyama?.ready || document.getElementById("error")?.hidden === false, null, { timeout: 900000 });
const loadMs = Date.now() - t0;
await page.evaluate(() => { document.getElementById("welcome").hidden = true; document.body.classList.add("hide-ui"); });
const info = await page.evaluate(() => {
  const gl = document.querySelector("canvas").getContext("webgl2");
  const d = gl.getExtension("WEBGL_debug_renderer_info");
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), ua: navigator.userAgent, timer: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"), multiDraw: !!gl.getExtension("WEBGL_multi_draw") };
});
console.log("load", loadMs, "ms", JSON.stringify(info));

// scenes: where to stand, which way to look, and the path walked/driven in the "move" run
const SCENES = {
  village: { place: "village", path: "road:village-road:z>=30:z<=140" },
  tanada: { place: "tanada", path: "road:kawamuko-contour-farm:from=0" },
  forest: { road: "east-forest", path: "road:east-forest:mid" },
  river: { place: "river", path: "river" },
  lookout: { place: "lookout", path: "lookout" },
  cockpit: { drive: true },
};
const scenes = only ? only.split(",") : Object.keys(SCENES);
const result = { quality: Q, viewport: [W, H], info, loadMs, scenes: {} };
for (const name of scenes) {
  const sc = SCENES[name];
  const setup = await page.evaluate(({ sc }) => {
    const g = window.__satoyama, w = g.world;
    const road = (id) => w.roads.find((r) => r.id === id).points;
    if (sc.drive) { g.setTime(18); return g.seatDriver(20); }
    g.setFree(true);
    if (sc.place) g.teleport(sc.place);
    if (sc.road) {
      const p = road(sc.road), k = Math.floor(p.length / 2), q = p[k + 3];
      g.place(p[k][0], p[k][1] + 1.7, p[k][2]);
      g.lookCompass(Math.atan2(q[0] - p[k][0], -(q[2] - p[k][2])) * 180 / Math.PI, -4);
    }
    g.setTime(18);
    return g.state.position;
  }, { sc });
  const path = await page.evaluate(({ spec }) => {
    const g = window.__satoyama, w = g.world, h = (x, z) => g.land.world.height.sample(x, z);
    const road = (id) => w.roads.find((r) => r.id === id).points.map((p) => [p[0], p[1], p[2]]);
    if (!spec) return null;
    if (spec.startsWith("road:")) {
      const [, id, a, b] = spec.split(":");
      let p = road(id);
      const cond = (s) => { const m = /z([<>]=)(-?\d+)/.exec(s); return m ? (q) => (m[1] === ">=" ? q[2] >= +m[2] : q[2] <= +m[2]) : null; };
      if (a?.startsWith("z")) p = p.filter(cond(a));
      if (b?.startsWith("z")) p = p.filter(cond(b));
      if (a === "mid") p = p.slice(Math.floor(p.length / 2));
      return p;
    }
    if (spec === "river") {
      const pts = w.river.bed.points.filter((p) => p[1] > 120 && p[1] < 600);
      return pts.map((p) => [p[0], h(p[0], p[1]), p[1]]);
    }
    if (spec === "lookout") {
      const a = w.landmarks.lookout, b = w.landmarks.shrine;
      return [[a[0], a[1] - 1.62, a[2]], [b[0], b[1] - 1.62, b[2]]];
    }
  }, { spec: sc.path });
  result.scenes[name] = { setup };
  const modes = sc.drive ? [["idle", FI], ["turn", FT], ["drive", FM]] : [["idle", FI], ["turn", FT], ["move", FM]];
  const want = (process.env.MODES || "idle,turn,move").split(",");
  for (const [mode, frames] of modes.filter(([m]) => want.includes(m === "drive" ? "move" : m))) {
    if (sc.drive && mode !== "drive") await page.evaluate(() => window.__satoyama.seatDriver(20));
    else if (!sc.drive) await page.evaluate(({ sc }) => {
      const g = window.__satoyama, w = g.world;
      g.setFree(true);
      if (sc.place) g.teleport(sc.place);
      if (sc.road) {
        const p = w.roads.find((r) => r.id === sc.road).points, k = Math.floor(p.length / 2), q = p[k + 3];
        g.place(p[k][0], p[k][1] + 1.7, p[k][2]);
        g.lookCompass(Math.atan2(q[0] - p[k][0], -(q[2] - p[k][2])) * 180 / Math.PI, -4);
      }
    }, { sc });
    const t = Date.now();
    const r = await page.evaluate(({ mode, frames, path, warm, stageSync }) =>
      window.__satoyama.profile({ mode, frames, warm, path: path ?? undefined, speed: 7.8, pitch: -4, turnRate: 90, stageSync }), { mode, frames, path, warm: WARM, stageSync: process.env.STAGESYNC === "1" });
    result.scenes[name][mode] = r;
    const ms = r.records.map((x) => x.ms).sort((a, b) => a - b);
    console.log(name, mode, `${Date.now() - t}ms`, "median", ms[Math.floor(ms.length / 2)].toFixed(0), "main", r.records[0].main.calls, r.records[0].main.tris, "shadow", r.records[0].shadow.calls, r.records[0].shadow.tris);
  }
}
result.errors = errors;
fs.writeFileSync(out, JSON.stringify(result));
console.log("errors:", errors.slice(0, 10));
await browser.close();
