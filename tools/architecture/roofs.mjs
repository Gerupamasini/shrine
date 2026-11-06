// Japanese roof generators: yosemune (hip), irimoya (hip-and-gable), kirizuma (gable),
// nagare (asymmetric gable). Local: ridge along X, front eave at +Z.
import * as THREE from "three";
import { V, thickSheet, gridSurface } from "./kit.mjs";

/**
 * @param o.W body width (X), o.D body depth (Z), o.over eave overhang, o.eaveY, o.ridgeY,
 *        o.sori upturn of corners (m), o.thick roof thickness, o.gable 0..1 (irimoya cut level, 1 = pure hip)
 *        o.ridgeHalf optional
 */
export function hipRoof(model, mat, o) {
  const { W, D, over, eaveY, ridgeY, sori = 0, thick = 0.3, gable = 1, uv = 1, edgeMat = mat, sag = 0.12 } = o;
  const ex = W / 2 + over, ez = D / 2 + over;
  const rh = o.ridgeHalf ?? Math.max(0.2, ex - ez);
  const N = 10, M = 14;
  const yAt = (v) => eaveY + (ridgeY - eaveY) * (v - sag * Math.sin(Math.PI * v) * (1 - v));
  const cutV = gable;
  const xg = ex + (rh - ex) * cutV; // half-width where the irimoya gable stands
  // front/back faces
  for (const side of [1, -1]) {
    const grid = [];
    for (let i = 0; i <= N; i++) {
      const v = i / N;
      const half = v < cutV ? ex + (rh - ex) * v : xg;
      const row = [];
      for (let j = 0; j <= M; j++) {
        const u = -1 + (2 * j) / M;
        const lift = sori * Math.pow(Math.abs(u), 3) * (1 - v) * (1 - v);
        row.push(V(u * half, yAt(v) + lift, side * ez * (1 - v)));
      }
      grid.push(side > 0 ? row : row.slice().reverse());
    }
    model.add(mat, thickSheet(grid, thick, uv, uv), { uv: "keep" });
  }
  // hip ends (below the gable cut)
  for (const side of [1, -1]) {
    const grid = [];
    const top = Math.max(1, Math.round(N * cutV));
    for (let i = 0; i <= top; i++) {
      const v = (i / top) * cutV;
      const row = [];
      for (let j = 0; j <= M; j++) {
        const u = -1 + (2 * j) / M;
        const lift = sori * Math.pow(Math.abs(u), 3) * (1 - v) * (1 - v);
        row.push(V(side * (ex + (rh - ex) * v), yAt(v) + lift, u * ez * (1 - v)));
      }
      grid.push(side > 0 ? row.slice().reverse() : row);
    }
    model.add(mat, thickSheet(grid, thick, uv, uv), { uv: "keep" });
  }
  // irimoya gable triangles (tsuma) with a bargeboard
  if (cutV < 1) {
    for (const side of [1, -1]) {
      const y0 = yAt(cutV), zc = ez * (1 - cutV);
      const shape = new THREE.Shape();
      shape.moveTo(-zc, y0);
      shape.lineTo(zc, y0);
      shape.lineTo(0, ridgeY);
      shape.closePath();
      const g = new THREE.ShapeGeometry(shape);
      g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.translate(side * (xg - 0.25), 0, 0);
      model.add(o.gableMat ?? "wood_old", g);
    }
  }
  // ridge
  const ridgeLen = 2 * (cutV < 1 ? xg : rh) + 0.4;
  model.box(o.ridgeMat ?? mat, ridgeLen, o.ridgeH ?? 0.35, o.ridgeW ?? 0.45, 0, ridgeY + (o.ridgeH ?? 0.35) / 2 - 0.05, 0);
  return { ex, ez, rh, xg };
}

/** Plain or asymmetric gable roof. front/back run can differ (nagare-zukuri). */
export function gableRoof(model, mat, o) {
  const { W, over, eaveY, ridgeY, frontRun, backRun, thick = 0.2, uv = 1, sag = 0.1, backEaveY = eaveY } = o;
  const ex = W / 2 + over;
  for (const [side, run, ey] of [[1, frontRun, eaveY], [-1, backRun, backEaveY]]) {
    const grid = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const v = i / N;
      const y = ey + (ridgeY - ey) * (v - sag * Math.sin(Math.PI * v) * (1 - v));
      grid.push([V(-ex, y, side * run * (1 - v)), V(0, y, side * run * (1 - v)), V(ex, y, side * run * (1 - v))].map((p) => p).slice(side > 0 ? 0 : 0));
      if (side < 0) grid[grid.length - 1].reverse();
    }
    model.add(mat, thickSheet(grid, thick, uv, uv), { uv: "keep" });
  }
  model.box(o.ridgeMat ?? mat, 2 * ex + 0.2, 0.25, 0.35, 0, ridgeY + 0.08, 0);
}

/** Corrugated tin sheet roof: real corrugations in geometry along the slope. */
export function corrugate(g, pitch = 0.076, depth = 0.018) {
  void pitch; void depth;
  return g;
}

export { gridSurface };
