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
  surface: (x: number, z: number) => number = () => 0;
  /**
   * Tree sites on the far terrain between the map's own forest and `radius`: [x, y, z, scale] and a
   * species index per tree (sugi/hinoki plantations in patches, pine on high ridges, broadleaf
   * elsewhere). Valley floors outside the map get no trees below `floorY`.
   */
  treeSites(radius: number, spacing: number) {
    const half = this.land.world.data.extent / 2 - 4;
    const hash = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
    const noise = (x: number, z: number) => {
      const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
      const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
      return (hash(xi, zi) * (1 - u) + hash(xi + 1, zi) * u) * (1 - v) + (hash(xi, zi + 1) * (1 - u) + hash(xi + 1, zi + 1) * u) * v;
    };
    const sites: number[] = [], kinds: number[] = [];
    for (let z = -radius; z <= radius; z += spacing)
      for (let x = -radius; x <= radius; x += spacing) {
        const jx = x + (hash(x, z) - 0.5) * spacing * 0.9, jz = z + (hash(z, x) - 0.5) * spacing * 0.9;
        if (Math.abs(jx) < half && Math.abs(jz) < half) continue;
        const r = Math.hypot(jx, jz);
        if (r > radius) continue;
        const y = this.surface(jx, jz);
        // gaps and clearings, thinning towards the edge of the ring
        if (hash(jx * 0.37, jz * 0.71) > 0.86 - 0.25 * Math.max(0, (r - radius * 0.7) / (radius * 0.3))) continue;
        const sl = Math.hypot(this.surface(jx + 6, jz) - y, this.surface(jx, jz + 6) - y) / 6;
        if (y < 6 && sl < 0.05) continue;                      // flat valley floor beyond the map
        const plantation = noise(jx / 260, jz / 260) > 0.5;
        const ridge = y > 160 && noise(jx / 90 + 7.3, jz / 90) > 0.45;
        const k = ridge ? 2 : plantation ? (hash(jx, jz * 3.1) < 0.8 ? 0 : 1) : (hash(jx * 2.3, jz) < 0.85 ? 3 : 4);
        sites.push(jx, y - 0.6, jz, 0.8 + hash(jz, jx * 1.7) * 0.45);
        kinds.push(k);
      }
    return { sites: new Float32Array(sites), kinds: new Uint8Array(kinds) };
  }
  constructor(public land: Landscape) {}
  async load() {
    const meta = await fetch(publicUrl("world/far-terrain.json")).then((r) => r.json());
    const buf = await fetch(publicUrl("world/" + meta.file)).then((r) => r.arrayBuffer());
    const far = await decodePng16(buf, { minHeight: meta.minHeight, range: meta.range });
    const n = meta.resolution as number, E = meta.extent as number;
    const h = this.land.world.height, half = this.land.world.data.extent / 2;
    const pos: number[] = [], idx: number[] = [];
    const inside = (x: number, z: number) => Math.abs(x) < half - 40 && Math.abs(z) < half - 40;
    const vertexY = (x: number, z: number, fy: number) => {
      const cx = T.MathUtils.clamp(x, -half + 1, half - 1), cz = T.MathUtils.clamp(z, -half + 1, half - 1);
      const out = Math.max(Math.abs(x) - half, Math.abs(z) - half, 0);
      const edge = h.sample(cx, cz) * (1 - T.MathUtils.smoothstep(out, 0, 2200));
      let y = Math.max(fy, edge) + (out > 0 ? 0 : -6);
      // keep the curvature of the earth for the farthest ridges (sinks ~2.9 m at 6 km)
      const r = Math.hypot(x, z);
      return y - (r * r) / (2 * 6371000);
    };
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * E, z = (j / (n - 1) - 0.5) * E;
        pos.push(x, vertexY(x, z, far[j * n + i]), z);
      }
    // surface height exactly as the mesh is triangulated (for placing far trees on it)
    this.surface = (x: number, z: number) => {
      const fi = (x / E + 0.5) * (n - 1), fj = (z / E + 0.5) * (n - 1);
      const i = Math.min(Math.max(Math.floor(fi), 0), n - 2), j = Math.min(Math.max(Math.floor(fj), 0), n - 2);
      const a = fi - i, b = fj - j;
      const p = (ii: number, jj: number) => pos[(jj * n + ii) * 3 + 1];
      // the two triangles of the quad: (a,a+n,a+1) and (a+1,a+n,a+n+1)
      return a + b < 1 ? p(i, j) + (p(i + 1, j) - p(i, j)) * a + (p(i, j + 1) - p(i, j)) * b
                       : p(i + 1, j + 1) + (p(i, j + 1) - p(i + 1, j + 1)) * (1 - a) + (p(i + 1, j) - p(i + 1, j + 1)) * (1 - b);
    };
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
          `// forest canopy seen from afar: crowns (15 m), crown clusters (60 m), stands (250 m)
          float crowns = fn(vFW.xz * 0.065), clusters = fn(vFW.xz * 0.017 + 3.1), stands = fn(vFW.xz * 0.004);
          float canopy = crowns * 0.45 + clusters * 0.4 + stands * 0.15;
          float conifer = smoothstep(0.42, 0.62, fn(vFW.xz * 0.0038 + 9.0));
          vec3 sugi = vec3(0.036, 0.052, 0.03), zoki = vec3(0.07, 0.092, 0.045);
          diffuseColor.rgb = mix(zoki, sugi, conifer) * (0.45 + canopy * 1.05);
          // gaps between crowns read darker, never as bare ground
          diffuseColor.rgb *= 0.75 + 0.25 * smoothstep(0.25, 0.55, crowns);`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `{ vec2 q = vFW.xz * 0.065; float a = fn(q), b = fn(q + vec2(0.2, 0.0)), c = fn(q + vec2(0.0, 0.2));
            vec2 q2 = vFW.xz * 0.017 + 3.1; float a2 = fn(q2), b2 = fn(q2 + vec2(0.2, 0.0)), c2 = fn(q2 + vec2(0.0, 0.2));
            vec3 bump = normalize(vec3((a - b) + (a2 - b2) * 0.8, 0.45, (a - c) + (a2 - c2) * 0.8));
            normal = normalize(normal + (viewMatrix * vec4(bump.x, 0.0, bump.z, 0.0)).xyz * 0.9); }`,
        );
    });
    this.mesh = new T.Mesh(g, m);
    this.mesh.receiveShadow = false;
    this.land.scene.add(this.mesh);
  }
}
