// Geometry kit for procedural architecture. Metres, +Y up, local front = +Z.
// UVs are authored in metres (box projection unless a part supplies its own),
// material names are resolved to photographic PBR sets by the runtime and by
// public/world/materials.json.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Document, NodeIO } from "@gltf-transform/core";
import fs from "node:fs";

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function rng(seed) {
  let s = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Collects geometry per material. */
export class Model {
  constructor(name) {
    this.name = name;
    this.parts = new Map();
  }
  add(material, geometry, { uv = "box", uvScale = 1, matrix = null } = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    if (uv === "box") boxUV(g, uvScale);
    else if (typeof uv === "function") uv(g);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "_occl"].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
    return this;
  }
  box(material, w, h, d, x, y, z, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)), V(1, 1, 1));
    return this.add(material, g, { ...opts, matrix: m });
  }
  cyl(material, r0, r1, h, x, y, z, seg = 16, opts = {}) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, opts.hseg ?? 1, opts.open ?? false);
    const circ = 2 * Math.PI * Math.max(r0, r1);
    const uvs = g.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * circ, uvs.getY(i) * h);
    const m = new THREE.Matrix4().compose(V(x, y + h / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)), V(1, 1, 1));
    return this.add(material, g, { uv: "keep", matrix: m });
  }
  /** Add another model's parts transformed. */
  merge(other, matrix) {
    for (const [mat, gs] of other.parts) for (const g of gs) this.add(mat, g.clone().applyMatrix4(matrix), { uv: "keep" });
    return this;
  }
  triangles() {
    let n = 0;
    for (const gs of this.parts.values()) for (const g of gs) n += g.attributes.position.count / 3;
    return n;
  }
}

