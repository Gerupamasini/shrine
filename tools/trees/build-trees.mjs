// Procedural species trees for 夏陰. Writes public/assets/models/trees/<species>_<variant>.glb
// Each GLB holds two meshes named "<species>_<v>_lod0" and "..._lod1" (same pivot: trunk base,
// metres, +Y up). Material names are mapped to textures by the runtime and by
// public/world/materials.json (Unity). COLOR_0 carries wind weights:
//   R = trunk sway (0 at base -> 1 at top), G = branch flex, B = leaf flutter phase.
import fs from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public/assets/models/trees");
fs.mkdirSync(OUT, { recursive: true });

// ---------- small math helpers ------------------------------------------------------
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
function rotAxis(v, axis, ang) { // Rodrigues
  const k = norm(axis), c = Math.cos(ang), s = Math.sin(ang);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
function rng(seed) { let s = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ (seed >>> 13)) >>> 0; for (let i = 0; i < 4; i++) s = (s * 1664525 + 1013904223) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function perp(d) { const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; return norm(cross(d, a)); }

// ---------- mesh accumulator ---------------------------------------------------------
class Part {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vert(p, n, uv, c) { this.pos.push(...p); this.nrm.push(...n); this.uv.push(...uv); this.col.push(...c); return this.count - 1; }
}
class Builder {
  constructor() { this.parts = new Map(); }
  part(mat) { if (!this.parts.has(mat)) this.parts.set(mat, new Part()); return this.parts.get(mat); }
  // Tube along a polyline. pts: [{p, r, w:[R,G,B]}]
  tube(mat, pts, sides, uvScale = [1.2, 1.2], cap = false) {
    const part = this.part(mat);
    const base = part.count;
    let lenAcc = 0;
    let n0 = null;
    const circ = 2 * Math.PI * pts[0].r;
    const uRep = Math.max(1, Math.round(circ / uvScale[0]));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i].p;
      const d = norm(sub(pts[Math.min(i + 1, pts.length - 1)].p, pts[Math.max(i - 1, 0)].p));
      if (!n0) n0 = perp(d); else n0 = norm(sub(n0, mul(d, dot(n0, d))));
      const b0 = cross(d, n0);
      if (i > 0) lenAcc += len(sub(p, pts[i - 1].p));
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const n = add(mul(n0, Math.cos(a)), mul(b0, Math.sin(a)));
        part.vert(add(p, mul(n, pts[i].r)), n, [(k / sides) * uRep, lenAcc / uvScale[1]], pts[i].w);
      }
    }
    for (let i = 0; i < pts.length - 1; i++)
      for (let k = 0; k < sides; k++) {
        const a = base + i * (sides + 1) + k, b = a + sides + 1;
        part.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  // A foliage card: centre c, plane axes u (length dir) and v, size w x h, atlas cell.
  card(mat, c, u, v, w, h, cell, cellsPerRow, normal, wind, pivotU = 0.5) {
    const part = this.part(mat);
    const cs = 1 / cellsPerRow, cx = (cell % cellsPerRow) * cs, cy = Math.floor(cell / cellsPerRow) * cs;
    const pad = cs * 0.01;
    const corners = [[-pivotU, -0.5], [1 - pivotU, -0.5], [1 - pivotU, 0.5], [-pivotU, 0.5]];
    const uvs = [[cx + pad, cy + cs - pad], [cx + cs - pad, cy + cs - pad], [cx + cs - pad, cy + pad], [cx + pad, cy + pad]];
    const base = part.count;
    corners.forEach(([a, b], i) => {
      const p = add(add(c, mul(u, a * w)), mul(v, b * h));
      // edge vertices flutter more than the attachment
      part.vert(p, normal, uvs[i], [wind[0], wind[1], Math.min(1, wind[2] + (a + pivotU) * 0.25)]);
    });
    part.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// ---------- species ------------------------------------------------------------------------
function trunkPath(r, H, wander, lean, segs) {
  const pts = [];
  const phase = r() * 10, phase2 = r() * 10;
  const leanDir = [Math.cos(r() * 6.28), 0, Math.sin(r() * 6.28)];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * H;
    const wob = [Math.sin(t * 3.1 + phase) * wander, 0, Math.cos(t * 2.7 + phase2) * wander];
    const l = mul(leanDir, lean * H * t * t);
    pts.push(add(add([0, y, 0], wob), l));
  }
  return pts;
}

function conifer(b, r, o, lod) {
  const { H, dbh, crownBase, branchMax, spacing, angle, droop, cardSize, cardsPerM, barkMat, leafMat, cells, flat } = o;
  const sides = lod ? 7 : 14;
  const tp = trunkPath(r, H, o.wander, o.lean, lod ? 10 : 24);
  const R0 = dbh / 2;
  const trunk = tp.map((p, i) => {
    const t = i / (tp.length - 1);
    let rad = R0 * Math.pow(1 - t, 0.85) + 0.02;
    rad *= 1 + o.flare * Math.exp(-p[1] / 0.9);
    return { p, r: rad, w: [Math.pow(t, 1.6), 0, 0] };
  });
  b.tube(barkMat, trunk, sides, [1.0, 1.3]);
  const trunkAt = (y) => {
    const f = Math.min(tp.length - 1.001, (y / H) * (tp.length - 1));
    const i = Math.floor(f), a = f - i;
    return add(mul(tp[i], 1 - a), mul(tp[i + 1], a));
  };
  let az = r() * 6.28;
  const cb = crownBase * H;
  // dead stubs below the living crown
  if (!lod) for (let y = cb * 0.35; y < cb; y += 0.9 + r() * 1.6) {
    az += 2.4;
    const d = norm([Math.cos(az), -0.15, Math.sin(az)]);
    const s = trunkAt(y), L = 0.3 + r() * 0.7;
    b.tube(barkMat, [{ p: s, r: 0.035, w: [y / H, 0, 0] }, { p: add(s, mul(d, L)), r: 0.012, w: [y / H, 0.2, 0] }], 4);
  }
  const step = spacing * (lod ? 1.7 : 1);
  for (let y = cb; y < H - 0.4; y += step * (0.7 + r() * 0.6)) {
    const t = (y - cb) / (H - cb);
    const perWhorl = lod ? 2 : 2 + Math.floor(r() * 2);
    for (let k = 0; k < perWhorl; k++) {
      az += 2.39996 + (r() - 0.5) * 0.5;
      const L = Math.max(0.35, branchMax * Math.pow(1 - t, 0.85) * (0.75 + r() * 0.5) + 0.25);
      const ang = (angle[0] + (angle[1] - angle[0]) * t + (r() - 0.5) * 12) * Math.PI / 180; // from vertical
      const dir = norm([Math.cos(az) * Math.sin(ang), Math.cos(ang), Math.sin(az) * Math.sin(ang)]);
      const s = trunkAt(y);
      const segs = 4;
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const sag = droop * L * L * u * u * (1 - t * 0.6);
        pts.push({ p: add(add(s, mul(dir, L * u)), [0, -sag, 0]), r: (0.025 + L * 0.018) * (1 - u * 0.8), w: [y / H, u, 0] });
      }
      if (!lod || L > 1.2) b.tube(barkMat, pts, lod ? 4 : 5, [0.6, 0.8]);
      // foliage
      const n = Math.max(1, Math.round(L * cardsPerM * (lod ? 0.45 : 1)));
      for (let i = 0; i < n; i++) {
        const u = lerp(o.leafStart, 1.0, (i + r() * 0.6) / n);
        const f = u * segs, fi = Math.min(segs - 1, Math.floor(f)), fa = f - fi;
        const at = add(mul(pts[fi].p, 1 - fa), mul(pts[fi + 1].p, fa));
        const along = norm(sub(pts[fi + 1].p, pts[fi].p));
        const side = norm(cross(along, [0, 1, 0]));
        const roll = (r() - 0.5) * (flat ? 0.6 : 1.6);
        const vv = rotAxis(side, along, roll);
        const size = cardSize * (0.75 + r() * 0.5) * (0.65 + 0.35 * Math.min(1, L / 2)) * (lod ? 1.45 : 1);
        const centre = add(at, mul(along, size * 0.18));
        // crown-shaped normal: blend card normal with the direction from the trunk axis
        const radial = norm(add(sub(centre, trunkAt(centre[1])), [0, 0.35, 0]));
        const cn = norm(cross(along, vv));
        const nn = norm(add(mul(radial, 0.75), mul(cn[1] < 0 ? mul(cn, -1) : cn, 0.25)));
        const cell = cells[Math.floor(r() * cells.length)];
        b.card(leafMat, centre, along, vv, size, size * (flat ? 0.75 : 0.85), cell, 4, nn, [y / H, 0.5 + u * 0.5, r()], 0.35);
        if (!flat && !lod && r() < 0.35) {
          const vv2 = rotAxis(vv, along, Math.PI / 2);
          b.card(leafMat, centre, along, vv2, size * 0.85, size * 0.7, cells[Math.floor(r() * cells.length)], 4, nn, [y / H, 0.5 + u * 0.5, r()], 0.35);
        }
      }
    }
  }
  // crown shell: clumps over the conical envelope so the crown reads as a dense mass
  const shellStep = cardSize * (lod ? 1.05 : 0.7);
  for (let y = cb + 0.4; y < H - 0.5; y += shellStep * 0.7) {
    const t = (y - cb) / (H - cb);
    const R = Math.max(0.35, branchMax * Math.pow(1 - t, 0.85) * 0.8 + 0.2);
    const n = Math.max(3, Math.round((2 * Math.PI * R) / (shellStep * (lod ? 1.4 : 1))));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.6 + y;
      const out = [Math.cos(a), 0, Math.sin(a)];
      const tan = [-Math.sin(a), 0, Math.cos(a)];
      const c = add(add(trunkAt(y), mul(out, R * (0.78 + r() * 0.3))), [0, (r() - 0.5) * 0.3, 0]);
      const size = cardSize * (0.9 + r() * 0.45) * (lod ? 1.35 : 1);
      const nn = norm(add(mul(out, 0.85), [0, 0.4, 0]));
      const vert = r() < 0.6;
      const u = vert ? tan : norm(add(out, [0, -0.25, 0]));
      const vv = vert ? norm(add([0, 1, 0], mul(out, -0.35 - r() * 0.2))) : tan;
      b.card(leafMat, c, u, vv, size, size * 0.82, cells[Math.floor(r() * cells.length)], 4, nn, [y / H, 0.8, r()], 0.5);
    }
  }
  // leader tip
  const top = trunkAt(H - 0.2);
  for (let i = 0; i < (lod ? 2 : 4); i++) {
    const a = i * 1.57 + r();
    const vv = [Math.cos(a), 0, Math.sin(a)];
    b.card(leafMat, add(top, [0, -0.15, 0]), [0, 1, 0], vv, cardSize * 0.9, cardSize * 0.55, cells[i % cells.length], 4, norm([vv[0] * 0.3, 0.9, vv[2] * 0.3]), [1, 0.7, r()], 0.3);
  }
}

