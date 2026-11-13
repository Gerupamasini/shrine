// Procedural architecture for 夏陰. node tools/architecture/build.mjs
// Writes public/assets/models/architecture/<asset>[_v].glb and index.json (bounds, tris).
import * as THREE from "three";
import fs from "node:fs";
import path from "node:path";
import { Model, V, rng, lathe, marchingCubes, writeModel, gridSurface } from "./kit.mjs";
import { hipRoof, gableRoof } from "./roofs.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public/assets/models/architecture");
fs.mkdirSync(OUT, { recursive: true });
const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public/world/scene.json"), "utf8"));
const index = {};
const M4 = (x = 0, y = 0, z = 0, ry = 0, s = 1) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), V(s, s, s));

async function save(name, model) {
  await writeModel(model, path.join(OUT, `${name}.glb`));
  const box = new THREE.Box3();
  for (const gs of model.parts.values()) for (const g of gs) { g.computeBoundingBox(); box.union(g.boundingBox); }
  index[name] = { triangles: Math.round(model.triangles()), min: box.min.toArray().map((v) => +v.toFixed(3)), max: box.max.toArray().map((v) => +v.toFixed(3)), materials: [...model.parts.keys()] };
  console.log(name, index[name].triangles);
}

// ---------------------------------------------------------------- torii
function torii(kind) {
  const m = new Model(`torii-${kind}`);
  const stone = kind === "stone";
  const post = stone ? "stone_granite" : "vermilion";
  const top = stone ? "stone_granite" : "lacquer_black";
  const H = stone ? 4.7 : 4.4, R = stone ? 0.27 : 0.23, span = stone ? 2.0 : 1.85;
  for (const s of [-1, 1]) {
    // slight inward lean (転び)
    const g = new THREE.CylinderGeometry(R * 0.92, R, H, 20, 4);
    const circ = 2 * Math.PI * R;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * H);
    g.translate(0, H / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(s * 0.025));
    g.translate(s * span, 0, 0);
    m.add(post, g, { uv: "keep" });
    if (stone) m.cyl("stone_granite", R * 1.55, R * 1.35, 0.45, s * span, 0, 0, 20); // kamebara base
    else m.cyl("lacquer_black", R * 1.25, R * 1.2, 0.55, s * span, 0, 0, 20); // nemaki
    m.cyl(top, R * 1.08, R * 1.08, 0.18, s * (span - 0.05), H - 0.4, 0, 20); // daiwa
  }
  // nuki (tie beam) passes through the posts
  m.box(post, span * 2 + 1.0, 0.28, 0.2, 0, H - 1.05, 0);
  // gakuzuka (centre strut) and plaque
  m.box(post, 0.22, 0.75, 0.18, 0, H - 0.55, 0);
  m.box(stone ? "stone_granite" : "wood_old", 0.55, 0.75, 0.08, 0, H - 0.55, 0.1);
  // shimaki + kasagi with upturned ends (sori)
  const L = span * 2 + 2.2;
  const beam = (y0, hgt, dep, len, sori, mat) => {
    const N = 24, grid = [];
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N;
      const lift = sori * Math.pow(Math.abs(u), 2.6);
      grid.push([V(u * len / 2, y0 + lift, dep / 2), V(u * len / 2, y0 + lift + hgt, dep / 2)]);
    }
    // extrude a box section along X: four sides
    const side = (dz, flipped) => {
      const g = gridSurface(grid.map(([a, b]) => [V(a.x, a.y, dz), V(b.x, b.y, dz)]), 1, 1, flipped);
      m.add(mat, g, { uv: "keep" });
    };
    side(dep / 2, false);
    side(-dep / 2, true);
    const topRow = grid.map(([, b]) => [V(b.x, b.y, dep / 2), V(b.x, b.y, -dep / 2)]);
    m.add(mat, gridSurface(topRow, 1, 1, true), { uv: "keep" });
    const botRow = grid.map(([a]) => [V(a.x, a.y, dep / 2), V(a.x, a.y, -dep / 2)]);
    m.add(mat, gridSurface(botRow, 1, 1, false), { uv: "keep" });
    for (const s of [-1, 1]) {
      const [a, b] = grid[s < 0 ? 0 : N];
      m.box(mat, 0.02, hgt, dep, a.x, (a.y + b.y) / 2, 0);
    }
  };
  beam(H, 0.26, 0.42, L - 0.3, 0.12, post);
  beam(H + 0.26, 0.24, 0.5, L, 0.2, top);
  return m;
}

// ---------------------------------------------------------------- stone lantern (kasuga-doro)
function toro(variant) {
  const r = rng(40 + variant);
  const m = new Model("toro");
  const hex = (mat, rb, rt, h, y, rot = 0) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, 6, 1);
    g.rotateY(rot);
    g.translate(0, y + h / 2, 0);
    m.add(mat, g);
  };
  hex("stone_granite", 0.42, 0.36, 0.2, 0);          // kiso
  hex("stone_granite", 0.3, 0.2, 0.14, 0.2);          // kaeribana
  m.cyl("stone_granite", 0.13, 0.12, 0.95, 0, 0.34, 0, 14); // sao
  m.cyl("stone_granite", 0.15, 0.15, 0.06, 0, 0.75, 0, 14); // fushi
  hex("stone_granite", 0.2, 0.33, 0.16, 1.29);        // chudai
  hex("stone_granite", 0.33, 0.33, 0.06, 1.45);
  // hibukuro with window openings: outer frame posts + dark inner box
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    m.box("stone_granite", 0.07, 0.36, 0.07, Math.cos(a) * 0.22, 1.69, Math.sin(a) * 0.22, { ry: -a });
  }
  hex("stone_dark", 0.16, 0.16, 0.36, 1.51);
  hex("stone_granite", 0.25, 0.25, 0.05, 1.87);
  // kasa with curled corners (warabite)
  const kasa = lathe([[0.02, 0.0], [0.5, 0.0], [0.52, 0.04], [0.48, 0.07], [0.3, 0.2], [0.1, 0.3], [0.06, 0.32]], 6);
  kasa.translate(0, 1.92, 0);
  m.add(r() < 0.5 ? "stone_moss" : "stone_granite", kasa);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const g = new THREE.SphereGeometry(0.05, 6, 4);
    g.translate(Math.cos(a) * 0.52, 2.0, Math.sin(a) * 0.52);
    m.add("stone_granite", g);
  }
  const hoju = lathe([[0, 0], [0.09, 0.02], [0.1, 0.08], [0.07, 0.14], [0.03, 0.2], [0, 0.24]], 12);
  hoju.translate(0, 2.24, 0);
  m.add("stone_granite", hoju);
  m.cyl("stone_granite", 0.07, 0.06, 0.05, 0, 2.21, 0, 12);
  return m;
}

// ---------------------------------------------------------------- komainu (worn stone lion-dog)
function komainu(mouthOpen) {
  const m = new Model(`komainu-${mouthOpen ? "a" : "un"}`);
  const sph = (x, y, z, cx, cy, cz, r) => Math.hypot(x - cx, y - cy, z - cz) - r;
  const ell = (x, y, z, cx, cy, cz, rx, ry, rz) => (Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz) - 1) * Math.min(rx, ry, rz);
  const cap = (x, y, z, ax, ay, az, bx, by, bz, r) => {
    const px = x - ax, py = y - ay, pz = z - az, vx = bx - ax, vy = by - ay, vz = bz - az;
    const t = Math.max(0, Math.min(1, (px * vx + py * vy + pz * vz) / (vx * vx + vy * vy + vz * vz)));
    return Math.hypot(px - vx * t, py - vy * t, pz - vz * t) - r;
  };
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const noise = (x, y, z) => Math.sin(x * 23.1 + y * 7.3) * Math.sin(y * 19.7 + z * 11.1) * Math.sin(z * 17.3 + x * 5.7);
  // seated pose facing +Z, pedestal top at y = 0.9
  const sdf = (x, y, z) => {
    let d = ell(x, y, z, 0, 1.38, -0.08, 0.27, 0.36, 0.33);                 // torso
    d = smin(d, sph(x, y, z, 0, 1.86, 0.1, 0.25), 0.18);                   // head
    d = smin(d, ell(x, y, z, 0, 1.78, 0.32, 0.15, mouthOpen ? 0.12 : 0.1, 0.12), 0.08); // muzzle
    for (const s of [-1, 1]) {
      d = smin(d, sph(x, y, z, s * 0.2, 1.98, 0.02, 0.1), 0.12);           // mane curls
      d = smin(d, sph(x, y, z, s * 0.24, 1.72, -0.02, 0.12), 0.1);
      d = smin(d, cap(x, y, z, s * 0.15, 1.3, 0.18, s * 0.14, 0.95, 0.27, 0.075), 0.08); // forelegs
      d = smin(d, ell(x, y, z, s * 0.17, 1.06, -0.22, 0.13, 0.16, 0.22), 0.1);   // haunches
      d = smin(d, sph(x, y, z, s * 0.15, 0.95, 0.3, 0.07), 0.05);          // paws
      d = smin(d, sph(x, y, z, s * 0.1, 1.9, 0.33, 0.04), 0.03);           // brows
    }
    d = smin(d, ell(x, y, z, 0, 1.6, -0.42, 0.16, 0.28, 0.1), 0.12);       // tail flame
    if (mouthOpen) d = Math.max(d, -ell(x, y, z, 0, 1.74, 0.43, 0.09, 0.035, 0.08));
    d = smin(d, ell(x, y, z, 0, 0.92, 0.0, 0.36, 0.05, 0.48), 0.05);       // base slab
    return d + noise(x, y, z) * 0.006;
  };
  m.add("stone_old", marchingCubes(sdf, [-0.45, 0.85, -0.6], [0.45, 2.15, 0.6], 40));
  // pedestal (dai): stacked stone blocks
  m.box("stone_granite", 0.95, 0.55, 1.15, 0, 0.275, 0);
  m.box("stone_moss", 1.05, 0.12, 1.25, 0, 0.06, 0);
  m.box("stone_granite", 0.86, 0.32, 1.05, 0, 0.71, 0);
  return m;
}

// ---------------------------------------------------------------- shrine buildings
function haiden() {
  const m = new Model("haiden");
  const W = 10.9, D = 7.3, FLOOR = 0.95;
  m.box("stone_granite", W + 0.6, 0.35, D + 0.6, 0, 0.175, 0);
  m.box("wood_old", W + 1.9, 0.14, D + 1.9, 0, FLOOR - 0.07, 0);        // engawa deck
  for (let i = 0; i <= 3; i++) for (let j = 0; j <= 2; j++) {
    const x = -W / 2 + (W / 3) * i, z = -D / 2 + (D / 2) * j;
    if (i > 0 && i < 3 && j === 1) continue;
    m.cyl("wood_old", 0.15, 0.15, 4.1, x, 0.35, z, 14);
    m.cyl("stone_granite", 0.24, 0.22, 0.2, x, 0.3, z, 10);
  }
  // engawa posts and railing (kōran)
  for (let k = 0; k <= 8; k++) {
    const x = -W / 2 - 0.9 + ((W + 1.8) / 8) * k;
    m.box("wood_old", 0.1, 0.65, 0.1, x, FLOOR + 0.32, D / 2 + 0.88);
    if (k < 8 && (k < 3 || k > 4)) m.box("wood_old", (W + 1.8) / 8, 0.07, 0.08, x + (W + 1.8) / 16, FLOOR + 0.62, D / 2 + 0.88);
  }
  for (const s of [-1, 1]) for (let k = 0; k <= 4; k++) {
    const z = -D / 2 - 0.9 + ((D + 1.8) / 4) * k;
    m.box("wood_old", 0.1, 0.65, 0.1, s * (W / 2 + 0.88), FLOOR + 0.32, z);
    if (k < 4) m.box("wood_old", 0.08, 0.07, (D + 1.8) / 4, s * (W / 2 + 0.88), FLOOR + 0.62, z + (D + 1.8) / 8);
  }
  // walls: plank sides/back, lattice doors front
  m.box("wood_planks", 0.08, 3.0, D, -W / 2, FLOOR + 1.5, 0);
  m.box("wood_planks", 0.08, 3.0, D, W / 2, FLOOR + 1.5, 0);
  m.box("wood_planks", W, 3.0, 0.08, 0, FLOOR + 1.5, -D / 2);
  m.box("wood_dark", W - 0.2, 2.9, 0.05, 0, FLOOR + 1.45, D / 2 - 0.12);    // dark interior behind lattice
  for (let i = 0; i < 3; i++) {
    const cx = -W / 3 + (W / 3) * i;
    for (let k = -8; k <= 8; k++) m.box("wood_old", 0.035, 2.2, 0.05, cx + k * 0.19, FLOOR + 1.1, D / 2);
    for (let k = 0; k < 7; k++) m.box("wood_old", 3.4, 0.035, 0.05, cx, FLOOR + 0.2 + k * 0.33, D / 2 + 0.01);
    m.box("wood_old", 3.4, 0.6, 0.07, cx, FLOOR + 2.6, D / 2 + 0.02);        // ranma panel
  }
  // nageshi, head beams, bracket blocks
  for (const y of [FLOOR + 2.25, FLOOR + 3.0]) {
    m.box("wood_old", W + 0.3, 0.2, 0.18, 0, y, D / 2 + 0.05);
    m.box("wood_old", W + 0.3, 0.2, 0.18, 0, y, -D / 2 - 0.05);
    m.box("wood_old", 0.18, 0.2, D + 0.3, -W / 2 - 0.05, y, 0);
    m.box("wood_old", 0.18, 0.2, D + 0.3, W / 2 + 0.05, y, 0);
  }
  for (let i = 0; i <= 3; i++) for (const z of [D / 2, -D / 2]) m.box("wood_old", 0.42, 0.28, 0.42, -W / 2 + (W / 3) * i, FLOOR + 3.28, z);
  // rafters under the eaves
  for (let k = -16; k <= 16; k++) for (const s of [-1, 1]) m.box("wood_old", 0.09, 0.11, 1.9, k * 0.36, FLOOR + 3.48, s * (D / 2 + 0.8), { rx: s * 0.42 });
  hipRoof(m, "roof_kawara", { W: W + 0.2, D: D + 0.2, over: 1.75, eaveY: FLOOR + 3.55, ridgeY: FLOOR + 7.4, sori: 0.42, thick: 0.32, gable: 0.55, uv: 1, ridgeMat: "roof_kawara_ridge", gableMat: "wood_old", ridgeH: 0.6, ridgeW: 0.55 });
  for (const s of [-1, 1]) m.box("roof_kawara_ridge", 0.35, 0.75, 0.6, s * 3.4, FLOOR + 7.7, 0); // onigawara
  // kōhai: projecting porch roof over the steps, two posts
  for (const s of [-1, 1]) {
    m.cyl("wood_old", 0.12, 0.12, 3.25, s * 1.55, 0.35, D / 2 + 2.3, 12);
    m.cyl("stone_granite", 0.2, 0.18, 0.18, s * 1.55, 0.3, D / 2 + 2.3, 8);
  }
  m.box("wood_old", 3.6, 0.22, 0.2, 0, 3.55, D / 2 + 2.3);
  gableRoof(m.addSub = new Model("kohai"), "roof_kawara", { W: 3.4, over: 0.4, eaveY: 3.85, ridgeY: 4.55, frontRun: 1.9, backRun: 0.01, thick: 0.25 });
  m.merge(m.addSub, new THREE.Matrix4().makeRotationY(0).setPosition(0, 0, D / 2 + 2.6));
  // kizahashi steps
  for (let k = 0; k < 5; k++) m.box("wood_old", 3.0, 0.08, 0.32, 0, 0.35 + k * 0.13, D / 2 + 2.25 - k * 0.27);
  for (const s of [-1, 1]) m.box("wood_old", 0.1, 0.9, 1.6, s * 1.55, 0.75, D / 2 + 1.55, { rx: 0.45 });
  // shimenawa (thick straw rope) + suzu bell + rope
  const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-1.6, 3.15, D / 2 + 2.32), V(0, 2.82, D / 2 + 2.4), V(1.6, 3.15, D / 2 + 2.32)]), 24, 0.11, 10);
  m.add("rope_straw", rope, { uvScale: 2 });
  for (let k = -3; k <= 3; k++) m.box("paper", 0.1, 0.42, 0.01, k * 0.45, 2.62 - Math.abs(k) * 0.03, D / 2 + 2.42, { rz: (k % 2) * 0.1 });
  const bell = new THREE.SphereGeometry(0.17, 12, 8);
  bell.translate(0, 3.1, D / 2 + 2.15);
  m.add("brass", bell);
  m.cyl("cloth_red", 0.03, 0.03, 2.0, 0, 1.05, D / 2 + 2.18, 6);
  return m;
}

