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

test("16-bit heightmap is a complete 1281² little-endian raster in metres", () => {
  assert.equal(N, 1281);
  assert.equal(E, 1500);
  assert.ok(Math.abs(E / (N - 1) - 1.171875) < 1e-9, "1.17 m cells");
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

test("the river: walled through the centre, a natural meandering course above and below it", () => {
  const R = data.river, pts = R.points, bed = R.bed;
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i][2] > pts[i - 1][2], `rows sorted by z at ${pts[i][2]}`);
    assert.ok(pts[i][1] <= pts[i - 1][1] + 1e-6, `water rises at z=${pts[i][2]}`);
  }
  assert.ok(pts[0].length === 6);
  const [w0, w1] = bed.walled;
  const walled = (z) => z > w0 - 5 && z < w1 + 5;
  // drop structures and the weir only in the walled reach; the weir holds a pool
  const weir = R.drops.find((d) => d.kind === "weir");
  assert.ok(weir && R.drops.length >= 3);
  for (const d of R.drops) {
    assert.ok(walled(d.z), `drop at ${d.z} inside the walled reach`);
    assert.ok(d.waterAbove - d.waterBelow >= (d.kind === "weir" ? 0.5 : 0.2), `drop at ${d.z}`);
  }
  const nearDrop = (z) => R.drops.some((d) => z > d.z - 14 && z < d.z + 12) || (z > weir.z - 135 && z < weir.z);
  // wetted width and depth, sampled across the bed in the natural reaches: 4-8 m of water
  // (wider in places), riffles 0.1-0.3 m deep, pools to 0.4-0.9 m
  let ok = 0, n = 0, deepest = 0, shallow = 0;
  for (const [x, y, z, w, fall] of pts) {
    if (fall || z < -500 || z > 640 || walled(z) || nearDrop(z)) continue;
    let wet = 0, depth = 0;
    for (let u = -w / 2; u <= w / 2; u += 0.2) {
      const g = H(x + u, z);
      if (g < y) {
        wet += 0.2;
        depth = Math.max(depth, y - g);
      }
    }
    n++;
    if (wet >= 3.5 && wet <= 10) ok++;
    deepest = Math.max(deepest, depth);
    if (depth > 0.08 && depth < 0.32) shallow++;
  }
  assert.ok(ok / n > 0.9, `${ok}/${n} natural rows with 3.5-10 m of water`);
  assert.ok(deepest > 0.45 && deepest < 1.0, `pools ${deepest.toFixed(2)} m deep`);
  assert.ok(shallow / n > 0.1, `riffles: ${shallow}/${n} rows no deeper than 0.3 m`);
  // the bed is 10-20 m between the banks; banks stand 1.0-2.5 m above the water
  for (const [, z, B, top] of bed.points) {
    if (z < -440 || z > 560) continue;
    const y = pts.reduce((best, p) => (Math.abs(p[2] - z) < Math.abs(best[2] - z) ? p : best))[1];
    assert.ok(top - y > 0.9 && top - y < 2.5, `bank height ${top - y} at z=${z}`);
    assert.ok(B > 4.9 && B < 10.2, `bed half width ${B} at z=${z}`);
  }
  // walls on both banks through the centre; outside it most of the banks are natural earth, with
  // old stone walls only in places (some broken), and the river swings across its floor
  const inCentre = bed.points.filter((p) => p[1] > w0 + 5 && p[1] < w1 - 5);
  assert.ok(inCentre.every((p) => p[6] < 0.5 && p[7] < 0.5 && p[8] === 1 && p[9] === 1), "block walls through the centre");
  const outside = bed.points.filter((p) => !walled(p[1]) && p[1] > -700 && p[1] < 700);
  const earth = outside.filter((p) => p[6] > 0.5 && p[7] > 0.5).length / outside.length;
  assert.ok(earth > 0.6 && earth < 0.97, `natural banks on ${(earth * 100).toFixed(0)}% of the open reaches`);
  assert.ok(outside.some((p) => p[7] < 0.5 && p[9] === 0), "old dry-stone walls at some outer bends");
  let runs = 0;
  for (let i = 1; i < bed.points.length; i++) if (bed.points[i][7] < 0.5 && bed.points[i - 1][7] >= 0.5) runs++;
  assert.ok(runs >= 4, `${runs} separate stretches of wall on the east bank`);
  assert.ok(bed.points.some((p) => !walled(p[1]) && p[6] < 0.5), "an old wall on the west bank too");
  // meanders: the centre line swings off a straight chord between bends by 8 m or more
  const nat = bed.points.filter((p) => p[1] > 260 && p[1] < 640);
  const a0 = nat[0], a1 = nat[nat.length - 1];
  const off = Math.max(...nat.map((p) => Math.abs(p[0] - (a0[0] + ((a1[0] - a0[0]) * (p[1] - a0[1])) / (a1[1] - a0[1])))));
  assert.ok(off > 8, `meander offset ${off.toFixed(1)} m`);
  assert.ok(bed.leveePath.length > 100);
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

test("irrigation: brook-fed canals along the high side of the floor, branch ditches to the river", () => {
  const canals = data.canals ?? [];
  assert.ok(canals.length >= 2, "two canals from the side brooks");
  const road = data.roads.find((r) => r.class === "prefectural").points;
  const roadAt = (z) => road.reduce((b, p) => (Math.abs(p[2] - z) < Math.abs(b[2] - z) ? p : b));
  for (const c of canals) {
    const cp = c.points;
    for (let i = 1; i < cp.length; i++) assert.ok(cp[i][1] <= cp[i - 1][1] + 1e-6, `${c.name} runs downhill`);
    // fed by an intake weir on its brook, higher than the water it delivers
    assert.ok(c.intake.crestY >= cp[0][1] - 0.05, `${c.name} intake`);
    assert.ok(cp.some((p) => p[4] === 1), `${c.name} passes under the road in a pipe`);
    // along the road, its water stands above the fields beside it (the high edge of the floor)
    let above = 0, k = 0;
    // (house yards and the temple bench stand higher; the canal passes them in front)
    const homes = data.objects.filter((o) => o.asset.startsWith("minka-") || o.asset.startsWith("tera-"));
    for (const [x, y, z, , cov] of cp) {
      if (cov || Math.abs(x - roadAt(z)[0]) > 9 || homes.some((o) => Math.hypot(o.position[0] - x, o.position[2] - z) < 30)) continue;
      k++;
      if (y > H(x - 6, z) + 0.05) above++;
    }
    assert.ok(k > 40 && above / k > 0.8, `${c.name}: water above the fields at ${above}/${k} points`);
    assert.ok(cp.some((p) => p[4] === 2), `${c.name} covered where lanes cross`);
  }
  const ditches = data.streams.filter((st) => st.kind === "ditch");
  assert.ok(ditches.length >= 5, `${ditches.length} branch ditches`);
  for (const d of ditches) {
    assert.ok(d.channel.bed1 < d.channel.bed0, `ditch at ${d.z} falls to the river`);
    assert.ok(d.covers.length >= 1, `ditch at ${d.z} has a covered crossing`);
  }
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
    // unit vector from the house square to the road (the road winds with the valley)
    const tr = (roadX(z + 4) - roadX(z - 4)) / 8, nl = Math.hypot(1, tr), sg = Math.sign(roadX(z) - x);
    const toRoad = [sg / nl, (-sg * tr) / nl];
    if (o.group === "tera") continue;
    if (o.group === "kawamuko") {
      // the terrace hamlet: houses in a row along the contour lane, fronts down the slope (east)
      assert.ok(front[0] > 0.8, `${o.id} faces down the slope`);
      assert.ok(data.roads.some((r) => r.class === "town" && r.points.some((p) => Math.hypot(p[0] - x, p[2] - z) < 24)), `${o.id} stands on the lane`);
      continue;
    }
    if (o.group === "machi" || o.roadside) {
      if (o.asset === "nokyo-soko") continue;
      // fronts on the road, with no windbreak behind
      assert.ok(front[0] * toRoad[0] + front[1] * toRoad[1] > 0.9, `${o.id} faces the road`);
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

test("hills and valley: eroded relief, a winding floor, side streams, temple and clinic", () => {
  // the hills come from the regional erosion model: side valleys cut into them, so the height
  // along a line parallel to the valley rises and falls by tens of metres
  const xs = [];
  for (let z = -600; z <= 600; z += 12) xs.push(H(420, z));
  let turns = 0;
  for (let i = 2; i < xs.length; i++) if ((xs[i] - xs[i - 1]) * (xs[i - 1] - xs[i - 2]) < 0) turns++;
  assert.ok(Math.max(...xs) - Math.min(...xs) > 40 && turns >= 6, `ridge and valley relief east of the village (${turns} turns)`);
  // the floor winds: the river line swings by more than 60 m
  const rx = data.river.points.map((p) => p[0]);
  assert.ok(Math.max(...rx) - Math.min(...rx) > 60);
  // side streams: a brook that never runs uphill, a culvert under the prefectural road, water to draw
  const brooks = data.streams.filter((st) => st.kind !== "ditch");
  assert.ok(brooks.length >= 2, "two side streams");
  for (const st of brooks) {
    for (let i = 1; i < st.brook.length; i++) assert.ok(st.brook[i][1] <= st.brook[i - 1][1] + 1e-6, `${st.name} falls downstream`);
    assert.ok(st.covers.some((c) => c.kind === "road" || c.kind === "bridge"), `${st.name} passes under the road`);
    assert.ok(st.water.length >= 2 && st.water.every((r) => r.length > 1));
    assert.ok(st.channel.bed1 < st.channel.bed0, `${st.name} channel falls to the river`);
  }
  // the larger brook crosses the road on a short bridge, the smaller in a box culvert
  assert.ok(brooks.some((st) => st.covers.some((c) => c.kind === "bridge")) && data.objects.some((o) => o.asset === "road-bridge" && o.collider));
  assert.ok(brooks.some((st) => st.covers.some((c) => c.kind === "road")));
  // temple: hall, gate with its plaque, bell tower, graves; clinic at the south end of the village
  for (const a of ["tera-hondo", "tera-sanmon", "tera-shoro", "rokujizo"]) assert.ok(data.objects.some((o) => o.asset === a), a);
  assert.ok(data.objects.filter((o) => o.asset === "haka").length >= 8, "a graveyard");
  assert.ok(data.objects.filter((o) => o.asset === "haka" && o.cemetery).length >= 10, "the communal graveyard on the hill foot");
  const clinic = data.objects.find((o) => o.asset === "shinryojo");
  assert.ok(clinic && clinic.signs, "clinic with its name board");
  const houses = data.objects.filter((o) => o.group && o.group !== "kawamuko" && o.group !== "sankyo" && o.group !== "tera");
  assert.ok(houses.every((o) => o.position[2] <= clinic.position[2] + 1), "the clinic is the last building to the south");
  // the houses gather around the centre
  const machi = data.hamlets.find((hm) => hm.name === "machi");
  const near = houses.filter((o) => Math.abs(o.position[2] - machi.z) < 330).length;
  assert.ok(near / houses.length > 0.8, `${near}/${houses.length} roadside buildings within 330 m of the centre`);
});

test("road works: graded cut and fill slopes (no sheer walls), the road ends at a tunnel portal", () => {
  const road = data.roads.find((r) => r.class === "prefectural");
  const tu = data.tunnel;
  assert.ok(tu, "tunnel portal recorded");
  assert.ok(Math.abs(road.points[0][2] - tu.z) < 3, "the road starts at the portal");
  assert.ok(data.objects.some((o) => o.asset === "tunnel" && o.collider), "portal model with a collider");
  assert.ok(data.ditch.zRange[0] >= tu.z, "ditches stop at the portal");
  // beside the road the ground never rises faster than 1:1 (cut) or falls faster than 1:1.5 (fill)
  // from the edge of the flat shoulder; sampled every 10 m along the open road
  // (yards beside the road end in stone walls, so samples by a house are left out)
  const houses = data.objects.filter((o) => o.asset.startsWith("minka-") || o.asset === "naya");
  let worst = 0;
  for (const [x, y, z] of road.points.filter((_, i) => i % 4 === 0)) {
    if (z > 560) continue;
    if (houses.some((o) => Math.hypot(o.position[0] - x, o.position[2] - z) < 32)) continue;
    for (const side of [-1, 1])
      for (const d of [6, 9, 12, 16]) {
        const dy = H(x + side * d, z) - y, run = d - 4.3;
        worst = Math.max(worst, dy / run, -dy / run / 1.5 * 1.0);
      }
  }
  assert.ok(worst < 1.25, `steepest roadside slope ${worst.toFixed(2)} (1.0 = 45 degrees)`);
  // carriageway, shoulders and ditch rims are level across the road (the ditch lining sits flush)
  let off = 0;
  const bridges = data.objects.filter((o) => o.asset === "road-bridge");
  for (const [x, y, z] of road.points) {
    if (z > 540 || bridges.some((o) => Math.abs(o.position[2] - z) < 4)) continue;    // the deck carries the road there
    for (const d of [-4.1, -3.75, -2, 0, 2, 3.75, 4.1]) off = Math.max(off, Math.abs(H(x + d, z) - y));
  }
  assert.ok(off < 0.08, `road cross-section level within ${off.toFixed(3)} m`);
});

test("map sheet: image, names of the hamlets and the centre, shrine and post office", () => {
  const m = JSON.parse(fs.readFileSync(`${W}/map.json`, "utf8"));
  assert.ok(fs.statSync(`${W}/${m.image}`).size > 100000);
  assert.equal(m.extent, E);
  const kinds = (k) => m.labels.filter((l) => l.kind === k).map((l) => l.text);
  assert.ok(kinds("district").includes("上沢"));
  assert.ok(kinds("hamlet").length >= 6, "every hamlet is named");
  for (const t of ["郵便局", "駐在所", "熊野神社"]) assert.ok(kinds("facility").includes(t), t);
  for (const l of m.labels) assert.ok(Math.abs(l.x) <= E / 2 && Math.abs(l.z) <= E / 2, `${l.text} on the sheet`);
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
    const name = o.asset.startsWith("minka-") || o.asset === "jihanki" || o.asset === "haka" ? `${o.asset}_${o.variant}` : o.asset === "naya" ? "naya_0" : o.asset === "komainu" ? `komainu-${o.variant}` : o.asset;
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

test("rural routes meet existing roads, form three circuits, and keep walkable grades", () => {
  const loops = data.ruralLoops;
  assert.equal(loops.length, 3);
  const road = (id) => { const r = data.roads.find(r => r.id === id); assert.ok(r, id); return r; };
  const distance = (p, a, b) => {
    const dx = b[0]-a[0], dz = b[2]-a[2];
    const t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[2]-a[2])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(p[0]-a[0]-t*dx, p[2]-a[2]-t*dz);
  };
  for (const loop of loops) {
    const legs = loop.roads.map(road), back = road(loop.returnVia);
    for (let i=1; i<legs.length; i++) {
      const a = legs[i-1].points.at(-1), b = legs[i].points[0];
      assert.ok(Math.hypot(a[0]-b[0], a[2]-b[2]) < .03, `${loop.id}: continuous junction`);
    }
    for (const p of [legs[0].points[0], legs.at(-1).points.at(-1)]) {
      assert.ok(Math.min(...back.points.slice(1).map((b,i)=>distance(p,back.points[i],b))) < 1,
        `${loop.id}: connected to return road`);
    }
    const outline = legs.flatMap(r => r.points);
    const first = outline[0], last = outline.at(-1);
    const returnPoints = back.points.filter(p => p[2] > Math.min(first[2], last[2]) && p[2] < Math.max(first[2], last[2]));
    returnPoints.sort((a,b) => (a[2]-b[2])*Math.sign(first[2]-last[2]));
    outline.push(...returnPoints, first);
    const area = Math.abs(outline.slice(1).reduce((sum,p,i) => sum + outline[i][0]*p[2] - p[0]*outline[i][2], 0))/2;
    assert.ok(area > 5000, `${loop.id}: a real circuit, not a retraced dead end (${area} m²)`);
    for (const r of legs) {
      assert.equal(r.surface, 'gravel');
      assert.ok(r.width >= 3);
      for (let i=1;i<r.points.length;i++) {
        const a=r.points[i-1], b=r.points[i], d=Math.hypot(b[0]-a[0],b[2]-a[2]);
        assert.ok(d > .05 && d < 20, `${r.id}: continuous sampling`);
        // Check the actual encoded ground at one-metre intervals, not just metadata heights.
        let y = H(a[0],a[2]);
        const n=Math.ceil(d);
        for(let k=1;k<=n;k++) {
          const t=k/n, next=H(a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t);
          assert.ok(Math.abs(next-y)/(d/n)<.35, `${r.id}: steep ground at ${i}/${k}`);
          y=next;
        }
      }
    }
  }
});
