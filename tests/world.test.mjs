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

test("the river falls downstream through drops, with a 3-6 m low-flow channel between gravel bars", () => {
  const R = data.river, pts = R.points;
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i][2] > pts[i - 1][2], `rows sorted by z at ${pts[i][2]}`);
    assert.ok(pts[i][1] <= pts[i - 1][1] + 1e-6, `water rises at z=${pts[i][2]}`);
  }
  // drop structures every ~100 m and a weir holding a pool
  assert.ok(R.drops.length >= 8);
  for (const d of R.drops) assert.ok(d.waterAbove - d.waterBelow >= (d.kind === "weir" ? 0.6 : 0.2), `drop at ${d.z}`);
  const weir = R.drops.find((d) => d.kind === "weir");
  assert.ok(weir);
  const atSill = (z) => R.drops.some((d) => z > d.z - 2.5 && z < d.z + 3) || (z > weir.z - 100 && z < weir.z);
  const nearDrop = (z) => R.drops.some((d) => z > d.z - 14 && z < d.z + 12) || (z > weir.z - 135 && z < weir.z);
  // wetted width: where the water surface is above the bed, sampled across the bed
  let ok = 0, n = 0;
  for (const [x, y, z, w, fall] of pts) {
    assert.ok(pts[0].length === 6);
    if (fall || z < -440 || z > 560) continue;
    let wet = 0;
    for (let u = -w / 2; u <= w / 2; u += 0.2) if (H(x + u, z) < y) wet += 0.2;
    n++;
    // wall to wall at the sills and in the weir pool; a low-flow channel between bars elsewhere
    if (atSill(z) ? wet > 0.8 * w : wet >= 2.5 && (nearDrop(z) || wet <= 7.5)) ok++;
  }
  assert.ok(ok / n > 0.93, `${ok}/${n} rows with a plausible wetted width`);
  // revetments stand 1.0-2.5 m above the water (lowest beside the weir pool)
  for (const [xc, z, B, top] of R.bed.points) {
    if (z < -440 || z > 560) continue;
    const y = pts.reduce((best, p) => (Math.abs(p[2] - z) < Math.abs(best[2] - z) ? p : best))[1];
    assert.ok(top - y > 1.0 && top - y < 2.5, `bank height ${top - y} at z=${z}`);
    assert.ok(B > 3 && B < 8.5);
    void xc;
  }
});

test("the weir intake feeds a canal that runs gently downhill above the river", () => {
  const R = data.river, cp = R.canal.points;
  assert.ok(cp.length > 50);
  for (let i = 1; i < cp.length; i++) assert.ok(cp[i][1] <= cp[i - 1][1] + 1e-6);
  const slope = (cp[0][1] - cp[cp.length - 1][1]) / (cp[cp.length - 1][2] - cp[0][2]);
  assert.ok(slope > 0.0005 && slope < 0.002, `canal slope ${slope}`);
  const weir = R.drops.find((d) => d.kind === "weir");
  // fed by gravity from the weir pool, then higher than the river below the weir
  assert.ok(R.intake.z < weir.z && cp[0][1] < weir.waterAbove && R.intake.sillY < cp[0][1]);
  for (const [, y, z] of cp) {
    if (z < weir.z + 1) continue;
    const rw = R.points.reduce((best, p) => (Math.abs(p[2] - z) < Math.abs(best[2] - z) ? p : best))[1];
    assert.ok(y > rw, `canal water above the river at z=${z}`);
  }
  for (const s of R.washSteps) assert.ok(s.topY - s.toeY > 1.0);
});

test("rice paddies are level fields with levees", () => {
  const rice = data.fields.filter((f) => f.type === "rice" && !f.terrace);
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
  // (fields cut by farm roads have irregular bounds, so the sampled grid is a little pessimistic)
  assert.ok(flat / total > 0.85, `${flat}/${total} fields have a level interior`);
});