function broadleaf(b, r, o, lod) {
  const { H, dbh, forkH, crownR, barkMat, leafMat, cells, cardSize } = o;
  const sides = lod ? 6 : 12;
  const tp = trunkPath(r, forkH + 1, o.wander, o.lean, lod ? 4 : 8);
  b.tube(barkMat, tp.map((p, i) => ({ p, r: dbh / 2 * (1 - 0.35 * i / (tp.length - 1)) * (1 + o.flare * Math.exp(-p[1] / 0.6)), w: [p[1] / H * 0.6, 0, 0] })), sides, [1.0, 1.2]);
  const leaves = [];
  const crownC = [tp.at(-1)[0], forkH + (H - forkH) * 0.55, tp.at(-1)[2]];
  function limb(start, dir, L, rad, depth) {
    const pts = [];
    const segs = lod ? 2 : 4;
    const bend = [(r() - 0.5) * 0.4, 0.15, (r() - 0.5) * 0.4];
    let p = start, d = dir;
    pts.push({ p, r: rad, w: [p[1] / H, depth * 0.25, 0] });
    for (let i = 1; i <= segs; i++) {
      d = norm(add(d, mul(bend, 0.35)));
      p = add(p, mul(d, L / segs));
      pts.push({ p, r: rad * (1 - 0.6 * i / segs), w: [p[1] / H, Math.min(1, depth * 0.25 + i / segs * 0.3), 0] });
    }
    if (!lod || depth < 2) b.tube(barkMat, pts, Math.max(4, sides - depth * 3), [0.8, 1]);
    const end = pts.at(-1).p;
    if (depth >= 1 && !lod) leaves.push({ p: pts[segs >> 1].p, d, depth: 3 });
    if (depth >= (lod ? 1 : 2)) { leaves.push({ p: end, d, depth }); if (depth >= 2) leaves.push({ p: pts[segs >> 1].p, d, depth }); return; }
    const kids = 2 + Math.floor(r() * 2);
    for (let k = 0; k < kids; k++) {
      const axis = perp(d);
      let nd = rotAxis(d, axis, (0.45 + r() * 0.5));
      nd = rotAxis(nd, d, k * 6.28 / kids + r());
      nd = norm(add(nd, [0, o.upward, 0]));
      limb(end, nd, L * (0.55 + r() * 0.2), rad * 0.6, depth + 1);
    }
  }
  const nLimbs = 3 + Math.floor(r() * 2);
  const top = tp.at(-1);
  for (let k = 0; k < nLimbs; k++) {
    const a = k * 6.28 / nLimbs + r() * 0.8;
    const tilt = o.limbTilt + r() * 0.3;
    limb(top, norm([Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)]), (H - forkH) * 0.55, dbh * 0.32, 0);
  }
  // leaf clusters: around terminal points + fill the crown shell
  const shell = lod ? 48 : 150;
  for (let i = 0; i < shell; i++) {
    const t = r() * 6.28, ph = Math.acos(1 - r() * 1.6);
    const rr = crownR * (0.55 + Math.sqrt(r()) * 0.5);
    leaves.push({ p: add(crownC, [Math.cos(t) * Math.sin(ph) * rr, Math.cos(ph) * rr * o.crownSquash, Math.sin(t) * Math.sin(ph) * rr]), d: [0, 1, 0], depth: 3 });
  }
  for (const l of leaves) {
    const count = lod ? 1 : l.depth >= 3 ? 1 : 3;
    for (let i = 0; i < count; i++) {
      const out = norm(add(sub(l.p, crownC), [0, 0.3, 0]));
      const u = norm(cross(out, [r() - 0.5, r() - 0.5, r() - 0.5]));
      const vv = norm(cross(out, u));
      const s = cardSize * (0.8 + r() * 0.5) * (lod ? 1.5 : 1);
      const c = add(l.p, mul(out, s * 0.1));
      b.card(leafMat, c, u, vv, s, s, cells[Math.floor(r() * cells.length)], 4, norm(add(mul(out, 0.8), [0, 0.25, 0])), [c[1] / H, 0.8, r()]);
    }
  }
}

