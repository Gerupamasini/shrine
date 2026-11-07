// Data integrity tests for the engine-independent world source (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const W = "public/world";
const data = JSON.parse(fs.readFileSync(`${W}/scene.json`, "utf8"));
const N = data.resolution, E = data.extent, { minHeight, range } = data.heightEncoding;
const raw = fs.readFileSync(`${W}/heightmap.r16`);
const H = (x, z) => {
  const fx = (x / E + 0.5) * (N - 1), fz = (z / E + 0.5) * (N - 1);
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
  const c = (ii, jj) => (raw.readUInt16LE((jj * N + ii) * 2) / 65535) * range + minHeight;
  return (c(i, j) * (1 - a) + c(i + 1, j) * a) * (1 - b) + (c(i, j + 1) * (1 - a) + c(i + 1, j + 1) * a) * b;
};

test("16-bit heightmap is a complete 1025² little-endian raster in metres", () => {
  assert.equal(N, 1025);
  assert.equal(E, 1200);
  assert.equal(raw.length, N * N * 2);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < raw.length; i += 2) {
    const h = (raw.readUInt16LE(i) / 65535) * range + minHeight;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  assert.ok(lo > minHeight + 1, "no clipped basin");
  assert.ok(hi > 150, "mountains around the valley");
});

test("approach: 200 steps, constant rise/tread, four flights, three landings", () => {
  const st = data.stair;
  assert.equal(data.steps.length, 200);
  assert.equal(st.steps, 200);
  assert.ok(st.rise >= 0.15 && st.rise <= 0.19, "natural riser");
  assert.ok(st.tread >= 0.3 && st.tread <= 0.4, "natural tread");
  assert.ok(2 * st.rise + st.tread > 0.6 && 2 * st.rise + st.tread < 0.72, "blondel rule");
  const rise = data.steps.at(-1).y - st.footY;
  assert.ok(rise >= 30 && rise <= 50, `30-50 m climb (${rise})`);
  for (let i = 1; i < 200; i++) {
    const a = data.steps[i - 1], b = data.steps[i];
    assert.ok(Math.abs(b.y - a.y - st.rise) < 1e-6);
    const dx = b.x - a.x;
    const expected = i % 50 === 0 ? st.tread + st.landing : st.tread;
    assert.ok(Math.abs(dx - expected) < 1e-6, `step ${i} spacing ${dx}`);
  }
});

test("shrine precinct overlooks the village from 30-50 m", () => {
  const p = data.precinct;
  const village = data.landmarks.village;
  const drop = p.y - (village[1] - 1.62);
  assert.ok(drop > 30 && drop < 50, `height above the village road: ${drop}`);
  assert.ok(Math.abs(H((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2) - p.y) < 0.05);
});

test("the stream falls monotonically and stays 3-6 m wide", () => {
  const pts = data.river.points;
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][1] <= pts[i - 1][1] + 1e-6);
  for (const p of pts) assert.ok(p[3] >= 3 && p[3] <= 6);
  // water lies above its bed where the channel is inside the valley
  const inner = pts.filter((p) => p[2] > -200 && p[2] < 450);
  const wet = inner.filter((p) => H(p[0], p[2]) < p[1]).length;
  assert.ok(wet / inner.length > 0.95);
});

test("rice paddies are level fields with levees", () => {
  const rice = data.fields.filter((f) => f.type === "rice");
  assert.ok(rice.length > 80, `${rice.length} rice fields`);
  let flat = 0, total = 0;
  for (const f of rice) {
    const [x0, z0, x1, z1] = f.bounds;
    let onLevel = 0;
    for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
      const h = H(x0 + ((x1 - x0) * i) / 6, z0 + ((z1 - z0) * j) / 6);
      if (Math.abs(h - f.level) < 0.03) onLevel++;
    }
    total++;
    if (onLevel >= 8) flat++;
  }
  assert.ok(flat / total > 0.9, `${flat}/${total} fields have a level interior`);
});

