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
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
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
      mesh.addPrimitive(doc.createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.attributes.position.array)).setBuffer(buffer))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.attributes.normal.array)).setBuffer(buffer))
        .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(g.attributes.uv.array)).setBuffer(buffer))
        .setMaterial(mat));
    }
    scene.addChild(doc.createNode(nodeName).setMesh(mesh));
  };
  write(model, model.name);
  for (const [n, m] of extraNodes) write(m, n);
  fs.writeFileSync(file, await io.writeBinary(doc));
}