/** Per-triangle box projection in metres. */
export function boxUV(g, scale = 1) {
  const p = g.attributes.position, n = p.count;
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    nrm.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const ax = Math.abs(nrm.x), ay = Math.abs(nrm.y), az = Math.abs(nrm.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      let u, w;
      if (ay >= ax && ay >= az) { u = v.x; w = v.z; }
      else if (ax >= az) { u = v.z * Math.sign(nrm.x || 1); w = v.y; }
      else { u = v.x * -Math.sign(nrm.z || 1); w = v.y; }
      uv[(i + k) * 2] = u * scale;
      uv[(i + k) * 2 + 1] = w * scale;
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Quad strip surface from a grid of points [rows][cols] (Vector3). */
export function gridSurface(grid, uScale = 1, vScale = 1, flip = false) {
  const rows = grid.length, cols = grid[0].length;
  const pos = [], uv = [], idx = [];
  // arc-length UVs
  const ulen = grid.map((row) => { const out = [0]; for (let j = 1; j < cols; j++) out.push(out[j - 1] + row[j].distanceTo(row[j - 1])); return out; });
  const vlen = [];
  for (let j = 0; j < cols; j++) { const out = [0]; for (let i = 1; i < rows; i++) out.push(out[i - 1] + grid[i][j].distanceTo(grid[i - 1][j])); vlen.push(out); }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const p = grid[i][j];
      pos.push(p.x, p.y, p.z);
      uv.push(ulen[i][j] * uScale, vlen[j][i] * vScale);
    }
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Thick sheet split into its parts: {top, bottom, edges} (non-indexed). */
export function thickSheetParts(grid, thickness, uScale = 1, vScale = 1) {
  const rows = grid.length, cols = grid[0].length;
  const top = gridSurface(grid, uScale, vScale);
  const n = top.attributes.normal;
  const under = grid.map((row, i) => row.map((p, j) => { const k = i * cols + j; return p.clone().addScaledVector(V(n.getX(k), n.getY(k), n.getZ(k)), -thickness); }));
  const bottom = gridSurface(under, uScale, vScale, true);
  const mid = new THREE.Vector3();
  let cnt = 0;
  for (const row of grid) for (const p of row) { mid.add(p); cnt++; }
  mid.divideScalar(cnt);
  const strips = [gridSurface([grid[rows - 1], under[rows - 1]], uScale, 1), gridSurface([under[0], grid[0]], uScale, 1),
    gridSurface([grid.map((r) => r[0]), under.map((r) => r[0])], uScale, 1), gridSurface([under.map((r) => r[cols - 1]), grid.map((r) => r[cols - 1])], uScale, 1)];
  return { top: top.toNonIndexed(), bottom: bottom.toNonIndexed(), edges: mergeGeometries(strips.map((e) => orientOutward(e.toNonIndexed(), mid))) };
}

/** Thick sheet: top surface grid plus offset underside and closed edges. */
export function thickSheet(grid, thickness, uScale = 1, vScale = 1) {
  const rows = grid.length, cols = grid[0].length;
  const top = gridSurface(grid, uScale, vScale);
  const n = top.attributes.normal;
  const under = grid.map((row, i) => row.map((p, j) => { const k = i * cols + j; return p.clone().addScaledVector(V(n.getX(k), n.getY(k), n.getZ(k)), -thickness); }));
  const bottom = gridSurface(under, uScale, vScale, true);
  const edges = [];
  const edge = (a, b) => edges.push(gridSurface([a, b], uScale, 1));
  edge(grid[rows - 1], under[rows - 1]);
  edge(under[0], grid[0]);
  edge(grid.map((r) => r[0]), under.map((r) => r[0]));
  edge(under.map((r) => r[cols - 1]), grid.map((r) => r[cols - 1]));
  // orient edge strips away from the sheet's mid-surface
  const mid = new THREE.Vector3();
  let cnt = 0;
  for (const row of grid) for (const p of row) { mid.add(p); cnt++; }
  mid.divideScalar(cnt);
  const out = edges.map((e) => orientOutward(e.toNonIndexed(), mid));
  return mergeGeometries([top.toNonIndexed(), bottom.toNonIndexed(), ...out]);
}

/** Flip triangles whose face normal points towards `centre`. Non-indexed input. */
export function orientOutward(g, centre) {
  const p = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const m = a.clone().add(b).add(c).divideScalar(3).sub(centre);
    if (n.dot(m) < 0) {
      for (const attr of Object.values(g.attributes)) {
        const s = attr.itemSize;
        for (let k = 0; k < s; k++) { const t = attr.array[(i + 1) * s + k]; attr.array[(i + 1) * s + k] = attr.array[(i + 2) * s + k]; attr.array[(i + 2) * s + k] = t; }
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

export function lathe(points, seg = 20) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return g;
}

/** Marching cubes over an SDF (negative inside). Returns smooth-normal BufferGeometry. */
export function marchingCubes(sdf, min, max, res) {
  const size = [0, 1, 2].map((i) => max[i] - min[i]);
  const step = Math.max(...size) / res;
  const nx = Math.ceil(size[0] / step) + 1, ny = Math.ceil(size[1] / step) + 1, nz = Math.ceil(size[2] / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    field[(k * ny + j) * nx + i] = sdf(min[0] + i * step, min[1] + j * step, min[2] + k * step);
  // Marching tetrahedra (6 per cube) — compact and crack-free.
  const pos = [];
  const corner = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const tets = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  const P = (i, j, k, c) => [min[0] + (i + corner[c][0]) * step, min[1] + (j + corner[c][1]) * step, min[2] + (k + corner[c][2]) * step];
  const F = (i, j, k, c) => field[((k + corner[c][2]) * ny + (j + corner[c][1])) * nx + (i + corner[c][0])];
  const lerpP = (a, b, fa, fb) => { const t = fa / (fa - fb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    for (const t of tets) {
      const p = t.map((c) => P(i, j, k, c)), f = t.map((c) => F(i, j, k, c));
      const inside = f.map((v) => v < 0);
      const cnt = inside.filter(Boolean).length;
      if (cnt === 0 || cnt === 4) continue;
      const ins = [0, 1, 2, 3].filter((q) => inside[q]), out = [0, 1, 2, 3].filter((q) => !inside[q]);
      const tri = (a, b, c) => pos.push(...a, ...b, ...c);
      if (cnt === 1) {
        const a = ins[0];
        const v = out.map((o) => lerpP(p[a], p[o], f[a], f[o]));
        tri(v[0], v[1], v[2]);
      } else if (cnt === 3) {
        const a = out[0];
        const v = ins.map((o) => lerpP(p[a], p[o], f[a], f[o]));
        tri(v[0], v[2], v[1]);
      } else {
        const [a, b] = ins, [c, d] = out;
        const v1 = lerpP(p[a], p[c], f[a], f[c]), v2 = lerpP(p[a], p[d], f[a], f[d]), v3 = lerpP(p[b], p[c], f[b], f[c]), v4 = lerpP(p[b], p[d], f[b], f[d]);
        tri(v1, v2, v3);
        tri(v3, v2, v4);
      }
    }
  }
  // orient triangles outward using the SDF gradient, then weld for smooth normals
  const e = step * 0.5;
  for (let q = 0; q < pos.length; q += 9) {
    const cx = (pos[q] + pos[q + 3] + pos[q + 6]) / 3, cy = (pos[q + 1] + pos[q + 4] + pos[q + 7]) / 3, cz = (pos[q + 2] + pos[q + 5] + pos[q + 8]) / 3;
    const gx = sdf(cx + e, cy, cz) - sdf(cx - e, cy, cz), gy = sdf(cx, cy + e, cz) - sdf(cx, cy - e, cz), gz = sdf(cx, cy, cz + e) - sdf(cx, cy, cz - e);
    const ux = pos[q + 3] - pos[q], uy = pos[q + 4] - pos[q + 1], uz = pos[q + 5] - pos[q + 2];
    const vx = pos[q + 6] - pos[q], vy = pos[q + 7] - pos[q + 1], vz = pos[q + 8] - pos[q + 2];
    const nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
    if (nx_ * gx + ny_ * gy + nz_ * gz < 0) for (let c = 0; c < 3; c++) { const t = pos[q + 3 + c]; pos[q + 3 + c] = pos[q + 6 + c]; pos[q + 6 + c] = t; }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g = mergeVertices(g, step * 0.01);
  g.computeVertexNormals();
  return g;
}

const io = new NodeIO();
export async function writeModel(model, file, extraNodes = []) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(model.name);
  const write = (m, nodeName) => {
    const mesh = doc.createMesh(nodeName);
    for (const [matName, gs] of m.parts) {
      const g = mergeGeometries(gs);
      const mat = doc.getRoot().listMaterials().find((x) => x.getName() === matName) ?? doc.createMaterial(matName).setDoubleSided(matName.includes("cloth") || matName.includes("paper") || matName.includes("rope"));
      const prim = doc.createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.attributes.position.array)).setBuffer(buffer))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.attributes.normal.array)).setBuffer(buffer))
        .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(g.attributes.uv.array)).setBuffer(buffer))
        .setMaterial(mat);
      // baked sky occlusion (bakeOcclusion), 8-bit; the runtime reads it as `_occl`
      if (g.attributes._occl) {
        const o = g.attributes._occl.array, q = new Uint8Array(o.length);
        for (let i = 0; i < o.length; i++) q[i] = Math.round(Math.min(1, Math.max(0, o[i])) * 255);
        prim.setAttribute("_OCCL", doc.createAccessor().setType("SCALAR").setArray(q).setNormalized(true).setBuffer(buffer));
      }
      mesh.addPrimitive(prim);
    }
    scene.addChild(doc.createNode(nodeName).setMesh(mesh));
  };
  write(model, model.name);
  for (const [n, m] of extraNodes) write(m, n);
  fs.writeFileSync(file, await io.writeBinary(doc));
}

