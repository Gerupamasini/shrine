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
  m.cyl("bamboo_green", 0.025, 0.025, 1.4, -0.7, 1.12, 0.0, 8, { rz: Math.PI / 2 });
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
const HOUSE_PRESETS = {
  "minka-kayabuki": [[13.5, 9.0], [12.0, 8.5], [14.5, 9.5], [11.5, 8.0]],
  "minka-kawara": [[12.0, 8.5], [10.8, 8.0], [13.5, 9.0], [11.4, 9.5]],
  "minka-totan": [[11.5, 8.0], [12.8, 8.6], [10.6, 7.6], [13.2, 9.2]],
  "minka-kura": [[6.5, 5.0], [7.2, 5.4], [6.0, 4.6], [7.5, 5.5]],
};
function minka(type, v) {
  const r = rng(1000 + v * 31 + type.length * 7);
  const [W, D] = HOUSE_PRESETS[type][v];
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
  for (let i = 0; i <= bays; i++) for (const z of [-D / 2, D / 2]) m.box("wood_old", 0.14, wallH, 0.14, -W / 2 + i * bayW, F + wallH / 2, z);
  for (const s of [-1, 1]) for (let i = 0; i <= 4; i++) m.box("wood_old", 0.14, wallH, 0.14, s * W / 2, F + wallH / 2, -D / 2 + (D / 4) * i);
  // back and side walls
  m.box("wood_siding", W, 1.0, 0.1, 0, F + 0.5, -D / 2);
  m.box(upper, W, wallH - 1.0, 0.1, 0, F + 1.0 + (wallH - 1.0) / 2, -D / 2);
  for (const s of [-1, 1]) {
    m.box("wood_siding", 0.1, 1.0, D, s * W / 2, F + 0.5, 0);
    m.box(upper, 0.1, wallH - 1.0, D, s * W / 2, F + 1.0 + (wallH - 1.0) / 2, 0);
  }
  // nuki beams on walls
  for (const y of [F + 1.0, F + wallH - 0.05]) {
    m.box("wood_old", W + 0.05, 0.12, 0.16, 0, y, -D / 2);
    for (const s of [-1, 1]) m.box("wood_old", 0.16, 0.12, D + 0.05, s * W / 2, y, 0);
  }
  // small windows on side/back
  for (let i = 0; i < 2; i++) {
    const x = -W / 4 + i * (W / 2) + (r() - 0.5);
    m.box("wood_dark", 1.2, 0.75, 0.05, x, F + 1.65, -D / 2 - 0.06);
    for (let k = -2; k <= 2; k++) m.box("wood_old", 0.03, 0.75, 0.04, x + k * 0.24, F + 1.65, -D / 2 - 0.09);
  }
  // front: engawa + sliding doors (glass on kawara/totan houses, shoji/amado on kayabuki)
  const front = D / 2;
  m.box("wood_old", W - 1.8, 0.08, 0.95, 0.9, F + 0.0, front + 0.47);
  for (let i = 0; i <= bays; i++) if (i > 0) m.box("wood_old", 0.1, F, 0.1, -W / 2 + i * bayW, F / 2, front + 0.9);
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
  m.box("wood_dark", bayW - 0.1, 2.0, 0.06, -W / 2 + bayW / 2, 1.0, front - 0.02);
  m.box("wood_planks", bayW * 0.5, 1.95, 0.06, -W / 2 + bayW * 0.3, 1.0, front + 0.03);
  m.box("wood_old", W + 0.1, 0.14, 0.18, 0, F + wallH, front);
  // roofs
  if (type === "minka-kayabuki") {
    const ret = hipRoof(m, "roof_thatch", { W, D, over: 1.15, eaveY: F + wallH + 0.15, ridgeY: F + wallH + 0.15 + (D / 2 + 1.15) * 1.25, sori: 0.0, thick: 0.75, gable: 0.82, uv: 0.7, ridgeMat: "roof_kawara_ridge", gableMat: "wood_old", ridgeH: 0.5, ridgeW: 0.8, sag: 0.05 });
    // ridge cover sticks (gushi)
    for (let k = -6; k <= 6; k++) m.box("wood_old", 0.08, 0.9, 0.08, k * (ret.xg / 6.5), F + wallH + 0.15 + (D / 2 + 1.15) * 1.25 + 0.25, 0, { rx: Math.PI / 2 });
  } else if (type === "minka-totan") {
    const tin = ["roof_tin", "roof_tin_blue", "roof_tin", "roof_tin_green"][v];
    hipRoof(m, tin, { W, D, over: 0.9, eaveY: F + wallH + 0.1, ridgeY: F + wallH + 0.1 + (D / 2 + 0.9) * 1.05, sori: 0, thick: 0.12, gable: 0.78, uv: 1, ridgeMat: tin, gableMat: "wood_siding", ridgeH: 0.2, sag: 0.02 });
  } else {
    hipRoof(m, "roof_kawara", { W, D, over: 1.0, eaveY: F + wallH + 0.15, ridgeY: F + wallH + 0.15 + (D / 2 + 1.0) * 0.62, sori: 0.15, thick: 0.22, gable: r() < 0.5 ? 0.6 : 1, ridgeMat: "roof_kawara_ridge", gableMat: "plaster_white", ridgeH: 0.45 });
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
    const ridgeY = type === "minka-kayabuki" ? F + wallH + 0.15 + (D / 2 + 1.15) * 1.25 : type === "minka-totan" ? F + wallH + 0.1 + (D / 2 + 0.9) * 1.05 : F + wallH + 0.15 + (D / 2 + 1.0) * 0.62;
    const ax = (r() < 0.5 ? -1 : 1) * (W / 2 - 1.6);
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
  if (r() < 0.6) {
    const s = r() < 0.5 ? -1 : 1;
    m.box("wood_siding", 2.4, 2.1, D * 0.6, s * (W / 2 + 1.2), F + 1.05 - 0.3, -D * 0.1);
    const g = new Model("geya");
    gableRoof(g, "roof_tin", { W: D * 0.6, over: 0.2, eaveY: 2.1, ridgeY: 2.6, frontRun: 2.6, backRun: 0.01, thick: 0.06 });
    m.merge(g, new THREE.Matrix4().makeRotationY(s * Math.PI / 2).setPosition(s * W / 2, F - 0.3, -D * 0.1));
  }
  // laundry pole + stepping stone
  if (r() < 0.5) {
    for (const x of [W / 2 - 2.5, W / 2 - 0.3]) m.cyl("wood_old", 0.04, 0.04, 1.9, x, 0, front + 3.2, 6);
    m.cyl("bamboo_green", 0.025, 0.025, 2.6, W / 2 - 2.7, 1.85, front + 3.2, 8, { rz: Math.PI / 2 });
  }
  m.box("stone_granite", 0.8, 0.25, 0.5, -W / 2 + bayW / 2, 0.125, front + 0.5);
  return { m, W, D };
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
  }
  return m;
}
function keiTruck() {
  const m = new Model("kei-truck");
  // cab-over light truck (generic), local +Z forward
  m.box("car_paint", 1.38, 0.95, 1.15, 0, 1.25, 1.1);
  m.box("car_paint", 1.38, 0.5, 1.25, 0, 0.75, 1.15);
  m.box("glass_dark", 1.26, 0.5, 0.04, 0, 1.45, 1.68, { rx: -0.12 });
  for (const s of [-1, 1]) m.box("glass_dark", 0.04, 0.42, 0.7, s * 0.7, 1.45, 1.2);
  m.box("metal_grey", 1.4, 0.12, 2.0, 0, 0.62, -0.55);
  for (const s of [-1, 1]) m.box("car_paint", 0.05, 0.32, 2.0, s * 0.68, 0.84, -0.55);
  m.box("car_paint", 1.4, 0.32, 0.05, 0, 0.84, -1.55);
  m.box("car_paint", 1.4, 0.75, 0.05, 0, 1.0, 0.45);
  for (const z of [1.15, -1.0]) for (const s of [-1, 1]) {
    const w = new THREE.CylinderGeometry(0.27, 0.27, 0.17, 16);
    w.rotateZ(Math.PI / 2);
    w.translate(s * 0.62, 0.27, z);
    m.add("rubber", w);
  }
  m.box("metal_grey", 1.3, 0.12, 0.08, 0, 0.6, 1.72);
  for (const s of [-1, 1]) m.box("light_lens", 0.18, 0.12, 0.03, s * 0.5, 0.85, 1.79);
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
function bridge(span) {
  const m = new Model("bridge");
  m.box("concrete", span, 0.35, 3.0, 0, -0.175, 0);
  for (const s of [-1, 1]) {
    m.box("concrete", span, 0.5, 0.18, 0, 0.25, s * 1.45);
    for (const x of [-span / 2, span / 2]) m.box("concrete", 0.3, 0.7, 0.25, x, 0.35, s * 1.45);
  }
  for (const x of [-span / 2 + 0.6, span / 2 - 0.6]) m.box("concrete", 0.8, 1.6, 3.2, x, -1.0, 0);
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
      m.add(edge && r() < 0.45 ? "stone_moss" : "stone_step", g, { uvScale: 1 });
      z0 += w;
    }
    // side curbs (stepped stones along both edges)
    for (const side of [-1, 1]) curb.box(r() < 0.6 ? "stone_moss" : "stone_step", depth + 0.02, 0.45, 0.32, s.x + depth / 2, top + 0.08 + (r() - 0.5) * 0.04, st.z + side * (st.width / 2 + 0.16));
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
        m.box(r() < 0.25 ? "stone_moss" : "stone_step", len - 0.02, 0.24, wid - 0.02, x + len / 2, y - 0.08 + (r() - 0.5) * 0.012, z + wid / 2);
        z += wid;
      }
      x += len;
    }
  };
  for (let f = 0; f < 3; f++) {
    const x0 = st.x0 + f * per + st.flight * st.tread;
    pave(x0, x0 + st.landing, st.footY + (f + 1) * st.flight * st.rise, st.z - st.width / 2, st.z + st.width / 2);
    for (const side of [-1, 1]) curb.box("stone_moss", st.landing, 0.45, 0.32, x0 + st.landing / 2, st.footY + (f + 1) * st.flight * st.rise + 0.1, st.z + side * (st.width / 2 + 0.16));
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
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    if (az < dd.zRange[0] || bz > dd.zRange[1]) continue;
    const len = Math.hypot(bx - ax, bz - az), dirx = (bx - ax) / len, dirz = (bz - az) / len;
    const nx = -dirz, nz = dirx, yaw = Math.atan2(dirx, dirz);
    for (const side of [-1, 1]) {
      const cx = (ax + bx) / 2 + nx * side * dd.offset, cz = (az + bz) / 2 + nz * side * dd.offset;
      const y = (ay + by) / 2 - 0.07;
      const L = len + 0.03, w = dd.width, wall = 0.1, dep = dd.depth;
      // two walls, floor (inner faces stained), and a concrete lid on some segments
      for (const ws of [-1, 1]) m.box("concrete_old", L, dep + 0.35, wall, cx + nx * ws * (w / 2 + wall / 2), y - (dep + 0.35) / 2 + 0.03, cz + nz * ws * (w / 2 + wall / 2), { ry: yaw + Math.PI / 2 });
      m.box("concrete_dark", L, 0.06, w, cx, y - dep, cz, { ry: yaw + Math.PI / 2 });
      if (r() < 0.22) m.box("concrete_old", L * 0.96, 0.08, w + 0.16, cx, y + 0.01, cz, { ry: yaw + Math.PI / 2 });
    }
  }
  return m;
}

