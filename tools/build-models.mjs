/** Original metre-scale models. Exports portable GLB; no runtime dependency on this file. */
import * as T from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
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
mats.fern = new T.MeshStandardMaterial({
  color: 0x667d47,
  roughness: 1,
  side: T.DoubleSide,
});
mats.plaster = new T.MeshStandardMaterial({ color: 0x9f9981, roughness: 1 });
mats.glass = new T.MeshStandardMaterial({ color: 0x293634, roughness: 0.3 });
mats.leafLOD = mats.leaf.clone();
mats.broadleaf = mats.leaf.clone();
Object.entries(mats).forEach(([k, m]) => (m.name = k));
let group;
let reduced = false;
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
  const nx = reduced ? 8 : 24,
    nz = reduced ? 6 : 16,
    pos = [],
    uv = [],
    indices = [];
  const level = (x, z) => {
    let t = 1 - Math.abs(x) / (w * 0.5);
    if (hip) t = Math.min(t, (d * 0.5 - Math.abs(z)) / (w * 0.43));
    return y + rise * Math.max(0, t) + 0.12 * Math.pow(1 - Math.max(0, t), 6);
  };
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx - 0.5) * w,
        z = (j / nz - 0.5) * d;
      pos.push(x, level(x, z), z);
      uv.push(x / 2, z / 2);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  mesh(g, mat);
  const soffit = g.clone();
  soffit.translate(0, mat === "thatch" ? -0.42 : -0.16, 0);
  mesh(soffit, mat === "thatch" ? "thatch" : "darkwood");
  for (const side of [-1, 1]) {
    box(
      0.17,
      mat === "thatch" ? 0.48 : 0.22,
      d,
      (side * w) / 2,
      y - 0.04,
      0,
      mat,
    );
    box(w, 0.2, 0.15, 0, y - 0.04, (side * d) / 2, mat);
    for (let z = -d / 2; z <= d / 2; z += reduced ? 1.5 : 0.42) {
      beam(
        [0, level(0, z) - 0.18, z],
        [(side * w) / 2, y - 0.12, z],
        0.045,
        "darkwood",
      );
    }
    if (!hip)
      for (let x = -w / 2 + 0.12; x < w / 2; x += reduced ? 0.55 : 0.17) {
        const h = level(x, (side * d) / 2) - y - 0.15;
        if (h > 0)
          box(0.165, h, 0.09, x, y + h / 2, side * (d / 2 - 0.1), "darkwood");
      }
  }
  const ridgeLength = hip ? Math.max(0.6, d - w * 0.86) : d + 0.3;
  box(0.36, 0.25, ridgeLength, 0, y + rise + 0.08, 0, mat);
  if (mat === "roof" && !reduced) {
    // Ceramic roll tiles follow the swept surface. Each is real curved geometry.
    for (let z = -d / 2; z < d / 2; z += 0.34)
      for (const side of [-1, 1])
        for (let x = 0.15; x < w / 2; x += 0.48) {
          const xa = side * x,
            xb = side * Math.min(x + 0.52, w / 2);
          const a = new T.Vector3(xa, level(xa, z) + 0.025, z),
            b = new T.Vector3(xb, level(xb, z) + 0.025, z),
            delta = b.clone().sub(a);
          const tile = mesh(
            new T.CylinderGeometry(
              0.045,
              0.045,
              delta.length(),
              4,
              1,
              true,
              0,
              Math.PI,
            ),
            "roof",
          );
          tile.position.copy(a).add(b).multiplyScalar(0.5);
          tile.quaternion.setFromUnitVectors(
            new T.Vector3(0, 1, 0),
            delta.normalize(),
          );
        }
  } else if (mat === "thatch") {
    const p = [],
      uv = [];
    for (let i = 0; i < (reduced ? 0 : 3200); i++) {
      const x = (rand() - 0.5) * w,
        z = (rand() - 0.5) * d,
        yy = level(x, z) + 0.02;
      const dx = Math.sign(x) * 0.16;
      p.push(
        x,
        yy,
        z - 0.008,
        x + dx,
        level(x + dx, z) + 0.024,
        z,
        x,
        yy,
        z + 0.008,
      );
      uv.push(0, 0, 0.5, 1, 1, 0);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(p, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    mesh(geo, "thatch");
    for (let z = -ridgeLength / 2; z < ridgeLength / 2; z += 0.55)
      box(0.55, 0.25, 0.14, 0, y + rise + 0.25, z, "darkwood");
  }
}
function house(type = "house") {
  const w = 9,
    d = 7;
  box(w, 0.48, d, 0, 0.24, 0, "stone");
  box(w - 0.3, 2.9, d - 0.3, 0, 1.9, 0, "plaster");
  // Individual charred weatherboards, deeply recessed joinery, plaster infill.
  for (const side of [-1, 1]) {
    for (let x = -4.4; x < 4.4; x += 0.21) {
      const h = 1.2 + (rand() - 0.5) * 0.06;
      box(0.2, h, 0.08, x, 0.5 + h / 2, side * 3.52, "darkwood");
    }
    for (let z = -3.4; z < 3.4; z += 0.21)
      box(0.08, 1.2, 0.2, side * 4.52, 1.1, z, "darkwood");
    for (const x of [-4.35, -2.5, 0, 2.5, 4.35])
      box(0.13, 3, 0.15, x, 1.98, side * 3.55, "wood");
    box(9, 0.15, 0.14, 0, 3.35, side * 3.55, "wood");
    for (const x of [-2.65, 2.65]) {
      box(2.05, 1.38, 0.11, x, 2.28, side * 3.61, "glass");
      for (let i = 0; i < 9; i++)
        box(
          0.038,
          1.45,
          0.12,
          x - 0.95 + i * 0.24,
          2.28,
          side * 3.7,
          "darkwood",
        );
      for (const y of [1.55, 2.28, 3])
        box(2.2, 0.06, 0.16, x, y, side * 3.7, "wood");
      box(0.55, 1.5, 0.12, x + 1.37, 2.3, side * 3.64, "darkwood");
    }
    box(0.1, 1.4, 2, side * 4.6, 2.25, 0, "glass");
    for (let i = 0; i < 8; i++)
      box(0.12, 1.4, 0.045, side * 4.67, 2.25, -0.9 + i * 0.25, "wood");
    beam([side * 5.15, 3.55, -4.05], [side * 5.15, 3.55, 4.05], 0.065, "metal");
    beam([side * 5.15, 3.55, 3.9], [side * 5.15, 0.25, 3.9], 0.05, "metal");
  }
  box(1.6, 2.5, 0.1, 0, 1.75, 3.63, "glass");
  for (let x = -0.72; x < 0.8; x += 0.16)
    box(0.035, 2.5, 0.15, x, 1.75, 3.73, "wood");
  box(9.6, 0.15, 1.15, 0, 0.5, 3.9, "wood");
  for (let x = -4.5; x < 4.5; x += 0.2)
    box(0.18, 0.04, 1.15, x, 0.6, 3.9, "darkwood");
  for (let i = 0; i < 3; i++)
    box(
      2.25,
      0.16,
      1.6 - i * 0.32,
      0,
      0.08 + i * 0.16,
      4.5 - i * 0.12,
      "stone",
    );
  roof(
    11,
    9,
    3.55,
    type === "thatch-house" ? 4.5 : 2.3,
    type === "thatch-house"
      ? "thatch"
      : type === "metal-house"
        ? "metal"
        : "roof",
    type === "thatch-house",
  );
  // Road-side lean-to: secondary roof and storage rather than a repeated cube.
  if (type === "metal-house") {
    box(2.6, 2.2, 3, -5.8, 1.3, -1, "darkwood");
    const old = group,
      wing = new T.Group();
    group = wing;
    roof(3.8, 4.4, 2.5, 0.8, "metal");
    group = old;
    wing.position.set(-5.8, 0, -1);
    group.add(wing);
  }
  for (const x of [-4.2, 4.2])
    for (const z of [-3.3, 3.3]) {
      box(0.48, 0.5, 0.48, x, 0.25, z, "stone");
    }
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
  for (const side of [-1, 1])
    for (const x of [-5, -2.5, 0, 2.5, 5]) {
      for (let tier = 0; tier < 3; tier++)
        box(
          0.6 + tier * 0.18,
          0.14,
          0.5 + tier * 0.22,
          x,
          5.3 + tier * 0.17,
          side * 3.5,
          "wood",
        );
    }
  for (let x = -5.8; x < 5.8; x += 0.2)
    box(0.19, 0.85, 0.05, x, 2.02, 3.05, "darkwood");
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
  const path = new T.CatmullRomCurve3([
    new T.Vector3(-4.85, 6.2, 0),
    new T.Vector3(-3.4, 5.98, 0),
    new T.Vector3(0, 5.94, 0),
    new T.Vector3(3.4, 5.98, 0),
    new T.Vector3(4.85, 6.2, 0),
  ]);
  for (let i = 0; i < 48; i++) {
    const a = path.getPoint(i / 48),
      b = path.getPoint((i + 1) / 48),
      delta = b.clone().sub(a);
    const cap = box(
      delta.length() + 0.015,
      0.22,
      0.68,
      ...a.clone().add(b).multiplyScalar(0.5).toArray(),
      "darkwood",
    );
    cap.rotation.z = Math.atan2(delta.y, delta.x);
  }
  box(0.65, 0.9, 0.12, 0, 5.13, 0.25, "darkwood");
}
function lantern() {
  box(1.02, 0.18, 1.02, 0, 0.09, 0, "stone");
  box(0.82, 0.19, 0.82, 0, 0.275, 0, "stone");
  cyl(0.24, 0.32, 0.19, 0, 0.46, 0, "stone", 16);
  cyl(0.17, 0.24, 0.95, 0, 1.01, 0, "stone", 16);
  const profile = [
    [0.19, 0],
    [0.22, 0.1],
    [0.43, 0.22],
    [0.48, 0.28],
    [0.47, 0.35],
    [0.35, 0.41],
  ].map(([r, y]) => new T.Vector2(r, y));
  mesh(new T.LatheGeometry(profile, 20), "stone", 0, 1.43, 0);
  box(0.75, 0.1, 0.75, 0, 1.84, 0, "stone");
  for (const x of [-0.31, 0.31])
    for (const z of [-0.31, 0.31]) box(0.13, 0.62, 0.13, x, 2.18, z, "stone");
  for (const side of [-1, 1]) {
    box(0.52, 0.16, 0.1, 0, 1.96, side * 0.31, "stone");
    box(0.52, 0.12, 0.1, 0, 2.44, side * 0.31, "stone");
    box(0.1, 0.16, 0.52, side * 0.31, 1.96, 0, "stone");
  }
  cyl(0.09, 0.12, 0.18, 0, 2.03, 0, "darkwood", 12);
  // Broad, curved stone kasa, hollow below rather than a painted black window.
  const segments = 40,
    rings = 8,
    p = [],
    uv = [],
    idx = [];
  for (let j = 0; j <= rings; j++)
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2,
        t = j / rings,
        r = 0.08 + 0.75 * t,
        sq = 1 / Math.max(Math.abs(Math.sin(a)), Math.abs(Math.cos(a)));
      p.push(
        Math.cos(a) * r * sq * 0.8,
        2.52 + 0.42 * (1 - t) ** 2 + 0.09 * t ** 8,
        Math.sin(a) * r * sq * 0.8,
      );
      uv.push(i / segments, j / rings);
    }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      idx.push(
        a,
        a + 1,
        a + segments + 1,
        a + 1,
        a + segments + 2,
        a + segments + 1,
      );
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  mesh(g, "stone");
  cyl(0.1, 0.18, 0.18, 0, 3.01, 0, "stone", 16);
  mesh(new T.SphereGeometry(0.12, 12, 8), "stone", 0, 3.15, 0);
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
  box(1.35, 0.18, 1.55, 0, 0.09, 0, "stone");
  box(1.15, 0.48, 1.35, 0, 0.42, 0, "stone");
  const form = (x, y, z, sx, sy, sz) => {
    const m = mesh(new T.SphereGeometry(1, 20, 14), "stone", x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  };
  form(0, 1.17, -0.16, 0.39, 0.61, 0.41);
  form(0, 1.5, 0.04, 0.43, 0.38, 0.4);
  form(0, 1.91, 0.13, 0.34, 0.35, 0.3);
  form(0, 1.79, 0.38, 0.29, 0.17, 0.22);
  form(0, 1.84, 0.55, 0.15, 0.1, 0.06);
  form(0, 1.68, 0.38, 0.24, 0.07, 0.22);
  for (const side of [-1, 1]) {
    form(side * 0.28, 0.92, -0.28, 0.21, 0.28, 0.3);
    form(side * 0.23, 1.1, 0.3, 0.11, 0.47, 0.13);
    form(side * 0.23, 0.69, 0.44, 0.16, 0.09, 0.23);
    for (let t = 0; t < 3; t++)
      form(side * 0.23 + (t - 1) * 0.075, 0.7, 0.6, 0.04, 0.05, 0.07);
    form(side * 0.27, 2.15, 0.07, 0.12, 0.2, 0.13).rotation.z = side * 0.35;
    form(side * 0.18, 1.98, 0.39, 0.105, 0.045, 0.035).rotation.z = -side * 0.2;
    form(side * 0.18, 1.93, 0.39, 0.035, 0.025, 0.02);
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2;
      const curl = mesh(
        new T.TorusGeometry(0.095, 0.038, 6, 14, 5.5),
        "stone",
        side * (0.29 + Math.sin(a) * 0.08),
        1.65 + Math.cos(a) * 0.34,
        -0.03 + Math.sin(a) * 0.28,
      );
      curl.rotation.y = (side * Math.PI) / 2;
    }
  }
  const path = new T.CatmullRomCurve3([
    new T.Vector3(0, 0.95, -0.4),
    new T.Vector3(0.12, 1.3, -0.62),
    new T.Vector3(0.15, 1.66, -0.54),
    new T.Vector3(-0.03, 1.72, -0.5),
    new T.Vector3(-0.1, 1.55, -0.52),
  ]);
  mesh(new T.TubeGeometry(path, 24, 0.085, 8, false), "stone");
}
function pole() {
  cyl(0.09, 0.16, 9, 0, 4.5, 0, "stone", 16);
  box(2.3, 0.12, 0.12, 0, 8.2, 0, "metal");
  for (const x of [-0.9, 0, 0.9]) {
    cyl(0.035, 0.035, 0.42, x, 8.42, 0, "metal", 8);
    for (let i = 0; i < 4; i++)
      cyl(0.09, 0.065, 0.045, x, 8.3 + i * 0.07, 0, "paper", 12);
  }
  cyl(0.3, 0.3, 0.82, 0.38, 6.8, 0, "metal", 20);
  cyl(0.33, 0.33, 0.05, 0.38, 7.23, 0, "metal", 20);
  for (const y of [6.4, 7.1]) box(0.65, 0.06, 0.08, 0.2, y, 0, "metal");
  beam([-0.8, 8.1, 0], [0, 7.45, 0], 0.025, "metal");
  beam([0.8, 8.1, 0], [0, 7.45, 0], 0.025, "metal");
  for (const x of [0.23, 0.51]) cyl(0.045, 0.06, 0.22, x, 7.33, 0, "paper", 12);
}
function fern() {
  const p = [],
    uv = [];
  for (let f = 0; f < 7; f++) {
    const a = f * 2.399 + rand() * 0.25,
      span = 0.42 + rand() * 0.22,
      height = 0.38 + rand() * 0.28;
    const point = (t) =>
      new T.Vector3(
        Math.cos(a) * span * t,
        Math.sin(t * Math.PI * 0.72) * height,
        Math.sin(a) * span * t,
      );
    for (let j = 1; j < 9; j++) {
      const t = j / 10,
        c = point(t),
        next = point(t + 0.06),
        width = Math.sin(t * Math.PI) * 0.11;
      for (const side of [-1, 1]) {
        const tip = c
          .clone()
          .add(
            new T.Vector3(
              -Math.sin(a) * width * side,
              0.016,
              Math.cos(a) * width * side,
            ),
          );
        const base = c
          .clone()
          .add(new T.Vector3(Math.cos(a) * 0.035, -0.005, Math.sin(a) * 0.035));
        p.push(
          ...c.toArray(),
          ...tip.toArray(),
          ...next.toArray(),
          ...tip.toArray(),
          ...base.toArray(),
          ...next.toArray(),
        );
        uv.push(0, 0, 1, 0.5, 0, 1, 1, 0.5, 0.2, 0.7, 0, 1);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  mesh(g, "fern");
}
function rock() {
  const m = mesh(new T.IcosahedronGeometry(1, 2), "stone", 0, 0.35, 0);
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f =
      0.91 +
      0.085 * Math.sin(p.getX(i) * 3 + p.getY(i) * 4) +
      0.065 * Math.sin(p.getZ(i) * 7 + p.getX(i));
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.65, p.getZ(i) * f);
  }
  m.geometry = mergeVertices(m.geometry);
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
function shed() {
  box(5, 0.3, 4, 0, 0.15, 0, "stone");
  box(4.8, 2.7, 3.8, 0, 1.6, 0, "darkwood");
  for (let x = -2.3; x < 2.4; x += 0.23)
    box(0.2, 2.6, 0.055, x, 1.65, 1.94, "wood");
  box(2, 2.5, 0.08, 0, 1.6, 2, "darkwood");
  for (const x of [-2.4, 0, 2.4]) box(0.12, 2.8, 0.12, x, 1.7, 2.05, "wood");
  roof(6, 5, 3, 1.25, "metal");
}
for (const low of [false, true]) {
  reduced = low;
  const suffix = low ? "-low" : "";
  for (const name of ["house", "thatch-house", "metal-house"])
    await save(name + suffix, () => house(name));
  await save("office" + suffix, () => house());
  await save("shed" + suffix, shed);
  await save("shrine" + suffix, shrine);
}
reduced = false;
await save("torii", torii);
await save("lantern", lantern);
await save("temizuya", temizuya);
await save("ema", ema);
await save("komainu", komainu);
await save("pole", pole);
await save("rock", rock);
await save("fern", fern);
