import * as T from "three";
import { publicUrl } from "../urls";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import { decodePng16 } from "./grass";

/**
 * Distant ranges out to ~7 km. Inside the 1.2 km map the detailed terrain is used;
 * near its border the far mesh continues the map's edge heights so ridges run on
 * outward, then blends into the generated far-field heights. Shaded as forested
 * slopes; aerial perspective does most of the work at these distances.
 */
export class FarTerrain implements System {
  update() {}
  mesh!: T.Mesh;
  constructor(public land: Landscape) {}
  async load() {
    const meta = await fetch(publicUrl("world/far-terrain.json")).then((r) => r.json());
    const buf = await fetch(publicUrl("world/" + meta.file)).then((r) => r.arrayBuffer());
    const far = await decodePng16(buf, { minHeight: meta.minHeight, range: meta.range });
    const n = meta.resolution as number, E = meta.extent as number;
    const h = this.land.world.height, half = this.land.world.data.extent / 2;
    const pos: number[] = [], idx: number[] = [];
    const inside = (x: number, z: number) => Math.abs(x) < half - 40 && Math.abs(z) < half - 40;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * E, z = (j / (n - 1) - 0.5) * E;
        const cx = T.MathUtils.clamp(x, -half + 1, half - 1), cz = T.MathUtils.clamp(z, -half + 1, half - 1);
        const out = Math.max(Math.abs(x) - half, Math.abs(z) - half, 0);
        const edge = h.sample(cx, cz) * (1 - T.MathUtils.smoothstep(out, 0, 2200));
        let y = Math.max(far[j * n + i], edge) + (out > 0 ? 0 : -6);
        // keep the curvature of the earth for the farthest ridges (sinks ~2.9 m at 6 km)
        const r = Math.hypot(x, z);
        y -= (r * r) / (2 * 6371000) * 1.0;
        pos.push(x, y, z);
      }
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const x = (i / (n - 1) - 0.5) * E, z = (j / (n - 1) - 0.5) * E, s = E / (n - 1);
        if (inside(x, z) && inside(x + s, z + s) && inside(x + s, z) && inside(x, z + s)) continue;
        const a = j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, envMapIntensity: 0.8 });
    this.land.lib.finish(m);
    addHook(m, "far-terrain", (s) => {
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\n varying vec3 vFW;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vFW;
          float fh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float fn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(fh(i),fh(i+vec2(1,0)),f.x),mix(fh(i+vec2(0,1)),fh(i+vec2(1,1)),f.x),f.y); }`,
        )
        .replace(
          "#include <map_fragment>",
          `float canopy = fn(vFW.xz * 0.11) * 0.55 + fn(vFW.xz * 0.023) * 0.45;
          float conifer = smoothstep(0.45, 0.6, fn(vFW.xz * 0.004));
          diffuseColor.rgb = mix(vec3(0.05, 0.07, 0.04), vec3(0.065, 0.085, 0.045), conifer) * (0.6 + canopy * 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.17, 0.13), smoothstep(0.35, 0.6, 1.0 - vNormal.y) * 0.4);`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `{ float e = 1.5; vec2 q = vFW.xz * 0.11; float a = fn(q), b = fn(q + vec2(0.17, 0.0)), c = fn(q + vec2(0.0, 0.17));
            vec3 bump = normalize(vec3(a - b, 0.6, a - c));
            normal = normalize(normal + (viewMatrix * vec4(bump.x, 0.0, bump.z, 0.0)).xyz * 0.6); }`,
        );
    });
    this.mesh = new T.Mesh(g, m);
    this.mesh.receiveShadow = false;
    this.land.scene.add(this.mesh);
  }
}