function honden() {
  const m = new Model("honden");
  const W = 2.4, D = 2.4, FLOOR = 1.5;
  m.box("stone_granite", 4.6, 0.6, 4.4, 0, 0.3, 0);
  m.box("stone_moss", 4.9, 0.12, 4.7, 0, 0.06, 0);
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) m.cyl("wood_old", 0.11, 0.11, 2.9, x, 0.6, z, 12);
  m.box("wood_old", W + 1.0, 0.1, D + 1.0, 0, FLOOR, 0);
  for (const s of [-1, 1]) m.box("wood_planks", 0.06, 1.7, D, s * W / 2, FLOOR + 0.85, 0);
  m.box("wood_planks", W, 1.7, 0.06, 0, FLOOR + 0.85, -D / 2);
  m.box("wood_dark", W - 0.2, 1.6, 0.05, 0, FLOOR + 0.82, D / 2);
  for (const s of [-1, 1]) m.box("brass", 0.06, 0.06, 0.02, s * 0.12, FLOOR + 0.8, D / 2 + 0.03);  // door fittings
  m.box("wood_old", W + 0.2, 0.15, 0.15, 0, FLOOR + 1.75, D / 2);
  for (let k = 0; k < 6; k++) m.box("wood_old", 1.4, 0.07, 0.28, 0, 0.62 + k * 0.17, D / 2 + 1.2 - k * 0.15);
  gableRoof(m, "roof_copper", { W: W, over: 0.9, eaveY: FLOOR + 1.9, backEaveY: FLOOR + 1.95, ridgeY: FLOOR + 3.4, frontRun: D / 2 + 2.3, backRun: D / 2 + 0.75, thick: 0.18 });
  // chigi and katsuogi on the ridge
  for (const s of [-1, 1]) for (const t of [-1, 1]) m.box("wood_old", 0.08, 1.4, 0.16, s * (W / 2 + 0.95), FLOOR + 3.85, 0, { rz: 0, rx: t * 0.6 });
  for (let k = -1; k <= 1; k++) {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.9, 10);
    g.rotateX(Math.PI / 2);
    g.translate(k * 0.75, FLOOR + 3.62, 0);
    m.add("wood_old", g);
  }
  // tamagaki fence
  for (let k = 0; k <= 22; k++) {
    const t = k / 22, per = 2 * (6.2 + 5.8);
    let d = t * per, x, z;
    if (d < 6.2) (x = -3.1 + d), (z = 2.9);
    else if (d < 12) (x = 3.1), (z = 2.9 - (d - 6.2));
    else if (d < 18.2) (x = 3.1 - (d - 12)), (z = -2.9);
    else (x = -3.1), (z = -2.9 + (d - 18.2));
    if (Math.abs(x) < 0.9 && z > 2.8) continue;
    m.box("wood_old", 0.09, 1.1, 0.09, x, 0.55, z);
  }
  for (const [w, d, x, z] of [[2.3, 0.07, -2.0, 2.9], [2.3, 0.07, 2.0, 2.9], [6.2, 0.07, 0, -2.9], [0.07, 5.8, -3.1, 0], [0.07, 5.8, 3.1, 0]])
    for (const y of [0.4, 1.0]) m.box("wood_old", w, 0.07, d === 0.07 ? 0.07 : d, x, y, z);
  return m;
}

function saisen() {
  const m = new Model("saisen");
  m.box("wood_old", 1.4, 0.75, 0.75, 0, 0.375, 0);
  for (let k = -5; k <= 5; k++) m.box("wood_dark", 0.05, 0.06, 0.78, k * 0.12, 0.78, 0, { rz: 0.5 });
  m.box("wood_old", 1.46, 0.05, 0.8, 0, 0.74, 0);
  return m;
}

function temizuya() {
  const m = new Model("temizuya");
  for (const x of [-1.25, 1.25]) for (const z of [-0.8, 0.8]) {
    m.cyl("wood_old", 0.1, 0.1, 2.35, x, 0.15, z, 12);
    m.cyl("stone_granite", 0.18, 0.16, 0.15, x, 0, z, 8);
  }
  for (const z of [-0.8, 0.8]) m.box("wood_old", 3.0, 0.18, 0.14, 0, 2.45, z);
  for (const x of [-1.25, 1.25]) m.box("wood_old", 0.14, 0.18, 2.0, x, 2.45, 0);
  const roof = new Model("tr");
  gableRoof(roof, "roof_kawara", { W: 2.6, over: 0.55, eaveY: 2.6, ridgeY: 3.45, frontRun: 1.65, backRun: 1.65, thick: 0.22 });
  m.merge(roof, new THREE.Matrix4());
  // chozubachi basin (hollowed stone) and water surface
  m.box("stone_granite", 1.5, 0.45, 0.7, 0, 0.45, 0);
  m.box("stone_granite", 1.5, 0.12, 0.7, 0, 0.96, 0);
  m.box("stone_moss", 1.6, 0.3, 0.8, 0, 0.15, 0);
  m.box("water_still", 1.3, 0.02, 0.5, 0, 1.0, 0);
  m.box("stone_granite", 1.3, 0.05, 0.08, 0, 1.03, 0.31);
  m.box("stone_granite", 1.3, 0.05, 0.08, 0, 1.03, -0.31);
  m.box("stone_granite", 0.08, 0.05, 0.5, 0.71, 1.03, 0);
  m.box("stone_granite", 0.08, 0.05, 0.5, -0.71, 1.03, 0);
  // bamboo rail with ladles
  m.cyl("bamboo_green", 0.025, 0.025, 1.4, 0, 1.12 - 0.7, 0.0, 8, { rz: Math.PI / 2 });   // centred at y 1.12
  for (let k = 0; k < 5; k++) {
    const x = -0.5 + k * 0.25;
    m.cyl("wood_light", 0.045, 0.045, 0.07, x, 1.1, 0.18, 10);
    m.box("wood_light", 0.02, 0.012, 0.42, x, 1.15, -0.02, { rx: 0.25 });
  }
  return m;
}

function shamusho() {
  const m = new Model("shamusho");
  const W = 11, D = 7, F = 0.55;
  m.box("concrete", W + 0.3, F, D + 0.3, 0, F / 2, 0);
  // posts
  for (let i = 0; i <= 6; i++) for (const z of [-D / 2, D / 2]) m.box("wood_old", 0.15, 2.6, 0.15, -W / 2 + (W / 6) * i, F + 1.3, z);
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 6, D / 6]) m.box("wood_old", 0.15, 2.6, 0.15, x, F + 1.3, z);
  // walls: lower siding, upper plaster; front glass sliding doors + lit interior
  m.box("wood_siding", W, 0.9, 0.1, 0, F + 0.45, -D / 2);
  m.box("plaster_white", W, 1.7, 0.1, 0, F + 1.75, -D / 2);
  for (const s of [-1, 1]) {
    m.box("wood_siding", 0.1, 0.9, D, s * W / 2, F + 0.45, 0);
    m.box("plaster_white", 0.1, 1.7, D, s * W / 2, F + 1.75, 0);
  }
  m.box("interior_lit", W - 0.3, 2.3, 0.05, 0, F + 1.2, D / 2 - 0.35);
  for (let k = 0; k < 8; k++) {
    const x = -W / 2 + 0.7 + k * ((W - 1.4) / 7);
    m.box("aluminium", 0.05, 2.3, 0.06, x, F + 1.15, D / 2);
  }
  m.box("glass", W - 0.3, 2.2, 0.02, 0, F + 1.15, D / 2 + 0.01);
  m.box("aluminium", W - 0.2, 0.06, 0.08, 0, F + 2.3, D / 2);
  m.box("aluminium", W - 0.2, 0.06, 0.08, 0, F + 0.04, D / 2);
  m.box("plaster_white", W, 0.4, 0.1, 0, F + 2.45, D / 2);
  hipRoof(m, "roof_kawara", { W, D, over: 0.9, eaveY: F + 2.7, ridgeY: F + 5.0, sori: 0.12, thick: 0.25, gable: 0.6, ridgeMat: "roof_kawara_ridge", gableMat: "plaster_white", ridgeH: 0.4 });
  for (let k = 0; k < 3; k++) m.box("concrete", 1.6, 0.15, 0.35, 0, k * 0.17 + 0.07, D / 2 + 0.9 - k * 0.3);
  return m;
}

function ema() {
  const m = new Model("ema");
  const r = rng(77);
  for (const x of [-1.5, 1.5]) m.box("wood_old", 0.1, 2.1, 0.1, x, 1.05, 0);
  for (const y of [1.0, 1.45]) m.box("wood_old", 3.2, 0.05, 0.05, 0, y, 0);
  const roof = new Model("er");
  gableRoof(roof, "roof_wood", { W: 3.2, over: 0.25, eaveY: 2.0, ridgeY: 2.35, frontRun: 0.45, backRun: 0.45, thick: 0.05 });
  m.merge(roof, new THREE.Matrix4());
  const shape = new THREE.Shape([new THREE.Vector2(-0.075, 0), new THREE.Vector2(0.075, 0), new THREE.Vector2(0.075, 0.075), new THREE.Vector2(0, 0.1), new THREE.Vector2(-0.075, 0.075)]);
  for (const y of [1.0, 1.45]) for (let k = 0; k < 26; k++) {
    if (r() < 0.25) continue;
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false });
    g.translate(0, -0.11, 0);
    g.rotateZ((r() - 0.5) * 0.2);
    g.rotateY((r() - 0.5) * 0.5);
    g.translate(-1.4 + k * 0.11 + r() * 0.03, y, (r() < 0.5 ? 1 : -1) * 0.035);
    m.add(r() < 0.3 ? "wood_old" : "wood_light", g);
  }
  return m;
}

function shimenawaTree() {
  const m = new Model("shimenawa-tree");
  const R = 0.5;
  const pts = [];
  for (let k = 0; k <= 32; k++) { const a = (k / 32) * Math.PI * 2; pts.push(V(Math.cos(a) * R, 2.6 + Math.sin(a * 2) * 0.03, Math.sin(a) * R)); }
  m.add("rope_straw", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.07, 8, true), { uvScale: 2 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    m.box("paper", 0.08, 0.35, 0.01, Math.cos(a) * (R + 0.07), 2.38, Math.sin(a) * (R + 0.07), { ry: -a + Math.PI / 2 });
  }
  return m;
}

function bench() {
  const m = new Model("bench");
  m.box("wood_old", 1.8, 0.06, 0.38, 0, 0.44, 0);
  for (const x of [-0.75, 0.75]) m.box("wood_old", 0.08, 0.42, 0.34, x, 0.21, 0);
  return m;
}
function fenceLookout() {
  const m = new Model("fence-lookout");
  for (let k = 0; k <= 7; k++) m.cyl("wood_old", 0.06, 0.06, 1.05, -7 + k * 2, 0, 0, 8);
  for (const y of [0.55, 1.0]) m.box("wood_old", 14.2, 0.08, 0.08, 0, y, 0);
  return m;
}
function sekihi() {
  const m = new Model("sekihi");
  const r = rng(9);
  const g = new THREE.BoxGeometry(0.75, 1.7, 0.24, 6, 12, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const taper = 1 - Math.max(0, y - 0.6) * 0.25;
    p.setXYZ(i, p.getX(i) * taper + (r() - 0.5) * 0.02, y + (y > 0.8 ? (r() - 0.5) * 0.08 : 0), p.getZ(i) + (r() - 0.5) * 0.015);
  }
  g.computeVertexNormals();
  g.translate(0, 1.2, 0);
  m.add("stone_old", g);
  m.box("stone_moss", 1.1, 0.35, 0.6, 0, 0.175, 0);
  return m;
}
function jizo() {
  const m = new Model("jizo");
  const sdf = (x, y, z) => {
    const body = Math.max(Math.hypot(x / 0.17, z / 0.14) - 1, -(y - 0.25) / 0.4, (y - 0.85) / 0.4) * 0.14;
    const head = Math.hypot(x, y - 0.95, z) - 0.12;
    const k = 0.06, h = Math.max(k - Math.abs(body - head), 0) / k;
    return Math.min(body, head) - h * h * k * 0.25;
  };
  m.add("stone_old", marchingCubes(sdf, [-0.25, 0.2, -0.25], [0.25, 1.1, 0.25], 22));
  const bib = new THREE.ConeGeometry(0.19, 0.3, 12, 1, true);
  bib.translate(0, 0.66, 0.01);
  m.add("cloth_red", bib);
  m.box("stone_granite", 0.5, 0.25, 0.4, 0, 0.125, 0);
  return m;
}

