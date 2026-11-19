import * as T from "three";
import { publicUrl } from "../urls";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import { QUALITY, type Quality } from "../engine/quality";
import { windUniforms } from "./vegetation";
import { loadImageData, type Raster } from "./data";

/** GPU-side copies of the world rasters, shared by grass, rice and water. */
export class WorldTextures {
  height: T.DataTexture;
  veg!: T.Texture;
  splat0!: T.Texture;
  splat1!: T.Texture;
  splat2!: T.Texture;
  paddy!: T.DataTexture;
  /** the vegetation mask and splat maps as written (for the CPU: the GPU copies above are sampled in
   *  the shaders) */
  vegRaster!: Raster;
  splat0Raster!: Raster;
  splat1Raster!: Raster;
  splat2Raster!: Raster;
  constructor(public land: Landscape) {
    const h = land.world.height;
    this.height = new T.DataTexture(h.data, h.n, h.n, T.RedFormat, T.FloatType);
    this.height.minFilter = this.height.magFilter = T.NearestFilter;
    this.height.needsUpdate = true;
  }
  async load() {
    const img = (p: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = publicUrl(p);
      });
    const [veg, s0, s1, s2, vegRaster, r0, r1, r2] = await Promise.all([img("world/vegetation-mask.png"), img("world/splat0.png"), img("world/splat1.png"), img("world/splat2.png"),
      loadImageData("world/vegetation-mask.png"), loadImageData("world/splat0.png"), loadImageData("world/splat1.png"), loadImageData("world/splat2.png")]);
    this.vegRaster = vegRaster;
    this.splat0Raster = r0;
    this.splat1Raster = r1;
    this.splat2Raster = r2;
    const tex = (i: HTMLImageElement) => {
      const t = new T.Texture(i);
      t.flipY = false;
      t.minFilter = T.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.veg = tex(veg);
    this.splat0 = tex(s0);
    this.splat1 = tex(s1);
    this.splat2 = tex(s2);
    // 16-bit paddy level PNG -> float texture (browsers decode PNG16 to 8 bit, so read the raw file)
    const buf = await fetch(publicUrl("world/paddy-level.png")).then((r) => r.arrayBuffer());
    const levels = await decodePng16(buf, this.land.world.data.heightEncoding);
    const n = this.land.world.height.n;
    this.paddy = new T.DataTexture(levels, n, n, T.RedFormat, T.FloatType);
    this.paddy.minFilter = this.paddy.magFilter = T.NearestFilter;
    this.paddy.needsUpdate = true;
  }
  /** the paddy level at x, z as the shaders read it (bilinear over rice texels only; -100 if none) */
  paddyAt(x: number, z: number) {
    const n = this.land.world.height.n, E = this.land.world.data.extent, lv = this.paddy.image.data as unknown as Float32Array;
    const fx = Math.min(Math.max((x / E + 0.5) * (n - 1), 0), n - 1.001), fz = Math.min(Math.max((z / E + 0.5) * (n - 1), 0), n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
    const v = [lv[j * n + i], lv[j * n + i + 1], lv[(j + 1) * n + i], lv[(j + 1) * n + i + 1]];
    const w = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b];
    let ws = 0, s = 0;
    for (let k = 0; k < 4; k++) if (v[k] >= -15) (ws += w[k]), (s += w[k] * v[k]);
    return ws > 1e-4 ? s / ws : -100;
  }
  uniforms() {
    return {
      tHeight: { value: this.height },
      tVeg: { value: this.veg },
      tSplat0: { value: this.splat0 },
      tSplat1: { value: this.splat1 },
      tSplat2: { value: this.splat2 },
      tPaddy: { value: this.paddy },
      uExtent: { value: this.land.world.data.extent },
      uRes: { value: this.land.world.height.n },
    };
  }
}

