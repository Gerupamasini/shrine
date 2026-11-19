import type { Heightfield } from "./data";

/**
 * Right-triangulated irregular network (RTIN) over the heightfield: the terrain is drawn with as few
 * triangles as keep it within a height error, so a crest, a step or an edge keeps its vertices and a
 * flat field or an even slope collapses into a few large triangles.
 *
 * Every grid vertex has an error: how far the surface moves if that vertex is left out, and never
 * less than the error of the vertices that depend on it. A mesh for a threshold takes every vertex
 * whose error is above it. The errors are computed once for the whole map, so two neighbouring
 * blocks extracted at the same threshold agree on their shared edge (no cracks); between blocks at
 * different thresholds a skirt hides the step.
 *
 * Grid: the 1793² heightfield sits in a 2049² RTIN grid (2^11 + 1); cells beyond the map repeat its
 * edge. Blocks are 128 cells square and start from their two triangles along the diagonal of the
 * hierarchy above them, so the triangulation inside a block is the global one.
 */
export const RTIN_SIZE = 2048;

/**
 * Per-vertex errors, finest level first. Square centres (half size h) depend on the four midpoints
 * of their sides; side midpoints (half length h) on the centres of the four squares of half size
 * h / 2 around them. `weight` scales a vertex's own error (cultivated land keeps its bunds further).
 */
export function rtinErrors(h: Heightfield, weight?: (i: number, j: number) => number): Float32Array {
  const T = RTIN_SIZE, G = T + 1, n = h.n, d = h.data;
  const H = (x: number, y: number) => d[(y < n ? y : n - 1) * n + (x < n ? x : n - 1)];
  const err = new Float32Array(G * G);
  const own = (x: number, y: number, e: number) => (weight && x < n && y < n ? e * weight(x, y) : e);
  for (let hs = 1; hs <= T / 2; hs *= 2) {
    const S = 2 * hs, q = hs >> 1;
    // side midpoints: horizontal sides (y a multiple of S, x an odd multiple of hs) ...
    for (let y = 0; y <= T; y += S)
      for (let x = hs; x < T; x += S) {
        let e = own(x, y, Math.abs((H(x - hs, y) + H(x + hs, y)) / 2 - H(x, y)));
        if (q) {
          if (y > 0) e = Math.max(e, err[(y - q) * G + x - q], err[(y - q) * G + x + q]);
          if (y < T) e = Math.max(e, err[(y + q) * G + x - q], err[(y + q) * G + x + q]);
        }
        err[y * G + x] = e;
      }
    // ... and vertical sides
    for (let y = hs; y < T; y += S)
      for (let x = 0; x <= T; x += S) {
        let e = own(x, y, Math.abs((H(x, y - hs) + H(x, y + hs)) / 2 - H(x, y)));
        if (q) {
          if (x > 0) e = Math.max(e, err[(y - q) * G + x - q], err[(y + q) * G + x - q]);
          if (x < T) e = Math.max(e, err[(y - q) * G + x + q], err[(y + q) * G + x + q]);
        }
        err[y * G + x] = e;
      }
    // square centres: the diagonal is the one through the centre of the square above (checkerboard)
    for (let y = hs; y < T; y += S)
      for (let x = hs; x < T; x += S) {
        const X = x - hs, Y = y - hs;
        const main = (((X / S) + (Y / S)) & 1) === 0;
        const mid = main ? (H(X, Y) + H(X + S, Y + S)) / 2 : (H(X, Y + S) + H(X + S, Y)) / 2;
        let e = own(x, y, Math.abs(mid - H(x, y)));
        e = Math.max(e, err[y * G + x - hs], err[y * G + x + hs], err[(y - hs) * G + x], err[(y + hs) * G + x]);
        err[y * G + x] = e;
      }
  }
  return err;
}

export type BlockMesh = { position: Float32Array; index: Uint16Array | Uint32Array; minY: number; maxY: number; triangles: number };

/** the largest block side, in cells */
const MAX_BLOCK = 256;
const scratch = new Int32Array((MAX_BLOCK + 1) ** 2);
let stamp = 0;
const marks = new Int32Array((MAX_BLOCK + 1) ** 2);

/**
 * The mesh of one block (cells [i0, i0 + B] x [j0, j0 + B]) for a height error `maxError`, in world
 * coordinates, with a skirt `skirt` metres deep along its four sides. B is a power of two up to 256
 * and i0, j0 multiples of it (a square of the hierarchy). The measured worst error over the map is
 * about 1.5-2 times `maxError` (a vertex's error is measured against its parent's edge, not the final
 * triangle), so callers ask for half the error they can accept.
 */
export function rtinBlock(h: Heightfield, err: Float32Array, i0: number, j0: number, B: number, maxError: number, skirt: number): BlockMesh {
  const G = RTIN_SIZE + 1, n = h.n, d = h.data, s = h.spacing, half = h.extent / 2, R = B + 1;
  stamp++;
  const pos: number[] = [], idx: number[] = [];
  let minY = Infinity, maxY = -Infinity;
  const vert = (x: number, y: number) => {
    const k = (y - j0) * R + (x - i0);
    if (marks[k] === stamp) return scratch[k];
    marks[k] = stamp;
    const v = pos.length / 3;
    scratch[k] = v;
    const hy = d[(y < n ? y : n - 1) * n + (x < n ? x : n - 1)];
    if (hy < minY) minY = hy;
    if (hy > maxY) maxY = hy;
    pos.push(x * s - half, hy, y * s - half);
    return v;
  };
  const emit = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    const a = vert(ax, ay), b = vert(bx, by), c = vert(cx, cy);
    // counter-clockwise seen from above (+y): x right, z towards the viewer
    const ny = (by - ay) * (cx - ax) - (bx - ax) * (cy - ay);
    if (ny > 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  };
  const split = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && err[my * G + mx] > maxError) {
      split(cx, cy, ax, ay, mx, my);
      split(bx, by, cx, cy, mx, my);
    } else emit(ax, ay, bx, by, cx, cy);
  };
  const main = (((i0 / B) + (j0 / B)) & 1) === 0;
  const X1 = i0 + B, Y1 = j0 + B;
  if (main) {
    split(i0, j0, X1, Y1, X1, j0);
    split(X1, Y1, i0, j0, i0, Y1);
  } else {
    split(i0, Y1, X1, j0, i0, j0);
    split(X1, j0, i0, Y1, X1, Y1);
  }
  const triangles = idx.length / 3;
  // skirts: down from every vertex the mesh has along each side (both faces: seen from either side)
  const side = (list: number[]) => {
    let prev = -1;
    for (const k of list) {
      if (marks[k] !== stamp) continue;
      const v = scratch[k];
      if (prev >= 0) {
        const base = pos.length / 3;
        pos.push(pos[prev * 3], pos[prev * 3 + 1] - skirt, pos[prev * 3 + 2], pos[v * 3], pos[v * 3 + 1] - skirt, pos[v * 3 + 2]);
        idx.push(prev, base, v, v, base, base + 1, prev, v, base, v, base + 1, base);
      }
      prev = v;
    }
  };
  const top: number[] = [], bottom: number[] = [], left: number[] = [], right: number[] = [];
  for (let k = 0; k < R; k++) {
    top.push(k);
    bottom.push(B * R + k);
    left.push(k * R);
    right.push(k * R + B);
  }
  [top, bottom, left, right].forEach(side);
  return { position: new Float32Array(pos), index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), minY: minY - skirt, maxY, triangles };
}