// ---------------------------------------------------------------- houses
const PRESETS = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/architecture/presets.json"), "utf8"));
const HOUSE_PRESETS = Object.fromEntries(Object.entries(PRESETS).filter(([k]) => !k.startsWith("_")));
function minka(type, v) {
  const r = rng(1000 + v * 31 + type.length * 7);
  const pre = HOUSE_PRESETS[type][v];
  const W = pre.W, D = pre.D, storeys = pre.storeys ?? 1;
  const m = new Model(`${type}_${v}`);
  const F = type === "minka-kura" ? 0.45 : 0.6;
  // stone footing course and floor
  m.box("stone_granite", W + 0.2, F, D + 0.2, 0, F / 2, 0);
  if (type === "minka-kura") {
    // storehouse: thick plaster walls, small doors, heavy gable roof with floating (okiyane) roof
    m.box("stone_moss", W + 0.4, 0.9, D + 0.4, 0, F + 0.45, 0);
    m.box("plaster_white", W, 4.2, D, 0, F + 0.9 + 2.1, 0);
    m.box("wood_dark", 1.4, 1.9, 0.12, -W / 4, F + 1.85, D / 2 + 0.02);
    for (const y of [F + 3.9]) m.box("wood_dark", 0.9, 0.7, 0.12, W / 4, y, D / 2 + 0.02);
    m.box("plaster_white", W + 0.3, 0.3, D + 0.3, 0, F + 5.15, 0);
    gableRoof(m, "roof_kawara", { W: W, over: 0.6, eaveY: F + 5.25, ridgeY: F + 7.2, frontRun: D / 2 + 0.7, backRun: D / 2 + 0.7, thick: 0.28 });
    return { m, W, D };
  }
  // posts and walls: lower board siding, upper plaster or clay, wood framing visible
  const bays = Math.round(W / 1.82);
  const bayW = W / bays;
  const wallH = type === "minka-kayabuki" ? 2.35 : 2.7;
  const upper = type === "minka-kayabuki" && v % 2 === 0 ? "plaster_clay" : "plaster_white";
  for (let i = 0; i <= bays; i++) for (const z of [-D / 2, D / 2]) m.box("wood_frame", 0.15, wallH, 0.15, -W / 2 + i * bayW, F + wallH / 2, z);
  for (const s of [-1, 1]) for (let i = 0; i <= 4; i++) m.box("wood_frame", 0.15, wallH, 0.15, s * W / 2, F + wallH / 2, -D / 2 + (D / 4) * i);
  // back and side walls
  m.box("wood_siding", W, 1.0, 0.1, 0, F + 0.5, -D / 2);
  m.box(upper, W, wallH - 1.0, 0.1, 0, F + 1.0 + (wallH - 1.0) / 2, -D / 2);
  for (const s of [-1, 1]) {
    m.box("wood_siding", 0.1, 1.0, D, s * W / 2, F + 0.5, 0);
    m.box(upper, 0.1, wallH - 1.0, D, s * W / 2, F + 1.0 + (wallH - 1.0) / 2, 0);
  }
  // nuki beams on walls
  for (const y of [F + 1.0, F + wallH - 0.05]) {
    m.box("wood_frame", W + 0.05, 0.13, 0.17, 0, y, -D / 2);
    for (const s of [-1, 1]) m.box("wood_frame", 0.17, 0.13, D + 0.05, s * W / 2, y, 0);
  }
  // small windows on side/back
  for (let i = 0; i < 2; i++) {
    const x = -W / 4 + i * (W / 2) + (r() - 0.5);
    m.box("wood_dark", 1.2, 0.75, 0.05, x, F + 1.65, -D / 2 - 0.06);
    for (let k = -2; k <= 2; k++) m.box("wood_old", 0.03, 0.75, 0.04, x + k * 0.24, F + 1.65, -D / 2 - 0.09);
  }
  // front: engawa + sliding doors (glass on kawara/totan houses, shoji/amado on kayabuki)
  const front = D / 2;
  m.box("wood_frame", W - 1.8, 0.08, 0.95, 0.9, F + 0.0, front + 0.47);
  for (let i = 0; i <= bays; i++) if (i > 0) m.box("wood_frame", 0.1, F, 0.1, -W / 2 + i * bayW, F / 2, front + 0.9);
  const glassy = type !== "minka-kayabuki";
  const doorStart = 1;
  for (let i = doorStart; i < bays; i++) {
    const cx = -W / 2 + (i + 0.5) * bayW;
    const open = r() < 0.25;
    if (glassy) {
      m.box(v % 2 === 1 && i === bays - 1 ? "interior_lit" : "interior_dark", bayW - 0.1, 1.8, 0.05, cx, F + 0.95, front - 0.25);
      m.box("glass", bayW - 0.1, 1.75, 0.02, cx, F + 0.95, front + 0.02);
      for (const dx of [-bayW / 2 + 0.05, 0, bayW / 2 - 0.05]) m.box("aluminium", 0.04, 1.8, 0.05, cx + dx, F + 0.95, front + 0.03);
      for (const y of [F + 0.07, F + 1.82, F + 0.9]) m.box("aluminium", bayW - 0.05, 0.04, 0.05, cx, y, front + 0.03);
    } else {
      if (open) m.box("interior_dark", bayW - 0.1, 1.8, 0.05, cx, F + 0.95, front - 0.6);
      else {
        m.box("paper", bayW - 0.15, 1.75, 0.02, cx, F + 0.95, front);
        for (let k = 1; k < 4; k++) m.box("wood_old", 0.025, 1.75, 0.03, cx - bayW / 2 + (bayW / 4) * k, F + 0.95, front + 0.02);
        for (let k = 1; k < 7; k++) m.box("wood_old", bayW - 0.15, 0.025, 0.03, cx, F + 0.08 + k * 0.25, front + 0.02);
      }
    }
  }
  // doma entrance (earthen floor) at the left bay with a wooden sliding door
  const doorTop = F + 1.85;
  m.box("interior_dark", bayW - 0.1, doorTop, 0.06, -W / 2 + bayW / 2, doorTop / 2, front - 0.3);
  m.box("wood_planks", bayW * 0.5, doorTop - 0.05, 0.06, -W / 2 + bayW * 0.3, doorTop / 2, front + 0.03);
  // transom walls (kokabe) between the door head and the eave beam, with a lintel (kamoi)
  m.box(upper, W - 0.05, F + wallH - doorTop, 0.1, 0, (doorTop + F + wallH) / 2, front - 0.02);
  m.box("wood_frame", W + 0.05, 0.12, 0.17, 0, doorTop + 0.04, front + 0.01);
  m.box("wood_frame", W + 0.1, 0.15, 0.19, 0, F + wallH, front);
  // roofs
  if (type === "minka-kayabuki") {
    const ret = hipRoof(m, "roof_thatch", { W, D, over: 1.15, eaveY: F + wallH + 0.15, ridgeY: F + wallH + 0.15 + (D / 2 + 1.15) * 1.25, sori: 0.0, thick: 0.75, gable: 0.82, uv: 0.7, ridgeMat: "roof_kawara_ridge", gableMat: "wood_old", ridgeH: 0.5, ridgeW: 0.8, sag: 0.05 });
    // ridge cover sticks (gushi)
    for (let k = -6; k <= 6; k++) m.box("wood_old", 0.08, 0.9, 0.08, k * (ret.xg / 6.5), F + wallH + 0.15 + (D / 2 + 1.15) * 1.25 + 0.25, 0, { rx: Math.PI / 2 });
  } else if (type === "minka-totan") {
    const tin = ["roof_tin", "roof_tin_blue", "roof_tin", "roof_tin_green"][v];
    hipRoof(m, tin, { W, D, over: 0.9, eaveY: F + wallH + 0.1, ridgeY: F + wallH + 0.1 + (D / 2 + 0.9) * 1.05, sori: 0, thick: 0.12, gable: 0.78, uv: 1, ridgeMat: tin, gableMat: "wood_siding", ridgeH: 0.2, sag: 0.02 });
  } else if (storeys === 2) {
    // 1970s-80s rebuilt farmhouse: lower hisashi roof all round, upper storey rising through it
    hipRoof(m, "roof_kawara", { W, D, over: 0.9, eaveY: F + wallH + 0.15, ridgeY: F + wallH + 0.15 + (D / 2 + 0.9) * 0.42, sori: 0.08, thick: 0.2, gable: 1, ridgeMat: "roof_kawara", ridgeH: 0.2 });
    const W2 = W * 0.66, D2 = D * 0.74, y2 = F + wallH, h2 = 2.75;
    m.box("plaster_white", W2, h2, D2, 0, y2 + h2 / 2, -D * 0.04);
    for (let i = 0; i <= 3; i++) for (const zs of [-1, 1]) m.box("wood_frame", 0.13, h2, 0.13, -W2 / 2 + (W2 / 3) * i, y2 + h2 / 2, -D * 0.04 + zs * D2 / 2);
    m.box("wood_frame", W2 + 0.05, 0.12, D2 + 0.05, 0, y2 + h2 - 0.06, -D * 0.04);
    // upper windows: aluminium sashes with a dark interior, rain shutters (amado) boxes on two
    for (let i = 0; i < 3; i++) {
      const cx = -W2 / 2 + (W2 / 3) * (i + 0.5), fz = -D * 0.04 + D2 / 2;
      m.box("interior_dark", W2 / 3 - 0.35, 1.1, 0.05, cx, y2 + 1.55, fz - 0.06);
      m.box("glass", W2 / 3 - 0.35, 1.1, 0.02, cx, y2 + 1.55, fz + 0.02);
      for (const dx of [-(W2 / 3 - 0.35) / 2, 0, (W2 / 3 - 0.35) / 2]) m.box("aluminium", 0.04, 1.14, 0.05, cx + dx, y2 + 1.55, fz + 0.03);
      for (const dy of [-0.55, 0.55]) m.box("aluminium", W2 / 3 - 0.3, 0.04, 0.05, cx, y2 + 1.55 + dy, fz + 0.03);
      if (i !== 1) m.box("wood_siding", 0.32, 1.25, 0.18, cx + (W2 / 3 - 0.35) / 2 + 0.2, y2 + 1.55, fz + 0.08);
    }
    hipRoof(m, "roof_kawara", { W: W2, D: D2, over: 0.75, eaveY: y2 + h2 + 0.1, ridgeY: y2 + h2 + 0.1 + (D2 / 2 + 0.75) * 0.6, sori: 0.12, thick: 0.2, gable: r() < 0.5 ? 0.6 : 1, ridgeMat: "roof_kawara_ridge", gableMat: "plaster_white", ridgeH: 0.42 });
  } else {
    hipRoof(m, "roof_kawara", { W, D, over: 1.0, eaveY: F + wallH + 0.15, ridgeY: F + wallH + 0.15 + (D / 2 + 1.0) * 0.62, sori: 0.15, thick: 0.22, gable: r() < 0.5 ? 0.6 : 1, ridgeMat: "roof_kawara_ridge", gableMat: "plaster_white", ridgeH: 0.45 });
  }
  // magariya: L-shaped wing (former stable / barn) projecting forward at one end
  if (pre.wing) {
    const [wx, wz, ww, wd] = pre.wing;
    const wh = 2.3, z0 = wz - wd / 2;
    m.box("stone_granite", ww + 0.2, F, wd + 0.2, wx, F / 2, wz);
    for (const sx of [-1, 1]) {
      m.box("wood_siding", 0.1, 1.1, wd, wx + sx * ww / 2, F + 0.55, wz);
      m.box(type === "minka-kayabuki" ? "plaster_clay" : "plaster_white", 0.1, wh - 1.1, wd, wx + sx * ww / 2, F + 1.1 + (wh - 1.1) / 2, wz);
    }
    m.box("wood_siding", ww, wh, 0.1, wx, F + wh / 2, z0 + wd);
    for (const sx of [-1, 0, 1]) for (const zz of [z0, z0 + wd]) m.box("wood_frame", 0.15, wh, 0.15, wx + sx * ww / 2, F + wh / 2, zz);
    // big stable doorway with a slatted window above
    m.box("interior_dark", 1.8, 1.9, 0.06, wx + (wx > 0 ? -ww / 2 : ww / 2) * 0.98, F + 0.95, wz + 0.6, { ry: Math.PI / 2 });
    for (let k = 0; k < 7; k++) m.box("wood_frame", 0.04, 0.45, 0.05, wx - 0.9 + k * 0.3, F + 1.8, z0 + wd + 0.06);
    const wr = new Model("wing-roof");
    const roofMat = type === "minka-kayabuki" ? "roof_thatch" : "roof_tin_blue";
    gableRoof(wr, roofMat, { W: wd + 0.9, over: 0.0, eaveY: F + wh + 0.1, ridgeY: F + wh + 0.1 + (ww / 2 + 0.9) * (type === "minka-kayabuki" ? 1.1 : 0.7), frontRun: ww / 2 + 0.9, backRun: ww / 2 + 0.9, thick: type === "minka-kayabuki" ? 0.6 : 0.1, uv: 0.7 });
    m.merge(wr, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(wx, 0, wz + 0.45));
  }
  // rain gutters + downpipes on tiled/tin roofs (kayabuki has none)
  if (type !== "minka-kayabuki") {
    const over = type === "minka-totan" ? 0.9 : 1.0;
    const eY = F + wallH + 0.1;
    for (const zs of [1, -1]) {
      const g = new THREE.CylinderGeometry(0.06, 0.06, W + over * 2, 8, 1, true, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI);
      g.translate(0, eY - 0.06, zs * (D / 2 + over + 0.02));
      m.add("metal_grey", g);
      m.cyl("metal_grey", 0.035, 0.035, eY - 0.06, (W / 2 + over - 0.3) * (zs > 0 ? 1 : -1), 0, zs * (D / 2 + over * 0.15), 6);
    }
  }
  // 1990s TV antenna (Yagi) on a mast at the ridge end
  if (r() < 0.8) {
    const ridgeY = storeys === 2 ? F + wallH + 2.85 + (D * 0.74 / 2 + 0.75) * 0.6 : type === "minka-kayabuki" ? F + wallH + 0.15 + (D / 2 + 1.15) * 1.25 : type === "minka-totan" ? F + wallH + 0.1 + (D / 2 + 0.9) * 1.05 : F + wallH + 0.15 + (D / 2 + 1.0) * 0.62;
    const ax = (r() < 0.5 ? -1 : 1) * ((storeys === 2 ? W * 0.33 : W / 2) - 1.6);
    const mastH = 3.2 + r() * 1.5;
    const yaw = r() * Math.PI;
    m.cyl("metal_grey", 0.025, 0.025, mastH, ax, ridgeY - 1.2, 0, 6);
    for (const k of [0, 1]) {
      const by = ridgeY - 1.2 + mastH - 0.25 - k * 0.9;
      m.box("metal_grey", 1.7 - k * 0.4, 0.025, 0.025, ax, by, 0, { ry: yaw });
      for (let e = 0; e < 7 - k * 2; e++) {
        const t = -0.75 + e * 0.24;
        m.box("metal_grey", 0.018, 0.018, 0.55 - e * 0.04, ax + Math.cos(yaw) * t, by, -Math.sin(yaw) * t, { ry: yaw });
      }
    }
    // guy wires
    for (const a of [0.6, 2.7, 4.8]) {
      const len = Math.hypot(1.8, mastH - 0.6);
      const g = new THREE.CylinderGeometry(0.006, 0.006, len, 3);
      g.translate(0, len / 2, 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), Math.atan2(1.8, mastH - 0.6)));
      g.translate(ax + Math.cos(a) * 1.8, ridgeY - 1.2 + 0.6, Math.sin(a) * 1.8 * 0.6);
      m.add("metal_dark", g);
    }
  }
  // lean-to (geya) on the side for some houses
  let lean = 0;
  if (r() < 0.6) {
    const s = r() < 0.5 ? -1 : 1;
    lean = s;
    m.box("wood_siding", 2.4, 2.1, D * 0.6, s * (W / 2 + 1.2), F + 1.05 - 0.3, -D * 0.1);
    const g = new Model("geya");
    gableRoof(g, "roof_tin", { W: D * 0.6, over: 0.2, eaveY: 2.1, ridgeY: 2.6, frontRun: 2.6, backRun: 0.01, thick: 0.06 });
    m.merge(g, new THREE.Matrix4().makeRotationY(s * Math.PI / 2).setPosition(s * W / 2, F - 0.3, -D * 0.1));
  }
  // LP gas: two grey 50 kg cylinders chained to the wall on a concrete slab, with the regulator and
  // the copper pipe into the kitchen, on the side without the lean-to; in Tohoku also the kerosene
  // home tank (490 L, on legs) that feeds the bath boiler and the winter stoves
  {
    const s = lean ? -lean : r() < 0.5 ? -1 : 1, gx = s * (W / 2 + 0.42), gz = -D / 2 + 1.1;
    m.box("concrete_old", 0.6, 0.08, 1.05, gx, 0.04, gz);
    for (const dz of [-0.24, 0.24]) {
      m.cyl("lpg_grey", 0.18, 0.18, 1.02, gx, 0.08, gz + dz, 14);
      m.cyl("lpg_grey", 0.18, 0.12, 0.1, gx, 1.1, gz + dz, 14);
      m.cyl("metal_dark", 0.1, 0.1, 0.16, gx, 1.2, gz + dz, 10, { open: true });
    }
    m.box("metal_dark", 0.04, 0.04, 0.62, gx - s * 0.2, 0.9, gz);                 // chain
    m.box("brass", 0.1, 0.14, 0.08, gx - s * 0.16, 1.45, gz);                     // regulator
    m.cyl("brass", 0.012, 0.012, 1.05, gx - s * 0.28, 0.4, gz, 4);
    if (type !== "minka-kayabuki" || r() < 0.5) {
      const tz = gz + 1.9;
      for (const lx of [-0.22, 0.22]) for (const lz of [-0.6, 0.6]) m.box("metal_dark", 0.05, 0.42, 0.05, s * (W / 2 + 0.5) + lx, 0.21, tz + lz);
      m.box("tank_cream", 0.62, 0.95, 1.35, s * (W / 2 + 0.5), 0.42 + 0.48, tz);
      m.cyl("metal_dark", 0.06, 0.06, 0.08, s * (W / 2 + 0.5), 1.37, tz - 0.4, 8);
      m.cyl("metal_grey", 0.015, 0.015, 0.9, s * (W / 2 + 0.24), 0.05, tz - 0.6, 4);
    }
  }
  m.box("stone_granite", 0.8, 0.25, 0.5, -W / 2 + bayW / 2, 0.125, front + 0.5);
  // where evening smoke rises: the bath-stove chimney at the back (a galvanised pipe with a rain
  // cap) on tiled and tin houses, the smoke vent (kemudashi) at the ridge of a thatched house
  let smoke;
  if (type === "minka-kayabuki") {
    smoke = [0, F + wallH + 0.15 + (D / 2 + 1.15) * 1.25 + 0.2, 0];
  } else {
    const cx = W / 2 - 1.1, cz = -D / 2 - 0.45;
    const top = F + wallH + (storeys === 2 ? 3.9 : 1.9);
    m.cyl("metal_grey", 0.075, 0.075, top, cx, 0.2, cz, 10);
    m.cyl("metal_grey", 0.24, 0.02, 0.16, cx, top + 0.22, cz, 10);
    for (const y of [F + 1.2, F + wallH - 0.2]) m.box("metal_dark", 0.04, 0.04, 0.42, cx, y, cz + 0.22);
    smoke = [cx, top + 0.3, cz];
  }
  return { m, W, D, smoke };
}
function naya(v) {
  const r = rng(500 + v);
  const m = new Model(`naya_${v}`);
  const W = 5.6, D = 4.4;
  m.box("concrete", W, 0.15, D, 0, 0.075, 0);
  for (const x of [-W / 2, 0, W / 2]) for (const z of [-D / 2, D / 2]) m.box("wood_old", 0.12, 2.6, 0.12, x, 1.3, z);
  m.box("wood_siding", W, 2.5, 0.06, 0, 1.25, -D / 2);
  for (const s of [-1, 1]) m.box("wood_siding", 0.06, 2.5, D, s * W / 2, 1.25, 0);
  m.box("wood_siding", W / 2, 2.5, 0.06, -W / 4, 1.25, D / 2);
  gableRoof(m, "roof_tin", { W, over: 0.35, eaveY: 2.6, ridgeY: 3.5, frontRun: D / 2 + 0.4, backRun: D / 2 + 0.4, thick: 0.06 });
  // stacked firewood / straw bundles in the open bay
  for (let k = 0; k < 10; k++) m.cyl("wood_light", 0.08, 0.08, 1.0, W / 4 + (r() - 0.5) * 1.4, 0.15 + Math.floor(k / 5) * 0.17, D / 2 - 0.8 + (k % 5) * 0.17, 7, { rx: Math.PI / 2 });
  return m;
}
function blockWall() {
  const m = new Model("block-wall");
  m.box("concrete_block", 2.0, 1.2, 0.15, 0, 0.6, 0);
  m.box("concrete", 2.02, 0.06, 0.2, 0, 1.23, 0);
  return m;
}
function ishigaki() {
  const m = new Model("ishigaki");
  const g = new THREE.BoxGeometry(2.0, 1, 0.8, 4, 4, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) - (p.getY(i) + 0.5) * 0.18);
  g.computeVertexNormals();
  g.translate(0, -0.5, -0.4);
  m.add("ishigaki", g);
  return m;
}
function denchu(withTransformer) {
  const m = new Model(withTransformer ? "denchu-trans" : "denchu");
  m.cyl("concrete_pole", 0.17, 0.1, 10.5, 0, -0.5, 0, 12);
  m.box("metal_dark", 1.8, 0.09, 0.09, 0, 9.4, 0);
  for (const x of [-0.75, 0, 0.75]) m.cyl("porcelain", 0.05, 0.035, 0.14, x, 9.45, 0, 8);
  m.box("metal_dark", 1.1, 0.07, 0.07, 0, 8.6, 0);
  for (let k = 0; k < 10; k++) m.box("metal_dark", 0.25, 0.025, 0.025, (k % 2 ? 1 : -1) * 0.14, 2.2 + k * 0.45, 0, { ry: Math.PI / 2 * (k % 2) });
  if (withTransformer) {
    m.cyl("metal_grey", 0.24, 0.24, 0.7, 0.32, 7.2, 0, 12);
    m.box("metal_dark", 0.5, 0.08, 0.08, 0.2, 7.95, 0);
  } else {
    // 1990s rural street lamp: bent arm with a fluorescent tube under a steel hood
    m.box("metal_grey", 1.5, 0.05, 0.05, 0.85, 6.6, 0, { rz: -0.12 });
    m.box("metal_grey", 0.62, 0.08, 0.2, 1.62, 6.52, 0);
    m.box("lamp_bulb", 0.5, 0.03, 0.12, 1.62, 6.47, 0);
  }
  return m;
}
function busStop() {
  const m = new Model("bus-stop");
  m.cyl("metal_grey", 0.04, 0.04, 2.3, 0, 0, 0, 8);
  const sign = new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24);
  sign.rotateX(Math.PI / 2);
  sign.translate(0, 2.2, 0);
  m.add("sign_blue", sign);
  m.box("concrete", 0.6, 0.12, 0.6, 0, 0.06, 0);
  m.box("wood_old", 1.6, 0.05, 0.35, 1.3, 0.45, 0);
  for (const x of [0.65, 1.95]) m.box("wood_old", 0.06, 0.45, 0.3, x, 0.22, 0);
  return m;
}
function jihanki(v) {
  // drinks vending machine (generic): painted steel cabinet, lit display of cans, dispenser slot
  const m = new Model(`jihanki_${v}`);
  const body = v === 0 ? "car_paint" : "vend_red";
  m.box(body, 1.02, 1.83, 0.72, 0, 0.915, 0);
  m.box("vend_lit", 0.9, 0.92, 0.02, 0, 1.28, 0.365);
  const cans = ["cloth_red", "sign_blue", "brass", "car_paint", "bamboo_green", "sign_blue", "cloth_red", "metal_grey"];
  for (let row = 0; row < 3; row++)
    for (let k = 0; k < 8; k++) {
      m.cyl(cans[(k + row * 3 + v) % cans.length], 0.032, 0.032, 0.12, -0.39 + k * 0.111, 0.92 + row * 0.3, 0.385, 8);
      m.box("vend_lit", 0.06, 0.025, 0.012, -0.39 + k * 0.111, 0.89 + row * 0.3, 0.392);
    }
  m.box("glass", 0.92, 0.94, 0.01, 0, 1.28, 0.4);
  m.box("interior_dark", 0.62, 0.2, 0.04, 0, 0.32, 0.37);          // dispenser opening
  m.box("metal_dark", 0.12, 0.3, 0.03, 0.36, 0.72, 0.375);          // coin / bill panel
  m.box(body, 1.06, 0.06, 0.76, 0, 1.86, 0);
  return m;
}
/** Farm-road bridge: concrete slab on a mid-stream pier, low parapets, end posts with name plates.
 *  Local frame: span along X, deck top at y = 0.4 (the object sits 0.4 m below the deck). */