test("lookout faces the village with the evening sun clearing the horizon", () => {
  const lk = data.landmarks.lookout;
  // horizon elevation towards the 18:00 sun azimuth (285.6°) must be below the sun (6.7°)
  const az = (285.6 * Math.PI) / 180;
  let best = -90;
  for (let d = 15; d < 590; d += 2) {
    const x = lk[0] + Math.sin(az) * d, z = lk[2] - Math.cos(az) * d;
    if (Math.abs(x) > 599 || Math.abs(z) > 599) break;
    best = Math.max(best, (Math.atan2(H(x, z) - lk[1], d) * 180) / Math.PI);
  }
  assert.ok(best < 6.0, `terrain horizon ${best.toFixed(2)}°`);
});

test("every placed object resolves to a GLB and every material to a texture set", () => {
  const index = JSON.parse(fs.readFileSync("public/assets/models/architecture/index.json", "utf8")).assets;
  const props = { "prop-bucket": "wooden_bucket_01", "prop-barrels": "wooden_barrels_01", "prop-crate": "wooden_crate_01", "prop-basket": "wicker_basket_01", "prop-ladder": "wooden_ladder" };
  for (const o of data.objects) {
    if (props[o.asset]) {
      assert.ok(fs.existsSync(`public/assets/models/props/${props[o.asset]}.glb`), o.asset);
      continue;
    }
    const name = o.asset.startsWith("minka-") || o.asset === "jihanki" ? `${o.asset}_${o.variant}` : o.asset === "naya" ? "naya_0" : o.asset === "komainu" ? `komainu-${o.variant}` : o.asset;
    assert.ok(index[name], `architecture/${name}`);
    const glb = fs.readFileSync(`public/assets/models/architecture/${name}.glb`);
    assert.equal(glb.readUInt32LE(0), 0x46546c67, "glTF magic");
  }
  const mats = JSON.parse(fs.readFileSync(`${W}/materials.json`, "utf8"));
  for (const [name, entry] of Object.entries(index))
    for (const m of entry.materials) assert.ok(mats.architecture[m], `${name}: material ${m}`);
  for (const def of [...Object.values(mats.architecture), ...Object.values(mats.vegetation), ...mats.terrainLayers]) {
    const id = def.tex ?? def.id;
    if (!id) continue;
    for (const f of ["albedo.jpg", "normal.jpg", "arm.jpg"]) assert.ok(fs.existsSync(`public/assets/textures/${id}/${f}`), `${id}/${f}`);
  }
});

test("vegetation placements are reproducible data, trees have six species", () => {
  const veg = JSON.parse(fs.readFileSync(`${W}/vegetation.json`, "utf8"));
  assert.equal(veg.seed, data.seed + 7);
  for (const k of ["sugi", "hinoki", "akamatsu", "broadleaf", "bamboo", "keyaki"]) {
    assert.ok(veg.trees[k].length > 0, k);
    for (let v = 0; v < 4; v++) assert.ok(fs.existsSync(`public/assets/models/trees/${k}_${v}.glb`));
  }
  // no tree on the stair tread
  const st = data.stair;
  for (const rows of Object.values(veg.trees))
    for (const r of rows) assert.ok(!(r[0] > st.x0 && r[0] < st.x1 && Math.abs(r[2] - st.z) < st.width / 2 + 0.5), `tree on the stair at ${r}`);
});

test("audio and credits: every recording has a recorded licence", () => {
  const credits = fs.readFileSync("ASSET_CREDITS.md", "utf8");
  const manifest = JSON.parse(fs.readFileSync("docs/asset-manifest.json", "utf8"));
  for (const f of fs.readdirSync("public/assets/audio")) {
    const e = manifest.find((m) => m.path === `assets/audio/${f}`);
    assert.ok(e && e.licence && e.authors?.length, `licence for ${f}`);
  }
  assert.match(credits, /CC BY 4\.0/);
  assert.match(credits, /Σ64/);
  for (const e of manifest) assert.ok(fs.existsSync(path.join("public", e.path)), e.path);
});