// ---------------------------------------------------------------- build all
await save("road-ditch", ditches());
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
  const { m, W, D } = minka(type, v);
  await save(`${type}_${v}`, m);
  index[`${type}_${v}`].footprint = [W, D];
}
for (let v = 0; v < 2; v++) await save(`naya_${v}`, naya(v));
await save("block-wall", blockWall());
await save("ishigaki", ishigaki());
await save("denchu", denchu(false));
await save("denchu-trans", denchu(true));
await save("kei-truck", keiTruck());
await save("bus-stop", busStop());
const bz = scene.river.bridgeZ;
const bo = scene.objects.find((o) => o.asset === "bridge");
await save("bridge", bridge(bo?.span ?? 11));
await save("stairs", stairs());
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ presets: HOUSE_PRESETS, assets: index }, null, 1));
// weld + quantize every GLB (KHR_mesh_quantization: supported by three.js and glTFast)
const { NodeIO } = await import("@gltf-transform/core");
const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
const { weld, quantize, dedup } = await import("@gltf-transform/functions");
const io2 = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let total = 0;
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".glb"))) {
  const doc = await io2.read(path.join(OUT, f));
  await doc.transform(weld({ tolerance: 0.0005 }), dedup(), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 16, quantizeNormal: 10 }));
  await io2.write(path.join(OUT, f), doc);
  total += fs.statSync(path.join(OUT, f)).size;
}
console.log("architecture bytes", total);
void bz;