function bridge(span, width, skew) {
  const m = new Model("bridge");
  const top = 0.4;
  m.box("concrete", span, 0.5, width, 0, top - 0.25, 0);
  m.box("concrete_dark", span, 0.03, width - 0.5, 0, top + 0.012, 0);           // worn wheel tracks / grime
  for (const s of [-1, 1]) {
    const zc = s * (width / 2 - 0.1);
    m.box("concrete", span - 0.8, 0.6, 0.2, 0, top + 0.3, zc);                  // parapet
    m.box("concrete_cap", span - 0.8, 0.07, 0.26, 0, top + 0.635, zc);
    for (let x = -span / 2 + 1.5; x < span / 2 - 1.2; x += 1.6) m.box("concrete_dark", 0.3, 0.06, 0.21, x, top + 0.03, zc);   // drain slots
    for (const x of [-span / 2 + 0.2, span / 2 - 0.2]) {
      m.box("concrete", 0.38, 1.0, 0.38, x, top + 0.5, s * (width / 2 - 0.16));  // end post (oyabashira)
      m.box("concrete_cap", 0.44, 0.08, 0.44, x, top + 1.04, s * (width / 2 - 0.16));
      m.box("metal_dark", 0.02, 0.26, 0.3, x - Math.sign(x) * 0.2, top + 0.66, s * (width / 2 - 0.16));  // name plate
    }
  }
  // pier: a wall along the stream (skewed to the deck), down into the bed
  const ph = 3.2;
  m.box("concrete_old", 0.6, ph, 2.8, 0, top - 0.5 - ph / 2, 0, { ry: skew });
  for (const s of [-1, 1]) m.cyl("concrete_old", 0.3, 0.3, ph, Math.sin(skew) * s * 1.4, top - 0.5 - ph, Math.cos(skew) * s * 1.4, 14);
  return m;
}

/** Short road bridge over a brook (local: +Z along the road, X across it; origin under the deck,
 *  deck top at y = 0.5, level with the road): slab, low concrete parapets, end posts with plates. */
function roadBridge(span, width) {
  const m = new Model("road-bridge");
  const L = span + 0.6, top = 0.5;
  m.box("concrete", width, top, L, 0, top / 2, 0);
  m.box("concrete_dark", 6.0, 0.02, L, 0, top + 0.005, 0);                       // carriageway (asphalt over the slab)
  for (const zz of [-1, 1]) m.box("road_paint", 0.15, 0.022, L, zz * 2.85, top + 0.006, 0);   // edge lines
  for (const s of [-1, 1]) {
    const x = s * (width / 2 - 0.12);
    m.box("concrete", 0.24, 0.62, L - 0.5, x, top + 0.31, 0);                     // parapet
    m.box("concrete_cap", 0.3, 0.06, L - 0.5, x, top + 0.65, 0);
    for (const zz of [-1, 1]) {
      m.box("concrete", 0.42, 0.95, 0.42, x, top + 0.475, zz * (L / 2 - 0.21));   // end post (oyabashira)
      m.box("concrete_cap", 0.48, 0.07, 0.48, x, top + 0.985, zz * (L / 2 - 0.21));
      m.box("metal_dark", 0.02, 0.24, 0.3, x - s * 0.22, top + 0.62, zz * (L / 2 - 0.21));   // name plate
    }
  }
  // fascia under the deck edges
  for (const s of [-1, 1]) m.box("concrete_old", 0.12, 0.35, L, s * (width / 2 + 0.04), top - 0.3, 0);
  return m;
}

// ---------------------------------------------------------------- stairs and precinct stonework (world coordinates)
function stairs() {
  const st = scene.stair, r = rng(200);
  const m = new Model("stairs");
  const curb = new Model("curbs");
  for (const s of scene.steps) {
    const f = Math.floor((s.index - 1) / st.flight), k = (s.index - 1) % st.flight;
    const top = s.y;
    const isLast = k === st.flight - 1 && f < 3;
    const depth = isLast ? st.tread : st.tread;
    // each tread is 2-3 granite blocks with slightly different heights and wear
    const nb = r() < 0.6 ? 3 : 2;
    let z0 = st.z - st.width / 2;
    for (let b = 0; b < nb; b++) {
      const w = b === nb - 1 ? st.z + st.width / 2 - z0 : (st.width / nb) * (0.8 + r() * 0.4);
      const dh = (r() - 0.5) * 0.018;
      const g = new THREE.BoxGeometry(depth + 0.04, st.rise + 0.12, w - 0.012, 3, 1, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), zz = p.getZ(i);
        if (y > 0) {
          // worn: centre of the walkway lower, front edge rounded
          const zc = z0 + w / 2 + zz - st.z;
          const wear = 0.018 * Math.exp(-(zc * zc) / 1.2) * (x > 0 ? 1.0 : 0.5);
          y -= wear + (x > depth / 2 - 0.01 ? 0.0 : 0) + (x < -depth / 2 + 0.03 ? 0.012 : 0);
        }
        p.setXYZ(i, x, y, zz);
      }
      g.computeVertexNormals();
      // nosing faces -X (downhill); block sits between front edge x and x+depth
      g.translate(s.x + depth / 2 - 0.02, top - (st.rise + 0.12) / 2 + dh, z0 + w / 2);
      const edge = b === 0 || b === nb - 1;
      const pick = r();
      m.add(edge && pick < 0.4 ? "stone_paving_moss" : pick < 0.72 ? "stone_step" : "stone_step_b", g, { uvScale: 1 });
      z0 += w;
    }
    // side curbs (stepped stones along both edges)
    for (const side of [-1, 1]) curb.box(r() < 0.6 ? "stone_paving_moss" : "stone_step_b", depth + 0.02, 0.45, 0.32, s.x + depth / 2, top + 0.08 + (r() - 0.5) * 0.04, st.z + side * (st.width / 2 + 0.16));
  }
  // landings and forecourt paving (ishidatami)
  const per = st.flight * st.tread + st.landing;
  const pave = (x0, x1, y, z0, z1) => {
    let x = x0;
    while (x < x1 - 0.05) {
      const len = Math.min(x1 - x, 0.55 + r() * 0.5);
      let z = z0;
      while (z < z1 - 0.05) {
        const wid = Math.min(z1 - z, 0.6 + r() * 0.7);
        m.box(r() < 0.25 ? "stone_paving_moss" : "stone_step", len - 0.02, 0.24, wid - 0.02, x + len / 2, y - 0.08 + (r() - 0.5) * 0.012, z + wid / 2);
        z += wid;
      }
      x += len;
    }
  };
  for (let f = 0; f < 3; f++) {
    const x0 = st.x0 + f * per + st.flight * st.tread;
    pave(x0, x0 + st.landing, st.footY + (f + 1) * st.flight * st.rise, st.z - st.width / 2, st.z + st.width / 2);
    for (const side of [-1, 1]) curb.box("stone_paving_moss", st.landing, 0.45, 0.32, x0 + st.landing / 2, st.footY + (f + 1) * st.flight * st.rise + 0.1, st.z + side * (st.width / 2 + 0.16));
  }
  pave(96, st.x0, st.footY, st.z - 2.4, st.z + 2.4);                     // forecourt
  pave(st.x1, 244.0, st.topY, st.z - 1.3, st.z + 1.3);                    // sando to the haiden
  m.merge(curb, new THREE.Matrix4());
  // ishigaki retaining wall at the precinct's south-west rim
  const p = scene.precinct;
  const wall = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / 2);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const g = new THREE.BoxGeometry(len / n + 0.02, 4.6, 0.9, 3, 4, 1);
      const pp = g.attributes.position;
      for (let k = 0; k < pp.count; k++) if (pp.getZ(k) > 0) pp.setZ(k, pp.getZ(k) - (2.3 - pp.getY(k)) * 0.16);
      g.computeVertexNormals();
      g.rotateY(-Math.atan2(bz - az, bx - ax));
      g.translate(x, p.y - 2.75, z);
      m.add("ishigaki", g, { uvScale: 0.6 });
    }
  };
  wall(p.x0 - 0.2, -34, p.x0 - 0.2, p.z1 + 0.2);
  wall(p.x0 - 0.2, p.z1 + 0.2, p.x0 + 32, p.z1 + 0.2);
  return m;
}

// ---------------------------------------------------------------- road side ditches (world coordinates)
function ditches() {
  const m = new Model("road-ditch");
  const pts = scene.roads[0].points, dd = scene.ditch;
  const r = rng(77);
  // in the centre the ditch runs under concrete lids along its whole length (shop fronts, parking)
  const machi = (scene.hamlets ?? []).find((hm) => hm.name === "machi");
  const lidded = (z) => machi && Math.abs(z - machi.z) < machi.halfLength + 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    if (az < dd.zRange[0] || bz > dd.zRange[1]) continue;
    const len = Math.hypot(bx - ax, bz - az), dirx = (bx - ax) / len, dirz = (bz - az) / len;
    const nx = -dirz, nz = dirx, yaw = Math.atan2(dirx, dirz);
    for (const side of [-1, 1]) {
      const cx = (ax + bx) / 2 + nx * side * dd.offset, cz = (az + bz) / 2 + nz * side * dd.offset;
      // rim flush with the level shoulder (the terrain shader opens the ground over the channel)
      const y = (ay + by) / 2 + 0.006;
      const L = len + 0.03, w = dd.width, wall = 0.1, dep = dd.depth;
      // two walls, floor (inner faces stained), and a concrete lid on some segments
      for (const ws of [-1, 1]) m.box("concrete_old", L, dep + 0.35, wall, cx + nx * ws * (w / 2 + wall / 2), y - (dep + 0.35) / 2, cz + nz * ws * (w / 2 + wall / 2), { ry: yaw + Math.PI / 2 });
      m.box("concrete_dark", L, 0.06, w, cx, y - dep, cz, { ry: yaw + Math.PI / 2 });
      const crossing = (dd.crossings ?? []).some((zc) => Math.abs(cz - zc) < 2.6);   // farm road over the ditch
      if (crossing || lidded(cz) || r() < 0.22) m.box(lidded(cz) ? "concrete" : "concrete_old", L * 0.985 + (crossing ? 0.04 : 0), crossing ? 0.12 : 0.08, w + 0.22, cx, y + (crossing ? 0.06 : 0.04), cz, { ry: yaw + Math.PI / 2 });
    }
  }
  return m;
}

// ---------------------------------------------------------------- village landmarks
/** Thin box from a to b (a steel angle or rod). */
function strut(m, mat, a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.BoxGeometry(t, L, t);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  m.add(mat, g, { matrix: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)) });
}
/** Hinomi-yagura: a 12 m steel fire lookout with its alarm bell (hansho) and the PA horns of the
 *  village radio (bosai-musen). Local +Z is the ladder side. */
function hinomi() {
  const m = new Model("hinomi");
  const H = 9.0, b0 = 1.5, b1 = 0.6, half = (y) => b0 + (b1 - b0) * (y / H);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) {
    strut(m, "steel_red", V(sx * b0, 0, sz * b0), V(sx * b1, H, sz * b1), 0.11);
    m.box("concrete_old", 0.5, 0.35, 0.5, sx * b0, 0.12, sz * b0);
  }
  const levels = [0.3, 2.1, 3.9, 5.6, 7.3, H];
  for (let li = 0; li < levels.length; li++) {
    const y = levels[li], hw = half(y);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      strut(m, "steel_red", V(ax * hw, y, az * hw), V(bx * hw, y, bz * hw), 0.07);
      if (li < levels.length - 1) {
        const y2 = levels[li + 1], hw2 = half(y2);
        strut(m, "steel_red", V(ax * hw, y, az * hw), V(bx * hw2, y2, bz * hw2), 0.035);
        strut(m, "steel_red", V(bx * hw, y, bz * hw), V(ax * hw2, y2, az * hw2), 0.035);
      }
    }
  }
  // platform with a railing, posts carrying the little roof
  m.box("wood_old", 2.0, 0.06, 2.0, 0, H + 0.03, 0);
  for (const [sx, sz] of corners) {
    m.cyl("steel_red", 0.03, 0.03, 0.95, sx * 0.98, H, sz * 0.98, 6);
    strut(m, "steel_red", V(sx * 0.98, H + 0.9, sz * 0.98), V(sx * 0.55, H + 1.75, sz * 0.55), 0.05);
  }
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
    for (const y of [H + 0.5, H + 0.95]) strut(m, "steel_red", V(ax * 0.98, y, az * 0.98), V(bx * 0.98, y, bz * 0.98), 0.035);
  }
  const roof = new THREE.ConeGeometry(1.25, 1.1, 4, 1, true);
  roof.rotateY(Math.PI / 4);
  m.add("steel_red", roof, { matrix: new THREE.Matrix4().makeTranslation(0, H + 2.3, 0) });
  m.cyl("steel_red", 0.02, 0.02, 0.9, 0, H + 2.85, 0, 6);
  // the bell
  m.add("bronze_dark", lathe([[0.001, 0.0], [0.17, 0.0], [0.15, 0.08], [0.12, 0.3], [0.1, 0.38], [0.04, 0.42], [0.001, 0.43]], 16), { uv: "box", matrix: new THREE.Matrix4().makeTranslation(0, H + 1.15, 0) });
  m.cyl("metal_dark", 0.012, 0.012, 0.18, 0, H + 1.58, 0, 4);
  // PA horn speakers pointing over the valley
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const g = new THREE.CylinderGeometry(0.24, 0.05, 0.55, 14, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.42);
    g.rotateY(a + 0.5);
    m.add("metal_grey", g, { uv: "box", matrix: new THREE.Matrix4().makeTranslation(0, H + 1.95, 0) });
  }
  // ladder on the +Z face
  for (const x of [-0.22, 0.22]) strut(m, "steel_red", V(x, 0, b0 + 0.12), V(x, H, b1 + 0.12), 0.04);
  for (let y = 0.35; y < H; y += 0.32) { const z = half(y) + 0.12; strut(m, "steel_red", V(-0.22, y, z), V(0.22, y, z), 0.025); }
  return m;
}
/** Fire brigade equipment shed: block walls, tin roof, a red shutter facing +Z. */
function shoboShed() {
  const m = new Model("shobo-shed");
  const W = 4.4, D = 3.4, Hw = 2.7;
  m.box("concrete", W + 0.2, 0.15, D + 0.2, 0, 0.075, 0);
  m.box("concrete_block", W, Hw, 0.15, 0, Hw / 2, -D / 2);
  for (const sx of [-1, 1]) m.box("concrete_block", 0.15, Hw, D, sx * W / 2, Hw / 2, 0);
  m.box("concrete_block", 0.6, Hw, 0.15, -W / 2 + 0.3, Hw / 2, D / 2);
  m.box("concrete_block", 0.6, Hw, 0.15, W / 2 - 0.3, Hw / 2, D / 2);
  m.box("steel_red", W - 1.2, 2.3, 0.08, 0, 1.15, D / 2 + 0.02);
  for (let y = 0.15; y < 2.3; y += 0.12) m.box("steel_gate", W - 1.22, 0.012, 0.012, 0, y, D / 2 + 0.07);
  m.box("concrete", W - 1.0, 0.42, 0.06, 0, Hw - 0.15, D / 2 + 0.04);
  m.box("porcelain", 1.2, 0.22, 0.02, 0, Hw - 0.15, D / 2 + 0.08);
  gableRoof(m, "roof_tin", { W: W + 0.3, over: 0.25, eaveY: Hw, ridgeY: Hw + 0.6, frontRun: D / 2 + 0.35, backRun: D / 2 + 0.35, thick: 0.06 });
  return m;
}
/** Pillar post box (marugata posuto), a red cylinder with a domed cap; slot facing +Z. */
function postBox() {
  const m = new Model("post");
  m.cyl("concrete", 0.3, 0.3, 0.12, 0, 0, 0, 16);
  m.cyl("post_red", 0.2, 0.2, 1.0, 0, 0.12, 0, 20);
  m.cyl("post_red", 0.235, 0.235, 0.06, 0, 1.1, 0, 20);
  const dome = new THREE.SphereGeometry(0.23, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.55, 1);
  m.add("post_red", dome, { uv: "box", matrix: new THREE.Matrix4().makeTranslation(0, 1.16, 0) });
  m.box("interior_dark", 0.2, 0.035, 0.03, 0, 0.98, 0.2);
  m.box("post_red", 0.24, 0.025, 0.05, 0, 1.005, 0.205);
  m.box("porcelain", 0.16, 0.12, 0.01, 0, 0.72, 0.2);
  return m;
}

