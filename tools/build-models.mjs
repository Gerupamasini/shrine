/** Original metre-scale models. Exports portable GLB; no runtime dependency on this file. */
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdir, writeFile } from "node:fs/promises";
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((v) => {
      this.result = v;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((v) => {
      this.result = `data:${blob.type};base64,${Buffer.from(v).toString("base64")}`;
      this.onloadend?.();
    });
  }
};
const out = new URL("../public/assets/models/", import.meta.url);
await mkdir(out, { recursive: true });
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const mats = {
  wood: new T.MeshStandardMaterial({ color: 0x71604c, roughness: 0.91 }),
  darkwood: new T.MeshStandardMaterial({ color: 0x352b20, roughness: 0.9 }),
  stone: new T.MeshStandardMaterial({ color: 0x93958a, roughness: 1 }),
  roof: new T.MeshStandardMaterial({ color: 0x495250, roughness: 0.84 }),
  thatch: new T.MeshStandardMaterial({ color: 0x8c805b, roughness: 1 }),
  vermilion: new T.MeshStandardMaterial({ color: 0x913d27, roughness: 0.83 }),
  paper: new T.MeshStandardMaterial({ color: 0xc9b98e, roughness: 0.92 }),
  bark: new T.MeshStandardMaterial({ color: 0x73634c, roughness: 1 }),
  leaf: new T.MeshStandardMaterial({
    color: 0x34502b,
    roughness: 1,
    side: T.DoubleSide,
  }),
  metal: new T.MeshStandardMaterial({
    color: 0x787a72,
    roughness: 0.65,
    metalness: 0.25,
  }),
};
mats.leafLOD = mats.leaf.clone();
mats.broadleaf = mats.leaf.clone();
Object.entries(mats).forEach(([k, m]) => (m.name = k));
let group;
function mesh(g, mat, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(g, mats[mat]);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}
function box(w, h, d, x, y, z, mat = "wood") {
  return mesh(new T.BoxGeometry(w, h, d), mat, x, y, z);
}
function cyl(r1, r2, h, x, y, z, mat = "wood", s = 10) {
  return mesh(new T.CylinderGeometry(r1, r2, h, s), mat, x, y, z);
}
function beam(a, b, r, mat = "wood", r2 = r) {
  const v = new T.Vector3(...b).sub(new T.Vector3(...a));
  const m = cyl(
    r2,
    r,
    v.length(),
    ...new T.Vector3(...a)
      .add(new T.Vector3(...b))
      .multiplyScalar(0.5)
      .toArray(),
    mat,
    7,
  );
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.normalize());
  return m;
}
function roof(w, d, y, rise, mat = "roof", hip = false) {
  // Swept eaves: ridge slopes and gently upturned outer ends.
  const pos = [],
    uv = [],
    idx = [];
  const nx = 20,
    nz = 6;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx - 0.5) * w,
        z = (j / nz - 0.5) * d,
        u = Math.abs(x / (w * 0.5));
      let yy = y + rise * (1 - u) + 0.24 * u ** 5;
      if (hip) yy -= Math.max(0, Math.abs(z) / (d * 0.5) - 0.62) * rise * 0.8;
      pos.push(x, yy, z);
      uv.push((i / nx) * 4, (j / nz) * 4);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  mesh(g, mat);
  // Eave thickness, rafters, ridge cap, tile courses.
  box(0.26, 0.22, d + 0.15, 0, y + rise + 0.09, 0, mat);
  for (const side of [-1, 1])
    for (let x = -w * 0.45; x < w * 0.45; x += 0.18) {
      const u = Math.abs(x / (w * 0.5)),
        h = rise * (1 - u);
      if (h > 0.15)
        box(0.175, h, 0.09, x, y + h * 0.5, side * (d * 0.5 - 0.08), "wood");
    }
  for (const side of [-1, 1]) {
    box(0.16, 0.22, d, (side * w) / 2, y + 0.12, 0, mat);
    for (let z = -d / 2; z < d / 2; z += 0.48) {
      beam(
        [0, y + rise - 0.08, z],
        [(side * w) / 2, y - 0.04, z],
        0.065,
        "darkwood",
      );
    }
  }
  if (mat === "roof")
    for (let z = -d / 2; z <= d / 2; z += 0.33) {
      for (const side of [-1, 1])
        beam(
          [0, y + rise + 0.045, z],
          [(side * w) / 2, y + 0.24, z],
          0.042,
          "roof",
        );
    }
  if (mat === "thatch") {
    for (const side of [-1, 1]) {
      const p = [],
        ii = [];
      for (let k = 0; k < 900; k++) {
        let z = (rand() - 0.5) * d,
          x = side * (0.1 + rand() * 0.9) * w * 0.5,
          u = Math.abs(x / (w * 0.5)),
          yy = y + rise * (1 - u) + 0.24 * u ** 5;
        let n = p.length / 3;
        p.push(
          x,
          yy + 0.035,
          z,
          x + side * 0.14,
          yy - 0.09,
          z + 0.012,
          x + side * 0.14,
          yy - 0.09,
          z - 0.012,
        );
        ii.push(n, n + 1, n + 2);
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
      g.setIndex(ii);
      g.computeVertexNormals();
      mesh(g, "thatch");
    }
    for (let z = -d / 2; z < d / 2; z += 0.3)
      box(0.4, 0.45, 0.16, 0, y + rise + 0.2, z, "darkwood");
  }
}
function house(type = "house") {
  const w = 9,
    d = 7;
  box(w, 0.55, d, 0, 0.28, 0, "stone");
  box(w - 0.15, 3.25, d - 0.15, 0, 2, 0, "paper");
  for (const x of [-4.25, -2.1, 0, 2.1, 4.25])
    for (const z of [-3.5, 3.5]) box(0.16, 3.5, 0.16, x, 2.1, z);
  for (const y of [0.65, 1.1, 3.3]) {
    box(w, 0.13, 0.17, 0, y, 3.54, "darkwood");
    box(w, 0.13, 0.17, 0, y, -3.54, "darkwood");
  }
  for (let x = -4; x < 4; x += 0.24) {
    box(0.055, 1, 0.06, x, 1.15, 3.64, "wood");
    box(0.055, 1, 0.06, x, 1.15, -3.64, "wood");
  }
  for (const x of [-2.9, 2.9])
    for (const z of [-3.59, 3.59]) {
      box(1.55, 1.45, 0.06, x, 2.15, z, "darkwood");
      for (let j = 0; j < 7; j++)
        box(0.045, 1.45, 0.08, x - 0.7 + j * 0.23, 2.15, z + 0.04, "wood");
      box(1.6, 0.04, 0.08, x, 2.15, z + 0.05);
    }
  box(1.5, 2.5, 0.12, 0, 1.8, 3.64, "darkwood");
  for (let x = -0.6; x < 0.7; x += 0.15)
    box(0.045, 2.4, 0.15, x, 1.8, 3.72, "wood");
  for (let i = 0; i < 3; i++)
    box(
      2.2,
      0.16,
      1.4 - i * 0.32,
      0,
      0.12 + i * 0.16,
      4.05 - i * 0.15,
      "stone",
    );
  if (type === "thatch-house") {
    roof(11, 8.9, 3.5, 4.9, "thatch");
    for (const s of [-1, 1]) box(0.5, 0.7, 8.9, s * 5.25, 3.66, 0, "thatch");
  } else
    roof(11, 9, 3.65, 2.1, type === "metal-house" ? "metal" : "roof", true);
  box(2.3, 0.15, 1.5, 0, 3.15, 4.1, "roof");
}
function shrine() {
  box(14, 0.65, 10, 0, 0.32, 0, "stone");
  box(12.8, 1.05, 8.4, 0, 1.03, 0, "darkwood");
  for (let x = -6; x < 6; x += 0.25) box(0.22, 0.1, 9, x, 1.6, 0, "wood");
  box(10, 3.8, 6.1, 0, 3.35, -0.6, "darkwood");
  for (const x of [-5, -2.5, 0, 2.5, 5])
    for (const z of [-3.4, 3.4]) {
      box(0.32, 4.6, 0.32, x, 3.7, z);
      box(0.6, 0.25, 0.6, x, 1.6, z, "stone");
      box(0.65, 0.3, 0.55, x, 5.65, z);
    }
  for (const z of [-3.45, 3.45]) {
    box(11, 0.32, 0.3, 0, 5.7, z);
    box(11, 0.15, 0.32, 0, 5.1, z);
  }
  for (let x = -4.8; x < 5; x += 0.18)
    box(0.06, 2.9, 0.16, x, 3.65, 2.55, "wood");
  for (const s of [-1, 1]) {
    box(0.14, 0.14, 8.5, s * 6.3, 2.55, 0);
    for (let z = -4; z <= 4; z += 0.8) box(0.1, 1, 0.1, s * 6.3, 2.05, z);
  }
  roof(16, 12, 5.9, 3.25, "roof");
  // Worship porch with projecting gable and curved eaves.
  const old = group;
  const porch = new T.Group();
  group = porch;
  roof(5.4, 5.5, 5, 1.8, "roof");
  group = old;
  porch.position.z = 5;
  group.add(porch);
  for (const x of [-2, 2]) box(0.3, 4, 0.3, x, 3.6, 7, "wood");
  for (let i = 0; i < 6; i++)
    box(4.5, 0.24, 2.4 - i * 0.3, 0, 0.12 + i * 0.24, 5.45 - i * 0.08, "stone");
  box(2.15, 1, 0.95, 0, 2, 4.2, "wood");
  for (let i = 0; i < 13; i++)
    box(0.09, 0.07, 0.95, -0.98 + i * 0.16, 2.54, 4.2, "darkwood");
  beam([-3.8, 4.7, 3.65], [3.8, 4.7, 3.65], 0.1, "thatch");
  for (let i = 0; i < 5; i++) {
    const x = -2.5 + i * 1.25;
    box(0.12, 0.38, 0.025, x, 4.42, 3.66, "paper").rotation.z = 0.25;
    box(0.12, 0.35, 0.025, x + 0.1, 4.12, 3.66, "paper").rotation.z = -0.25;
  }
  beam([0, 4.7, 5.8], [0, 2.5, 5.8], 0.055, "thatch");
  cyl(0.17, 0.22, 0.3, 0, 4.6, 5.8, "metal");
  // Inner sanctuary behind the worship hall.
  const rear = new T.Group();
  group = rear;
  house();
  group = old;
  rear.scale.set(0.48, 0.65, 0.55);
  rear.position.set(0, 1, -10);
  group.add(rear);
}
function torii() {
  for (const x of [-3.1, 3.1]) {
    const m = cyl(0.21, 0.3, 6.4, x, 3.2, 0, "vermilion", 16);
    m.rotation.z = -Math.sign(x) * 0.025;
    cyl(0.38, 0.4, 0.25, x, 0.13, 0, "stone", 16);
  }
  box(7.5, 0.3, 0.32, 0, 4.65, 0, "vermilion");
  box(0.28, 1, 0.28, 0, 5.2, 0, "vermilion");
  box(8.2, 0.28, 0.55, 0, 5.9, 0, "vermilion");
  for (const s of [-1, 1]) {
    const m = box(1.9, 0.25, 0.62, s * 3.95, 6.04, 0, "darkwood");
    m.rotation.z = s * 0.1;
  }
  box(6.2, 0.25, 0.62, 0, 5.95, 0, "darkwood");
  box(0.65, 0.9, 0.12, 0, 5.13, 0.25, "darkwood");
}
function lantern() {
  box(0.9, 0.18, 0.9, 0, 0.09, 0, "stone");
  box(0.65, 0.22, 0.65, 0, 0.28, 0, "stone");
  cyl(0.2, 0.24, 1.3, 0, 1, 0, "stone");
  box(0.85, 0.2, 0.85, 0, 1.65, 0, "stone");
  box(0.65, 0.75, 0.65, 0, 2, 0, "stone");
  for (const z of [-0.335, 0.335])
    box(0.28, 0.38, 0.015, 0, 2.06, z, "darkwood");
  const m = mesh(new T.ConeGeometry(0.85, 0.5, 4), "stone", 0, 2.65, 0);
  m.rotation.y = Math.PI / 4;
  cyl(0.1, 0.2, 0.25, 0, 3, 0, "stone");
}
function cedar(variant = 0) {
  seed = 1994 + variant * 33;
  const H = 19 + rand() * 5;
  beam([0, 0, 0], [0.15, H, 0], 0.43, "bark", 0.035);
  for (let ring = 0; ring < 15; ring++) {
    const y = 4 + (ring * (H - 5)) / 15;
    const radius = (1 - y / H) * 3.6 + 0.35;
    const count = 5 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ring * 1.7 + rand() * 0.6;
      const len = radius * (0.7 + rand() * 0.5);
      const tip = [Math.cos(a) * len, y + 0.35, Math.sin(a) * len];
      beam([0, y, 0], tip, 0.06 * (1 - y / H) + 0.012, "bark", 0.012);
      for (let q = 0; q < 6; q++) {
        const t = 0.22 + q * 0.14;
        const cx = tip[0] * t,
          cz = tip[2] * t;
        const spread = (1 - t) * 0.85 + 0.22;
        // Volumetric, irregular needle sprays: three axes, serrated tips and drooping ends.
        const p = [],
          norm = [],
          uv = [];
        for (let spray = 0; spray < 7; spray++) {
          let ang = a + (rand() - 0.5) * 2.5;
          let l = spread * (0.5 + rand() * 0.6);
          let ex = cx + Math.cos(ang) * l,
            ez = cz + Math.sin(ang) * l,
            ey = y + 0.2 + t * 0.2 - rand() * 0.25;
          let width = l * 0.3;
          for (let plane = 0; plane < 2; plane++) {
            let ox = Math.sin(ang) * width,
              oz = -Math.cos(ang) * width,
              oy = plane ? width * 0.65 : 0;
            if (plane) {
              ox *= 0.25;
              oz *= 0.25;
            }
            p.push(
              cx - ox,
              y + 0.2 - oy,
              cz - oz,
              ex,
              ey,
              ez,
              cx + ox,
              y + 0.2 + oy,
              cz + oz,
            );
            uv.push(0, 0, 0.5, 1, 1, 0);
          }
        }
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
        g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        mesh(g, "leaf");
      }
    }
  }
}
function broadleaf() {
  seed = 984;
  beam([0, 0, 0], [0.3, 8, 0], 0.34, "bark", 0.09);
  for (let k = 0; k < 16; k++) {
    let a = rand() * 6.28,
      y = 3 + rand() * 5,
      r = 2 + rand() * 2.5;
    let end = [Math.cos(a) * r, y + 2, Math.sin(a) * r];
    beam([0, y * 0.65, 0], end, 0.12, "bark", 0.025);
    const positions = [],
      uv = [];
    for (let j = 0; j < 240; j++) {
      let cx = end[0] + (rand() - 0.5) * 2.8,
        cy = end[1] + (rand() - 0.5) * 2,
        cz = end[2] + (rand() - 0.5) * 2.8;
      let angle = rand() * 6.28,
        length = 0.24 + rand() * 0.18,
        width = length * 0.48;
      const v = new T.Vector3(
          Math.cos(angle) * length,
          0.08 + rand() * 0.14,
          Math.sin(angle) * length,
        ),
        u = new T.Vector3(
          -Math.sin(angle) * width,
          0.035,
          Math.cos(angle) * width,
        ),
        c = new T.Vector3(cx, cy, cz);
      const points = [
        c.clone().sub(v),
        c.clone().add(u),
        c.clone().add(v),
        c.clone().sub(v),
        c.clone().add(v),
        c.clone().sub(u),
      ];
      for (const p of points) positions.push(...p.toArray());
      uv.push(0.5, 0, 1, 0.5, 0.5, 1, 0.5, 0, 0.5, 1, 0, 0.5);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    mesh(g, "broadleaf");
  }
}
function temizuya() {
  box(4, 0.25, 3, 0, 0.12, 0, "stone");
  box(2.6, 0.7, 1.3, 0, 0.7, 0, "stone");
  box(2.1, 0.04, 0.85, 0, 1.07, 0, "metal");
  for (const x of [-1.7, 1.7])
    for (const z of [-1.1, 1.1]) box(0.18, 3.3, 0.18, x, 1.7, z);
  roof(4.6, 3.8, 3.3, 1.2);
  beam([-1.3, 1.15, 0.3], [1.3, 1.15, 0.3], 0.045, "wood");
}
function ema() {
  for (const x of [-1.6, 1.6]) box(0.14, 2.5, 0.14, x, 1.25, 0);
  for (const y of [1, 1.65, 2.25]) box(3.3, 0.09, 0.08, 0, y, 0);
  for (let x = -1.4; x < 1.5; x += 0.28)
    for (const y of [0.85, 1.5, 2.1])
      box(0.2, 0.26, 0.035, x, y, 0.09, "thatch");
  roof(3.8, 1, 2.5, 0.45);
}
function komainu() {
  box(1.2, 0.6, 1.3, 0, 0.3, 0, "stone");
  mesh(new T.SphereGeometry(0.48, 12, 8), "stone", 0, 1.05, 0).scale.set(
    0.8,
    1.4,
    1,
  );
  mesh(new T.SphereGeometry(0.35, 12, 8), "stone", 0, 1.8, 0.16);
  box(0.45, 0.2, 0.32, 0, 1.68, 0.42, "stone");
  for (const x of [-0.24, 0.24]) {
    beam([x, 0.6, 0.32], [x, 1.3, 0.2], 0.12, "stone");
    mesh(new T.ConeGeometry(0.13, 0.25, 5), "stone", x, 2.1, 0.14);
  }
  const tail = new T.Mesh(
    new T.TorusGeometry(0.22, 0.1, 6, 12, 4.2),
    mats.stone,
  );
  tail.position.set(0, 1.35, -0.45);
  group.add(tail);
}
function pole() {
  cyl(0.09, 0.16, 9, 0, 4.5, 0, "wood");
  box(2.3, 0.12, 0.12, 0, 8.2, 0, "metal");
  for (const x of [-0.9, 0, 0.9]) cyl(0.09, 0.09, 0.24, x, 8.4, 0, "paper");
}
function rock() {
  const m = mesh(new T.IcosahedronGeometry(1, 2), "stone", 0, 0.35, 0);
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f = 0.82 + rand() * 0.25;
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.65, p.getZ(i) * f);
  }
  m.geometry.computeVertexNormals();
}
async function save(name, fn) {
  group = new T.Group();
  group.name = name;
  fn();
  group.updateMatrixWorld(true);
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (!g.attributes.uv)
      g.setAttribute(
        "uv",
        new T.Float32BufferAttribute(
          new Float32Array(g.attributes.position.count * 2),
          2,
        ),
      );
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes))
      if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    const list = byMat.get(o.material) || [];
    list.push(g);
    byMat.set(o.material, list);
  });
  const clean = new T.Group();
  clean.name = name;
  for (const [mat, gs] of byMat) {
    const m = new T.Mesh(mergeGeometries(gs), mat);
    m.name = mat.name;
    clean.add(m);
  }
  const buf = await new GLTFExporter().parseAsync(clean, { binary: true });
  await writeFile(new URL(`${name}.glb`, out), Buffer.from(buf));
  let tris = 0;
  clean.traverse((o) => {
    if (o.isMesh) tris += o.geometry.attributes.position.count / 3;
  });
  console.log(name, Math.round(buf.byteLength / 1024) + "KiB", tris + " tris");
}
for (const name of ["house", "thatch-house", "metal-house"])
  await save(name, () => house(name));
