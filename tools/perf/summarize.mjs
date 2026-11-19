// Tables from profile.mjs runs:  node tools/perf/summarize.mjs <before.json> [after.json]
// (counts runs: STAGESYNC=0 - stage times are the CPU's; GPU runs: STAGESYNC=1 - per pass)
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const q = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : NaN; };
const med = (xs) => q(xs, 0.5), p95 = (xs) => q(xs, 0.95);
const man = (n) => (n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万` : String(Math.round(n)));
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const NAMES = { village: "村", tanada: "棚田", forest: "林道", river: "川", lookout: "展望", cockpit: "運転席" };
const MODES = { idle: "停止", turn: "旋回", move: "移動", drive: "走行" };
function rows(r) {
  const out = {};
  for (const [scene, v] of Object.entries(r.scenes))
    for (const [mode, m] of Object.entries(v)) {
      if (!m?.records) continue;
      const drawn = m.records.filter((x) => x.drawn !== false);
      const cpu = m.records.map((x) => (x.stages.sim ?? 0) + (x.stages.update ?? 0));
      const st = (k) => med(drawn.map((x) => x.stages[k] ?? 0));
      out[`${scene}/${mode}`] = {
        scene, mode,
        frame: med(drawn.map((x) => x.ms)), frame95: p95(drawn.map((x) => x.ms)),
        cpu: med(cpu), cpu95: p95(cpu), cpuMax: Math.max(...cpu),
        warmMax: Math.max(0, ...m.warm.map((x) => x.ms)),
        shadowCpu: st("shadow"), mainCpu: st("main"),
        post: med(drawn.map((x) => ["ssao", "rays", "bloom", "output", "finish"].reduce((s, k) => s + (x.stages[k] ?? 0), 0))),
        mc: med(drawn.map((x) => x.main.calls)), mt: med(drawn.map((x) => x.main.tris)),
        sc: med(drawn.map((x) => x.shadow.calls)), stt: med(drawn.map((x) => x.shadow.tris)),
        mem: m.memory,
      };
    }
  return out;
}
const A = rows(a), B = b ? rows(b) : null;
const pair = (x, y, fmt = f1) => (B ? `${fmt(x)} → ${fmt(y)}` : fmt(x));
console.log(`品質 ${a.quality}・${a.viewport.join("×")}・${a.info.renderer}`);
console.log("\n| 場面 | 動作 | フレーム 中央値/95% (ms) | CPU更新 中央値/95%/最大 (ms) | 主パス 描画回数・三角形 | 影 描画回数・三角形 |");
console.log("|---|---|---|---|---|---|");
for (const [k, x] of Object.entries(A)) {
  const y = B?.[k];
  if (B && !y) continue;
  console.log(`| ${NAMES[x.scene] ?? x.scene} | ${MODES[x.mode] ?? x.mode} | ${pair(x.frame, y?.frame, (v) => v.toFixed(0))} / ${pair(x.frame95, y?.frame95, (v) => v.toFixed(0))} | ${pair(x.cpu, y?.cpu)} / ${pair(x.cpu95, y?.cpu95)} / ${pair(x.cpuMax, y?.cpuMax)} | ${pair(x.mc, y?.mc, man)}・${pair(x.mt, y?.mt, man)} | ${pair(x.sc, y?.sc, man)}・${pair(x.stt, y?.stt, man)} |`);
}
console.log("\n| 場面 | 動作 | 影パスのCPU (ms) | 主パスのCPU (ms) | 画面効果のCPU (ms) | 入場直後の最大フレーム (ms) |");
console.log("|---|---|---|---|---|---|");
for (const [k, x] of Object.entries(A)) {
  const y = B?.[k];
  if (B && !y) continue;
  console.log(`| ${NAMES[x.scene] ?? x.scene} | ${MODES[x.mode] ?? x.mode} | ${pair(x.shadowCpu, y?.shadowCpu)} | ${pair(x.mainCpu, y?.mainCpu)} | ${pair(x.post, y?.post)} | ${pair(x.warmMax, y?.warmMax, (v) => v.toFixed(0))} |`);
}
const mem = (r) => { const m = Object.values(r)[0]?.mem; return m ? `頂点・索引 ${m.geometryMB}MB、テクスチャ ${m.textureMB}MB、描画先 ${m.targetsMB}MB、JSヒープ ${m.jsHeapMB}MB` : "-"; };
console.log(`\nメモリ（推定）: ${mem(A)}${B ? ` → ${mem(B)}` : ""}`);
console.log(`読み込み: ${(a.loadMs / 1000).toFixed(0)} s${b ? ` → ${(b.loadMs / 1000).toFixed(0)} s` : ""}`);