// ---------------------------------------------------------------- baked occlusion
// Buildings are instanced, so their sky occlusion (dark soffits and wall heads under deep eaves,
// inner corners, the foot of a wall) can be baked once per model into a vertex attribute. Large
// faces are split adaptively where the occlusion changes; faces that no ray can leave (the inner
// sides of wall boxes, the undersides of floors) are dropped, since nothing ever sees them.

/** Bounding volume hierarchy over triangles (Float32Array, 9 floats per triangle). */
class TriBVH {
  constructor(tris, flags) {
    this.tris = tris;
    this.flags = flags;
    const n = tris.length / 9;
    this.order = new Uint32Array(n).map((_, i) => i);
    const cen = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) cen[i * 3 + a] = (tris[i * 9 + a] + tris[i * 9 + 3 + a] + tris[i * 9 + 6 + a]) / 3;
    this.cen = cen;
    this.bmin = []; this.bmax = []; this.left = []; this.right = []; this.start = []; this.count = [];
    this.root = this.build(0, n);
    this.bminA = Float32Array.from(this.bmin.flat());
    this.bmaxA = Float32Array.from(this.bmax.flat());
  }
  build(s, e) {
    const id = this.bmin.length;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
    for (let k = s; k < e; k++) {
      const t = this.order[k];
      for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) { const x = this.tris[t * 9 + v * 3 + a]; if (x < mn[a]) mn[a] = x; if (x > mx[a]) mx[a] = x; }
      for (let a = 0; a < 3; a++) { const c = this.cen[t * 3 + a]; if (c < cmn[a]) cmn[a] = c; if (c > cmx[a]) cmx[a] = c; }
    }
    this.bmin.push(mn); this.bmax.push(mx); this.left.push(-1); this.right.push(-1); this.start.push(s); this.count.push(e - s);
    if (e - s <= 4) return id;
    let ax = 0;
    for (let a = 1; a < 3; a++) if (cmx[a] - cmn[a] > cmx[ax] - cmn[ax]) ax = a;
    const sub = Array.from(this.order.subarray(s, e)).sort((p, q) => this.cen[p * 3 + ax] - this.cen[q * 3 + ax]);
    this.order.set(sub, s);
    const m = (s + e) >> 1;
    this.left[id] = this.build(s, m);
    this.right[id] = this.build(m, e);
    return id;
  }
  /** nearest front-facing hit (or any-side hit on double-sided triangles) within tMax: [t, triangle] */
  hit(ox, oy, oz, dx, dy, dz, tMax) {
    const T = this.tris, F = this.flags, bmin = this.bminA, bmax = this.bmaxA;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = tMax, bestTri = -1;
    const stack = [this.root];
    while (stack.length) {
      const nd = stack.pop();
      // slab test
      let t0 = ((ix >= 0 ? bmin[nd * 3] : bmax[nd * 3]) - ox) * ix, t1 = ((ix >= 0 ? bmax[nd * 3] : bmin[nd * 3]) - ox) * ix;
      const ty0 = ((iy >= 0 ? bmin[nd * 3 + 1] : bmax[nd * 3 + 1]) - oy) * iy, ty1 = ((iy >= 0 ? bmax[nd * 3 + 1] : bmin[nd * 3 + 1]) - oy) * iy;
      if (ty0 > t0) t0 = ty0; if (ty1 < t1) t1 = ty1;
      const tz0 = ((iz >= 0 ? bmin[nd * 3 + 2] : bmax[nd * 3 + 2]) - oz) * iz, tz1 = ((iz >= 0 ? bmax[nd * 3 + 2] : bmin[nd * 3 + 2]) - oz) * iz;
      if (tz0 > t0) t0 = tz0; if (tz1 < t1) t1 = tz1;
      if (t0 > t1 || t1 < 0 || t0 > best) continue;
      if (this.left[nd] < 0) {
        for (let k = this.start[nd], e = k + this.count[nd]; k < e; k++) {
          const t = this.order[k], o = t * 9;
          const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
          const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          // det > 0: the ray meets the front face (counter-clockwise winding)
          if (F[t] & 1 ? Math.abs(det) < 1e-12 : det < 1e-12) continue;
          const inv = 1 / det;
          const sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > 1e-4 && tt < best) { best = tt; bestTri = t; }
        }
      } else {
        stack.push(this.left[nd], this.right[nd]);
      }
    }
    return bestTri < 0 ? null : [best, bestTri];
  }
}