await save("office", () => house());
await save("shed", () => house("metal-house"));
await save("shrine", shrine);
await save("torii", torii);
await save("lantern", lantern);
await save("temizuya", temizuya);
await save("ema", ema);
await save("komainu", komainu);
await save("pole", pole);
await save("rock", rock);
for (let i = 0; i < 3; i++) await save("cedar" + i, () => cedar(i));
await save("broadleaf", broadleaf);
function lowTree(broad = false, far = false) {
  beam([0, 0, 0], [0, broad ? 8 : 21, 0], broad ? 0.32 : 0.38, "bark", 0.04);
  seed = 137;
  const pos = [],
    uv = [];
  const rings = far ? 7 : 12;
  for (let j = 0; j < rings; j++)
    for (let k = 0; k < 5; k++) {
      const y = broad ? 5 + rand() * 4 : 4 + (j / rings) * 16,
        angle = (k / 5) * 6.28 + j * 2.3;
      const radius = broad ? 2.6 : (1 - y / 23) * 3.5;
      const cx = Math.cos(angle) * radius * 0.58,
        cz = Math.sin(angle) * radius * 0.58;
      for (let q = 0; q < (far ? 2 : 4); q++) {
        const a = angle + (q - 0.5) * 0.7,
          l = broad ? 0.8 : radius * 0.72;
        const c = new T.Vector3(cx, y + (rand() - 0.5) * 0.5, cz),
          tip = c
            .clone()
            .add(new T.Vector3(Math.cos(a) * l, -0.1, Math.sin(a) * l));
        const side = new T.Vector3(
          -Math.sin(a) * l * 0.6,
          0.06,
          Math.cos(a) * l * 0.6,
        );
        for (let plane = 0; plane < 2; plane++) {
          const u = side.clone();
          if (plane) u.set(u.x * 0.3, l * 0.5, u.z * 0.3);
          const points = [c.clone().sub(u), tip, c.clone().add(u)];
          for (const p of points) pos.push(...p.toArray());
          uv.push(0, 0, 0.5, 1, 1, 0);
        }
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  mesh(g, broad ? "broadleaf" : "leaf");
}
await save("cedar-low", () => lowTree());
await save("cedar-far", () => lowTree(false, true));
await save("broadleaf-low", () => lowTree(true));
await save("broadleaf-far", () => lowTree(true, true));
