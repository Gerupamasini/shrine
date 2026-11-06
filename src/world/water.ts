import * as T from "three";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";

/**
 * The stream: a ribbon over the centreline with per-vertex water depth taken from
 * the heightfield. Depth drives absorption and opacity (the stony bed shows through
 * the shallows); a procedural flow normal moves downstream; reflections come from the
 * sky environment, so the sunset sky and the low sun glint on the surface.
 * (Unity: rebuild with a river spline + HDRP/URP water shader.)
 */
export class River implements System {
  mesh: T.Mesh;
  uniforms = { uTimeW: { value: 0 } };
  constructor(land: Landscape) {
    const pts = land.world.data.river.points;
    const h = land.world.height;
    const across = 9;
    const pos: number[] = [], uv: number[] = [], depth: number[] = [], idx: number[] = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z, w] = pts[i];
      const p = pts[Math.min(i + 1, pts.length - 1)], q = pts[Math.max(i - 1, 0)];
      const dx = p[0] - q[0], dz = p[2] - q[2], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      if (i > 0) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][2]);
      const half = w / 2 + 0.6;
      for (let k = 0; k < across; k++) {
        const t = k / (across - 1) * 2 - 1;
        const px = x + nx * t * half, pz = z + nz * t * half;
        pos.push(px, y, pz);
        uv.push(t, dist);
        depth.push(y - h.sample(px, pz));
      }
      if (i < pts.length - 1)
        for (let k = 0; k < across - 1; k++) {
          const a = i * across + k, b = a + across;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setAttribute("aDepth", new T.Float32BufferAttribute(depth, 1));
    g.setAttribute("normal", new T.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new T.MeshStandardMaterial({ color: 0x0f1a17, roughness: 0.05, metalness: 0.0, transparent: true, depthWrite: false, envMapIntensity: 1.25 });
    land.lib.finish(m);
    const u = this.uniforms;
    addHook(m, "river", (s) => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\n attribute float aDepth; varying float vDepth; varying vec2 vFlow;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n vDepth = aDepth; vFlow = uv;");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uTimeW; varying float vDepth; varying vec2 vFlow;
          float wh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float wn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(wh(i),wh(i+vec2(1,0)),f.x),mix(wh(i+vec2(0,1)),wh(i+vec2(1,1)),f.x),f.y); }
          float waves(vec2 p){ return wn(p * 1.3 + vec2(0.0, -uTimeW * 1.1)) * 0.6 + wn(p * 3.7 + vec2(uTimeW * 0.2, -uTimeW * 2.3)) * 0.3 + wn(p * 9.0 + vec2(0.0, -uTimeW * 3.5)) * 0.1; }`,
        )
        .replace(
          "#include <map_fragment>",
          `float d = max(vDepth, 0.0);
          float edge = smoothstep(0.0, 0.08, d);
          diffuseColor.rgb = mix(vec3(0.16, 0.2, 0.15), vec3(0.03, 0.06, 0.055), smoothstep(0.05, 0.8, d));
          diffuseColor.a = edge * clamp(0.3 + d * 0.8, 0.0, 0.88);`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `{ vec2 p = vec2(vFlow.x * 4.0, vFlow.y * 1.6); float e = 0.05;
            float h0 = waves(p), hx = waves(p + vec2(e, 0.0)), hy = waves(p + vec2(0.0, e));
            vec3 wn3 = normalize(vec3((h0 - hx) / e * 0.09, 1.0, (h0 - hy) / e * 0.09));
            normal = normalize((viewMatrix * vec4(wn3, 0.0)).xyz); }`,
        );
    });
    this.mesh = new T.Mesh(g, m);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    land.scene.add(this.mesh);
  }
  update(dt: number) {
    this.uniforms.uTimeW.value += dt;
  }
}