function bamboo(b, r, o, lod) {
  const H = o.H, R = o.dbh / 2;
  const segs = lod ? 6 : 18;
  const lean = [(r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6];
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = add([0, t * H, 0], mul(lean, t * t * H * 0.25));
    pts.push({ p, r: R * (1 - 0.55 * t), w: [Math.pow(t, 1.3), 0, 0] });
  }
  b.tube("bamboo_culm", pts, lod ? 5 : 8, [0.06, 0.3]);
  const at = (t) => { const f = t * segs, i = Math.min(segs - 1, Math.floor(f)), a = f - i; return add(mul(pts[i].p, 1 - a), mul(pts[i + 1].p, a)); };
  const nb = lod ? 12 : 34;
  for (let i = 0; i < nb; i++) {
    const t = 0.45 + 0.55 * (i / nb);
    const a = i * 2.4 + r();
    const s = at(t);
    const L = 0.8 + (1 - t) * 1.4;
    const d = norm([Math.cos(a), -0.15 + r() * 0.4, Math.sin(a)]);
    if (!lod) b.tube("bamboo_culm", [{ p: s, r: 0.008, w: [t, 0, 0] }, { p: add(s, mul(d, L)), r: 0.004, w: [t, 0.6, 0] }], 3, [0.06, 0.3]);
    for (let k = 0; k < (lod ? 2 : 4); k++) {
      const c = add(s, mul(d, L * (0.4 + k * 0.3)));
      const vv = rotAxis(perp(d), d, r() * 3);
      b.card("bamboo_leaf", c, d, vv, 1.1 * (lod ? 1.6 : 1), 0.8 * (lod ? 1.6 : 1), Math.floor(r() * 16), 4, norm([d[0], 0.7, d[2]]), [t, 0.8, r()], 0.2);
    }
  }
}