// ---------------------------------------------------------------- village centre: shops and public buildings
// Local frame for all of them: front (+Z) on the road, frontage along X. `signs` are the anchors
// [x, y, z, w, h, vertical] where the runtime draws the sign texts (index.json, "signs").
const SIGN_ANCHORS = {};
/** Shop-house (machiya-style, hirairi): shopfront, tin awning, sign board, living floor above. */
function shopHouse(name, { W, D, storeys = 2, roof = "roof_kawara", front = "glass", lit = true, upper = "plaster_white", extras }) {
  const m = new Model(name);
  const F = 0.25, H1 = 3.0, H2 = storeys === 2 ? 2.6 : 0;
  m.box("concrete", W + 0.2, F, D + 0.2, 0, F / 2, 0);
  // side and back walls: board siding below, plaster or mortar above
  for (const s of [-1, 1]) {
    m.box("wood_siding", 0.12, 1.1, D, s * W / 2, F + 0.55, 0);
    m.box(upper, 0.12, H1 + H2 - 1.1, D, s * W / 2, F + 1.1 + (H1 + H2 - 1.1) / 2, 0);
  }
  m.box("wood_siding", W, 1.1, 0.12, 0, F + 0.55, -D / 2);
  m.box(upper, W, H1 + H2 - 1.1, 0.12, 0, F + 1.1 + (H1 + H2 - 1.1) / 2, -D / 2);
  // shopfront
  const fz = D / 2;
  for (const s of [-1, 1]) m.box("wood_frame", 0.18, H1, 0.2, s * (W / 2 - 0.09), F + H1 / 2, fz);
  m.box("wood_frame", W, 0.22, 0.22, 0, F + H1 - 0.11, fz);
  const bays = Math.max(2, Math.round((W - 0.4) / 1.8)), bw = (W - 0.4) / bays;
  for (let i = 0; i < bays; i++) {
    const cx = -W / 2 + 0.2 + (i + 0.5) * bw;
    if (front === "shutter" || (front === "mixed" && i === bays - 1)) {
      m.box("steel_gate", bw - 0.04, 2.3, 0.05, cx, F + 1.15, fz - 0.05);
      for (let y = F + 0.1; y < F + 2.3; y += 0.1) m.box("metal_grey", bw - 0.05, 0.012, 0.012, cx, y, fz - 0.02);
    } else {
      m.box(lit ? "interior_shop" : "interior_dark", bw - 0.08, 2.2, 0.05, cx, F + 1.15, fz - 1.4);
      // shelves of goods seen through the glass
      m.box("wood_dark", bw - 0.2, 1.7, 0.04, cx, F + 0.85, fz - 1.15);
      for (let k = 0; k < 3; k++) {
        m.box("wood_old", bw - 0.2, 0.03, 0.32, cx, F + 0.35 + k * 0.5, fz - 1.0);
        for (let j = 0; j < 5; j++) {
          const gw = 0.12 + ((i * 7 + j * 3 + k) % 4) * 0.04;
          m.box(["vend_red", "sign_blue", "porcelain", "wood_light", "phone_green"][(i + j * 2 + k) % 5], gw, 0.18 + ((j + k) % 3) * 0.06, 0.2, cx - (bw - 0.5) / 2 + j * (bw - 0.5) / 4, F + 0.47 + k * 0.5, fz - 1.0);
        }
      }
      m.box("glass", bw - 0.08, 2.15, 0.02, cx, F + 1.12, fz - 0.03);
      for (const dx of [-bw / 2 + 0.03, bw / 2 - 0.03]) m.box("aluminium", 0.05, 2.25, 0.06, cx + dx, F + 1.12, fz - 0.02);
      for (const y of [F + 0.05, F + 2.22, F + 0.95]) m.box("aluminium", bw - 0.04, 0.05, 0.06, cx, y, fz - 0.02);
    }
  }
  // tin awning on brackets, the sign board above it
  const aw = new Model("awning");
  gableRoof(aw, "roof_tin", { W: W + 0.2, over: 0.0, eaveY: F + H1 - 0.35, ridgeY: F + H1 - 0.12, frontRun: 1.15, backRun: 0.01, thick: 0.04 });
  m.merge(aw, new THREE.Matrix4().makeTranslation(0, 0, fz));
  for (const x of [-W / 2 + 0.4, 0, W / 2 - 0.4]) strut(m, "metal_dark", V(x, F + H1 - 0.85, fz), V(x, F + H1 - 0.3, fz + 1.05), 0.04);
  const sy = F + H1 + (storeys === 2 ? 0.42 : 0.38);
  m.box("wood_dark", W - 0.9, 0.78, 0.08, 0, sy, fz + 0.04);
  const signs = [[0, sy, fz + 0.09, W - 1.2, 0.62, 0]];
  if (storeys === 2) {
    // living floor: two windows with a rail, the roof along the road
    for (const s of [-1, 1]) {
      const x = s * W / 4, ww = W / 2 - 1.2;
      // sliding windows: glass in wooden frames, lace curtains behind (lit at dusk in some rooms)
      m.box(s > 0 ? "interior_lit" : "paper", ww, 1.0, 0.03, x, F + H1 + 1.35, fz - 0.2);
      m.box("glass", ww, 1.05, 0.02, x, F + H1 + 1.35, fz - 0.05);
      for (let k = 0; k <= 4; k++) m.box("wood_frame", 0.05, 1.1, 0.06, x - ww / 2 + (k * ww) / 4, F + H1 + 1.35, fz - 0.03);
      m.box("wood_frame", ww + 0.1, 0.06, 0.08, x, F + H1 + 0.8, fz);
      m.box("wood_frame", ww + 0.1, 0.06, 0.08, x, F + H1 + 1.9, fz);
      m.box("metal_grey", ww + 0.2, 0.04, 0.04, x, F + H1 + 1.15, fz + 0.18);
    }
    m.box(upper, W, H2 - 1.1, 0.1, 0, F + H1 + 0.55 + (H2 - 1.1) / 2 + 0.55, fz - 0.07);
  }
  gableRoof(m, roof, { W: W + 0.5, over: 0.45, eaveY: F + H1 + H2 + 0.05, ridgeY: F + H1 + H2 + 0.05 + (D / 2 + 0.45) * 0.5, frontRun: D / 2 + 0.45, backRun: D / 2 + 0.45, thick: roof === "roof_kawara" ? 0.2 : 0.06 });
  extras?.(m, { F, H1, H2, fz, signs });
  SIGN_ANCHORS[name] = signs.map((a) => a.map((v) => +(+v).toFixed(3)));
  return m;
}
function barberPole(m, x, y, z) {
  m.cyl("metal_grey", 0.1, 0.1, 0.06, x, y, z, 14);
  for (let i = 0; i < 12; i++) m.cyl(["post_red", "porcelain", "sign_blue"][i % 3], 0.075, 0.075, 0.075, x, y + 0.06 + i * 0.075, z, 14);
  m.cyl("glass", 0.085, 0.085, 0.92, x, y + 0.04, z, 14);
  m.cyl("metal_grey", 0.1, 0.06, 0.08, x, y + 0.96, z, 14);
}
/** Post office: a small flat-roofed concrete building, red band, glass doors. */
function postOffice() {
  const m = new Model("post-office");
  const W = 9, D = 8, F = 0.3, H = 3.4;
  m.box("concrete", W + 0.3, F, D + 0.3, 0, F / 2, 0);
  for (const s of [-1, 1]) m.box("plaster_white", 0.2, H, D, s * W / 2, F + H / 2, 0);
  m.box("plaster_white", W, H, 0.2, 0, F + H / 2, -D / 2);
  m.box("plaster_white", W, 0.9, 0.22, 0, F + H - 0.45, D / 2);
  for (const s of [-1, 1]) m.box("plaster_white", 1.4, H - 0.9, 0.22, s * (W / 2 - 0.7), F + (H - 0.9) / 2, D / 2);
  m.box("interior_shop", W - 2.9, 2.4, 0.05, 0, F + 1.2, D / 2 - 0.8);
  m.box("glass", W - 2.9, 2.4, 0.02, 0, F + 1.2, D / 2 - 0.02);
  for (const dx of [-(W - 2.9) / 2, -(W - 2.9) / 6, (W - 2.9) / 6, (W - 2.9) / 2]) m.box("aluminium", 0.06, 2.45, 0.06, dx, F + 1.22, D / 2);
  m.box("post_red", W + 0.02, 0.14, 0.24, 0, F + H - 0.95, D / 2 + 0.01);
  m.box("concrete_cap", W + 0.4, 0.3, D + 0.4, 0, F + H + 0.15, 0);
  m.box("concrete", W + 1.6, 0.12, 1.6, 0, F + 2.75, D / 2 + 0.8);          // canopy over the door
  m.box("concrete", 3.0, 0.15, 1.5, 0, 0.08, D / 2 + 0.9);                   // step
  SIGN_ANCHORS["post-office"] = [[0, F + H - 0.42, D / 2 + 0.13, W - 1.0, 0.62, 0]];
  return m;
}
/** Police box (chuzaisho): office in front, residence behind, red lamp over the door. */
function chuzaisho() {
  const m = new Model("chuzaisho");
  const W = 8, D = 7.5, F = 0.3, H = 2.9;
  m.box("concrete", W + 0.2, F, D + 0.2, 0, F / 2, 0);
  for (const s of [-1, 1]) m.box("plaster_white", 0.15, H, D, s * W / 2, F + H / 2, 0);
  m.box("plaster_white", W, H, 0.15, 0, F + H / 2, -D / 2);
  m.box("plaster_white", W - 3.4, H, 0.15, 1.7, F + H / 2, D / 2);
  m.box("interior_shop", 2.4, 2.2, 0.05, -W / 2 + 1.75, F + 1.1, D / 2 - 0.7);
  m.box("glass", 2.6, 2.2, 0.02, -W / 2 + 1.75, F + 1.1, D / 2);
  m.box("aluminium", 2.7, 0.06, 0.06, -W / 2 + 1.75, F + 2.22, D / 2 + 0.01);
  m.box("glass", 1.6, 1.0, 0.02, 1.9, F + 1.5, D / 2 + 0.08);
  m.cyl("metal_dark", 0.02, 0.02, 0.4, -W / 2 + 1.75, F + H - 0.05, D / 2 + 0.25, 6, { rx: Math.PI / 2 });
  const lamp = new THREE.SphereGeometry(0.16, 14, 10);
  m.add("lamp_red", lamp, { uv: "box", matrix: new THREE.Matrix4().makeTranslation(-W / 2 + 1.75, F + H - 0.05, D / 2 + 0.45) });
  hipRoof(m, "roof_tin_blue", { W, D, over: 0.7, eaveY: F + H + 0.05, ridgeY: F + H + 0.05 + (D / 2 + 0.7) * 0.45, sori: 0, thick: 0.1, gable: 0.7, uv: 1, ridgeMat: "roof_tin_blue", gableMat: "plaster_white", ridgeH: 0.15 });
  SIGN_ANCHORS["chuzaisho"] = [[-W / 2 + 0.25, F + 1.5, D / 2 + 0.1, 0.36, 1.7, 1]];
  return m;
}
/** JA branch office (one storey, glass front) and its rice warehouse. */
function nokyo() {
  return shopHouse("nokyo", { W: 12, D: 8.5, storeys: 1, roof: "roof_tin", front: "glass", upper: "concrete_cap" });
}
function nokyoSoko() {
  const m = new Model("nokyo-soko");
  const W = 18, D = 11, H = 5.6;
  m.box("concrete", W + 0.3, 0.4, D + 0.3, 0, 0.2, 0);
  for (const s of [-1, 1]) {
    m.box("concrete_block", 0.25, 1.5, D, s * W / 2, 1.15, 0);
    m.box("roof_tin", 0.12, H - 1.5, D, s * W / 2, 0.4 + 1.5 + (H - 1.5) / 2, 0);
  }
  for (const s of [-1, 1]) {
    m.box("concrete_block", W, 1.5, 0.25, 0, 1.15, s * D / 2);
    m.box("roof_tin", W, H - 1.5, 0.12, 0, 0.4 + 1.5 + (H - 1.5) / 2, s * D / 2);
  }
  for (const x of [-4.5, 4.5]) m.box("steel_gate", 3.6, 3.6, 0.1, x, 0.4 + 1.8, D / 2 + 0.1);
  m.box("metal_dark", W - 2, 0.12, 0.12, 0, 0.4 + 3.7, D / 2 + 0.12);
  gableRoof(m, "roof_tin", { W: W + 0.6, over: 0.5, eaveY: 0.4 + H, ridgeY: 0.4 + H + (D / 2 + 0.5) * 0.3, frontRun: D / 2 + 0.5, backRun: D / 2 + 0.5, thick: 0.06 });
  return m;
}
/** Community hall (kominkan): one storey, tiled hip roof, porch with glass doors, wooden name board. */
function kominkan() {
  const m = new Model("kominkan");
  const W = 14, D = 10, F = 0.45, H = 3.0;
  m.box("concrete", W + 0.3, F, D + 0.3, 0, F / 2, 0);
  for (const s of [-1, 1]) {
    m.box("wood_siding", 0.15, 1.0, D, s * W / 2, F + 0.5, 0);
    m.box("plaster_white", 0.15, H - 1.0, D, s * W / 2, F + 1.0 + (H - 1.0) / 2, 0);
  }
  m.box("wood_siding", W, 1.0, 0.15, 0, F + 0.5, -D / 2);
  m.box("plaster_white", W, H - 1.0, 0.15, 0, F + 1.0 + (H - 1.0) / 2, -D / 2);
  m.box("wood_siding", W, 1.0, 0.15, 0, F + 0.5, D / 2);
  m.box("plaster_white", W, H - 1.0, 0.15, 0, F + 1.0 + (H - 1.0) / 2, D / 2);
  for (const x of [-4.5, 4.5]) { m.box("glass", 2.4, 1.1, 0.03, x, F + 1.8, D / 2 + 0.08); m.box("wood_frame", 2.5, 0.06, 0.08, x, F + 2.38, D / 2 + 0.1); }
  // entrance porch
  m.box("concrete", 3.6, 0.3, 2.6, 0, 0.15, D / 2 + 1.3);
  m.box("interior_shop", 2.2, 2.2, 0.05, 0, F + 1.1, D / 2 + 0.05);
  m.box("glass", 2.2, 2.2, 0.02, 0, F + 1.1, D / 2 + 0.1);
  for (const s of [-1, 1]) m.box("wood_frame", 0.18, 2.7, 0.18, s * 1.6, F + 1.35, D / 2 + 2.4);
  const porch = new Model("porch");
  gableRoof(porch, "roof_kawara", { W: 4.0, over: 0.3, eaveY: F + 2.75, ridgeY: F + 3.5, frontRun: 1.5, backRun: 1.5, thick: 0.18 });
  m.merge(porch, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 0, D / 2 + 1.25));
  hipRoof(m, "roof_kawara", { W, D, over: 0.9, eaveY: F + H + 0.1, ridgeY: F + H + 0.1 + (D / 2 + 0.9) * 0.55, sori: 0.1, thick: 0.22, gable: 0.6, ridgeMat: "roof_kawara_ridge", gableMat: "plaster_white", ridgeH: 0.4 });
  m.box("wood_old", 0.42, 1.9, 0.08, -2.15, F + 1.1, D / 2 + 2.4);
  SIGN_ANCHORS["kominkan"] = [[-2.15, F + 1.1, D / 2 + 2.45, 0.34, 1.75, 1]];
  return m;
}
/** Glass telephone box of the period with a grey frame and a green public phone. */
function phoneBox() {
  const m = new Model("phone-box");
  const S = 0.9, H = 2.2;
  m.box("concrete", S + 0.2, 0.1, S + 0.2, 0, 0.05, 0);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m.box("metal_grey", 0.06, H, 0.06, x * S / 2, 0.1 + H / 2, z * S / 2);
  for (const s of [-1, 1]) { m.box("glass", 0.02, H - 0.3, S - 0.06, s * S / 2, 0.1 + (H - 0.3) / 2 + 0.15, 0); m.box("glass", S - 0.06, H - 0.3, 0.02, 0, 0.1 + (H - 0.3) / 2 + 0.15, s * S / 2); }
  m.box("porcelain", S + 0.14, 0.12, S + 0.14, 0, 0.1 + H + 0.06, 0);
  m.box("phone_green", 0.26, 0.4, 0.16, 0, 1.25, -S / 2 + 0.12);
  m.box("metal_dark", 0.3, 0.03, 0.26, 0, 0.98, -S / 2 + 0.16);
  return m;
}
/** White road markings on the prefectural road: dashed centre line, edge lines broken at junctions. */
function roadMarkings() {
  const m = new Model("road-markings");
  const pts = scene.roads[0].points, half = scene.roads[0].width / 2;
  const gaps = scene.roads.filter((r) => r.class !== "prefectural" && r.points.length > 1).map((r) => {
    const p = r.points[r.points.length - 1], q = r.points[0];
    // the end of the side road that touches the main road, and which side it joins from
    const near = [p, q].sort((a, b) => Math.abs(a[0] - roadXAt(a[2])) - Math.abs(b[0] - roadXAt(b[2])))[0];
    return { z: near[2], side: Math.sign(near[0] - roadXAt(near[2])) || 1, w: (r.width ?? 3) / 2 + 1.5, d: Math.abs(near[0] - roadXAt(near[2])) };
  }).filter((g) => g.d < half + 4);
  function roadXAt(z) { let best = pts[0]; for (const p of pts) if (Math.abs(p[2] - z) < Math.abs(best[2] - z)) best = p; return best[0]; }
  let along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L, nx = dz, nz = -dx, yaw = Math.atan2(dx, dz);
    const strip = (off, t0, t1) => {
      const cx = (ax + bx) / 2 + nx * off + dx * ((t0 + t1) / 2 - L / 2), cz = (az + bz) / 2 + nz * off + dz * ((t0 + t1) / 2 - L / 2);
      m.box("road_paint", t1 - t0, 0.012, 0.15, cx, (ay + by) / 2 + 0.012, cz, { ry: yaw + Math.PI / 2 });
    };
    // centre: 5 m line, 5 m gap
    let t = 0;
    while (t < L) {
      const phase = (along + t) % 10, run = Math.min(phase < 5 ? 5 - phase : 10 - phase, L - t);
      if (phase < 5) strip(0, t, t + run);
      t += run;
    }
    for (const s of [-1, 1]) {
      const mz = (az + bz) / 2;
      if (gaps.some((g) => g.side === s && Math.abs(mz - g.z) < g.w)) continue;
      strip(s * (half - 0.25), 0, L + 0.01);
    }
    along += L;
  }
  return m;
}

