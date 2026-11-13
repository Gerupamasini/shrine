import * as T from "three";
import { publicUrl } from "../urls";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import { decodePng16 } from "./grass";

/**
 * The land beyond the map, in two rings. Mid: the same eroded hills as the map itself for
 * 1.6 km on every side (mid-heightmap.png, 12.5 m cells) - the spurs and side valleys that
 * make the ridgelines around the village. Far: broad ranges out to 7 km for the horizon.
 * Inside the map the detailed terrain is used. Shaded as forested slopes (open valley floors
 * outside the map as fields); aerial perspective does most of the work at these distances.
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
        if (this.open(jx, jz) > 0.5) continue;                 // valley floors beyond the map are fields
        const stand = this.standAt(jx, jz);
        if (stand === 3) continue;                                    // a clear-cut: open ground
        const ridge = stand === 4 || (y > 160 && noise(jx / 90 + 7.3, jz / 90) > 0.62);
        const k = ridge ? 2 : stand === 0 || stand === 2 ? (hash(jx, jz * 3.1) < 0.8 ? 0 : 1) : (hash(jx * 2.3, jz) < 0.85 ? 3 : 4);
        // plantations: one age, close to one size; young stands about a third of the height
        const sc = stand === 2 ? 0.34 + hash(jz, jx) * 0.08 : stand === 0 ? 0.95 + hash(jz, jx * 1.7) * 0.15 : 0.75 + hash(jz, jx * 1.7) * 0.5;
        sites.push(jx, y - 0.6, jz, sc);
        kinds.push(k);
      }
    return { sites: new Float32Array(sites), kinds: new Uint8Array(kinds) };
  }
  constructor(public land: Landscape) {}
  /**
   * Forest stands beyond the map, as inside it (generate_world.py, STAND): cells of jittered seeds
   * STAND_CELL apart, each a sugi/hinoki plantation, a natural broadleaf wood, a young plantation, a
   * recent clear-cut or red pine on a high ridge. The lower slopes facing the valleys are mostly
   * planted, the high ground natural. Both the far terrain's canopy colour and the far tree
   * billboards read the same grid (a small float texture), so their boundaries agree.
   */
  static STAND_CELL = 190;
  stands!: { tex: T.DataTexture; n: number; origin: number; data: Float32Array };
  private buildStands(E: number) {
    const C = FarTerrain.STAND_CELL, n = Math.ceil(E / C) + 2, origin = -(n * C) / 2;
    const data = new Float32Array(n * n * 4);
    const hash = (a: number, b: number, k: number) => { const v = Math.sin(a * 12.9898 + b * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const ox = 0.15 + 0.7 * hash(i, j, 1), oz = 0.15 + 0.7 * hash(i, j, 2), r = hash(i, j, 3);
        const x = origin + (i + ox) * C, z = origin + (j + oz) * C;
        const y = this.surface(x, z), open = this.open(x, z);
        const low = y < 230 + 120 * hash(i, j, 4);
        // 0 plantation, 1 natural broadleaf, 2 young plantation, 3 clear-cut, 4 ridge pine
        let t = 1;
        if (y > 520 && r < 0.45) t = 4;
        else if (low || open > 0.2) t = r < 0.06 ? 3 : r < 0.14 ? 2 : r < 0.66 ? 0 : 1;
        else t = r < 0.03 ? 3 : r < 0.25 ? 0 : 1;
        data.set([ox, oz, t, hash(i, j, 5)], (j * n + i) * 4);
      }
    const tex = new T.DataTexture(data, n, n, T.RGBAFormat, T.FloatType);
    tex.minFilter = tex.magFilter = T.NearestFilter;
    tex.needsUpdate = true;
    this.stands = { tex, n, origin, data };
  }
  /** Stand type at (x, z): nearest seed of the 3x3 cells around it. */
  standAt(x: number, z: number) {
    const { n, origin, data } = this.stands, C = FarTerrain.STAND_CELL;
    const ci = Math.floor((x - origin) / C), cj = Math.floor((z - origin) / C);
    let best = 1e18, t = 1;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const i = Math.min(Math.max(ci + di, 0), n - 1), j = Math.min(Math.max(cj + dj, 0), n - 1), k = (j * n + i) * 4;
        const sx = origin + (i + data[k]) * C, sz = origin + (j + data[k + 1]) * C, d = (sx - x) ** 2 + (sz - z) ** 2;
        if (d < best) (best = d), (t = data[k + 2]);
      }
    return t;
  }
  /** 1 on the open valley floors of the mid ring (no forest there), 0 on wooded ground */
  open: (x: number, z: number) => number = () => 0;
  async load() {
    const meta = await fetch(publicUrl("world/far-terrain.json")).then((r) => r.json());
    const [far, mid, cover] = await Promise.all([
      fetch(publicUrl("world/" + meta.file)).then((r) => r.arrayBuffer()).then((b) => decodePng16(b, { minHeight: meta.minHeight, range: meta.range })),
      fetch(publicUrl("world/" + meta.mid.file)).then((r) => r.arrayBuffer()).then((b) => decodePng16(b, { minHeight: meta.mid.minHeight, range: meta.mid.range })),
      new T.ImageLoader().loadAsync(publicUrl("world/" + meta.mid.cover)),
    ]);
    const n = meta.resolution as number, E = meta.extent as number;
    const mn = meta.mid.resolution as number, mE = meta.mid.extent as number;
    const h = this.land.world.height, half = this.land.world.data.extent / 2;
    // land cover of the mid ring (G = open valley floor)
    const cv = document.createElement("canvas");
    cv.width = cv.height = mn;
    const cg = cv.getContext("2d", { willReadFrequently: true })!;
    cg.drawImage(cover, 0, 0);
    const cov = cg.getImageData(0, 0, mn, mn).data;
    this.open = (x, z) => {
      if (Math.abs(x) > mE / 2 || Math.abs(z) > mE / 2) return 0;
      const i = Math.round((x / mE + 0.5) * (mn - 1)), j = Math.round((z / mE + 0.5) * (mn - 1));
      return cov[(j * mn + i) * 4 + 1] / 255;
    };
    const earth = (x: number, z: number) => (x * x + z * z) / (2 * 6371000);   // curvature: ~2.9 m at 6 km
    const pos: number[] = [], idx: number[] = [], kind: number[] = [];
    // --- mid ring: every second sample of the regional model, with a hole for the map
    const st = 2, mm = (mn - 1) / st + 1, ms = (mE / (mn - 1)) * st;
    const inMap = (x: number, z: number) => Math.abs(x) < half - 30 && Math.abs(z) < half - 30;
    for (let j = 0; j < mm; j++)
      for (let i = 0; i < mm; i++) {
        const x = -mE / 2 + i * ms, z = -mE / 2 + j * ms;
        let y = mid[j * st * mn + i * st];
        // under the map the ring lies below the detailed terrain; at its rim it meets it
        const d = Math.max(Math.abs(x), Math.abs(z)) - half;
        if (d < 0) y = Math.min(y, h.sample(x, z)) - Math.min(6, -d * 0.4);
        pos.push(x, y - earth(x, z), z);
        kind.push(this.open(x, z));
      }
    for (let j = 0; j < mm - 1; j++)
      for (let i = 0; i < mm - 1; i++) {
        const x = -mE / 2 + i * ms, z = -mE / 2 + j * ms;
        if (inMap(x, z) && inMap(x + ms, z + ms) && inMap(x + ms, z) && inMap(x, z + ms)) continue;
        const a = j * mm + i;
        idx.push(a, a + mm, a + 1, a + 1, a + mm, a + mm + 1);
      }
    const midSurface = (x: number, z: number) => {
      const fi = (x + mE / 2) / ms, fj = (z + mE / 2) / ms;
      const i = Math.min(Math.max(Math.floor(fi), 0), mm - 2), j = Math.min(Math.max(Math.floor(fj), 0), mm - 2);
      const a = fi - i, b = fj - j;
      const p = (ii: number, jj: number) => pos[(jj * mm + ii) * 3 + 1];
      return a + b < 1 ? p(i, j) + (p(i + 1, j) - p(i, j)) * a + (p(i, j + 1) - p(i, j)) * b
                       : p(i + 1, j + 1) + (p(i, j + 1) - p(i + 1, j + 1)) * (1 - a) + (p(i + 1, j) - p(i + 1, j + 1)) * (1 - b);
    };
    // --- far ranges: outside the mid ring (a little overlap, kept just below it)
    const base = pos.length / 3;
    const inMid = (x: number, z: number) => Math.abs(x) < mE / 2 - 60 && Math.abs(z) < mE / 2 - 60;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * E, z = (j / (n - 1) - 0.5) * E;
        const inside = Math.abs(x) < mE / 2 && Math.abs(z) < mE / 2;
        pos.push(x, far[j * n + i] - earth(x, z) - (inside ? 14 : 0), z);
        kind.push(0);
      }
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const x = (i / (n - 1) - 0.5) * E, z = (j / (n - 1) - 0.5) * E, s = E / (n - 1);
        if (inMid(x, z) && inMid(x + s, z + s) && inMid(x + s, z) && inMid(x, z + s)) continue;
        const a = base + j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    // surface height as the meshes are triangulated (for placing the far trees on them)
    this.surface = (x: number, z: number) => {
      if (Math.abs(x) < mE / 2 - 1 && Math.abs(z) < mE / 2 - 1) return midSurface(x, z);
      const fi = (x / E + 0.5) * (n - 1), fj = (z / E + 0.5) * (n - 1);
      const i = Math.min(Math.max(Math.floor(fi), 0), n - 2), j = Math.min(Math.max(Math.floor(fj), 0), n - 2);
      const a = fi - i, b = fj - j;
      const p = (ii: number, jj: number) => pos[(base + jj * n + ii) * 3 + 1];
      return a + b < 1 ? p(i, j) + (p(i + 1, j) - p(i, j)) * a + (p(i, j + 1) - p(i, j)) * b
                       : p(i + 1, j + 1) + (p(i, j + 1) - p(i + 1, j + 1)) * (1 - a) + (p(i + 1, j) - p(i + 1, j + 1)) * (1 - b);
    };
    this.buildStands(E);
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("aOpen", new T.Float32BufferAttribute(kind, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, envMapIntensity: 0.8 });
    this.land.lib.finish(m);
    const su = { tStands: { value: this.stands.tex }, uStandGrid: { value: new T.Vector3(this.stands.origin, FarTerrain.STAND_CELL, this.stands.n) } };
    addHook(m, "far-terrain-stands", (s) => {
      Object.assign(s.uniforms, su);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\n varying vec3 vFW; attribute float aOpen; varying float vOpen;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vFW = (modelMatrix * vec4(transformed, 1.0)).xyz; vOpen = aOpen;");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vFW; varying float vOpen;
          uniform sampler2D tStands; uniform vec3 uStandGrid;
          // nearest stand seed among the 3x3 cells: x = type, y = distance to the next stand's border
          vec2 standOf(vec2 p) {
            vec2 c = floor((p - uStandGrid.x) / uStandGrid.y);
            float b1 = 1e9, b2 = 1e9, t = 1.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              ivec2 q = ivec2(clamp(c + vec2(i, j), vec2(0.0), vec2(uStandGrid.z - 1.0)));
              vec4 s = texelFetch(tStands, q, 0);
              vec2 sp = uStandGrid.x + (vec2(q) + s.xy) * uStandGrid.y;
              float d = length(sp - p);
              if (d < b1) { b2 = b1; b1 = d; t = s.z; } else if (d < b2) { b2 = d; }
            }
            return vec2(t, (b2 - b1) * 0.5);
          }
          float fh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float fn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(fh(i),fh(i+vec2(1,0)),f.x),mix(fh(i+vec2(0,1)),fh(i+vec2(1,1)),f.x),f.y); }`,
        )
        .replace(
          "#include <map_fragment>",
          `// forest canopy seen from afar: crowns (15 m), crown clusters (60 m), stands (250 m)
          float crowns = fn(vFW.xz * 0.065), clusters = fn(vFW.xz * 0.017 + 3.1), stands = fn(vFW.xz * 0.004);
          vec2 st = standOf(vFW.xz);
          float canopy = crowns * 0.45 + clusters * 0.4 + stands * 0.15;
          vec3 sugi = vec3(0.034, 0.05, 0.029), zoki = vec3(0.07, 0.092, 0.045);
          vec3 col;
          if (st.x < 0.5) col = sugi * (0.7 + 0.45 * crowns);                       // plantation: dark, even
          else if (st.x < 1.5) col = zoki * (0.45 + canopy * 1.05);                  // natural wood: lumpy
          else if (st.x < 2.5) col = vec3(0.08, 0.11, 0.042) * (0.85 + 0.25 * fn(vFW.xz * 0.12));   // young plantation
          else if (st.x < 3.5) col = mix(vec3(0.1, 0.09, 0.055), vec3(0.075, 0.095, 0.045), smoothstep(0.4, 0.7, fn(vFW.xz * 0.08)));  // clear-cut
          else col = vec3(0.052, 0.062, 0.034) * (0.6 + 0.6 * canopy);              // red pine on the ridge
          // the edge of a plantation against the wood next to it reads as a slightly darker line
          col *= mix(0.82, 1.0, smoothstep(2.0, 9.0, st.y));
          diffuseColor.rgb = col;
          // gaps between crowns read darker, never as bare ground
          diffuseColor.rgb *= 0.75 + 0.25 * smoothstep(0.25, 0.55, crowns);
          // valley floors beyond the map: a patchwork of rice fields
          vec2 fc = floor(vFW.xz / vec2(46.0, 24.0));
          vec3 field = mix(vec3(0.075, 0.13, 0.03), vec3(0.11, 0.15, 0.045), fh(fc * 0.37)) * (0.9 + 0.2 * fn(vFW.xz * 0.05));
          diffuseColor.rgb = mix(diffuseColor.rgb, field, smoothstep(0.35, 0.65, vOpen));`,
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