// ---------- species presets ------------------------------------------------------------------
const SPECIES = {
  sugi: (r) => ({ kind: conifer, H: 24 + r() * 6, dbh: 0.42 + r() * 0.18, crownBase: 0.46 + r() * 0.1, branchMax: 2.6 + r() * 0.8, spacing: 0.42,
    angle: [96, 62], droop: 0.12, cardSize: 1.25, cardsPerM: 2.4, leafStart: 0.25, wander: 0.08, lean: 0.004, flare: 0.55,
    barkMat: "bark_sugi", leafMat: "foliage_sugi", cells: [0, 1, 2, 3, 4, 5, 6, 7], flat: false, cardsPerM2: 1 }),
  hinoki: (r) => ({ kind: conifer, H: 19 + r() * 5, dbh: 0.36 + r() * 0.14, crownBase: 0.38 + r() * 0.1, branchMax: 3.0 + r() * 0.8, spacing: 0.5,
    angle: [88, 55], droop: 0.08, cardSize: 1.15, cardsPerM: 2.2, leafStart: 0.3, wander: 0.12, lean: 0.006, flare: 0.4,
    barkMat: "bark_hinoki", leafMat: "foliage_hinoki", cells: [8, 9, 10, 11, 0, 3], flat: true }),
  akamatsu: (r) => ({ kind: conifer, H: 15 + r() * 6, dbh: 0.32 + r() * 0.16, crownBase: 0.58 + r() * 0.12, branchMax: 3.6 + r() * 1.2, spacing: 0.85,
    angle: [70, 45], droop: -0.05, cardSize: 1.35, cardsPerM: 1.5, leafStart: 0.55, wander: 0.9, lean: 0.025, flare: 0.25,
    barkMat: "bark_pine", leafMat: "foliage_pine", cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], flat: false }),
  broadleaf: (r) => ({ kind: broadleaf, H: 11 + r() * 5, dbh: 0.3 + r() * 0.15, forkH: 2.4 + r() * 1.8, crownR: 3.6 + r() * 1.6, crownSquash: 0.8,
    upward: 0.35, limbTilt: 0.6, cardSize: 2.1, wander: 0.25, lean: 0.01, flare: 0.3, barkMat: "bark_broadleaf", leafMat: "foliage_broadleaf", cells: [...Array(16).keys()] }),
  keyaki: (r) => ({ kind: broadleaf, H: 17 + r() * 5, dbh: 0.55 + r() * 0.2, forkH: 3.2 + r() * 1.5, crownR: 5.5 + r() * 1.5, crownSquash: 0.75,
    upward: 0.7, limbTilt: 0.35, cardSize: 2.2, wander: 0.15, lean: 0.004, flare: 0.5, barkMat: "bark_keyaki", leafMat: "foliage_broadleaf", cells: [...Array(16).keys()] }),
  bamboo: (r) => ({ kind: bamboo, H: 11 + r() * 4, dbh: 0.09 + r() * 0.04 }),
};