// ---------------------------------------------------------------- river works (world coordinates)
/** Flip triangles of a non-indexed geometry so that their normals agree with dir(centroid). */
function orientTo(g, dir) {
  const p = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(e.subVectors(c, a));
    if (n.dot(dir(a.clone().add(b).add(c).divideScalar(3))) < 0)
      for (const attr of Object.values(g.attributes)) {
        const s = attr.itemSize;
        for (let k = 0; k < s; k++) { const t = attr.array[(i + 1) * s + k]; attr.array[(i + 1) * s + k] = attr.array[(i + 2) * s + k]; attr.array[(i + 2) * s + k] = t; }
      }
  }
  g.computeVertexNormals();
  return g;
}
/** UVs turned 45 degrees: concrete kenchi blocks are laid diagonally (tanizumi). */
const diagonalUV = (g) => {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, (u + v) * Math.SQRT1_2, (v - u) * Math.SQRT1_2); }
};

function riverWorks() {
  const m = new Model("river-works");
  const R = scene.river, bedPts = R.bed.points, RUN = R.bed.wallRun, CAP = R.bed.capWidth, rr = rng(91);
  const wpts = R.points;
  const lerpRow = (pts, zi, z) => {
    // pts sorted by z (column zi); linear interpolation of every numeric column
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][zi] <= z) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi], t = THREE.MathUtils.clamp((z - a[zi]) / (b[zi] - a[zi] || 1), 0, 1);
    return a.map((v, k) => v + (b[k] - v) * t);
  };
  // facing codes per bank side (nearest row, not interpolated): 0 old dry stone, 1 concrete kenchi blocks, 2 cut granite
  const facingAt = (z, side) => { let best = bedPts[0], d = 1e9; for (const p of bedPts) { const e = Math.abs(p[1] - z); if (e < d) { d = e; best = p; } else if (p[1] > z) break; } return side < 0 ? best[8] : best[9]; };
  const bedAt = (z) => { const [xc, , B, top, toeW, toeE, eW, eE] = lerpRow(bedPts, 1, z); return { xc, z, B, top, toeW, toeE, eW, eE, fW: facingAt(z, -1), fE: facingAt(z, 1) }; };
  const waterAt = (z) => lerpRow(wpts, 2, z)[1];
  const dirAt = (z) => { const a = bedAt(z - 1), b = bedAt(z + 1); const l = Math.hypot(b.xc - a.xc, 2); return [(b.xc - a.xc) / l, 2 / l]; };
  const gaps = R.washSteps.map((s) => [s.z - 0.85, s.z + 0.85]);
  const inGap = (z, side) => side > 0 && gaps.some(([a, b]) => z > a + 1e-3 && z < b - 1e-3);

  // --- revetments: one face per contiguous masonry run and bank side
  const zs = [...new Set([...bedPts.map((p) => p[1]), ...gaps.flat()])].sort((a, b) => a - b);
  const faceMat = (f, wet) => (f === 1 ? (wet ? "revet_block_wet" : "revet_block") : f === 2 ? (wet ? "revet_kenchi_wet" : "revet_kenchi") : wet ? "revet_stone_wet" : "revet_stone");
  for (const side of [-1, 1]) {
    let run = [];
    const flush = () => {
      if (run.length >= 2) wallRun(run, side);
      run = [];
    };
    for (const z of zs) {
      const b = bedAt(z);
      const earth = side < 0 ? b.eW : b.eE;
      if (earth < 0.5 && !inGap(z, side)) run.push(b);
      else flush();
    }
    flush();
  }
  function section(b, side) {
    const toe = side < 0 ? b.toeW : b.toeE, H = b.top - toe;
    const ys = THREE.MathUtils.clamp(waterAt(b.z) + 0.35, toe + 0.06, b.top - 0.3);
    const P = (a, y) => V(b.xc + side * a, y, b.z);
    return {
      wet: [P(b.B - 0.2, toe - 0.45), P(b.B, toe), P(b.B + (RUN * (ys - toe)) / H, ys)],
      dry: [P(b.B + (RUN * (ys - toe)) / H, ys), P(b.B + RUN, b.top)],
      back: (y) => P(b.B + RUN + CAP, y),
      cap: P(b.B + RUN + CAP, b.top),
      toe,
    };
  }
  function wallRun(rows, side) {
    // split into pieces of one facing material so a reach changes texture cleanly
    let i0 = 0;
    for (let i = 1; i <= rows.length; i++) {
      const fOf = (r) => (side < 0 ? r.fW : r.fE);
      const key = (r) => faceMat(fOf(r), false);
      if (i < rows.length && key(rows[i]) === key(rows[i0])) continue;
      const piece = rows.slice(Math.max(i0 - (i0 > 0 ? 1 : 0), 0), i);
      if (piece.length >= 2) {
        const secs = piece.map((r) => section(r, side));
        const towardRiver = (c) => { const b = bedAt(c.z); return V(Math.sign(b.xc - c.x) || -side, 0.35, 0); };
        for (const [part, wet] of [["wet", true], ["dry", false]]) {
          const g = orientTo(gridSurface(secs.map((s) => s[part]), 1, 1).toNonIndexed(), towardRiver);
          if (fOf(piece[0]) === 1) diagonalUV(g);
          m.add(faceMat(fOf(piece[0]), wet), g, { uv: "keep" });
        }
      }
      i0 = i;
    }
    // concrete cap (tenba) over the whole crest, cast in segments: the wall is a closed solid
    // over the sunken ground behind it
    // (an old dry-stone wall has no concrete: its top is a coping of mossy stones, grassed over behind)
    const cw = CAP + 0.1, off = RUN - 0.06 + cw / 2;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      const ax = a.xc + side * (a.B + off), bx = b.xc + side * (b.B + off);
      const L = Math.hypot(bx - ax, b.z - a.z), yaw = Math.atan2(bx - ax, b.z - a.z);
      const old = (side < 0 ? a.fW : a.fE) === 0;
      m.box(old ? "stone_moss" : "concrete_cap", L + 0.012, old ? 0.3 : 0.24, cw, (ax + bx) / 2, (a.top + b.top) / 2 - (old ? 0.1 : 0.05), (a.z + b.z) / 2, { ry: yaw + Math.PI / 2 });
    }
    // end walls (wing) where the masonry stops (earth bank, washing steps)
    for (const [r, dz] of [[rows[0], -1], [rows[rows.length - 1], 1]]) {
      const s = section(r, side);
      const face = [...s.wet, s.dry[1], s.cap];
      const back = face.map((p) => s.back(p.y));
      const g = orientTo(gridSurface([face, back], 1, 1).toNonIndexed(), () => V(0, 0, dz));
      m.add(faceMat(side < 0 ? r.fW : r.fE, false), g, { uv: "box" });
    }
  }

  // --- drop structures and the weir: concrete sill + apron, set along X like the terrain
  for (const d of R.drops) {
    const weir = d.kind === "weir";
    const b0 = bedAt(d.z);
    const half = b0.B + 0.45, body = weir ? 1.4 : 0.6;
    const bottom = d.waterBelow - 0.5;
    m.box("concrete_wet", 2 * half, d.crestY - bottom, body, b0.xc, (d.crestY + bottom) / 2, d.z - body / 2);
    // crest edge lighter where the water thins over it
    m.box("concrete_cap", 2 * half, 0.04, 0.16, b0.xc, d.crestY - 0.015, d.z - 0.08);
    if (weir) {
      // sloping downstream face of the fixed weir
      const f0 = bedAt(d.z), f1 = bedAt(d.z + 0.45);
      const rowA = [V(f0.xc - half, d.crestY, d.z), V(f0.xc + half, d.crestY, d.z)];
      const rowB = [V(f1.xc - half, d.waterBelow - 0.12, d.z + 0.45), V(f1.xc + half, d.waterBelow - 0.12, d.z + 0.45)];
      m.add("concrete_wet", orientTo(gridSurface([rowA, rowB]).toNonIndexed(), () => V(0, 1, 1)), { uv: "box" });
    }
    // apron (mizutataki) following the bed between the walls
    const rows = [];
    const z0 = d.z + (weir ? 0.45 : 0.0), z1 = d.z + d.apron;
    for (let k = 0; k <= 4; k++) {
      const z = z0 + ((z1 - z0) * k) / 4, b = bedAt(z);
      rows.push([V(b.xc - b.B - 0.3, d.waterBelow - 0.1, z), V(b.xc + b.B + 0.3, d.waterBelow - 0.1, z)]);
    }
    m.add("concrete_wet", orientTo(gridSurface(rows).toNonIndexed(), () => V(0, 1, 0)), { uv: "box" });
    const be = bedAt(z1);
    const edge = [[V(be.xc - be.B - 0.3, d.waterBelow - 0.1, z1), V(be.xc + be.B + 0.3, d.waterBelow - 0.1, z1)], [V(be.xc - be.B - 0.3, d.waterBelow - 0.5, z1), V(be.xc + be.B + 0.3, d.waterBelow - 0.5, z1)]];
    m.add("concrete_wet", orientTo(gridSurface(edge).toNonIndexed(), () => V(0, 0, 1)), { uv: "box" });
    if (weir) m.box("concrete_wet", 2 * (be.B + 0.3), 0.16, 0.3, be.xc, d.waterBelow - 0.04, z1 - 0.15);   // end sill
  }

  // --- irrigation intake on the east wall, just above the weir: headwall, sluice gate, hoist
  {
    const it = R.intake, b = bedAt(it.z), [dx, dz] = dirAt(it.z), yaw = Math.atan2(dx, dz);
    const y0 = b.toeE - 0.3, y1 = b.top + 0.35;
    const a0 = b.B - 0.38, a1 = b.B + RUN + 0.35;
    m.box("concrete_cap", a1 - a0, y1 - y0, 2.6, b.xc + (a0 + a1) / 2, (y0 + y1) / 2, it.z, { ry: yaw });
    const fx = b.xc + a0 - 0.02;                                     // river face of the headwall
    const at = (ox, y, oz) => V(fx - ox * Math.cos(yaw) + oz * Math.sin(yaw), y, it.z + ox * Math.sin(yaw) + oz * Math.cos(yaw));
    const put = (mat, w, h, d, ox, y, oz) => { const p = at(ox, y, oz); m.box(mat, w, h, d, p.x, p.y, p.z, { ry: yaw }); };
    put("interior_dark", 0.06, 0.75, 1.0, 0.0, it.sillY + 0.37, 0);                 // culvert mouth
    for (const s of [-1, 1]) put("steel_red", 0.12, b.top + 2.05 - it.sillY, 0.12, 0.08, (it.sillY + b.top + 2.05) / 2, s * 0.6);
    put("steel_gate", 0.07, 0.86, 1.1, 0.1, it.sillY + 0.3 + 0.43, 0);              // gate leaf, opened 0.3 m
    for (const y of [it.sillY + 0.55, it.sillY + 0.95]) put("steel_red", 0.09, 0.07, 1.12, 0.12, y, 0);
    put("steel_red", 0.16, 0.16, 1.45, 0.08, b.top + 2.05, 0);                      // hoist beam
    put("steel_red", 0.3, 0.32, 0.3, 0.08, b.top + 2.29, 0);                        // gearbox
    const sp = at(0.1, 0, 0);
    m.cyl("metal_grey", 0.025, 0.025, b.top + 2.75 - (it.sillY + 1.16), sp.x, it.sillY + 1.16, sp.z, 8);  // threaded spindle
    const hw = at(0.08, 0, 0);
    const wheel = new THREE.TorusGeometry(0.27, 0.018, 6, 28);
    wheel.rotateX(Math.PI / 2);
    m.add("steel_red", wheel, { uv: "box", matrix: new THREE.Matrix4().makeTranslation(hw.x, b.top + 2.52, hw.z) });
    for (let k = 0; k < 3; k++) m.box("steel_red", 0.54, 0.02, 0.03, hw.x, b.top + 2.52, hw.z, { ry: (k * Math.PI) / 3 });
    // concrete box where the buried culvert opens into the canal
    const c0 = R.canal.points[0], cw = c0[3] + 0.56;
    m.box("concrete_cap", cw, 0.12, 0.9, c0[0], c0[1] + 0.28, c0[2] - 0.75);                     // cover slab over the inlet
    for (const [w, d, ox, oz] of [[cw, 0.14, 0, -1.33], [0.14, 1.4, -cw / 2 + 0.07, -0.6], [0.14, 1.4, cw / 2 - 0.07, -0.6]]) m.box("concrete_cap", w, 0.9, d, c0[0] + ox, c0[1] - 0.15, c0[2] + oz);
    m.box("concrete_dark", cw, 0.1, 1.4, c0[0], c0[1] - R.canal.depth - 0.05, c0[2] - 0.6);
  }

  // --- canal: precast U-channel segments (2 m), culvert headwalls under the farm road
  {
    const cp = R.canal.points, cul = R.canal.culvert;
    for (let i = 0; i < cp.length - 1; i++) {
      const [ax, ay, az, w] = cp[i], [bx, by, bz] = cp[i + 1];
      const mz = (az + bz) / 2;
      if (mz > cul[0] && mz < cul[1]) continue;
      const L = Math.hypot(bx - ax, bz - az), dirx = (bx - ax) / L, dirz = (bz - az) / L, yaw = Math.atan2(dirx, dirz);
      const nx = -dirz, nz = dirx, cx = (ax + bx) / 2, cz = mz, wy = (ay + by) / 2;
      const o = { ry: yaw + Math.PI / 2 };
      const D = R.canal.depth, Tp = R.canal.wallTop;
      m.box("concrete_dark", L - 0.01, 0.1, w + 0.28, cx, wy - D - 0.05, cz, o);
      for (const s of [-1, 1]) m.box("concrete_cap", L - 0.01, D + Tp + 0.1, 0.14, cx + nx * s * (w / 2 + 0.07), wy + (Tp - D - 0.1) / 2, cz + nz * s * (w / 2 + 0.07), o);
    }
    for (const zc of cul) {
      const i = cp.findIndex((p) => p[2] >= zc);
      const p = cp[Math.max(i, 0)];
      const hy0 = p[1] - R.canal.depth - 0.2, hy1 = R.bridgeDeckY - 0.1;                         // up to the farm road
      m.box("concrete_cap", p[3] + 1.4, hy1 - hy0, 0.25, p[0], (hy0 + hy1) / 2, zc);
      const pipe = new THREE.CylinderGeometry(0.42, 0.42, 0.27, 18);
      pipe.rotateX(Math.PI / 2);
      m.add("interior_dark", pipe, { uv: "box", matrix: new THREE.Matrix4().makeTranslation(p[0], p[1] - 0.12, zc) });
    }
    const e = cp[cp.length - 1];
    m.box("concrete_cap", e[3] + 0.3, R.canal.depth + R.canal.wallTop + 0.1, 0.14, e[0], e[1] + (R.canal.wallTop - R.canal.depth - 0.1) / 2, e[2] + 0.05);
  }

  // --- washing steps (kawato): stone blocks down through the east wall
  for (const s of R.washSteps) {
    const b = bedAt(s.z);
    const n = 8, A0 = b.B - 0.6, A1 = b.B + RUN + R.bed.capWidth;
    const tread = (A1 - A0) / n, rise = (s.topY - s.toeY + 0.05) / n;
    for (let k = 1; k <= n; k++) {
      const a = A1 - k * tread, y = s.topY - k * rise;
      for (const [w, oz] of [[0.86, -0.4], [0.74, 0.43]]) {
        const hh = 0.32 + rr() * 0.04;
        m.box(rr() < 0.5 ? "stone_step_b" : "stone_paving_moss", tread + 0.06, hh, w - 0.02, b.xc + a + tread / 2, y - hh / 2 + (rr() - 0.5) * 0.012, s.z + oz + (rr() - 0.5) * 0.03);
      }
    }
    m.box("stone_old", 1.1, 0.2, 1.5, b.xc + A0 - 0.45, Math.max(s.toeY, waterAt(s.z) - 0.04) + 0.06, s.z);   // washing stone
  }
  return m;
}

// ---------------------------------------------------------------- road tunnel (zuido)
/** Concrete portal of a 1970s two-lane road tunnel at the head of the valley: a face wall with a
 *  raised arch ring and coping, the name plaque over the crown, and the lined bore running on into
 *  the hill (lit by sodium lamps, fading to black). Local origin = road level at the face, front
 *  = +Z (south); the bore follows the road's heading (`slope` = dx/dz). */
