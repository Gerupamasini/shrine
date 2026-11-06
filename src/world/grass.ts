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
    const [veg, s0, s1] = await Promise.all([img("world/vegetation-mask.png"), img("world/splat0.png"), img("world/splat1.png")]);
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
  uniform sampler2D tHeight, tVeg, tSplat0, tSplat1, tPaddy;
  uniform float uExtent, uRes;
  float fetchH(sampler2D t, vec2 xz) {
    vec2 f = clamp((xz / uExtent + 0.5) * (uRes - 1.0), vec2(0.0), vec2(uRes - 1.001));
    ivec2 i = ivec2(floor(f)); vec2 a = fract(f);
    float h00 = texelFetch(t, i, 0).r, h10 = texelFetch(t, i + ivec2(1, 0), 0).r;
    float h01 = texelFetch(t, i + ivec2(0, 1), 0).r, h11 = texelFetch(t, i + ivec2(1, 1), 0).r;
    return mix(mix(h00, h10, a.x), mix(h01, h11, a.x), a.y);
  }
  vec2 worldUv(vec2 xz) { return xz / uExtent + 0.5; }
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

function bladeGeometry(blades: number, segs: number, rice: boolean) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const rand = (() => { let s = rice ? 7 : 3; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rand() * 0.8;
    const lean = rice ? 0.28 + rand() * 0.35 : 0.15 + rand() * 0.45;
    const hgt = rice ? 0.85 + rand() * 0.3 : 0.45 + rand() * 0.55;
    const w = rice ? 0.0065 + rand() * 0.003 : 0.006 + rand() * 0.006;
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
    public opts: { rice: boolean; spacing: number; radius: number; blades: number },
  ) {
    const { spacing, radius } = opts;
    const n = Math.ceil((radius * 2) / spacing);
    const offsets = new Float32Array(n * n * 2);
    let k = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      offsets[k++] = (i - n / 2) * spacing;
      offsets[k++] = (j - n / 2) * spacing;
    }
    const g = bladeGeometry(opts.blades, opts.rice ? 4 : 3, opts.rice);
    g.setAttribute("aOffset", new T.InstancedBufferAttribute(offsets, 2));
    g.instanceCount = n * n;
    this.uniforms = {
      ...wt.uniforms(),
      uCam: { value: new T.Vector2() },
      uSpacing: { value: spacing },
      uRadius: { value: radius },
      uDensity: { value: 1 },
    };
    const mat = new T.MeshStandardMaterial({ roughness: 0.92, side: T.DoubleSide, color: 0xffffff, envMapIntensity: 0.45 });
    (mat as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "", ...(opts.rice ? { RICE: "" } : {}) };
    this.land.lib.finish(mat);
    const u = this.uniforms;
    addHook(mat, opts.rice ? "rice-field" : "grass-field", (s) => {
      Object.assign(s.uniforms, u, windUniforms);
      s.vertexShader = s.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          ${SAMPLE_GLSL}
          attribute vec2 aOffset;
          uniform vec2 uCam; uniform float uSpacing, uRadius, uDensity, uWindTime, uWindStrength; uniform vec2 uWindDir;
          varying vec3 vGrassCol; varying float vGrassT;`,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          vec2 snapC = floor(uCam / uSpacing) * uSpacing;
          vec2 cell = snapC + aOffset;
          float hsh = hash21(cell * 0.731), hsh2 = hash21(cell.yx * 1.37 + 3.1);
          vec2 wxz = cell + (vec2(hsh, hsh2) - 0.5) * uSpacing * 0.9;
          vec2 wuv = worldUv(wxz);
          vec4 veg = texture2D(tVeg, wuv);
          vec4 s0 = texture2D(tSplat0, wuv), s1 = texture2D(tSplat1, wuv);
          float dist = length(wxz - uCam);
          float fade = 1.0 - smoothstep(uRadius * 0.65, uRadius, dist);
          #ifdef RICE
            float dens = step(0.5, veg.b) * smoothstep(0.3, 0.6, s1.r);
            float groundY = fetchH(tPaddy, wxz) + 0.03;
            float scl = (0.9 + hsh * 0.25) * dens * fade;
          #else
            float bare = s0.b + s0.a + s1.r + s1.g + s1.b + s1.a;
            float dens = clamp(veg.a * 1.4, 0.0, 1.0) * (1.0 - smoothstep(0.25, 0.6, bare));
            dens *= step(hsh * 0.85, dens * uDensity);
            float groundY = fetchH(tHeight, wxz);
            float tall = 0.55 + 0.9 * smoothstep(0.35, 0.95, veg.a) + 0.5 * step(0.93, hsh2);
            float scl = tall * dens * fade * (0.6 + hsh * 0.6);
          #endif
          float yaw = hsh * 6.2831;
          mat2 rot = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw));
          vec3 transformed = vec3(position);
          transformed.xz = rot * transformed.xz;
          transformed *= scl;
          float tY = position.y;
          float gust = sin(uWindTime * 1.3 + dot(wxz, uWindDir) * 0.35) * 0.5 + 0.5;
          float sway = tY * tY * uWindStrength * (0.12 + 0.22 * gust);
          transformed.xz += uWindDir * sway * scl + vec2(sin(uWindTime * 3.1 + hsh * 20.0), cos(uWindTime * 2.7 + hsh2 * 20.0)) * 0.02 * tY;
          transformed += vec3(wxz.x, groundY, wxz.y);
          vGrassT = uv.y;
          #ifdef RICE
            vec3 baseC = vec3(0.035, 0.07, 0.015), tipC = vec3(0.12, 0.2, 0.035), ear = vec3(0.3, 0.27, 0.1);
            vGrassCol = mix(baseC, tipC, clamp(uv.y, 0.0, 1.0)) * (0.88 + veg.g * 0.25);
            if (uv.y > 1.2) vGrassCol = ear;
          #else
            vec3 baseC = vec3(0.04, 0.065, 0.015), tipC = mix(vec3(0.14, 0.2, 0.045), vec3(0.3, 0.26, 0.1), step(0.85, hsh2));
            vGrassCol = mix(baseC, tipC, uv.y) * (0.8 + hsh * 0.35);
          #endif`,
        )
        .replace("#include <project_vertex>", "vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;")
        .replace("#include <worldpos_vertex>", "vec4 worldPosition = vec4(transformed, 1.0);")
        .replace("#include <fog_vertex>", "#ifdef USE_FOG\n vFogWorld = transformed;\n #endif");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\n varying vec3 vGrassCol; varying float vGrassT;")
        .replace("#include <map_fragment>", "diffuseColor.rgb = vGrassCol;")
        .replace("#include <aomap_fragment>", "reflectedLight.indirectDiffuse *= mix(0.35, 1.0, clamp(vGrassT, 0.0, 1.0));");
    });
    this.mesh = new T.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    land.scene.add(this.mesh);
  }
  setQuality(q: Quality) {
    this.uniforms.uDensity.value = q === "low" ? 0.45 : q === "high" ? 1.0 : 0.8;
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
  uniforms: Record<string, T.IUniform>;
  constructor(land: Landscape, wt: WorldTextures) {
    const data = land.world.data;
    const fields = data.fields.filter((f) => f.type === "rice");
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const f of fields) (x0 = Math.min(x0, f.bounds[0])), (z0 = Math.min(z0, f.bounds[1])), (x1 = Math.max(x1, f.bounds[2])), (z1 = Math.max(z1, f.bounds[3]));
    const step = land.world.height.spacing;
    const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
    const g = new T.PlaneGeometry(nx * step, nz * step, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.uniforms = { ...wt.uniforms(), uNearFade: { value: new T.Vector2(14, 26) } };
    const u = this.uniforms;
    const mat = new T.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff, envMapIntensity: 0.5 });
    (mat as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
    land.lib.finish(mat);
    addHook(mat, "rice-canopy", (s) => {
      Object.assign(s.uniforms, u, windUniforms);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", `#include <common>\n${SAMPLE_GLSL}\n varying vec2 vRxz; varying float vRice;`)
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
          vec2 wuv = worldUv(position.xz);
          float lvl = fetchH(tPaddy, position.xz);
          float isRice = step(-15.0, lvl);
          transformed.y = isRice > 0.5 ? lvl + 0.82 : fetchH(tHeight, position.xz) - 2.0;
          vRxz = position.xz; vRice = isRice;`,
        )
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform sampler2D tVeg; uniform float uExtent, uWindTime, uWindStrength; uniform vec2 uWindDir, uNearFade;
          varying vec2 vRxz; varying float vRice;
          float rh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(rh(i),rh(i+vec2(1,0)),f.x),mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x),f.y); }`,
        )
        .replace(
          "#include <map_fragment>",
          `vec4 veg = texture2D(tVeg, vRxz / uExtent + 0.5);
          if (veg.b < 0.5 || vRice < 0.5) discard;
          float camD = length(vRxz - cameraPosition.xz);
          float dither = rh(gl_FragCoord.xy);
          if (smoothstep(uNearFade.x, uNearFade.y, camD) < dither) discard;
          // rows, clumps and the travelling bright bands of wind over the ears
          float rows = 0.5 + 0.5 * sin(dot(vRxz, vec2(0.0, 1.0)) * 20.9);
          float clump = rn(vRxz * 4.0) * 0.6 + rn(vRxz * 0.9) * 0.4;
          float wave = sin(dot(vRxz, uWindDir) * 0.18 - uWindTime * 1.6 + rn(vRxz * 0.05) * 6.0);
          vec3 col = mix(vec3(0.045, 0.085, 0.018), vec3(0.11, 0.17, 0.035), clump);
          col = mix(col, vec3(0.2, 0.22, 0.08), smoothstep(0.55, 1.0, wave) * 0.4 * uWindStrength);
          col *= mix(0.82, 1.0, rows) * (0.88 + veg.g * 0.25);
          diffuseColor.rgb = col;`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `{ float e = 0.25; float h0 = rn(vRxz * 3.0); vec3 pn = normalize(vec3(h0 - rn(vRxz * 3.0 + vec2(e, 0.0)), 0.35, h0 - rn(vRxz * 3.0 + vec2(0.0, e))));
            normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz); }`,
        );
    });
    this.mesh = new T.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    land.scene.add(this.mesh);
  }
}