const io = new NodeIO();
function writeGLB(name, lods) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const mats = new Map();
  const stats = [];
  lods.forEach((builder, li) => {
    const mesh = doc.createMesh(`${name}_lod${li}`);
    let tris = 0;
    for (const [matName, p] of builder.parts) {
      if (!mats.has(matName)) mats.set(matName, doc.createMaterial(matName).setDoubleSided(matName.startsWith("foliage") || matName === "bamboo_leaf")
        .setAlphaMode(matName.startsWith("foliage") || matName === "bamboo_leaf" ? "MASK" : "OPAQUE").setAlphaCutoff(0.5));
      const prim = doc.createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p.pos)).setBuffer(buffer))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p.nrm)).setBuffer(buffer))
        .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(p.uv)).setBuffer(buffer))
        .setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p.col)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(p.count > 65535 ? new Uint32Array(p.idx) : new Uint16Array(p.idx)).setBuffer(buffer))
        .setMaterial(mats.get(matName));
      mesh.addPrimitive(prim);
      tris += p.idx.length / 3;
    }
    scene.addChild(doc.createNode(`${name}_lod${li}`).setMesh(mesh));
    stats.push(tris);
  });
  return io.writeBinary(doc).then((bin) => { fs.writeFileSync(path.join(OUT, `${name}.glb`), bin); return stats; });
}

const index = {};
for (const [species, preset] of Object.entries(SPECIES)) {
  for (let v = 0; v < 4; v++) {
    const seed = 1000 * (Object.keys(SPECIES).indexOf(species) + 1) + v * 17;
    const lods = [0, 1].map((lod) => {
      const r = rng(seed);
      const o = preset(r);
      const b = new Builder();
      o.kind(b, r, o, lod);
      return { b, o };
    });
    const name = `${species}_${v}`;
    const tris = await writeGLB(name, lods.map((l) => l.b));
    index[name] = { species, variant: v, height: +lods[0].o.H.toFixed(2), dbh: +lods[0].o.dbh.toFixed(3), triangles: tris };
    console.log(name, index[name]);
  }
}
fs.writeFileSync(path.join(OUT, "trees.json"), JSON.stringify(index, null, 1));