function tunnel(t) {
  const m = new Model("tunnel");
  const R = t.halfWidth - 0.05, ys = 2.4, FW = t.faceHalfWidth, top = t.faceTop, TH = 1.2;
  const crown = ys + R;
  // face wall with the horseshoe opening
  const face = new THREE.Shape([new THREE.Vector2(-FW, -0.8), new THREE.Vector2(FW, -0.8), new THREE.Vector2(FW, top), new THREE.Vector2(-FW, top)]);
  const hole = new THREE.Path();
  // (the opening stops at the road: below it the face is solid, the floor of the reveal)
  hole.moveTo(R, -0.02); hole.lineTo(R, ys); hole.absarc(0, ys, R, 0, Math.PI, false); hole.lineTo(-R, -0.02); hole.lineTo(R, -0.02);
  face.holes.push(hole);
  const fg = new THREE.ExtrudeGeometry(face, { depth: TH, bevelEnabled: false, curveSegments: 28 });
  fg.translate(0, 0, -TH);
  m.add("concrete", fg);
  // arch ring standing 0.18 m proud of the face, and a coping along the top
  const ring = new THREE.Shape();
  ring.moveTo(R + 0.55, 0); ring.lineTo(R + 0.55, ys); ring.absarc(0, ys, R + 0.55, 0, Math.PI, false); ring.lineTo(-R - 0.55, 0);
  ring.lineTo(-R, 0); ring.lineTo(-R, ys); ring.absarc(0, ys, R, Math.PI, 0, true); ring.lineTo(R, 0); ring.lineTo(R + 0.55, 0);
  const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.18, bevelEnabled: false, curveSegments: 28 });
  m.add("concrete_old", rg);
  m.box("concrete", 2 * FW + 0.4, 0.32, TH + 0.35, 0, top + 0.16, -TH / 2 + 0.17);
  // pilasters at the ends of the face
  for (const sx of [-1, 1]) m.box("concrete", 0.7, top + 0.8, 0.3, sx * (FW - 0.35), (top - 0.8) / 2, 0.15);
  // name plaque (granite) over the crown; the lettering is drawn by src/world/signs.ts
  const py = crown + (top - crown) / 2 + 0.1;
  m.box("stone_granite", 2.9, 0.92, 0.14, 0, py, 0.25);
  SIGN_ANCHORS["tunnel"] = [[0, py, 0.325, 2.6, 0.7, 0]];
  // drip line of rust and damp under the coping: a darker band
  m.box("concrete_dark", 2 * FW - 1.6, 0.06, 0.02, 0, top - 0.25, 0.005);
  // the bore: horseshoe lining, raised inspection walkways, road slab with the centre line
  const L = 96, step = 4;
  const prof = [];
  for (let k = 0; k <= 4; k++) prof.push([R, (ys * k) / 4]);
  for (let k = 1; k <= 20; k++) { const a = (Math.PI * k) / 20; prof.push([R * Math.cos(a), ys + R * Math.sin(a)]); }
  for (let k = 1; k <= 4; k++) prof.push([-R, ys - (ys * k) / 4]);
  // (the lining starts behind the face wall: the opening's own reveal lines the first 1.2 m)
  const bands = [["tunnel_lining", TH - 0.05, 16], ["tunnel_dim", 16, 44], ["tunnel_dark", 44, L]];
  for (const [mat, d0, d1] of bands) {
    const pos = [];
    for (let d = d0; d < d1; d += step) {
      const da = d, db = Math.min(d + step, d1);
      const xa = -t.slope * da, xb = -t.slope * db;
      for (let k = 0; k < prof.length - 1; k++) {
        const [px0, py0] = prof[k], [px1, py1] = prof[k + 1];
        // quad facing the bore axis (inward)
        const A = [xa + px0, py0, -da], B = [xa + px1, py1, -da], C = [xb + px1, py1, -db], D = [xb + px0, py0, -db];
        pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    m.add(mat, g);
  }
  const yaw = Math.atan2(-t.slope, 1);
  const along = (d) => [-t.slope * d, -d];
  for (let d = 0; d < L; d += 12) {
    const len = Math.min(12, L - d), [cx, cz] = along(d + len / 2);
    m.box("concrete_dark", 2 * R - 1.4, 0.06, len, cx, 0.0, cz, { ry: yaw });
    for (const sx of [-1, 1]) m.box(d < 16 ? "concrete" : "tunnel_dim", 0.7, 0.22, len, cx + sx * (R - 0.35), 0.11, cz, { ry: yaw });
    for (let k = 0; k < len; k += 6) {
      const [lx, lz] = along(d + k + 1.5);
      m.box("road_paint", 0.12, 0.012, 3.0, lx, 0.035, lz, { ry: yaw });
    }
  }
  // sodium lamps along the left wall, below the springline of the arch
  for (let d = 7; d < L - 4; d += 9) {
    const [lx, lz] = along(d);
    m.box("lamp_sodium", 0.16, 0.22, 0.7, lx - R + 0.12, ys + 1.4, lz, { ry: yaw });
  }
  const [ex, ez] = along(L);
  m.box("tunnel_end", 2 * R + 0.4, crown + 0.6, 0.1, ex, crown / 2, ez, { ry: yaw });
  return m;
}

/** Laundry poles (monohoshi): two T-shaped galvanised posts set in concrete and a pair of
 *  vinyl-coated poles across them, the kind every farmhouse yard had. Local X = along the poles. */
function monohoshi() {
  const m = new Model("monohoshi");
  for (const x of [-1.35, 1.35]) {
    m.box("concrete_old", 0.32, 0.12, 0.32, x, 0.06, 0);
    m.cyl("metal_grey", 0.03, 0.03, 1.72, x, 0.1, 0, 8);
    m.box("metal_grey", 0.05, 0.05, 0.62, x, 1.8, 0);
    for (const z of [-0.26, 0.26]) m.box("metal_grey", 0.06, 0.08, 0.04, x, 1.86, z);
  }
  for (const z of [-0.26, 0.26]) m.cyl("pole_vinyl", 0.016, 0.016, 3.4, 0, 1.88 - 1.7, z, 8, { rz: Math.PI / 2 });
  // a towel and a work glove pair left out on one pole
  m.box("cloth_white", 0.34, 0.5, 0.01, -0.6, 1.62, 0.26);
  m.box("cloth_white", 0.12, 0.2, 0.01, 0.5, 1.78, -0.26);
  return m;
}

// ---------------------------------------------------------------- clinic, temple, stream works
/** Village clinic (shinryojo) of the 1960s: a long single-storey building, white mortar over a
 *  grey wainscot, steel-sash windows, a concrete porch with a flat canopy and the name board. */
function shinryojo() {
  const m = new Model("shinryojo");
  const W = 15, D = 9, F = 0.4, H = 3.1;
  m.box("concrete", W + 0.3, F, D + 0.3, 0, F / 2, 0);
  for (const [w, d, x, z] of [[W, 0.16, 0, D / 2], [W, 0.16, 0, -D / 2], [0.16, D, W / 2, 0], [0.16, D, -W / 2, 0]]) {
    m.box("concrete_old", w, 0.9, d, x, F + 0.45, z);
    m.box("plaster_white", w, H - 0.9, d, x, F + 0.9 + (H - 0.9) / 2, z);
  }
  // windows of the waiting room and the consulting rooms (curtained, a little lit)
  for (const x of [-5.6, -2.9, 2.9, 5.6]) {
    m.box("interior_lit", 1.9, 1.25, 0.05, x, F + 1.75, D / 2 - 0.02);
    m.box("paper", 1.86, 1.2, 0.02, x, F + 1.75, D / 2 + 0.05);
    m.box("glass", 1.9, 1.25, 0.02, x, F + 1.75, D / 2 + 0.09);
    for (const dx of [-0.95, 0, 0.95]) m.box("aluminium", 0.05, 1.3, 0.06, x + dx, F + 1.75, D / 2 + 0.1);
    for (const dy of [-0.63, 0.63]) m.box("aluminium", 1.95, 0.05, 0.06, x, F + 1.75 + dy, D / 2 + 0.1);
  }
  for (const s of [-1, 1]) for (const z of [-2.2, 2.2]) {
    m.box("interior_dark", 0.05, 1.1, 1.6, s * (W / 2 - 0.02), F + 1.8, z);
    m.box("glass", 0.02, 1.1, 1.6, s * (W / 2 + 0.09), F + 1.8, z);
  }
  // entrance: glass double door, porch slab, flat canopy on two pipe columns, shoe step
  m.box("interior_shop", 2.0, 2.15, 0.05, 0, F + 1.08, D / 2 - 0.02);
  m.box("glass", 2.0, 2.15, 0.02, 0, F + 1.08, D / 2 + 0.09);
  for (const dx of [-1.0, 0, 1.0]) m.box("aluminium", 0.06, 2.2, 0.07, dx, F + 1.1, D / 2 + 0.1);
  m.box("concrete", 4.2, 0.3, 2.4, 0, 0.15, D / 2 + 1.2);
  m.box("concrete", 3.0, 0.15, 0.5, 0, 0.075, D / 2 + 2.65);
  m.box("concrete", 4.8, 0.16, 2.9, 0, F + 2.62, D / 2 + 1.35);
  for (const s of [-1, 1]) m.cyl("metal_grey", 0.05, 0.05, 2.35, s * 2.0, 0.3, D / 2 + 2.45, 10);
  hipRoof(m, "roof_tin_blue", { W, D, over: 0.7, eaveY: F + H + 0.05, ridgeY: F + H + 0.05 + (D / 2 + 0.7) * 0.42, sori: 0, thick: 0.1, gable: 1, ridgeMat: "roof_tin_blue", ridgeH: 0.16 });
  // name board over the canopy, a wall lamp, the bicycle of the nurse
  m.box("metal_dark", 4.3, 0.75, 0.06, 0, F + 3.12, D / 2 + 2.72);
  SIGN_ANCHORS["shinryojo"] = [[0, F + 3.12, D / 2 + 2.76, 4.1, 0.62, 0]];
  m.box("lamp_bulb", 0.3, 0.12, 0.12, 1.6, F + 2.45, D / 2 + 0.2);
  return m;
}

/** Main hall (hondo) of a small Soto temple: a low wide hall under a big hipped tile roof with
 *  deep eaves, a veranda all round, a stepped porch (kohai) and sliding lattice doors. */
function teraHondo() {
  const m = new Model("tera-hondo");
  const W = 12.6, D = 10.0, FL = 0.9, WH = 2.9;
  m.box("stone_granite", W + 2.6, 0.3, D + 2.6, 0, 0.15, 0);
  m.box("wood_old", W + 2.2, 0.12, D + 2.2, 0, FL - 0.06, 0);
  for (let i = 0; i <= 6; i++) for (const z of [-D / 2, D / 2]) {
    m.box("wood_old", 0.2, WH + FL - 0.3, 0.2, -W / 2 + (W / 6) * i, 0.3 + (WH + FL - 0.3) / 2, z);
    m.cyl("stone_granite", 0.2, 0.18, 0.16, -W / 2 + (W / 6) * i, 0.28, z, 8);
  }
  for (const s of [-1, 1]) for (let j = 1; j < 5; j++) m.box("wood_old", 0.2, WH + FL - 0.3, 0.2, s * W / 2, 0.3 + (WH + FL - 0.3) / 2, -D / 2 + (D / 5) * j);
  // walls: white plaster above a board dado at the sides and back, lattice doors along the front
  for (const s of [-1, 1]) {
    m.box("wood_siding", 0.1, 1.0, D, s * W / 2, FL + 0.5, 0);
    m.box("plaster_white", 0.1, WH - 1.0, D, s * W / 2, FL + 1.0 + (WH - 1.0) / 2, 0);
  }
  m.box("wood_siding", W, 1.0, 0.1, 0, FL + 0.5, -D / 2);
  m.box("plaster_white", W, WH - 1.0, 0.1, 0, FL + 1.0 + (WH - 1.0) / 2, -D / 2);
  m.box("interior_dark", W - 0.3, WH - 0.1, 0.05, 0, FL + (WH - 0.1) / 2, D / 2 - 0.25);
  for (let i = 0; i < 6; i++) {
    const cx = -W / 2 + (W / 6) * (i + 0.5), bw = W / 6 - 0.24;
    if (i === 2 || i === 3) { m.box("interior_lit", bw, 1.6, 0.04, cx, FL + 1.0, D / 2 - 0.2); }
    m.box("paper", bw, 0.9, 0.02, cx, FL + 1.75, D / 2 - 0.05);
    m.box("wood_siding", bw, 0.75, 0.04, cx, FL + 0.42, D / 2 - 0.05);
    for (let k = 1; k < 5; k++) m.box("wood_old", 0.03, 1.5, 0.03, cx - bw / 2 + (bw / 5) * k, FL + 1.45, D / 2 - 0.02);
    for (let k = 0; k < 5; k++) m.box("wood_old", bw, 0.03, 0.03, cx, FL + 0.95 + k * 0.3, D / 2 - 0.02);
  }
  for (const y of [FL + 2.25, FL + WH]) {
    m.box("wood_old", W + 0.3, 0.2, 0.22, 0, y, D / 2);
    m.box("wood_old", W + 0.3, 0.2, 0.22, 0, y, -D / 2);
    for (const s of [-1, 1]) m.box("wood_old", 0.22, 0.2, D + 0.3, s * W / 2, y, 0);
  }
  // veranda rail
  for (let k = 0; k <= 10; k++) {
    const x = -W / 2 - 1.0 + ((W + 2.0) / 10) * k;
    if (k === 5) continue;
    m.box("wood_old", 0.09, 0.6, 0.09, x, FL + 0.3, D / 2 + 1.0);
    if (k < 10 && k !== 4) m.box("wood_old", (W + 2.0) / 10, 0.06, 0.07, x + (W + 2.0) / 20, FL + 0.58, D / 2 + 1.0);
  }
  for (let k = -18; k <= 18; k++) for (const s of [-1, 1]) m.box("wood_old", 0.09, 0.11, 2.2, k * 0.37, FL + WH + 0.32, s * (D / 2 + 0.95), { rx: s * 0.38 });
  hipRoof(m, "roof_kawara", { W: W + 0.2, D: D + 0.2, over: 2.0, eaveY: FL + WH + 0.4, ridgeY: FL + WH + 0.4 + 4.3, sori: 0.38, thick: 0.3, gable: 1, uv: 1, ridgeMat: "roof_kawara_ridge", ridgeH: 0.55, ridgeW: 0.5 });
  // porch: two posts, a beam, a lean-to roof, five timber steps, the offertory box
  for (const s of [-1, 1]) {
    m.cyl("wood_old", 0.13, 0.13, 3.0, s * 1.7, 0.3, D / 2 + 2.9, 12);
    m.cyl("stone_granite", 0.2, 0.18, 0.16, s * 1.7, 0.28, D / 2 + 2.9, 8);
  }
  m.box("wood_old", 3.9, 0.22, 0.2, 0, 3.3, D / 2 + 2.9);
  const kh = new Model("kohai");
  gableRoof(kh, "roof_kawara", { W: 3.8, over: 0.4, eaveY: 3.55, ridgeY: 4.3, frontRun: 2.0, backRun: 0.01, thick: 0.24 });
  m.merge(kh, new THREE.Matrix4().setPosition(0, 0, D / 2 + 3.2));
  for (let k = 0; k < 5; k++) m.box("wood_old", 3.2, 0.08, 0.32, 0, 0.32 + k * 0.125, D / 2 + 2.6 - k * 0.3);
  m.box("wood_old", 1.3, 0.55, 0.6, 0, FL + 0.28, D / 2 + 0.5);
  return m;
}

/** Temple gate (a small yakui-mon): two main posts and two rear posts, a tiled gable roof, open
 *  board doors, a name plaque under the eave; low plastered walls run off to each side. */
function teraSanmon() {
  const m = new Model("tera-sanmon");
  for (const s of [-1, 1]) {
    m.box("wood_old", 0.3, 3.3, 0.3, s * 1.55, 1.65, 0.0);
    m.box("wood_old", 0.2, 2.9, 0.2, s * 1.55, 1.45, -1.3);
    m.box("stone_granite", 0.5, 0.2, 0.5, s * 1.55, 0.1, 0.0);
    m.box("wood_planks", 1.3, 2.4, 0.07, s * 2.1, 1.35, -0.75, { ry: s * 1.2 });       // doors standing open
    m.box("plaster_white", 3.4, 1.5, 0.3, s * 3.45, 0.95, 0.0);                          // side walls
    m.box("stone_granite", 3.5, 0.2, 0.42, s * 3.45, 0.1, 0.0);
    const wr = new Model("wall-roof");
    gableRoof(wr, "roof_kawara", { W: 3.5, over: 0.05, eaveY: 1.72, ridgeY: 1.95, frontRun: 0.36, backRun: 0.36, thick: 0.1 });
    m.merge(wr, new THREE.Matrix4().setPosition(s * 3.45, 0, 0));
  }
  m.box("wood_old", 3.7, 0.26, 0.24, 0, 3.05, 0.0);
  m.box("wood_old", 3.5, 0.2, 0.18, 0, 2.75, -1.3);
  for (const s of [-1, 1]) m.box("wood_old", 0.16, 0.18, 1.5, s * 1.55, 2.95, -0.65);
  gableRoof(m, "roof_kawara", { W: 4.6, over: 0.35, eaveY: 3.3, ridgeY: 4.25, frontRun: 1.55, backRun: 2.0, thick: 0.24 });
  m.box("wood_dark", 1.5, 0.52, 0.06, 0, 2.72, 0.19);
  SIGN_ANCHORS["tera-sanmon"] = [[0, 2.72, 0.225, 1.36, 0.42, 0]];
  return m;
}

/** Bell tower (shoro): four leaning posts on a stone base, a hipped tile roof, the bronze bell
 *  (bonsho) and its striking beam hung on ropes. */
function teraShoro() {
  const m = new Model("tera-shoro");
  m.box("stone_moss", 3.8, 0.7, 3.8, 0, 0.35, 0);
  m.box("stone_granite", 3.4, 0.14, 3.4, 0, 0.77, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strut(m, "wood_old", V(sx * 1.35, 0.84, sz * 1.35), V(sx * 1.05, 4.1, sz * 1.05), 0.24);
  for (const y of [1.5, 3.9]) for (let k = 0; k < 4; k++) {
    const a = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k], b = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(k + 1) % 4];
    const r = 1.35 - ((y - 0.84) / 3.26) * 0.3;
    strut(m, "wood_old", V(a[0] * r, y, a[1] * r), V(b[0] * r, y, b[1] * r), 0.13);
  }
  hipRoof(m, "roof_kawara", { W: 2.4, D: 2.4, over: 1.15, eaveY: 4.15, ridgeY: 5.75, sori: 0.3, thick: 0.24, gable: 1, ridgeMat: "roof_kawara_ridge", ridgeH: 0.35, ridgeHalf: 0.25 });
  m.add("bronze_dark", lathe([[0.001, 0.0], [0.5, 0.0], [0.47, 0.12], [0.43, 0.9], [0.36, 1.2], [0.18, 1.36], [0.001, 1.4]], 22), { uv: "box", matrix: new THREE.Matrix4().makeTranslation(0, 2.2, 0) });
  m.cyl("metal_dark", 0.03, 0.03, 0.45, 0, 3.6, 0, 6);
  m.cyl("wood_old", 0.08, 0.08, 1.9, 1.1, 2.75 - 0.95, 0, 10, { rz: Math.PI / 2 });
  for (const x of [0.6, 1.6]) m.cyl("rope_straw", 0.012, 0.012, 1.25, x, 2.78, 0, 5);
  return m;
}

