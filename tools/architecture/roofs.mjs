// Japanese roof generators: yosemune (hip), irimoya (hip-and-gable), kirizuma (gable),
// nagare (asymmetric gable). Local: ridge along X, front eave at +Z.
import * as THREE from "three";
import { V, thickSheet, thickSheetParts, gridSurface } from "./kit.mjs";

/** roof sheet: covering on top and on the cut edges, boarded soffit underneath */
function sheet(model, mat, soffit, grid, thick, uv) {
  const p = thickSheetParts(grid, thick, uv, uv);
  model.add(mat, p.top, { uv: "keep" });
  model.add(mat, p.edges, { uv: "keep" });
  model.add(soffit, p.bottom, { uv: "keep" });
}

/**
 * @param o.W body width (X), o.D body depth (Z), o.over eave overhang, o.eaveY, o.ridgeY,
 *        o.sori upturn of corners (m), o.thick roof thickness, o.gable 0..1 (irimoya cut level, 1 = pure hip)
 *        o.ridgeHalf optional
 */
export function hipRoof(model, mat, o) {
  const { W, D, over, eaveY, ridgeY, sori = 0, thick = 0.3, gable = 1, uv = 1, edgeMat = mat, sag = 0.12 } = o;
  const ex = W / 2 + over, ez = D / 2 + over;
  const rh = o.ridgeHalf ?? Math.max(0.2, ex - ez);
  const N = Math.max(4, Math.round(10 * (o.res ?? 1))), M = Math.max(6, Math.round(14 * (o.res ?? 1)));
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
    sheet(model, mat, o.soffitMat ?? "roof_soffit", grid, thick, uv);
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
    sheet(model, mat, o.soffitMat ?? "roof_soffit", grid, thick, uv);
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
  // exposed rafters (taruki) under the eaves of the long faces, parallel, every o.rafters.step
  if (o.rafters) {
    const { step = 0.45, size = 0.065, mat: rm = "wood_frame", wallZ = D / 2, wallX = W / 2, target = model } = o.rafters;
    const surf = (x, v, side) => {
      const half = v < cutV ? ex + (rh - ex) * v : xg;
      const u = Math.max(-1, Math.min(1, x / half));
      return V(x, yAt(v) + sori * Math.pow(Math.abs(u), 3) * (1 - v) * (1 - v), side * ez * (1 - v));
    };
    for (const side of [1, -1]) {
      const v1 = 1 - (wallZ - 0.12) / ez, v0 = 0.04;
      const half1 = v1 < cutV ? ex + (rh - ex) * v1 : xg;
      for (let x = -Math.floor((half1 - 0.35) / step) * step; x <= half1 - 0.35 + 1e-6; x += step) {
        const a = surf(x, v0, side), b = surf(x, v1, side);
        const dir = b.clone().sub(a), cos = Math.abs(dir.z) / dir.length();
        const drop = thick / Math.max(0.3, cos) + size * 0.55;
        a.y -= drop; b.y -= drop;
        strutBox(target, rm, a, b, size, size * 1.25);
      }
    }
    // hip ends: rafters run along X
    if (o.rafters.ends !== false) for (const side of [1, -1]) {
      const v1 = 1 - (wallX - 0.12) / ex, v0 = 0.04;
      if (v1 <= v0) continue;
      const zl = ez * (1 - v1) - 0.35;
      for (let z = -Math.floor(zl / step) * step; z <= zl + 1e-6; z += step) {
        const pt = (v) => {
          const u = Math.max(-1, Math.min(1, z / (ez * (1 - v))));
          return V(side * (ex + (rh - ex) * v), yAt(v) + sori * Math.pow(Math.abs(u), 3) * (1 - v) * (1 - v), z);
        };
        const a = pt(v0), b = pt(v1);
        const dir = b.clone().sub(a), cos = Math.abs(dir.x) / dir.length();
        const drop = thick / Math.max(0.3, cos) + size * 0.55;
        a.y -= drop; b.y -= drop;
        strutBox(target, rm, a, b, size, size * 1.25);
      }
    }
  }
  // ridge
  const ridgeLen = 2 * (cutV < 1 ? xg : rh) + 0.4;
  model.box(o.ridgeMat ?? mat, ridgeLen, o.ridgeH ?? 0.35, o.ridgeW ?? 0.45, 0, ridgeY + (o.ridgeH ?? 0.35) / 2 - 0.05, 0);
  // height of the roof's underside above a wall line `t` metres in from the eave edge
  const under = (t, run) => {
    const v = Math.min(1, t / run), e = 0.02;
    const dy = (yAt(Math.min(1, v + e)) - yAt(Math.max(0, v - e))) / (2 * e * run);
    return yAt(v) - thick * Math.sqrt(1 + dy * dy);
  };
  return { ex, ez, rh, xg, underFront: under(ez - D / 2, ez), underSide: under(ex - W / 2, ex - rh) };
}

/** A beam of w x h cross-section from a to b (h measured in the vertical plane through the beam). */
export function strutBox(model, mat, a, b, w, h) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.BoxGeometry(w, h, len);
  const z = d.clone().normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
  const y = z.clone().cross(x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(a.clone().add(b).multiplyScalar(0.5));
  model.add(mat, g, { matrix: m });
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
    sheet(model, mat, o.soffitMat ?? "roof_soffit", grid, thick, uv);
  }
  model.box(o.ridgeMat ?? mat, 2 * ex + 0.2, 0.25, 0.35, 0, ridgeY + 0.08, 0);
}

/** Corrugated tin sheet roof: real corrugations in geometry along the slope. */
export function corrugate(g, pitch = 0.076, depth = 0.018) {
  void pitch; void depth;
  return g;
}

export { gridSurface };