const NON_OCCLUDERS = /glass|lens/;
/** cosine-weighted hemisphere directions (Hammersley), z up */
function hemisphere(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let b = i, r = 0, f = 0.5;
    while (b) { if (b & 1) r += f; b >>= 1; f *= 0.5; }
    const u = (i + 0.5) / n, phi = 2 * Math.PI * r;
    const s = Math.sqrt(u);
    out.push([s * Math.cos(phi), s * Math.sin(phi), Math.sqrt(1 - u)]);
  }
  return out;
}

/**
 * Bake sky occlusion into `_occl` (0 = open sky, 1 = fully occluded) on every part of `model`.
 * `occluders`: the model whose surfaces cast the occlusion (defaults to `model`; a simplified LOD
 * passes its detailed parent so both levels darken alike). Returns stats.
 */
export function bakeOcclusion(model, { occluders = model, rays = 48, maxDist = 4.5, groundDist = 1.6, maxLen = 8.0, minLen = 0.45, minArea = 0.2, tol = 0.1, groundWeight = 0.5, cull = true, fine = /^(room|glass)/, fineLen = 0.55 } = {}) {
  // occluder soup + a ground plane at y = 0. Glass lets the light through. The opaque room planes
  // behind windows block from both sides: they close the openings, so the inside of the walls is
  // never seen (and dropped) while whatever shows through glass is kept.
  const soup = [], flags = [];
  for (const [mat, gs] of occluders.parts) {
    if (NON_OCCLUDERS.test(mat)) continue;
    const two = /cloth|paper|rope|^room/.test(mat) ? 1 : 0;
    for (const g of gs) {
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i++) soup.push(p[i]);
      for (let i = 0; i < p.length / 9; i++) flags.push(two);
    }
  }
  const G = 80;
  soup.push(-G, -0.01, -G, -G, -0.01, G, G, -0.01, G, -G, -0.01, -G, G, -0.01, G, G, -0.01, -G);
  flags.push(3, 3);
  const bvh = new TriBVH(Float32Array.from(soup), Uint8Array.from(flags));
  const dirs = hemisphere(rays);
  const memo = new Map();
  let samples = 0;
  const sample = (p, n) => {
    const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)},${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
    let r = memo.get(key);
    if (r) return r;
    samples++;
    // tangent frame, rotated by a hashed angle so neighbouring samples do not band
    const t = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
    const b = n.clone().cross(t);
    const a = (Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453) % 1 * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ox = p.x + n.x * 0.004, oy = p.y + n.y * 0.004, oz = p.z + n.z * 0.004;
    // The image-based light already holds a darker lower hemisphere, so the ground only adds the
    // contact shadow at the foot of a wall (short range). A face counts as enclosed when every ray
    // meets the building itself; the ground closes only faces that rest on it.
    let occ = 0, open = 0;
    const onGround = p.y < 0.03;
    for (const [lx0, ly0, lz] of dirs) {
      const lx = lx0 * ca - ly0 * sa, ly = lx0 * sa + ly0 * ca;
      const dx = t.x * lx + b.x * ly + n.x * lz, dy = t.y * lx + b.y * ly + n.y * lz, dz = t.z * lx + b.z * ly + n.z * lz;
      const h = bvh.hit(ox, oy, oz, dx, dy, dz, 1e3);
      if (!h) { open++; continue; }
      const [d, tri] = h;
      const ground = flags[tri] & 2;
      if (ground && !onGround) open++;
      if (ground) { if (d < groundDist) occ += groundWeight * (1 - (d / groundDist) ** 2); }
      else if (d < maxDist) occ += 1 - (d / maxDist) ** 2;
    }
    r = { occ: Math.min(1, occ / dirs.length), enclosed: open === 0 };
    memo.set(key, r);
    return r;
  };
  let before = 0, after = 0, dropped = 0;
  const out = new Map();
  for (const [mat, gs] of model.parts) {
    const res = [];
    // panes and window rooms are flat quads whose occlusion falls steeply under the eaves: split them
    // finely, or the two triangles of a pane show as a diagonal seam in the reflection
    const isFine = fine.test(mat), mLen = isFine ? fineLen : maxLen, mArea = isFine ? 0.02 : minArea;
    for (const g of gs) {
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      const pos = [], nor = [], uv = [], occl = [];
      const vtx = (i) => ({ p: new THREE.Vector3().fromBufferAttribute(P, i), n: new THREE.Vector3().fromBufferAttribute(N, i).normalize(), uv: new THREE.Vector2().fromBufferAttribute(U, i) });
      const mid = (a, b) => ({ p: a.p.clone().add(b.p).multiplyScalar(0.5), n: a.n.clone().add(b.n).normalize(), uv: a.uv.clone().add(b.uv).multiplyScalar(0.5) });
      const centre = (tri) => ({ p: tri[0].p.clone().add(tri[1].p).add(tri[2].p).divideScalar(3), n: tri[0].n.clone().add(tri[1].n).add(tri[2].n).normalize() });
      // corners of a face often sit inside a neighbouring part (a wall end inside a post), so the
      // test points are inset from the corners
      const enclosed = (tri) => {
        const n = tri[0].n.clone().add(tri[1].n).add(tri[2].n).normalize();
        for (const w of [[0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8], [1 / 3, 1 / 3, 1 / 3]]) {
          const q = tri[0].p.clone().multiplyScalar(w[0]).addScaledVector(tri[1].p, w[1]).addScaledVector(tri[2].p, w[2]);
          if (!sample(q, n).enclosed) return false;
        }
        return true;
      };
      const emit = (tri) => {
        const s = tri.map((v) => sample(v.p, v.n));
        for (let k = 0; k < 3; k++) {
          pos.push(tri[k].p.x, tri[k].p.y, tri[k].p.z);
          nor.push(tri[k].n.x, tri[k].n.y, tri[k].n.z);
          uv.push(tri[k].uv.x, tri[k].uv.y);
          occl.push(s[k].occ);
        }
        after++;
      };
      const refine = (tri, depth) => {
        let e = 0, L = 0;
        for (let k = 0; k < 3; k++) { const d = tri[k].p.distanceTo(tri[(k + 1) % 3].p); if (d > L) { L = d; e = k; } }
        const area = tri[1].p.clone().sub(tri[0].p).cross(tri[2].p.clone().sub(tri[0].p)).length() / 2;
        if (cull && depth > 0 && area > mArea && enclosed(tri)) { dropped++; return; }
        if (depth < 10 && L > Math.min(minLen, mLen) && area > mArea) {
          const P0 = tri[e], Q = tri[(e + 1) % 3], R = tri[(e + 2) % 3];
          const M = mid(P0, Q);
          let split = L > mLen;
          if (!split) {
            const sp = sample(P0.p, P0.n).occ, sq = sample(Q.p, Q.n).occ, sm = sample(M.p, M.n).occ;
            split = Math.abs(sm - (sp + sq) / 2) > tol;
            if (!split) {
              const c = centre(tri);
              const sc = sample(c.p, c.n).occ, avg = tri.reduce((s, v) => s + sample(v.p, v.n).occ, 0) / 3;
              split = Math.abs(sc - avg) > tol * 1.4;
            }
          }
          if (split) { refine([P0, M, R], depth + 1); refine([M, Q, R], depth + 1); return; }
        }
        emit(tri);
      };
      for (let i = 0; i < P.count; i += 3) {
        before++;
        const tri = [vtx(i), vtx(i + 1), vtx(i + 2)];
        // faces no ray can leave (inside walls, under floors) are never seen: drop them unrefined
        if (cull && enclosed(tri)) { dropped++; continue; }
        refine(tri, 0);
      }
      if (!pos.length) continue;
      const o = new THREE.BufferGeometry();
      o.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      o.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      o.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      o.setAttribute("_occl", new THREE.Float32BufferAttribute(occl, 1));
      res.push(o);
    }
    if (res.length) out.set(mat, res);
  }
  model.parts = out;
  model.baked = true;
  return { before, after, dropped, samples };
}