/** Decode a greyscale 16-bit PNG (as written by PIL) into heights. */
export async function decodePng16(buf: ArrayBuffer, enc: { minHeight: number; range: number }) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let off = 8, w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (off < u8.length) {
    const len = dv.getUint32(off), type = String.fromCharCode(...u8.subarray(off + 4, off + 8));
    if (type === "IHDR") (w = dv.getUint32(off + 8)), (h = dv.getUint32(off + 12));
    if (type === "IDAT") idat.push(u8.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of idat) joined.set(a, p), (p += a.length);
  const raw = new Uint8Array(await new Response(new Blob([joined]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const stride = w * 2;
  const out = new Float32Array(w * h);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 2 ? cur[i - 2] : 0, b = prev[i], c = i >= 2 ? prev[i - 2] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) out[y * w + x] = ((cur[x * 2] << 8) | cur[x * 2 + 1]) / 65535 * enc.range + enc.minHeight;
    [prev, cur] = [cur, prev];
  }
  return out;
}

const SAMPLE_GLSL = /* glsl */ `
  uniform sampler2D tHeight, tVeg, tSplat0, tSplat1, tSplat2, tPaddy;
  uniform float uExtent, uRes;
  float fetchH(sampler2D t, vec2 xz) {
    vec2 f = clamp((xz / uExtent + 0.5) * (uRes - 1.0), vec2(0.0), vec2(uRes - 1.001));
    ivec2 i = ivec2(floor(f)); vec2 a = fract(f);
    float h00 = texelFetch(t, i, 0).r, h10 = texelFetch(t, i + ivec2(1, 0), 0).r;
    float h01 = texelFetch(t, i + ivec2(0, 1), 0).r, h11 = texelFetch(t, i + ivec2(1, 1), 0).r;
    return mix(mix(h00, h10, a.x), mix(h01, h11, a.x), a.y);
  }
  vec2 worldUv(vec2 xz) { return xz / uExtent + 0.5; }
  // paddy level: bilinear over rice texels only (non-rice texels hold minHeight), -100 if none
  float fetchPaddy(vec2 xz) {
    vec2 f = clamp((xz / uExtent + 0.5) * (uRes - 1.0), vec2(0.0), vec2(uRes - 1.001));
    ivec2 i = ivec2(floor(f)); vec2 a = fract(f);
    float h00 = texelFetch(tPaddy, i, 0).r, h10 = texelFetch(tPaddy, i + ivec2(1, 0), 0).r;
    float h01 = texelFetch(tPaddy, i + ivec2(0, 1), 0).r, h11 = texelFetch(tPaddy, i + ivec2(1, 1), 0).r;
    vec4 w = vec4((1.0 - a.x) * (1.0 - a.y), a.x * (1.0 - a.y), (1.0 - a.x) * a.y, a.x * a.y);
    vec4 v = step(vec4(-15.0), vec4(h00, h10, h01, h11));
    w *= v;
    float ws = w.x + w.y + w.z + w.w;
    return ws > 1e-4 ? dot(w, vec4(h00, h10, h01, h11)) / ws : -100.0;
  }
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

function bladeGeometry(blades: number, segs: number, rice: boolean, widthScale = 1) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const rand = (() => { let s = rice ? 7 : 3; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rand() * 0.8;
    const lean = rice ? 0.12 + rand() * 0.3 : 0.15 + rand() * 0.45;
    const hgt = rice ? 0.85 + rand() * 0.3 : 0.45 + rand() * 0.55;
    const w = (rice ? 0.0045 + rand() * 0.002 : 0.006 + rand() * 0.006) * widthScale;
    const dir = [Math.cos(ang), Math.sin(ang)];
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const bend = lean * t * t;
      const x = dir[0] * bend * hgt, z = dir[1] * bend * hgt, y = hgt * (t - 0.5 * lean * t * t * (rice ? 0.7 : 0.4));
      const width = w * (1 - t * 0.85);
      for (const side of [-1, 1]) {
        pos.push(x - dir[1] * width * side, y, z + dir[0] * width * side);
        nrm.push(dir[0] * 0.4, 0.9, dir[1] * 0.4);
        uv.push(side < 0 ? 0 : 1, t);
      }
      if (s < segs) {
        const a = base + s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  if (rice) {
    // drooping panicles (ears) in late August
    for (let k = 0; k < 3; k++) {
      const ang = k * 2.1 + 0.4;
      const base = pos.length / 3;
      const pts = [[0, 0.75], [0.08, 0.95], [0.2, 0.98], [0.3, 0.88]];
      pts.forEach(([r, y], s) => {
        for (const side of [-1, 1]) {
          pos.push(Math.cos(ang) * r - Math.sin(ang) * 0.012 * side, y, Math.sin(ang) * r + Math.cos(ang) * 0.012 * side);
          nrm.push(0, 1, 0);
          uv.push(side < 0 ? 0 : 1, 1.5 + s * 0.1);
        }
        if (s < pts.length - 1) {
          const a = base + s * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      });
    }
  }
  const g = new T.InstancedBufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Bilinear lookup of a world raster as the GPU samples it (texel centres at (i + 0.5) / n, clamped):
 *  the base texel index and the four weights. */
function lookup(r: Raster, x: number, z: number, E: number, out: { k: number[]; w: number[] }) {
  const W = r.width, H = r.height;
  const fx = Math.min(Math.max((x / E + 0.5) * W - 0.5, 0), W - 1.001), fy = Math.min(Math.max((z / E + 0.5) * H - 0.5, 0), H - 1.001);
  const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
  const k = (j * W + i) * 4;
  out.k[0] = k; out.k[1] = k + 4; out.k[2] = k + W * 4; out.k[3] = k + W * 4 + 4;
  out.w[0] = (1 - a) * (1 - b); out.w[1] = a * (1 - b); out.w[2] = (1 - a) * b; out.w[3] = a * b;
}
function channel(r: Raster, l: { k: number[]; w: number[] }, c: number) {
  const d = r.data;
  return (d[l.k[0] + c] * l.w[0] + d[l.k[1] + c] * l.w[1] + d[l.k[2] + c] * l.w[2] + d[l.k[3] + c] * l.w[3]) / 255;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);
/** hash21 of the shaders */
function hash21(x: number, y: number) {
  let px = fract(x * 123.34), py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}

type GrassTile = { key: number; ti: number; tj: number; mesh: T.Mesh | null; on: boolean; done: boolean };

/**
 * Grass (or rice) clumps where they grow, in square tiles around the camera. A tile lists the plants
 * that really stand in it - placed on the CPU once, when the tile comes within reach, from the same
 * masks the shader used to read - with their position, ground height, size and look as instance
 * attributes; tiles out of view are culled and tiles past the radius are not drawn. (Before: one
 * camera-following lattice of every cell within the radius, each vertex reading the masks and the
 * height again and scaling the clumps of bare ground, roads and woods to nothing - up to 830,000
 * triangles for the blades alone, most of them collapsed.)
 * (Unity: terrain detail / GPU instancing from the same masks.)
 */
export class GrassField implements System {
  uniforms: Record<string, T.IUniform>;
  material: T.MeshStandardMaterial;
  base: T.BufferGeometry;
  tiles = new Map<number, GrassTile>();
  density = 1;
  radius: number;
  size: number;
  name: string;
  constructor(
    public land: Landscape,
    public wt: WorldTextures,
    public opts: { rice: boolean; spacing: number; radius: number; blades: number; segs?: number; width?: number; inner?: number; clump?: { geometry: T.BufferGeometry; map: T.Texture; height: number; scale: number }; seed?: number; tile?: number; name?: string },
  ) {
    this.radius = opts.radius;
    this.size = opts.tile ?? 16;
    this.name = opts.name ?? (opts.rice ? "rice-field" : opts.clump ? "grass-clumps" : "grass-field");
    if (opts.clump) {
      // photographic clump (Poly Haven grass_medium_01)
      this.base = new T.BufferGeometry();
      const src = opts.clump.geometry;
      for (const k of ["position", "normal", "uv"]) this.base.setAttribute(k, src.getAttribute(k));
      this.base.setIndex(src.getIndex());
    } else this.base = bladeGeometry(opts.blades, opts.segs ?? (opts.rice ? 6 : 3), opts.rice, opts.width ?? 1);
    this.uniforms = {
      uCam: { value: new T.Vector2() },
      uRadius: { value: opts.radius },
      uYNorm: { value: opts.clump ? 1 / opts.clump.height : 1 },
      uInner: { value: opts.inner ?? 0 },
    };
    const mat = (this.material = new T.MeshStandardMaterial({ roughness: 0.92, side: T.DoubleSide, color: 0xffffff, envMapIntensity: 0.95 }));
    if (opts.clump) {
      mat.map = opts.clump.map;
      mat.alphaTest = 0.45;
      mat.alphaToCoverage = true;
    }
    (mat as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "", ...(opts.rice ? { RICE: "" } : {}), ...(opts.clump ? { PHOTO_CLUMP: "" } : {}) };
    this.land.lib.finish(mat);
    const u = this.uniforms;
    addHook(mat, this.name, (s) => {
      Object.assign(s.uniforms, u, windUniforms);
      s.vertexShader = s.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute vec4 aSite;   // x, ground height, z, size (mask and density included)
          attribute vec4 aLook;   // hash, second hash, field tint (vegetation mask green)
          uniform vec2 uCam; uniform float uRadius, uWindTime, uWindStrength, uYNorm, uInner; uniform vec2 uWindDir;
          varying vec3 vGrassCol; varying float vGrassT;
          float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `
          vec3 objectNormal = vec3(normal);
          {
            float ny = aLook.x * 6.2831;
            objectNormal.xz = mat2(cos(ny), -sin(ny), sin(ny), cos(ny)) * objectNormal.xz;
            // bend normals towards the sky: a clump is lit like a volume, not like flat cards
            objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.55));
          }`,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          vec2 wxz = aSite.xz;
          float hsh = aLook.x, hsh2 = aLook.y, vegG = aLook.z;
          float dist = length(wxz - uCam);
          float fade = (1.0 - smoothstep(uRadius * 0.65, uRadius, dist)) * smoothstep(uInner * 0.8, uInner, dist);
          float scl = aSite.w * fade;
          float yaw = hsh * 6.2831;
          mat2 rot = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw));
          vec3 transformed = vec3(position);
          transformed.xz = rot * transformed.xz;
          transformed *= scl;
          float tY = position.y * uYNorm;
          float gust = sin(uWindTime * 1.3 + dot(wxz, uWindDir) * 0.35) * 0.5 + 0.5;
          float sway = tY * tY * uWindStrength * (0.12 + 0.22 * gust);
          transformed.xz += uWindDir * sway * scl + vec2(sin(uWindTime * 3.1 + hsh * 20.0), cos(uWindTime * 2.7 + hsh2 * 20.0)) * 0.02 * tY;
          transformed += vec3(wxz.x, aSite.y, wxz.y);
          vGrassT = tY;
          #ifdef RICE
            vec3 baseC = vec3(0.018, 0.05, 0.01), tipC = vec3(0.04, 0.13, 0.02), ear = vec3(0.14, 0.15, 0.05);
            // per-blade hue: older lower leaves darker and bluer, young leaves yellower
            float bh = hash21(wxz * 3.17 + floor(position.x * 40.0 + position.z * 23.0));
            vec3 tipVar = mix(tipC * vec3(0.85, 0.95, 1.1), tipC * vec3(1.18, 1.1, 0.8), bh);
            vGrassCol = mix(baseC, tipVar, clamp(uv.y, 0.0, 1.0)) * (0.82 + vegG * 0.25 + hsh * 0.12);
            #ifdef PHOTO_CLUMP
              vGrassCol = vec3(0.52, 0.8, 0.42) * (0.86 + vegG * 0.22 + hsh * 0.12) * mix(vec3(0.88, 1.0, 1.12), vec3(1.16, 1.07, 0.8), fract(vegG * 7.31));
            #endif
            if (uv.y > 1.2) vGrassCol = ear;
          #else
            vec3 baseC = vec3(0.07, 0.1, 0.03), tipC = mix(vec3(0.22, 0.29, 0.08), vec3(0.36, 0.32, 0.14), step(0.85, hsh2));
            vGrassCol = mix(baseC, tipC, uv.y) * (0.8 + hsh * 0.35);
            #ifdef PHOTO_CLUMP
              // tint of the photographed grass: lush late-summer green, a few dry clumps
              vGrassCol = mix(vec3(0.78, 0.95, 0.62), vec3(1.15, 1.0, 0.68), step(0.86, hsh2)) * (0.8 + hsh * 0.3);
            #endif
          #endif`,
        )
        .replace("#include <project_vertex>", "vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;")
        .replace("#include <worldpos_vertex>", "vec4 worldPosition = vec4(transformed, 1.0);")
        .replace("#include <fog_vertex>", "#ifdef USE_FOG\n vFogWorld = transformed;\n #endif");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\n varying vec3 vGrassCol; varying float vGrassT;")
        .replace("#include <map_fragment>", "#ifdef PHOTO_CLUMP\n #include <map_fragment>\n diffuseColor.rgb *= vGrassCol;\n #else\n diffuseColor.rgb = vGrassCol;\n #endif")
        .replace("#include <aomap_fragment>", "reflectedLight.indirectDiffuse *= mix(0.35, 1.0, clamp(vGrassT, 0.0, 1.0));");
    });
  }
  setQuality(q: Quality) {
    this.at = { i: 1e9, j: 1e9 };
    this.density = QUALITY[q].grass.density;
    const f = QUALITY[q].grass.radius;
    this.radius = this.opts.radius * f;
    this.uniforms.uRadius.value = this.radius;
    this.uniforms.uInner.value = (this.opts.inner ?? 0) * f;
    // every tile is placed again for the new density
    for (const t of this.tiles.values()) this.drop(t);
    this.tiles.clear();
  }
  private drop(t: GrassTile) {
    if (!t.mesh) return;
    t.mesh.geometry.dispose();
    this.land.scene.remove(t.mesh);
    t.mesh = null;
  }
  /** plants placed so far (for the profile) */
  placed = 0;
  private look = { k: [0, 0, 0, 0], w: [0, 0, 0, 0] };
  /** Place the plants of one tile (the shader's masks, evaluated once per plant here). */
  private build(t: GrassTile) {
    const o = this.opts, sp = o.spacing, seed = o.seed ?? 0, wt = this.wt, E = this.land.world.data.extent, h = this.land.world.height;
    const veg = wt.vegRaster, s0 = wt.splat0Raster, s1 = wt.splat1Raster, s2 = wt.splat2Raster, l = this.look;
    const x0 = t.ti * this.size, z0 = t.tj * this.size;
    const i0 = Math.ceil(x0 / sp), i1 = Math.ceil((x0 + this.size) / sp), j0 = Math.ceil(z0 / sp), j1 = Math.ceil((z0 + this.size) / sp);
    const site: number[] = [], look: number[] = [];
    let lo = Infinity, hi = -Infinity;
    const base = o.clump ? o.clump.scale : 1;
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        const cx = i * sp, cz = j * sp;
        const hsh = hash21(cx * 0.731 + seed, cz * 0.731 + seed), hsh2 = hash21(cz * 1.37 + 3.1 + seed, cx * 1.37 + 3.1 + seed);
        const jit = o.rice ? 0.12 : 0.9;
        const x = cx + (hsh - 0.5) * sp * jit, z = cz + (hsh2 - 0.5) * sp * jit;
        if (Math.abs(x) > E / 2 - 1 || Math.abs(z) > E / 2 - 1) continue;
        lookup(veg, x, z, E, l);
        let y: number, size: number;
        if (o.rice) {
          if (channel(veg, l, 2) < 0.5) continue;
          lookup(s1, x, z, E, l);
          const dens = smooth(0.3, 0.6, channel(s1, l, 0));
          if (dens <= 0) continue;
          y = wt.paddyAt(x, z);
          if (y < -15) continue;
          y += 0.03;
          size = (0.9 + hsh * 0.25) * dens * base;
          lookup(veg, x, z, E, l);
        } else {
          const a = channel(veg, l, 3);
          if (a <= 0) continue;
          lookup(s0, x, z, E, l);
          let bare = channel(s0, l, 2) + channel(s0, l, 3);
          lookup(s1, x, z, E, l);
          bare += channel(s1, l, 0) + channel(s1, l, 1) + channel(s1, l, 2) + channel(s1, l, 3);
          lookup(s2, x, z, E, l);
          bare += channel(s2, l, 0) + channel(s2, l, 2);
          const dens = Math.min(a * 1.4, 1) * (1 - smooth(0.25, 0.6, bare));
          if (hsh * 0.85 > dens * this.density || dens <= 0) continue;
          y = h.sample(x, z);
          const tall = 0.55 + 0.9 * smooth(0.35, 0.95, a) + (hsh2 >= 0.93 ? 0.5 : 0);
          size = tall * dens * (0.6 + hsh * 0.6) * base;
          lookup(veg, x, z, E, l);
        }
        site.push(x, y, z, size);
        look.push(hsh, hsh2, channel(veg, l, 1), 0);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    const n = site.length / 4;
    this.placed += n;
    if (!n) return;
    const g = new T.InstancedBufferGeometry();
    for (const k of ["position", "normal", "uv"]) g.setAttribute(k, this.base.getAttribute(k));
    g.setIndex(this.base.getIndex());
    g.setAttribute("aSite", new T.InstancedBufferAttribute(new Float32Array(site), 4));
    g.setAttribute("aLook", new T.InstancedBufferAttribute(new Float32Array(look), 4));
    g.instanceCount = n;
    const r = this.size / 2;
    g.boundingSphere = new T.Sphere(new T.Vector3(x0 + r, (lo + hi) / 2 + 0.6, z0 + r), Math.hypot(r * Math.SQRT2, (hi - lo) / 2 + 1.6));
    const m = new T.Mesh(g, this.material);
    m.name = this.name;
    m.receiveShadow = true;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    m.visible = t.on;
    this.land.scene.add(m);
    t.mesh = m;
  }
  private queue: GrassTile[] = [];
  private jump = false;
  private static frame = -1;
  private static spent = 0;
  private at = { i: 1e9, j: 1e9 };
  update(_dt: number, _t: number, cam: T.PerspectiveCamera) {
    (this.uniforms.uCam.value as T.Vector2).set(cam.position.x, cam.position.z);
    const S = this.size, p = cam.position;
    // rice only near the fields' level (not from the shrine's height)
    const ci = Math.floor(p.x / S), cj = Math.floor(p.z / S);
    if (ci !== this.at.i || cj !== this.at.j) {
      this.at = { i: ci, j: cj };
      const r = this.radius, n = Math.ceil(r / S) + 1;
      const want = new Set<number>();
      this.queue = [];
      for (let tj = cj - n; tj <= cj + n; tj++)
        for (let ti = ci - n; ti <= ci + n; ti++) {
          const dx = Math.max(ti * S - p.x, 0, p.x - (ti + 1) * S), dz = Math.max(tj * S - p.z, 0, p.z - (tj + 1) * S);
          if (dx * dx + dz * dz > r * r) continue;
          const key = (tj + 4096) * 8192 + ti + 4096;
          want.add(key);
          let t = this.tiles.get(key);
          if (!t) this.tiles.set(key, (t = { key, ti, tj, mesh: null, on: false, done: false }));
          t.on = true;
          if (t.mesh) t.mesh.visible = true;
          else if (!t.done) this.queue.push(t);
        }
      for (const t of this.tiles.values()) {
        if (want.has(t.key)) continue;
        t.on = false;
        if (t.mesh) t.mesh.visible = false;
        // well out of reach: free it
        if (Math.max(Math.abs(t.ti - ci), Math.abs(t.tj - cj)) > n + 2) (this.drop(t), this.tiles.delete(t.key));
      }
      this.queue.sort((a, b) => Math.hypot(a.ti - ci, a.tj - cj) - Math.hypot(b.ti - ci, b.tj - cj));
      // after a jump nothing around the camera is placed yet: place it all at once
      this.jump = !this.tiles.get((cj + 4096) * 8192 + ci + 4096)?.done;
    }
    // a few tiles a frame, nearest first, within a time budget shared by every field (2 ms a frame)
    if (GrassField.frame !== _t) (GrassField.frame = _t), (GrassField.spent = 0);
    while (this.queue.length && (this.jump || GrassField.spent < 2)) {
      const t0 = performance.now();
      const t = this.queue.shift()!;
      this.build(t);
      t.done = true;
      GrassField.spent += performance.now() - t0;
    }
    this.jump = false;
  }
}

