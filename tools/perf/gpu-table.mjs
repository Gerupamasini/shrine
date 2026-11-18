// Per-pass GPU time table from STAGESYNC=1 runs:  node tools/perf/gpu-table.mjs <before.json> [after.json]
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const NAMES = { village: "村", tanada: "棚田", forest: "林道", river: "川", lookout: "展望", cockpit: "運転席" };
const avg = (m, k) => m.records.reduce((s, x) => s + (k === "post" ? ["output", "finish"].reduce((t, kk) => t + (x.stages[kk] ?? 0), 0) : (x.stages[k] ?? 0)), 0) / m.records.length;
const cell = (sa, sb, k) => { const x = avg(sa, k); const y = sb ? avg(sb, k) : null; return y === null ? x.toFixed(0) : `${x.toFixed(0)} → ${y.toFixed(0)}`; };
console.log(`GPU時間（${a.viewport.join("×")}・${a.quality}・SwiftShader、各パスの後でGPUを待って計測、ms）`);
console.log("| 場面 | 影 | 主パス | SSAO | 光芒 | ブルーム | トーンマップ・仕上げ | 合計 |");
console.log("|---|---|---|---|---|---|---|---|");
for (const [scene, v] of Object.entries(a.scenes)) {
  const x = v.idle, y = b?.scenes[scene]?.idle;
  if (!x?.records) continue;
  const tot = (m) => m.records.reduce((s, r) => s + r.ms, 0) / m.records.length;
  console.log(`| ${NAMES[scene] ?? scene} | ${cell(x, y, "shadow")} | ${cell(x, y, "main")} | ${cell(x, y, "ssao")} | ${cell(x, y, "rays")} | ${cell(x, y, "bloom")} | ${cell(x, y, "post")} | ${y ? `${tot(x).toFixed(0)} → ${tot(y).toFixed(0)}` : tot(x).toFixed(0)} |`);
}