/** A row of family graves: stepped granite stones (saoishi on two plinths) of different ages
 *  and heights, flower holders, wooden sotoba boards standing behind some of them. */
function haka(v) {
  const m = new Model(`haka_${v}`);
  const r = rng(300 + v * 17);
  let x = -1.35;
  for (let i = 0; i < 4; i++) {
    const w = 0.62 + r() * 0.14, old = r() < 0.4, mat = old ? "stone_moss" : "stone_granite";
    const hh = 0.7 + r() * 0.35;
    m.box(mat, w, 0.22, w, x, 0.11, 0);
    m.box(mat, w * 0.72, 0.2, w * 0.72, x, 0.32, 0);
    m.box(old ? "stone_old" : "stone_granite", w * 0.42, hh, w * 0.42, x, 0.42 + hh / 2, 0, { rz: old ? (r() - 0.5) * 0.06 : 0 });
    for (const s of [-1, 1]) m.cyl("stone_granite", 0.045, 0.045, 0.16, x + s * w * 0.3, 0.22, w * 0.36, 8);
    if (r() < 0.55) for (let k = 0; k < 1 + Math.floor(r() * 3); k++) m.box("wood_light", 0.08, 1.7 + r() * 0.3, 0.012, x - 0.12 + k * 0.11, 0.95, -w * 0.5 - 0.05, { rz: (r() - 0.5) * 0.08 });
    x += w + 0.12 + r() * 0.1;
  }
  m.box("stone_old", 3.3, 0.1, 1.0, 0, 0.02, 0.02);
  return m;
}

/** Six Jizo (roku-jizo) in red bibs on a stone step under a little tin-roofed shelter. */
function rokujizo() {
  const m = new Model("rokujizo");
  m.box("stone_moss", 3.3, 0.22, 0.7, 0, 0.11, 0);
  for (let i = 0; i < 6; i++) {
    const x = -1.3 + i * 0.52;
    m.add("stone_old", lathe([[0.001, 0], [0.12, 0], [0.13, 0.12], [0.1, 0.42], [0.07, 0.5], [0.09, 0.56], [0.085, 0.66], [0.001, 0.72]], 10), { uv: "box", matrix: new THREE.Matrix4().makeTranslation(x, 0.22, 0) });
    m.box("cloth_red", 0.19, 0.16, 0.02, x, 0.62, 0.105);
  }
  for (const s of [-1, 1]) for (const z of [-0.36, 0.36]) m.box("wood_old", 0.08, 1.35, 0.08, s * 1.62, 0.675, z);
  const rf = new Model("rf");
  gableRoof(rf, "roof_tin", { W: 3.7, over: 0.1, eaveY: 1.35, ridgeY: 1.62, frontRun: 0.62, backRun: 0.5, thick: 0.05 });
  m.merge(rf, new THREE.Matrix4());
  return m;
}

/** Irrigation canals fed from the side brooks (scene.json "canals"): the intake weir across the
 *  brook with its sluice gate, the precast U-channel, the headwalls where it dives under the
 *  prefectural road, and the slabs where lanes and farm roads cross it. */
function canalWorks(m) {
  for (const c of scene.canals ?? []) {
    const cp = c.points, D = c.depth, Tp = c.wallTop;
    for (let i = 0; i < cp.length - 1; i++) {
      const [ax, ay, az, w, ca] = cp[i], [bx, by, bz, , cb] = cp[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const dirx = (bx - ax) / L, dirz = (bz - az) / L, yaw = Math.atan2(dirx, dirz);
      const nx = -dirz, nz = dirx, cx = (ax + bx) / 2, cz = (az + bz) / 2, wy = (ay + by) / 2;
      const o = { ry: yaw + Math.PI / 2 };
      if (ca === 1 && cb === 1) continue;                                  // in the pipe under the road
      m.box("concrete_dark", L + 0.01, 0.1, w + 0.28, cx, wy - D - 0.05, cz, o);
      for (const s of [-1, 1]) m.box("concrete_cap", L + 0.01, D + Tp + 0.1, 0.14, cx + nx * s * (w / 2 + 0.07), wy + (Tp - D - 0.1) / 2, cz + nz * s * (w / 2 + 0.07), o);
      // slab cover where a lane or a farm road crosses
      if (ca === 2 || cb === 2) m.box("concrete_old", L + 0.02, 0.14, w + 0.5, cx, wy + Tp + 0.05, cz, o);
    }
    // headwalls (with the dark mouth of the pipe) where the canal goes under the road and comes out
    for (let i = 1; i < cp.length; i++) {
      if ((cp[i][4] === 1) === (cp[i - 1][4] === 1)) continue;
      const open = cp[i][4] === 1 ? cp[i - 1] : cp[i], piped = cp[i][4] === 1 ? cp[i] : cp[i - 1];
      const dx = piped[0] - open[0], dz = piped[2] - open[2], l = Math.hypot(dx, dz) || 1, yaw = Math.atan2(dx / l, dz / l);
      const hx = (open[0] + piped[0]) / 2, hz = (open[2] + piped[2]) / 2, top = open[1] + 0.75, bot = open[1] - D - 0.25;
      m.box("concrete", open[3] + 1.6, top - bot, 0.3, hx, (top + bot) / 2, hz, { ry: yaw });
      const pipe = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 18);
      pipe.rotateX(Math.PI / 2);
      m.add("interior_dark", pipe, { uv: "box", matrix: new THREE.Matrix4().makeRotationY(yaw).setPosition(hx, open[1] - 0.12, hz) });
    }
    // the far end opens into the branch ditch: an end wall
    const e = cp[cp.length - 1], e0 = cp[cp.length - 2], ey = Math.atan2(e[0] - e0[0], e[2] - e0[2]);
    m.box("concrete_cap", e[3] + 0.3, D + Tp + 0.1, 0.14, e[0], e[1] + (Tp - D - 0.1) / 2, e[2], { ry: ey });
    // intake: a low concrete weir across the brook, the canal mouth with a steel sluice gate
    const it = c.intake, dl = Math.hypot(it.dir[0], it.dir[1]) || 1, bdx = it.dir[0] / dl, bdz = it.dir[1] / dl;
    const by = Math.atan2(bdx, bdz);
    m.box("concrete_wet", 0.6, it.crestY - it.bedY + 0.35, 4.2, it.x, (it.crestY + it.bedY - 0.35) / 2, it.z, { ry: by + Math.PI / 2 });
    m.box("concrete_cap", 0.62, 0.05, 4.2, it.x, it.crestY + 0.02, it.z, { ry: by + Math.PI / 2 });
    m.box("concrete_wet", 1.6, 0.12, 4.2, it.x + bdx * 1.0, it.bedY - 0.02, it.z + bdz * 1.0, { ry: by + Math.PI / 2 });     // apron
    const p0 = cp[0], p1 = cp[1], gl = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) || 1, gx = (p1[0] - p0[0]) / gl, gz = (p1[2] - p0[2]) / gl, gy = Math.atan2(gx, gz);
    const gpx = p0[0] + gx * 0.4, gpz = p0[2] + gz * 0.4;
    m.box("concrete_cap", 0.3, D + Tp + 1.0, p0[3] + 0.9, gpx, p0[1] + (Tp + 1.0 - D) / 2, gpz, { ry: gy });         // gate pier
    m.box("steel_gate", 0.06, D + 0.5, p0[3] + 0.06, gpx + gx * 0.18, p0[1] - D / 2 + 0.25 + 0.15, gpz + gz * 0.18, { ry: gy });
    m.cyl("metal_dark", 0.03, 0.03, 0.55, gpx + gx * 0.18, p0[1] + Tp + 0.95, gpz + gz * 0.18, 8);
    m.cyl("steel_red", 0.16, 0.16, 0.04, gpx + gx * 0.18, p0[1] + Tp + 1.42, gpz + gz * 0.18, 12);
  }
}

/** Works of the side streams in world coordinates (scene.json "streams"): the concrete-lined
 *  channel across the paddies (two walls and a bed), the box culvert under the prefectural road
 *  with its headwalls and guard pipes, slab covers where the farm road and the levee path cross,
 *  and the outfall in the river wall. */
function streamWorks() {
  const m = new Model("stream-works");
  canalWorks(m);
  for (const st of scene.streams ?? []) {
    const ch = st.channel, z = st.z, w = st.width, wall = st.kind === "ditch" ? 0.12 : 0.16;
    const topAt = (x) => {
      const t = ch.tops;
      for (let i = 0; i < t.length - 1; i++) if (x <= t[i + 1][0]) { const f = (x - t[i][0]) / (t[i + 1][0] - t[i][0]); return t[i][1] + (t[i + 1][1] - t[i][1]) * Math.max(0, Math.min(1, f)); }
      return t[t.length - 1][1];
    };
    const bedAt = (x) => ch.bed0 + (ch.bed1 - ch.bed0) * ((ch.x0 - x) / (ch.x0 - ch.xRiver));
    const covered = (x) => st.covers.some((c) => x > c.x0 - 0.05 && x < c.x1 + 0.05);
    for (let x = ch.x1; x < ch.x0 - 0.01; x += 2.0) {
      const xa = x, xb = Math.min(x + 2.0, ch.x0), cx = (xa + xb) / 2, L = xb - xa;
      if (covered(cx)) continue;
      const top = topAt(cx), bed = bedAt(cx), hgt = top - bed + 0.12;
      for (const s of [-1, 1]) m.box("concrete_old", L + 0.02, hgt, wall, cx, bed - 0.12 + hgt / 2, z + s * (w / 2 + wall / 2));
      m.box("concrete_dark", L + 0.02, 0.12, w, cx, bed - 0.06, z);
    }
    for (const c of st.covers) {
      const cx = (c.x0 + c.x1) / 2, L = c.x1 - c.x0;
      if (c.kind === "bridge") {
        // the lined channel runs on under the road bridge: walls up to the deck, a cobbled floor
        const deck = st.roadY - 0.5, bed = ch.bed0 - 0.12;
        for (const s of [-1, 1]) m.box("concrete_old", L, deck - bed, 0.3, cx, (deck + bed) / 2, z + s * (w / 2 + 0.15));
        m.box("concrete_dark", L, 0.12, w, cx, bed + 0.06, z);
      } else if (c.kind === "road") {
        // box culvert: headwalls flush with the edge of the verge, wing walls, white guard pipes
        for (const [hx, dir] of [[c.x1, 1], [c.x0, -1]]) {
          const top = st.roadY + 0.12, bed = (dir > 0 ? st.brook[st.brook.length - 1][1] : ch.bed0) - 0.15;
          m.box("concrete", 0.3, top - bed, w + 2.6, hx, (top + bed) / 2, z);
          m.box("interior_dark", 0.05, Math.min(1.25, top - bed - 0.45), w, hx + dir * 0.16, bed + 0.15 + Math.min(1.25, top - bed - 0.45) / 2, z);
          for (const s of [-1, 1]) m.box("concrete", 1.6, top - bed - 0.2, 0.22, hx + dir * 0.8, (top + bed) / 2 - 0.1, z + s * (w / 2 + 1.25), { ry: -dir * s * 0.5 });
          for (const s of [-1, 1]) m.cyl("porcelain", 0.045, 0.045, 0.8, hx - dir * 0.05, top, z + s * (w / 2 + 1.1), 8);
          for (const y of [0.42, 0.74]) m.cyl("porcelain", 0.03, 0.03, w + 2.2, hx - dir * 0.05, top + y - (w + 2.2) / 2, z, 8, { rx: Math.PI / 2 });
        }
      } else {
        // slab cover with a kerb, the channel walls running on underneath
        const top = topAt(cx);
        m.box("concrete_old", L, 0.16, w + 0.9, cx, top + 0.02, z);
        for (const hx of [c.x0, c.x1]) m.box("concrete", 0.22, 0.5, w + 0.5, hx, top - 0.2, z);
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------- build all
await save("road-ditch", ditches());
if (scene.tunnel) await save("tunnel", tunnel(scene.tunnel));
await save("monohoshi", monohoshi());
await save("shinryojo", shinryojo());
await save("tera-hondo", teraHondo());
await save("tera-sanmon", teraSanmon());
await save("tera-shoro", teraShoro());
for (let v = 0; v < 3; v++) await save(`haka_${v}`, haka(v));
await save("rokujizo", rokujizo());
await save("stream-works", streamWorks());
await save("torii-stone", torii("stone"));
await save("torii-wood", torii("wood"));
for (let v = 0; v < 2; v++) await save(v ? `toro_${v}` : "toro", toro(v));
await save("komainu-a", komainu(true));
await save("komainu-un", komainu(false));
await save("haiden", haiden());
await save("honden", honden());
await save("saisen", saisen());
await save("temizuya", temizuya());
await save("shamusho", shamusho());
await save("ema", ema());
await save("shimenawa-tree", shimenawaTree());
await save("bench", bench());
await save("fence-lookout", fenceLookout());
await save("sekihi", sekihi());
await save("jizo", jizo());
for (const type of Object.keys(HOUSE_PRESETS)) for (let v = 0; v < 4; v++) {
  const { m, W, D, smoke } = minka(type, v);
  await save(`${type}_${v}`, m);
  index[`${type}_${v}`].footprint = [W, D];
  if (smoke) index[`${type}_${v}`].smoke = smoke.map((x) => +x.toFixed(3));
  index[`${type}_${v}`].storeys = HOUSE_PRESETS[type][v].storeys;
}
for (let v = 0; v < 2; v++) await save(`naya_${v}`, naya(v));
await save("block-wall", blockWall());
await save("ishigaki", ishigaki());
await save("denchu", denchu(false));
await save("denchu-trans", denchu(true));
await save("bus-stop", busStop());
for (let v = 0; v < 2; v++) await save(`jihanki_${v}`, jihanki(v));
const bo = scene.objects.find((o) => o.asset === "bridge");
{
  // skew: stream direction at the bridge relative to the deck's local frame
  const bp = scene.river.bed.points, i = bp.findIndex((p) => p[1] >= scene.river.bridgeZ);
  const skew = Math.atan2(bp[i + 1][0] - bp[i - 1][0], bp[i + 1][1] - bp[i - 1][1]) - (bo?.rotation[1] ?? 0);
  await save("bridge", bridge(bo?.span ?? 11, bo?.width ?? 3.2, skew));
}
await save("river-works", riverWorks());
{
  const rb = scene.objects.find((o) => o.asset === "road-bridge");
  if (rb) {
    const m = roadBridge(rb.span ?? 3.5, rb.width ?? 9.4);
    // skew: shear the deck so its ends run along the brook (world X) while the parapets follow the road
    const t = Math.tan(rb.skew ?? 0), shear = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, t, 0, 1, 0, 0, 0, 0, 1);
    for (const gs of m.parts.values()) for (const g of gs) g.applyMatrix4(shear);
    await save("road-bridge", m);
  }
}
await save("stairs", stairs());
await save("hinomi", hinomi());
await save("shobo-shed", shoboShed());
await save("post", postBox());
await save("shop-yorozuya", shopHouse("shop-yorozuya", { W: 9, D: 8.5, storeys: 2, roof: "roof_kawara", front: "glass",
  extras: (m, { F, fz }) => {
    // ice-cream chest and a bench under the awning
    m.box("porcelain", 1.1, 0.8, 0.6, 2.6, F + 0.4, fz + 0.55);
    m.box("glass", 1.0, 0.03, 0.5, 2.6, F + 0.81, fz + 0.55);
    m.box("wood_old", 1.6, 0.06, 0.4, -2.4, F + 0.42, fz + 0.65);
    for (const x of [-3.0, -1.8]) m.box("wood_old", 0.06, 0.4, 0.36, x, F + 0.2, fz + 0.65);
  } }));
await save("shop-sakaya", shopHouse("shop-sakaya", { W: 8, D: 8, storeys: 2, roof: "roof_tin", front: "mixed",
  extras: (m, { F, fz, signs }) => {
    // the red tobacco plate on a bracket, and stacked beer crates
    m.box("metal_dark", 0.04, 0.04, 0.5, 3.5, F + 2.25, fz + 0.25);
    signs.push([3.5, F + 1.95, fz + 0.5, 0.72, 0.44, 0]);
    for (let i = 0; i < 6; i++) m.box(i % 2 ? "vend_red" : "sign_blue", 0.45, 0.3, 0.33, -3.2 + (i % 3) * 0.47, F + 0.15 + Math.floor(i / 3) * 0.31, fz + 0.45);
  } }));
await save("shop-tofu", shopHouse("shop-tofu", { W: 7, D: 8, storeys: 2, roof: "roof_kawara", front: "mixed" }));
await save("barber", shopHouse("barber", { W: 7, D: 7.5, storeys: 2, roof: "roof_tin", front: "glass",
  extras: (m, { F, fz }) => barberPole(m, 3.05, F + 0.9, fz + 0.32) }));
await save("post-office", postOffice());
await save("chuzaisho", chuzaisho());
await save("nokyo", nokyo());
await save("nokyo-soko", nokyoSoko());
await save("kominkan", kominkan());
await save("phone-box", phoneBox());
await save("road-markings", roadMarkings());
for (const [k, v] of Object.entries(SIGN_ANCHORS)) if (index[k]) index[k].signs = v;
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ presets: HOUSE_PRESETS, assets: index }, null, 1));
// weld + quantize every GLB (KHR_mesh_quantization: supported by three.js and glTFast)
const { NodeIO, PropertyType } = await import("@gltf-transform/core");
const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
const { weld, quantize, dedup } = await import("@gltf-transform/functions");
const io2 = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let total = 0;
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".glb"))) {
  const doc = await io2.read(path.join(OUT, f));
  await doc.transform(weld({ tolerance: 0.0005 }), dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 16, quantizeNormal: 10 }));
  await io2.write(path.join(OUT, f), doc);
  total += fs.statSync(path.join(OUT, f)).size;
}
console.log("architecture bytes", total);

// Vehicles share the architecture registry; rebuild after the main index is written.
await import("../vehicles/build.mjs");
