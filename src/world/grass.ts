import * as T from "three";
import { publicUrl } from "../urls";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import type { Quality } from "../engine/lighting";
import { windUniforms } from "./vegetation";

/** GPU-side copies of the world rasters, shared by grass, rice and water. */
export class WorldTextures {
  height: T.DataTexture;
  veg!: T.Texture;
  splat0!: T.Texture;
  splat1!: T.Texture;
  splat2!: T.Texture;
  paddy!: T.DataTexture;
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
    const [veg, s0, s1, s2] = await Promise.all([img("world/vegetation-mask.png"), img("world/splat0.png"), img("world/splat1.png"), img("world/splat2.png")]);
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

function bladeGeometry(blades: number, segs: number, rice: boolean) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const rand = (() => { let s = rice ? 7 : 3; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rand() * 0.8;
    const lean = rice ? 0.12 + rand() * 0.3 : 0.15 + rand() * 0.45;
    const hgt = rice ? 0.85 + rand() * 0.3 : 0.45 + rand() * 0.55;
    const w = rice ? 0.0045 + rand() * 0.002 : 0.006 + rand() * 0.006;
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

/**
 * Camera-following field of instanced grass (or rice) clumps. Instances live on a fixed
 * local grid; the vertex shader snaps the grid to the camera, jitters each cell by a
 * stable world-space hash, reads the ground height and the density masks, and scales
 * clumps to zero where nothing should grow. (Unity: terrain detail / GPU instancing.)
 */
export class GrassField implements System {
  mesh: T.Mesh;
  uniforms: Record<string, T.IUniform>;
  constructor(
    public land: Landscape,
    wt: WorldTextures,
    public opts: { rice: boolean; spacing: number; radius: number; blades: number; inner?: number; clump?: { geometry: T.BufferGeometry; map: T.Texture; height: number; scale: number }; seed?: number },
  ) {
    const { spacing, radius } = opts;
    // instances sorted by distance from the centre: drawing the first N gives a disc of a smaller
    // radius, so quality settings can shrink the field without rebuilding it
    const n = Math.ceil((radius * 2) / spacing);
    const cells: [number, number, number][] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i - n / 2) * spacing, z = (j - n / 2) * spacing, d = Math.hypot(x, z);
      if (d <= radius + spacing) cells.push([x, z, d]);
    }
    cells.sort((a, b) => a[2] - b[2]);
    this.radii = cells.map((c) => c[2]);
    const offsets = new Float32Array(cells.length * 2);
    cells.forEach((c, k) => ((offsets[k * 2] = c[0]), (offsets[k * 2 + 1] = c[1])));
    let g: T.InstancedBufferGeometry;
    if (opts.clump) {
      // photographic clump (Poly Haven grass_medium_01): copy its attributes into an instanced geometry
      g = new T.InstancedBufferGeometry();
      const src = opts.clump.geometry;
      for (const k of ["position", "normal", "uv"]) g.setAttribute(k, src.getAttribute(k));
      g.setIndex(src.getIndex());
    } else g = bladeGeometry(opts.blades, opts.rice ? 6 : 3, opts.rice);
    g.setAttribute("aOffset", new T.InstancedBufferAttribute(offsets, 2));
    g.instanceCount = cells.length;
    this.uniforms = {
      ...wt.uniforms(),
      uCam: { value: new T.Vector2() },
      uSpacing: { value: spacing },
      uRadius: { value: radius },
      uDensity: { value: 1 },
      uYNorm: { value: opts.clump ? 1 / opts.clump.height : 1 },
      uBaseScale: { value: opts.clump ? opts.clump.scale : 1 },
      uInner: { value: opts.inner ?? 0 },
      uSeed: { value: opts.seed ?? 0 },
    };
    const mat = new T.MeshStandardMaterial({ roughness: 0.92, side: T.DoubleSide, color: 0xffffff, envMapIntensity: 0.95 });
    if (opts.clump) {
      mat.map = opts.clump.map;
      mat.alphaTest = 0.45;
      mat.alphaToCoverage = true;
    }
    (mat as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "", ...(opts.rice ? { RICE: "" } : {}), ...(opts.clump ? { PHOTO_CLUMP: "" } : {}) };
    this.land.lib.finish(mat);
    const u = this.uniforms;
    addHook(mat, opts.rice ? "rice-field" : opts.clump ? "grass-clumps" : "grass-field", (s) => {
      Object.assign(s.uniforms, u, windUniforms);
      s.vertexShader = s.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          ${SAMPLE_GLSL}
          attribute vec2 aOffset;
          uniform vec2 uCam; uniform float uSpacing, uRadius, uDensity, uWindTime, uWindStrength, uYNorm, uBaseScale, uInner, uSeed; uniform vec2 uWindDir;
          varying vec3 vGrassCol; varying float vGrassT;
          void grassCell(out vec2 wxz, out float hsh, out float hsh2) {
            vec2 snapC = floor(uCam / uSpacing) * uSpacing;
            vec2 cell = snapC + aOffset;
            hsh = hash21(cell * 0.731 + uSeed); hsh2 = hash21(cell.yx * 1.37 + 3.1 + uSeed);
            #ifdef RICE
              wxz = cell + (vec2(hsh, hsh2) - 0.5) * uSpacing * 0.12;   // transplanted hills stand in rows
            #else
              wxz = cell + (vec2(hsh, hsh2) - 0.5) * uSpacing * 0.9;
            #endif
          }`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `
          vec3 objectNormal = vec3(normal);
          {
            vec2 nw; float nh, nh2;
            grassCell(nw, nh, nh2);
            float ny = nh * 6.2831;
            objectNormal.xz = mat2(cos(ny), -sin(ny), sin(ny), cos(ny)) * objectNormal.xz;
            // bend normals towards the sky: a clump is lit like a volume, not like flat cards
            objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.55));
          }`,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          vec2 wxz; float hsh, hsh2;
          grassCell(wxz, hsh, hsh2);
          vec2 wuv = worldUv(wxz);
          vec4 veg = texture2D(tVeg, wuv);
          vec4 s0 = texture2D(tSplat0, wuv), s1 = texture2D(tSplat1, wuv), s2 = texture2D(tSplat2, wuv);
          float dist = length(wxz - uCam);
          float fade = (1.0 - smoothstep(uRadius * 0.65, uRadius, dist)) * smoothstep(uInner * 0.8, uInner, dist);
          #ifdef RICE
            float dens = step(0.5, veg.b) * smoothstep(0.3, 0.6, s1.r);
            float groundY = fetchPaddy(wxz) + 0.03;
            float scl = (0.9 + hsh * 0.25) * dens * fade * uBaseScale;
          #else
            float bare = s0.b + s0.a + s1.r + s1.g + s1.b + s1.a + s2.r + s2.b;   // dirt..asphalt, furrows, concrete
            float dens = clamp(veg.a * 1.4, 0.0, 1.0) * (1.0 - smoothstep(0.25, 0.6, bare));
            dens *= step(hsh * 0.85, dens * uDensity);
            float groundY = fetchH(tHeight, wxz);
            float tall = 0.55 + 0.9 * smoothstep(0.35, 0.95, veg.a) + 0.5 * step(0.93, hsh2);
            float scl = tall * dens * fade * (0.6 + hsh * 0.6) * uBaseScale;
          #endif
          float yaw = hsh * 6.2831;
          mat2 rot = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw));
          vec3 transformed = vec3(position);
          transformed.xz = rot * transformed.xz;
          transformed *= scl;
          float tY = position.y * uYNorm;
          float gust = sin(uWindTime * 1.3 + dot(wxz, uWindDir) * 0.35) * 0.5 + 0.5;
          float sway = tY * tY * uWindStrength * (0.12 + 0.22 * gust);
          transformed.xz += uWindDir * sway * scl + vec2(sin(uWindTime * 3.1 + hsh * 20.0), cos(uWindTime * 2.7 + hsh2 * 20.0)) * 0.02 * tY;
          transformed += vec3(wxz.x, groundY, wxz.y);
          vGrassT = tY;
          #ifdef RICE
            vec3 baseC = vec3(0.018, 0.05, 0.01), tipC = vec3(0.04, 0.13, 0.02), ear = vec3(0.14, 0.15, 0.05);
            // per-blade hue: older lower leaves darker and bluer, young leaves yellower
            float bh = hash21(wxz * 3.17 + floor(position.x * 40.0 + position.z * 23.0));
            vec3 tipVar = mix(tipC * vec3(0.85, 0.95, 1.1), tipC * vec3(1.18, 1.1, 0.8), bh);
            vGrassCol = mix(baseC, tipVar, clamp(uv.y, 0.0, 1.0)) * (0.82 + veg.g * 0.25 + hsh * 0.12);
            #ifdef PHOTO_CLUMP
              vGrassCol = vec3(0.52, 0.8, 0.42) * (0.86 + veg.g * 0.22 + hsh * 0.12) * mix(vec3(0.88, 1.0, 1.12), vec3(1.16, 1.07, 0.8), fract(veg.g * 7.31));
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
    this.mesh = new T.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    land.scene.add(this.mesh);
  }
  radii: number[] = [];
  setQuality(q: Quality) {
    this.uniforms.uDensity.value = q === "low" ? 0.45 : q === "high" ? 1.0 : 0.8;
    const r = this.opts.radius * (q === "low" ? 0.68 : q === "high" ? 1.0 : 0.88);
    let count = this.radii.length;
    while (count > 0 && this.radii[count - 1] > r) count--;
    (this.mesh.geometry as T.InstancedBufferGeometry).instanceCount = count;
    this.uniforms.uRadius.value = r;
  }
  update(_dt: number, _t: number, cam: T.PerspectiveCamera) {
    (this.uniforms.uCam.value as T.Vector2).set(cam.position.x, cam.position.z);
    if (this.opts.rice) {
      // only draw the rice clumps when a rice field is within reach
      const r = this.opts.radius, p = cam.position;
      this.mesh.visible = this.land.world.data.fields.some(
        (f) => f.type === "rice" && p.x > f.bounds[0] - r && p.x < f.bounds[2] + r && p.z > f.bounds[1] - r && p.z < f.bounds[3] + r && p.y < f.level + 30,
      );
    }
  }
}

/** Distant rice: a canopy sheet at paddy level + 0.85 m, shaded like a closed rice canopy. */
export class RiceCanopy implements System {
  update() {}
  mesh: T.Mesh;
  shells: T.Mesh;
  uniforms: Record<string, T.IUniform>;
  constructor(land: Landscape, wt: WorldTextures) {
    const data = land.world.data;
    const fields = data.fields.filter((f) => f.type === "rice");
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const f of fields) (x0 = Math.min(x0, f.bounds[0])), (z0 = Math.min(z0, f.bounds[1])), (x1 = Math.max(x1, f.bounds[2])), (z1 = Math.max(z1, f.bounds[3]));
    const step = land.world.height.spacing;
    const grid = (k: number) => {
      const nx = Math.ceil((x1 - x0) / (step * k)) + 1, nz = Math.ceil((z1 - z0) / (step * k)) + 1;
      const g = new T.PlaneGeometry(nx * step * k, nz * step * k, nx, nz);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      return g;
    };
    // near the camera the 3D rice hills (photo clumps, full density within ~10 m) are the rice; the
    // sheet, its shells and the edge curtain take over beyond them
    this.uniforms = { ...wt.uniforms(), uNearFade: { value: new T.Vector2(6.0, 9.5) } };
    const shellFade = { uNearFade: { value: new T.Vector2(6.5, 10.0) } };
    const make = (shell: boolean) => {
      const u = shell ? { ...this.uniforms, ...shellFade } : this.uniforms;
      const mat = new T.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff, envMapIntensity: 0.9, side: shell ? T.DoubleSide : T.FrontSide });
      (mat as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "", ...(shell ? { SHELL: "" } : {}) };
      land.lib.finish(mat);
      addHook(mat, shell ? "rice-shells" : "rice-canopy", (s) => {
        Object.assign(s.uniforms, u, windUniforms);
        s.vertexShader = s.vertexShader
          .replace("#include <common>", `#include <common>\n${SAMPLE_GLSL}\n varying vec2 vRxz; varying float vRice; varying float vShell;\n #ifdef SHELL\n attribute float aShell;\n #endif`)
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
            #ifdef SHELL
              vShell = aShell;                       // 1..3: stacked layers of leaves and ears
              float hgt = 0.82 * (0.45 + 0.55 * aShell / 3.0);
            #else
              vShell = 0.0;
              float hgt = 0.46;                      // base layer: closed, dark lower canopy
            #endif
            transformed.y = isRice > 0.5 ? lvl + hgt : fetchH(tHeight, position.xz) - 2.0;
            vRxz = position.xz; vRice = isRice;`,
          )
          .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);");
        s.fragmentShader = s.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
            uniform sampler2D tVeg; uniform float uExtent, uWindTime, uWindStrength; uniform vec2 uWindDir, uNearFade;
            varying vec2 vRxz; varying float vRice; varying float vShell;
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
            vec2 sway = uWindDir * sin(uWindTime * 1.3 + dot(vRxz, uWindDir) * 0.3) * 0.04 * vShell;
            vec2 q = vRxz + sway;
            #ifdef SHELL
              // individual leaf tips: a fine noise thresholded harder towards the top layer
              if (camD > 160.0) discard;
              float leaves = rn(q * 17.0 + vShell * 3.7) * 0.65 + rn(q * 41.0 - vShell * 1.3) * 0.35;
              if (leaves < 0.38 + vShell * 0.1) discard;
            #endif
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
    this.mesh = new T.Mesh(grid(1), make(false));
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    land.scene.add(this.mesh);
    // three upper shells on a coarser grid, as instances of one geometry
    const base = grid(2);
    const sg = new T.InstancedBufferGeometry();
    for (const k of ["position", "normal", "uv"]) sg.setAttribute(k, base.getAttribute(k));
    sg.setIndex(base.getIndex());
    sg.setAttribute("aShell", new T.InstancedBufferAttribute(new Float32Array([1, 2, 3]), 1));
    sg.instanceCount = 3;
    this.shells = new T.Mesh(sg, make(true));
    this.shells.receiveShadow = true;
    this.shells.frustumCulled = false;
    land.scene.add(this.shells);
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
    // it with texel centres at (i + 0.5) / n, so the contour is traced on those same centres
    const img = wt.veg.image as HTMLImageElement;
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const W = img.width;
    const f = (i: number, j: number) => px[(j * W + i) * 4 + 2] / 255 - 0.5;
    const tx = (i: number) => ((i + 0.5) / W) * E - half;
    const level = (x: number, z: number) => {
      const gi = Math.round((x + half) / sp), gj = Math.round((z + half) / sp);
      let best = -100;
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const v = lv[Math.min(Math.max(gj + dj, 0), n - 1) * n + Math.min(Math.max(gi + di, 0), n - 1)];
          if (v > -15 && (best < -15 || Math.abs(di) + Math.abs(dj) < 2)) best = Math.max(best, v);
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