/** Distant rice: a canopy sheet at paddy level + 0.85 m, shaded like a closed rice canopy. */
export class RiceCanopy implements System {
  meshes: T.Mesh[] = [];
  uniforms: Record<string, T.IUniform>;
  /** how far the layers of leaf tips are looked for (beyond it the sheet alone) */
  setQuality(q: Quality) {
    this.uniforms.uShells.value = QUALITY[q].grass.riceLayers;
  }
  constructor(land: Landscape, wt: WorldTextures) {
    const step = land.world.height.spacing, n = land.world.height.n, half = land.world.data.extent / 2;
    const lv = wt.paddy.image.data as Float32Array;
    const level = (i: number, j: number) => lv[Math.min(Math.max(j, 0), n - 1) * n + Math.min(Math.max(i, 0), n - 1)];
    // The sheets cover the rice only (the paddy level runs a little beyond each field), in tiles of
    // about 110 m that the camera can cull: one grid over every field's bounding box was 3 million
    // triangles a frame, most of them over woods, roads and houses, discarded pixel by pixel.
    const TILE = 96;
    const tiles = (k: number) => {
      const out: T.BufferGeometry[] = [];
      for (let tj = 0; tj < n - 1; tj += TILE)
        for (let ti = 0; ti < n - 1; ti += TILE) {
          const pos: number[] = [], idx: number[] = [], vid = new Map<number, number>();
          let lo = Infinity, hi = -Infinity;
          const vert = (i: number, j: number) => {
            const key = j * n + i;
            let v = vid.get(key);
            if (v === undefined) {
              v = pos.length / 3;
              vid.set(key, v);
              const y = level(i, j);
              pos.push(i * step - half, y > -15 ? y : 0, j * step - half);
            }
            return v;
          };
          for (let j = tj; j < Math.min(tj + TILE, n - 1); j += k)
            for (let i = ti; i < Math.min(ti + TILE, n - 1); i += k) {
              const i1 = Math.min(i + k, n - 1), j1 = Math.min(j + k, n - 1);
              const ls = [level(i, j), level(i1, j), level(i, j1), level(i1, j1)].filter((y) => y > -15);
              if (!ls.length) continue;
              for (const y of ls) (lo = Math.min(lo, y)), (hi = Math.max(hi, y));
              const a = vert(i, j), b = vert(i1, j), c = vert(i, j1), d = vert(i1, j1);
              idx.push(a, c, b, b, c, d);
            }
          if (!idx.length) continue;
          // (vertices just outside a field take a neighbour's level in the shader: keep them in range)
          for (let q = 1; q < pos.length; q += 3) pos[q] = Math.min(Math.max(pos[q], lo), hi + 1);
          const g = new T.BufferGeometry();
          g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
          const nrm = new Float32Array(pos.length);
          for (let q = 1; q < nrm.length; q += 3) nrm[q] = 1;
          g.setAttribute("normal", new T.BufferAttribute(nrm, 3));
          g.setAttribute("uv", new T.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
          g.setIndex(idx);
          g.computeBoundingBox();
          g.boundingBox!.max.y += 1.0;
          g.computeBoundingSphere();
          g.boundingSphere!.radius += 1.0;
          out.push(g);
        }
      return out;
    };
    // near the camera the 3D rice hills (photo clumps, full density within ~10 m) are the rice; the
    // sheet and the edge curtain take over beyond them
    this.uniforms = { ...wt.uniforms(), uNearFade: { value: new T.Vector2(6.0, 9.5) }, uShells: { value: 160 } };
    const make = () => {
      const u = this.uniforms;
      const mat = new T.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff, envMapIntensity: 0.9, side: T.FrontSide });
      (mat as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
      land.lib.finish(mat);
      addHook(mat, "rice-canopy", (s) => {
        Object.assign(s.uniforms, u, windUniforms);
        s.vertexShader = s.vertexShader
          .replace("#include <common>", `#include <common>\n${SAMPLE_GLSL}\n varying vec2 vRxz; varying float vRice; varying float vRy;`)
          .replace(
            "#include <begin_vertex>",
            `vec3 transformed = vec3(position);
            float lvl = fetchPaddy(position.xz);
            if (lvl < -15.0) {
              // just outside a field: borrow the neighbouring field's level so the sheet stays flat
              // across the edge and the per-fragment mask cuts it cleanly (no slanted walls)
              for (int k = 0; k < 8; k++) {
                vec2 o = vec2(cos(float(k) * 0.7854), sin(float(k) * 0.7854)) * 2.4;
                lvl = max(lvl, fetchPaddy(position.xz + o));
              }
            }
            float isRice = step(-15.0, lvl);
            float hgt = 0.46;                        // base layer: closed, dark lower canopy
            transformed.y = isRice > 0.5 ? lvl + hgt : fetchH(tHeight, position.xz) - 2.0;
            vRxz = position.xz; vRice = isRice; vRy = transformed.y;`,
          )
          .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);");
        s.fragmentShader = s.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
            uniform sampler2D tVeg; uniform float uExtent, uWindTime, uWindStrength, uShells; uniform vec2 uWindDir, uNearFade;
            varying vec2 vRxz; varying float vRice; varying float vRy;
            float rh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
            float rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(rh(i),rh(i+vec2(1,0)),f.x),mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x),f.y); }`,
          )
          .replace(
            "#include <map_fragment>",
            `vec4 veg = texture2D(tVeg, vRxz / uExtent + 0.5);
            // no walls at the field edges: triangles that touch a non-rice vertex are dropped
            if (veg.b < 0.5 || vRice < 0.999) discard;
            float camD = length(vRxz - cameraPosition.xz);
            float dither = rh(gl_FragCoord.xy);
            if (smoothstep(uNearFade.x, uNearFade.y, camD) < dither) discard;
            float ang = veg.g * 6.2831;
            // The layers of leaf tips above the sheet (three, 0.06-0.36 m up), seen through: where the
            // view ray crossed each layer, top first, is there a leaf? The first hit is what this pixel
            // shows. (They were three more sheets over every field, each lit, shadowed and mostly
            // discarded: four layers of fragments for every pixel of rice out to 160 m.)
            float vShell = 0.0;
            vec2 sway = uWindDir * sin(uWindTime * 1.3 + dot(vRxz, uWindDir) * 0.3) * 0.04;
            if (camD < uShells) {
              vec3 rd = normalize(vec3(vRxz.x, vRy, vRxz.y) - cameraPosition);
              vec2 step1 = rd.xz / max(-rd.y, 0.06);
              for (int k = 3; k >= 1; k--) {
                float fk = float(k);
                vec2 qk = vRxz - step1 * (0.82 * (0.45 + 0.55 * fk / 3.0) - 0.46) + sway * fk;
                // individual leaf tips: a fine noise thresholded harder towards the top layer
                float leaves = rn(qk * 17.0 + fk * 3.7) * 0.65 + rn(qk * 41.0 - fk * 1.3) * 0.35;
                if (leaves >= 0.38 + fk * 0.1 && texture2D(tVeg, qk / uExtent + 0.5).b >= 0.5) { vShell = fk; break; }
              }
            }
            vec2 q = vRxz + sway * vShell;
            float rowCoord = dot(vRxz, vec2(cos(ang), sin(ang))) * 20.9;
            float rowFade = 1.0 - smoothstep(18.0, 40.0, camD);
            // fade the row stripes out before they approach pixel size (no moire at grazing angles)
            float rowAA = 1.0 - smoothstep(0.25, 0.9, fwidth(rowCoord) / 6.2831);
            float rows = mix(1.0, 0.5 + 0.5 * sin(rowCoord), rowFade * rowAA * (1.0 - vShell / 3.0));
            vec2 rq = mat2(0.8, -0.6, 0.6, 0.8) * vRxz;
            float clump = (rn(vRxz * 0.7) + rn(rq * 0.53 + 7.1)) * 0.25 + rn(vRxz * 0.17) * 0.5;
            float wave = sin(dot(vRxz, uWindDir) * 0.16 - uWindTime * 1.4 + rn(vRxz * 0.04) * 6.0);
            vec3 col = mix(vec3(0.035, 0.075, 0.014), vec3(0.075, 0.14, 0.026), clump);
            col *= mix(0.55, 1.12, vShell / 3.0);    // self-shadowed depths, lit tips
            col = mix(col, vec3(0.13, 0.17, 0.05), smoothstep(0.6, 1.0, wave) * 0.3 * uWindStrength * (vShell / 3.0));
            col *= mix(0.86, 1.0, rows) * (0.9 + veg.g * 0.2);
            // each field its own green: planted a week apart, another variety, more or less fertiliser
            col *= mix(vec3(0.88, 1.0, 1.12), vec3(1.16, 1.07, 0.8), fract(veg.g * 7.31));
            diffuseColor.rgb = col;`,
          )
          .replace(
            "#include <normal_fragment_maps>",
            `{ // gentle canopy relief from two rotated octaves (no lattice pattern, small tilt)
              vec2 p1 = vRxz * 2.3, p2 = mat2(0.8, -0.6, 0.6, 0.8) * vRxz * 5.1 + 3.7;
              float e = 0.2;
              float hx = (rn(p1 + vec2(e, 0.0)) - rn(p1 - vec2(e, 0.0))) + 0.5 * (rn(p2 + vec2(e, 0.0)) - rn(p2 - vec2(e, 0.0)));
              float hz = (rn(p1 + vec2(0.0, e)) - rn(p1 - vec2(0.0, e))) + 0.5 * (rn(p2 + vec2(0.0, e)) - rn(p2 - vec2(0.0, e)));
              vec3 pn = normalize(vec3(-hx, 3.2, -hz));
              normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz); }`,
          );
      });
      return mat;
    };
    const baseMat = make();
    for (const g of tiles(1)) {
      const m = new T.Mesh(g, baseMat);
      m.receiveShadow = true;
      m.name = "rice-canopy";
      this.meshes.push(m);
      land.scene.add(m);
    }
    this.curtain = this.buildCurtain(land, wt);
    if (this.curtain) land.scene.add(this.curtain);
  }
  curtain: T.Mesh | null = null;
  /**
   * The side of the rice along every field edge. The canopy sheet and its shells stop at the edge of
   * the rice; seen from a levee or across the fields they ended in a hovering green plate with
   * nothing under it. A vertical band of stems and leaves now stands on the field's level along the
   * edge (the 0.5 contour of the rice mask, by marching squares), so the canopy rises from the field.
   */
  private buildCurtain(land: Landscape, wt: WorldTextures) {
    const lv = wt.paddy.image.data as Float32Array;
    const n = land.world.height.n, sp = land.world.height.spacing, E = land.world.data.extent, half = E / 2;
    // rice edge field: blue channel of the vegetation mask, 0.5 at the edge of the rice; the GPU samples
    // it with texel centres at (i + 0.5) / n, so the contour is traced on those same centres. (Read as
    // written: through a 2D canvas the mask came back premultiplied by its alpha - the grass density,
    // 0 inside the fields - so the rice read as "no rice" and almost no edge was drawn.)
    const px = wt.vegRaster.data;
    const W = wt.vegRaster.width;
    const f = (i: number, j: number) => px[(j * W + i) * 4 + 2] / 255 - 0.5;
    const tx = (i: number) => ((i + 0.5) / W) * E - half;
    const level = (x: number, z: number) => {
      const gi = Math.round((x + half) / sp), gj = Math.round((z + half) / sp);
      let best = -100, nearest = Infinity;
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const v = lv[Math.min(Math.max(gj + dj, 0), n - 1) * n + Math.min(Math.max(gi + di, 0), n - 1)];
          // A neighbouring upper terrace must never lift the lower field's edge.
          const distance=(gi+di-(x+half)/sp)**2+(gj+dj-(z+half)/sp)**2;
          if (v > -15 && distance < nearest) { best=v; nearest=distance; }
        }
      return best;
    };
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
    let along = 0;
    const H0 = 0.02, H1 = 0.84;
    const quad = (ax: number, az: number, bx: number, bz: number, y: number, ox: number, oz: number) => {
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-3) return;
      // outward normal (rice -> outside); wind the quad to face it
      let nx = (bz - az) / l, nz = -(bx - ax) / l;
      if (nx * ox + nz * oz < 0) (nx = -nx), (nz = -nz), ([ax, az, bx, bz] = [bx, bz, ax, az]);
      const u0 = along, u1 = along + l;
      along = u1;
      const v = [
        [ax, y + H0, az, u0, 0], [bx, y + H0, bz, u1, 0], [bx, y + H1, bz, u1, 1],
        [ax, y + H0, az, u0, 0], [bx, y + H1, bz, u1, 1], [ax, y + H1, az, u0, 1],
      ];
      // (a, b, b-top) winds about (-dz, 0, dx), the inward side: reverse it to face out
      for (const k of [0, 2, 1, 3, 5, 4]) {
        const [x, yy, z, uu, vv] = v[k];
        pos.push(x, yy, z);
        nrm.push(nx, 0, nz);
        uv.push(uu, vv);
      }
    };
    // integral image of the rice cells: tiny islands of rice (or holes in it) along the terrace
    // levees would stand up as lone green boxes, so the edge is only drawn where both sides are real
    const I = new Uint32Array((W + 1) * (W + 1));
    for (let j = 0; j < W; j++) {
      let row = 0;
      for (let i = 0; i < W; i++) {
        row += f(i, j) >= 0 ? 1 : 0;
        I[(j + 1) * (W + 1) + i + 1] = I[j * (W + 1) + i + 1] + row;
      }
    }
    const R = 4;
    const riceAround = (i: number, j: number) => {
      const i0 = Math.max(i - R, 0), j0 = Math.max(j - R, 0), i1 = Math.min(i + R + 1, W), j1 = Math.min(j + R + 1, W);
      return [I[j1 * (W + 1) + i1] - I[j0 * (W + 1) + i1] - I[j1 * (W + 1) + i0] + I[j0 * (W + 1) + i0], (i1 - i0) * (j1 - j0)];
    };
    const SEGS: Record<number, [number, number][]> = {
      1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]],
      8: [[2, 3]], 9: [[2, 0]], 10: [[0, 1], [2, 3]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]],
    };
    for (let j = 0; j < W - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const v0 = f(i, j), v1 = f(i + 1, j), v2 = f(i + 1, j + 1), v3 = f(i, j + 1);
        const k = (v0 >= 0 ? 1 : 0) | (v1 >= 0 ? 2 : 0) | (v2 >= 0 ? 4 : 0) | (v3 >= 0 ? 8 : 0);
        if (k === 0 || k === 15) continue;
        const [rc, all] = riceAround(i, j);
        if (rc < 16 || all - rc < 16) continue;
        const x0 = tx(i), x1 = tx(i + 1), z0 = tx(j), z1 = tx(j + 1);
        const t = (a: number, b: number) => a / (a - b);
        // crossing points on the cell edges: 0 bottom (z0), 1 right (x1), 2 top (z1), 3 left (x0)
        const P = [
          [x0 + (x1 - x0) * t(v0, v1), z0], [x1, z0 + (z1 - z0) * t(v1, v2)],
          [x0 + (x1 - x0) * t(v3, v2), z1], [x0, z0 + (z1 - z0) * t(v0, v3)],
        ];
        // direction out of the rice: down the gradient of the edge field
        const gx = (v1 + v2 - v0 - v3) / 2, gz = (v3 + v2 - v0 - v1) / 2;
        for (const [a, b] of SEGS[k]) {
          const mx = (P[a][0] + P[b][0]) / 2, mz = (P[a][1] + P[b][1]) / 2;
          const y = level(mx, mz);
          if (y < -15) continue;
          quad(P[a][0], P[a][1], P[b][0], P[b][1], y, -gx, -gz);
        }
      }
    if (!pos.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    const mat = new T.MeshStandardMaterial({ roughness: 0.9, color: 0xffffff, envMapIntensity: 0.8, side: T.DoubleSide });
    (mat as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
    land.lib.finish(mat);
    // fades in with the base sheet (not the shells), so the sheet never shows an open edge
    const u = { ...wt.uniforms(), uNearFade: { value: new T.Vector2(6.0, 9.5) } };
    addHook(mat, "rice-curtain", (s) => {
      Object.assign(s.uniforms, u, windUniforms);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\n varying vec2 vCuv; varying vec3 vCw;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vCuv = uv; vCw = position;
          // the tops sway with the canopy
          transformed.xz += vec2(0.0) + uv.y * uv.y * 0.05 * sin(uWindTime * 1.3 + dot(position.xz, vec2(0.8, 0.6)) * 0.3);`,
        )
        .replace("#include <common>", "#include <common>\n uniform float uWindTime;");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform vec2 uNearFade; varying vec2 vCuv; varying vec3 vCw;
          float ch(float x){ return fract(sin(x * 127.1) * 43758.5453); }
          float cn(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(ch(i), ch(i + 1.0), f); }`,
        )
        .replace(
          "#include <map_fragment>",
          `float camD = length(vCw.xz - cameraPosition.xz);
          if (smoothstep(uNearFade.x, uNearFade.y, camD) < fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)) discard;
          // ragged top: single leaf blades of each hill reach to different heights, arching out
          float tip = 0.5 + 0.3 * cn(vCuv.x * 3.3) + 0.25 * cn(vCuv.x * 17.0 + 2.0) + 0.15 * cn(vCuv.x * 53.0);
          if (vCuv.y > tip) discard;
          // a little light between the hills low down, where the stems stand apart over the water
          float gap = cn(vCuv.x * 9.6 + 1.3);
          if (vCuv.y < 0.35 && gap > 0.78 - vCuv.y * 0.6) discard;
          // stems and blades: hills every 0.3 m, dark near the water, leaves lighter towards the top
          float hill = 0.5 + 0.5 * sin(vCuv.x * 20.9 + cn(vCuv.x * 1.7) * 3.0);
          float streak = cn(vCuv.x * 37.0 + vCuv.y * 2.0) * 0.5 + cn(vCuv.x * 91.0 - vCuv.y * 9.0) * 0.5;
          vec3 low = vec3(0.014, 0.028, 0.011), high = vec3(0.05, 0.1, 0.02);
          vec3 col = mix(low, high, smoothstep(0.05, 0.9, vCuv.y)) * (0.55 + 0.75 * streak) * mix(0.75, 1.05, hill);
          col *= mix(0.45, 1.0, smoothstep(0.0, 0.3, vCuv.y));     // the shade at the foot of the plants
          diffuseColor.rgb = col;`,
        );
    });
    const mesh = new T.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.name = "rice-curtain";
    return mesh;
  }
}