test("terraced paddies step up the west footslope in level contour benches", () => {
  const ter = data.fields.filter((f) => f.terrace);
  assert.ok(ter.length > 40, `${ter.length} terraces`);
  // every terrace is level: a dense scan of its bounds finds a good share of cells at its level,
  // and the terraces climb at least 8 m above the valley floor
  let ok = 0;
  for (const f of ter) {
    const [x0, z0, x1, z1] = f.bounds;
    let on = 0;
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) if (Math.abs(H(x0 + ((x1 - x0) * i) / 20, z0 + ((z1 - z0) * j) / 20) - f.level) < 0.03) on++;
    if (on * ((x1 - x0) * (z1 - z0)) / 441 > f.area * 0.25) ok++;
  }
  assert.ok(ok / ter.length > 0.85, `${ok}/${ter.length} terraces level`);
  const lv = ter.map((f) => f.level);
  assert.ok(Math.max(...lv) - Math.min(...lv) > 8);
  assert.ok(ter.filter((f) => f.type === "fallow").length > 3, "some terraces lie fallow");
});

test("village layout: a centre on the main road, road-facing houses, south-facing farmhouses with igune", () => {
  const buildings = data.objects.filter((o) => o.group);
  assert.ok(buildings.length >= 70, `${buildings.length} buildings`);
  const veg = JSON.parse(fs.readFileSync(`${W}/vegetation.json`, "utf8"));
  const trees = [...veg.trees.sugi, ...veg.trees.keyaki, ...veg.trees.hinoki, ...veg.trees.broadleaf];
  const main = data.roads.find((r) => r.class === "prefectural");
  const roadX = (z) => main.points.reduce((b, p) => (Math.abs(p[2] - z) < Math.abs(b[2] - z) ? p : b))[0];
  const roads = data.roads.filter((r) => ["prefectural", "town", "farm", "driveway"].includes(r.class));
  assert.ok(main.width >= 6 && main.surface === "asphalt");
  assert.ok(data.roads.some((r) => r.class === "farm" && r.surface === "gravel"));
  // the centre: shops and public services in a row on the main road, fronts facing it
  const centre = buildings.filter((o) => o.group === "machi");
  for (const t of ["shop-yorozuya", "shop-sakaya", "post-office", "chuzaisho", "nokyo", "kominkan"]) assert.ok(centre.some((o) => o.asset === t), t);
  let sheltered = 0, farm = 0;
  for (const o of buildings) {
    const [x, , z] = o.position, yaw = o.rotation[1];
    const front = [Math.sin(yaw), Math.cos(yaw)];
    const toRoad = [Math.sign(roadX(z) - x), 0];
    if (o.group === "machi" || o.roadside) {
      if (o.asset === "nokyo-soko") continue;
      // fronts on the road, with no windbreak behind
      assert.ok(front[0] * toRoad[0] > 0.9, `${o.id} faces the road`);
      assert.ok(Math.abs(x - roadX(z)) < 32, `${o.id} stands by the road`);
      continue;
    }
    farm++;
    assert.ok(Math.abs(yaw) < 0.44, `${o.id} faces ${(yaw * 180) / Math.PI} deg off south`);
    const nw = trees.filter((t) => Math.hypot(t[0] - x, t[2] - z) < 22 && (t[2] < z - 4 || t[0] < x - 6)).length;
    if (nw >= 3) sheltered++;
    assert.ok(data.objects.some((b) => b.asset === "naya" && Math.hypot(b.position[0] - x, b.position[2] - z) < 16), `${o.id} has a barn`);
    // a short driveway from the yard to a road
    const lane = roads.find((r) => r.class === "driveway" && Math.hypot(r.points[0][0] - x, r.points[0][2] - z) < 22);
    assert.ok(lane, `${o.id} has a driveway`);
    const [a, b] = [lane.points[0], lane.points[lane.points.length - 1]];
    assert.ok(Math.hypot(b[0] - a[0], b[2] - a[2]) < 75, `${o.id} driveway is short`);
  }
  assert.ok(sheltered / farm > 0.85, `${sheltered}/${farm} farmhouses with an igune`);
  assert.ok(new Set(buildings.map((o) => o.group)).size >= 7);
  assert.ok(data.objects.some((o) => o.asset === "hinomi") && data.objects.some((o) => o.signs));
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
