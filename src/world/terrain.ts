import * as T from "three";
import { publicUrl } from "../urls";
import type { Library } from "../engine/library";
import { FAR_CASTER } from "../engine/lighting";
import { QUALITY, type Quality } from "../engine/quality";

/** the far shadow cascades take the ground from coarse tiles of this many cells (300 m, 4.7 m mesh) */
const SHADOW_BLOCK = 256, SHADOW_STEP = 4;
import { addHook } from "../engine/hooks";
import type { Heightfield, WorldData } from "./data";
import table from "../../public/world/materials.json";
import { rtinBlock, rtinErrors } from "./rtin";

/** Terrain layers in splat order (splat0..2 RGBA): tile size in metres, albedo tint, the share of
 *  the photo's own colour kept (saturation) and `fixed` = sample without the anti-tiling rotation
 *  (directional textures). Source of truth: public/world/materials.json (shared with Unity). */
export const TERRAIN_LAYERS = table.terrainLayers as { id: string; size: number; tint: number[]; saturation?: number; fixed?: boolean }[];
const NL = 12; // shader capacity (3 splat textures)

async function loadImage(url: string) {
  const img = new Image();
  img.decoding = "async";
  img.src = publicUrl(url);
  await img.decode();
  return img;
}

async function textureArray(paths: string[], size: number, srgb: boolean) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const data = new Uint8Array(size * size * 4 * paths.length);
  const imgs = await Promise.all(paths.map(loadImage));
  imgs.forEach((img, i) => {
    g.clearRect(0, 0, size, size);
    g.drawImage(img, 0, 0, size, size);
    data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
  });
  const t = new T.DataArrayTexture(data, size, size, paths.length);
  t.format = T.RGBAFormat;
  t.type = T.UnsignedByteType;
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.magFilter = T.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function dataTexture(img: ImageData | HTMLImageElement, srgb = false) {
  const t = img instanceof ImageData ? new T.DataTexture(img.data, img.width, img.height) : new T.Texture(img);
  t.flipY = false;
  t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.magFilter = T.LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** World-space normal map (RGB = n*0.5+0.5, X east, Y up, Z south) from the heightfield. */
export function normalTexture(h: Heightfield) {
  const n = h.n, s = h.spacing;
  const out = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const dx = (h.cell(i + 1, j) - h.cell(i - 1, j)) / (2 * s);
      const dz = (h.cell(i, j + 1) - h.cell(i, j - 1)) / (2 * s);
      const l = Math.hypot(dx, 1, dz);
      const k = (j * n + i) * 4;
      out[k] = ((-dx / l) * 0.5 + 0.5) * 255;
      out[k + 1] = ((1 / l) * 0.5 + 0.5) * 255;
      out[k + 2] = ((-dz / l) * 0.5 + 0.5) * 255;
      out[k + 3] = 255;
    }
  const t = new T.DataTexture(out, n, n);
  t.minFilter = T.LinearMipmapLinearFilter;
  t.magFilter = T.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** cells per side of a terrain block (150 m); each block is one mesh at a time. Beyond FAR_TIER m
 *  2 x 2 blocks are drawn as one mesh (300 m) */
const BLOCK = 128, FAR_TIER = 400;
/** height errors (m) of the cached meshes of a block, finest first */
const LEVELS = [0.015, 0.03, 0.06, 0.12, 0.25, 0.5, 1.0, 2.0];
/** a vertex in cultivated land counts this much more: bund crests and the steps of the terraces keep
 *  their vertices three times further than the same height difference on a wooded slope */
const FIELD_WEIGHT = 3;

type Block = {
  i0: number; j0: number; size: number; x0: number; z0: number; x1: number; z1: number; minY: number; maxY: number;
  meshes: (T.Mesh | undefined)[]; level: number; want: number; on: boolean; mat?: T.Material;
  /** a 2 x 2 group: drawn as one mesh while all of it is beyond FAR_TIER, else as its four blocks */
  kids?: Block[];
};

export class Terrain {
  group = new T.Group();
  blocks: Block[] = [];
  groups: Block[] = [];
  /** per-vertex height errors of the RTIN grid (src/world/rtin.ts) */
  errors!: Float32Array;
  /** blocks waiting for a mesh at a new level (made a few per frame) */
  private queue = new Set<Block>();
  material!: T.MeshStandardMaterial;
  uniforms: Record<string, T.IUniform> = {};
  normalMap: T.DataTexture;
  /** triangles in the meshes drawn (for the profile) */
  stats = { meshes: 0, made: 0, ms: 0 };
  constructor(
    public lib: Library,
    public data: WorldData,
    public height: Heightfield,
  ) {
    this.normalMap = normalTexture(height);
  }
  async build(quality: string) {
    const size = quality === "low" ? 512 : 1024;
    const base = (f: string) => TERRAIN_LAYERS.map((l) => `assets/textures/${l.id}/${f}`);
    const chan = (this.data as unknown as { channelMask?: { file: string; range: number; openBelow: number } }).channelMask;
    const [albedo, normal, arm, splat0, splat1, veg, splat2, channels] = await Promise.all([
      textureArray(base("albedo.jpg"), size, true),
      textureArray(base("normal.jpg"), size, false),
      textureArray(base("arm.jpg"), size, false),
      loadImage("world/splat0.png"),
      loadImage("world/splat1.png"),
      loadImage("world/vegetation-mask.png"),
      loadImage("world/splat2.png"),
      chan ? loadImage(`world/${chan.file}`) : Promise.resolve(null),
    ]);
    const u = (this.uniforms = {
      tAlbedo: { value: albedo },
      tNormal: { value: normal },
      tArm: { value: arm },
      tSplat0: { value: dataTexture(splat0) },
      tSplat1: { value: dataTexture(splat1) },
      tSplat2: { value: dataTexture(splat2) },
      tVeg: { value: dataTexture(veg) },
      tTerrainNormal: { value: this.normalMap },
      uExtent: { value: this.data.extent },
      uLayerScale: { value: [...TERRAIN_LAYERS.map((l) => 1 / l.size), ...Array(NL - TERRAIN_LAYERS.length).fill(1)] },
      uLayerTint: { value: [...TERRAIN_LAYERS.map((l) => new T.Color(...(l.tint as [number, number, number]))), ...Array(NL - TERRAIN_LAYERS.length).fill(new T.Color(1, 1, 1))] },
      uLayerFixed: { value: [...TERRAIN_LAYERS.map((l) => (l.fixed ? 1 : 0)), ...Array(NL - TERRAIN_LAYERS.length).fill(0)] },
      uLayerSat: { value: [...TERRAIN_LAYERS.map((l) => l.saturation ?? 1), ...Array(NL - TERRAIN_LAYERS.length).fill(1)] },
      uWet: { value: 0.0 },
      tFarAlbedo: { value: null as T.Texture | null },
      ...this.holeUniforms(),
      // openings of the brook-fed canals: distance to the nearest open channel (x = metres at 1.0, y = open below)
      tChannels: { value: channels ? dataTexture(channels) : new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) },
      uChannel: { value: new T.Vector2(chan?.range ?? 0, chan?.openBelow ?? -1) },
    });
    // three variants of one shader: the full one near the camera; a light one far off that reads the
    // ground's colour from a texture baked from the full one at load (one fetch instead of up to 72
    // over twelve layers and three projections, and no detail normal); and the bake itself
    const make = (variant: "near" | "far" | "bake") => {
      const m = new T.MeshStandardMaterial({ roughness: 1, metalness: 0 });
      if (variant !== "bake") this.lib.finish(m);
      else m.side = T.DoubleSide;
      if (variant !== "near") (m as unknown as { defines: Record<string, string> }).defines = { [variant === "far" ? "TERRAIN_FAR" : "TERRAIN_BAKE"]: "" };
      this.hook(m, u, variant);
      return m;
    };
    this.material = make("near");
    this.farMaterial = make("far");
    this.bakeMaterial = make("bake");
    this.buildChunks();
    u.tFarAlbedo.value = this.bakeFar(quality === "low" ? 1024 : 2048);
    return this;
  }
  /**
   * The ground's colour and ambient occlusion as the full shader computes them, seen from above, into
   * one texture for the far material (2048² over the 2.1 km map, about a metre a texel). Drawn once at
   * load from coarse blocks (only the height matters, for the side-projected steep faces).
   */
  bakeFar(size: number) {
    const r = this.lib.renderer, E = this.data.extent;
    const rt = new T.WebGLRenderTarget(size, size, { colorSpace: T.SRGBColorSpace, generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, depthBuffer: true });
    rt.texture.anisotropy = this.lib.anisotropy;
    const scene = new T.Scene();
    const geos: T.BufferGeometry[] = [];
    for (const b of this.blocks) {
      const m = rtinBlock(this.height, this.errors, b.i0, b.j0, b.size, 0.25, 0);
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(m.position, 3));
      g.setIndex(new T.BufferAttribute(m.index, 1));
      geos.push(g);
      const mesh = new T.Mesh(g, this.bakeMaterial);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    // looking down; the view's up is -z and its top and bottom swapped, so texel rows run with +z as
    // the shaders read them (uv = xz / extent + 0.5)
    const cam = new T.OrthographicCamera(-E / 2, E / 2, -E / 2, E / 2, 1, 4000);
    cam.position.set(0, 2000, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const prev = r.getRenderTarget(), tone = r.toneMapping, clear = r.getClearColor(new T.Color()), alpha = r.getClearAlpha();
    r.toneMapping = T.NoToneMapping;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(prev);
    r.toneMapping = tone;
    r.setClearColor(clear, alpha);
    for (const g of geos) g.dispose();
    return rt.texture;
  }
  farMaterial!: T.MeshStandardMaterial;
  bakeMaterial!: T.MeshStandardMaterial;
  private hook(m: T.MeshStandardMaterial, u: Record<string, T.IUniform>, variant: string) {
    addHook(m, "terrain-v5-" + variant, (s) => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTW;")
        // (the meshes carry positions only: the shading normal comes from the normal texture)
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vTW = (modelMatrix * vec4(transformed,1.0)).xyz;");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `#include <common>
          precision highp sampler2DArray;
          #define LAYERS ${TERRAIN_LAYERS.length}
          varying vec3 vTW;
          uniform sampler2DArray tAlbedo, tNormal, tArm;
          uniform sampler2D tSplat0, tSplat1, tSplat2, tVeg, tTerrainNormal;
          uniform float uExtent, uWet;
          uniform float uLayerScale[12];
          uniform float uLayerFixed[12];
          uniform float uLayerSat[12];
          uniform vec3 uLayerTint[12];
          // openings in the ground: the roadside ditch channels and the tunnel mouth
          uniform sampler2D tRoadX; uniform vec3 uRoadZ; uniform vec4 uDitch; uniform vec4 uTunnel; uniform vec2 uTunnelSize;
          uniform sampler2D tChannels; uniform vec2 uChannel;
          float roadX(float z, out float slope) {
            float f = clamp((z - uRoadZ.x) / uRoadZ.y, 0.0, uRoadZ.z - 2.0);
            int i = int(floor(f));
            float a = texelFetch(tRoadX, ivec2(i, 0), 0).r, b = texelFetch(tRoadX, ivec2(i + 1, 0), 0).r;
            slope = (b - a) / uRoadZ.y;
            return mix(a, b, f - float(i));
          }
          void groundHoles() {
            if (vTW.z > uDitch.z && vTW.z < uDitch.w) {
              float sl; float rx = roadX(vTW.z, sl);
              float d = abs(vTW.x - rx) * inversesqrt(1.0 + sl * sl);
              if (abs(d - uDitch.x) < uDitch.y) discard;
            }
            if (texture2D(tChannels, vTW.xz / uExtent + 0.5).r * uChannel.x < uChannel.y) discard;
            // the bore: a box from just under its road to its crown (with no floor it cut a slot through
            // any lower ground along its line - the river's terrace below the hill it runs through)
            float dz = uTunnel.y - vTW.z;
            if (dz > 0.04 && dz < 220.0 && vTW.y < uTunnel.w + uTunnelSize.y && vTW.y > uTunnel.w - 1.5 && abs(vTW.x - (uTunnel.x - uTunnel.z * dz)) < uTunnelSize.x) discard;
          }
          vec3 tAlb; vec3 tNrm; vec3 tArmV; vec3 tWorldN;
          float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x),f.y); }
          // Two differently rotated/scaled samples blended by noise hide tiling.
          void sampleLayer(int i, vec2 xz, float w, float flatN, inout vec3 alb, inout vec3 nrm, inout vec3 armv, inout float hsum) {
            float s = uLayerScale[i];
            vec2 uv1 = xz * s;
            vec2 uv2 = uLayerFixed[i] > 0.5 ? uv1 + vec2(0.37, 0.0) : mat2(0.8, -0.6, 0.6, 0.8) * xz * s * 0.63 + 0.37;
            float b = smoothstep(0.35, 0.65, vnoise(xz * 0.045 + float(i) * 7.1));
            vec4 a1 = texture(tAlbedo, vec3(uv1, float(i))), a2 = texture(tAlbedo, vec3(uv2, float(i)));
            vec3 n1 = texture(tNormal, vec3(uv1, float(i))).xyz * 2. - 1., n2 = texture(tNormal, vec3(uv2, float(i))).xyz * 2. - 1.;
            if (uLayerFixed[i] < 0.5) n2.xy = mat2(0.8, 0.6, -0.6, 0.8) * n2.xy;
            vec3 r1 = texture(tArm, vec3(uv1, float(i))).xyz, r2 = texture(tArm, vec3(uv2, float(i))).xyz;
            vec3 c = mix(a1.rgb, a2.rgb, b);
            c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uLayerSat[i]);
            alb += c * uLayerTint[i] * w;
            nrm += mix(mix(n1, n2, b), vec3(0.0, 0.0, 1.0), flatN) * w;
            armv += mix(r1, r2, b) * w;
            hsum += w;
          }
          void terrainSample() {
            vec2 tuv = vTW.xz / uExtent + 0.5;
            vec4 s0 = texture2D(tSplat0, tuv), s1 = texture2D(tSplat1, tuv), s2 = texture2D(tSplat2, tuv);
            float wts[12] = float[12](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, s1.a, s2.r, s2.g, s2.b, s2.a);
            // height-aware sharpening: noise breaks the blurred splat edges
            float nz = vnoise(vTW.xz * 0.35) * 0.6 + vnoise(vTW.xz * 1.7) * 0.4;
            float total = 0.0;
            for (int i = 0; i < 12; i++) { float w = wts[i]; w = w * (0.55 + nz * 0.9); w = pow(max(w, 0.0), 2.2); wts[i] = w; total += w; }
            vec3 alb = vec3(0.), nrm = vec3(0.), armv = vec3(0.); float hs = 0.;
            // steep ground (cut banks, terrace scarps, the rocky sides of the brooks) is textured from the
            // side as well as from above: projected only from above, a face steeper than ~45 degrees
            // stretched every layer into flat streaks
            vec3 Ng = normalize(texture2D(tTerrainNormal, tuv).xyz * 2. - 1.);
            float steep = smoothstep(0.82, 0.6, Ng.y);
            float wsx = Ng.x * Ng.x / max(Ng.x * Ng.x + Ng.z * Ng.z, 1e-4);
            for (int i = 0; i < 12; i++) {
              float w = wts[i] / max(total, 1e-4);
              if (w <= 0.02 || i >= LAYERS) continue;
              if (steep < 0.99) sampleLayer(i, vTW.xz, w * (1.0 - steep), 0.0, alb, nrm, armv, hs);
              if (steep > 0.01) {
                if (wsx > 0.05) sampleLayer(i, vec2(vTW.z, -vTW.y), w * steep * wsx, 0.7, alb, nrm, armv, hs);
                if (wsx < 0.95) sampleLayer(i, vec2(vTW.x, -vTW.y), w * steep * (1.0 - wsx), 0.7, alb, nrm, armv, hs);
              }
            }
            alb /= max(hs, 1e-4); nrm /= max(hs, 1e-4); armv /= max(hs, 1e-4);
            // macro variation (sun-bleached patches, damp hollows, forest shade)
            vec4 veg = texture2D(tVeg, tuv);
            float macro = vnoise(vTW.xz * 0.012) * 0.6 + vnoise(vTW.xz * 0.05) * 0.4;
            alb *= mix(0.82, 1.12, macro);
            alb = mix(alb, alb * vec3(0.8, 0.82, 0.84), veg.r * 0.6);
            tAlb = alb; tNrm = normalize(nrm); tArmV = armv;
            tArmV.r *= mix(1.0, 0.55, veg.r);
            tWorldN = normalize(texture2D(tTerrainNormal, tuv).xyz * 2. - 1.);
          }
          uniform sampler2D tFarAlbedo;
          // far off: the baked colour (rgb) and ambient occlusion (a), the large-scale normal only
          void terrainFar() {
            vec2 tuv = vTW.xz / uExtent + 0.5;
            vec4 b = texture2D(tFarAlbedo, tuv);
            tAlb = b.rgb; tNrm = vec3(0.0, 0.0, 1.0); tArmV = vec3(b.a, 1.0, 0.0);
            tWorldN = normalize(texture2D(tTerrainNormal, tuv).xyz * 2. - 1.);
          }`,
        )
        .replace(
          "#include <map_fragment>",
          `#if defined( TERRAIN_BAKE )
            terrainSample();
            gl_FragColor = vec4(tAlb, tArmV.r);
            return;
          #elif defined( TERRAIN_FAR )
            groundHoles();
            terrainFar();
          #else
            groundHoles();
            terrainSample();
          #endif
          diffuseColor.rgb *= tAlb;`,
        )
        .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * mix(0.78, 1.0, tArmV.g);")
        .replace("#include <metalnessmap_fragment>", "float metalnessFactor = 0.0;")
        .replace(
          "#include <normal_fragment_begin>",
          /* glsl */ `#include <normal_fragment_begin>
          {
            vec3 N = tWorldN;
            vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
            vec3 Bg = normalize(cross(Tg, N));   // points to +Z (south) like uv.y
            vec3 wn = normalize(Tg * tNrm.x - Bg * tNrm.y + N * tNrm.z * 1.15);
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
            nonPerturbedNormal = normalize((viewMatrix * vec4(N, 0.0)).xyz);
          }`,
        )
        .replace("#include <normal_fragment_maps>", "")
        .replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
          {
            // beyond the shadow-casting tree LODs the canopy still shades the forest floor
            float canopy = texture2D(tVeg, vTW.xz / uExtent + 0.5).r;
            float far = smoothstep(25.0, 90.0, length(vTW - cameraPosition));
            reflectedLight.directDiffuse *= 1.0 - canopy * 0.85 * far;
            reflectedLight.indirectDiffuse *= 1.0 - canopy * 0.35 * far;
          }`,
        )
        .replace(
          "#include <aomap_fragment>",
          /* glsl */ `{
            float ambientOcclusion = mix(1.0, tArmV.r, 0.9);
            reflectedLight.indirectDiffuse *= ambientOcclusion;
            reflectedLight.indirectSpecular *= ambientOcclusion;
          }`,
        );
    });
  }
  /** Road axis x(z) every 0.5 m (for the ditch openings) and the tunnel mouth, from scene.json. */
  holeUniforms() {
    const d = this.data, road = d.roads[0]?.points ?? [];
    const step = 0.5, z0 = road.length ? road[0][2] : 0, z1 = road.length ? road[road.length - 1][2] : 1;
    const n = Math.max(2, Math.ceil((z1 - z0) / step) + 1);
    const xs = new Float32Array(n);
    for (let i = 0, k = 0; i < n; i++) {
      const z = z0 + i * step;
      while (k < road.length - 2 && road[k + 1][2] < z) k++;
      const [ax, , az] = road[k], [bx, , bz] = road[Math.min(k + 1, road.length - 1)];
      xs[i] = bz > az ? ax + ((bx - ax) * (z - az)) / (bz - az) : ax;
    }
    const tex = new T.DataTexture(xs, n, 1, T.RedFormat, T.FloatType);
    tex.minFilter = tex.magFilter = T.NearestFilter;
    tex.needsUpdate = true;
    const dd = d.ditch, tu = d.tunnel;
    return {
      tRoadX: { value: tex },
      uRoadZ: { value: new T.Vector3(z0, step, n) },
      // x = channel centre offset, y = half width of the opening (inner width + most of the wall tops), z/w = z range
      uDitch: { value: dd ? new T.Vector4(dd.offset, dd.width / 2 + 0.07, dd.zRange[0], dd.zRange[1]) : new T.Vector4(0, -1, 1, 0) },
      uTunnel: { value: tu ? new T.Vector4(tu.x, tu.z, tu.slope, tu.y) : new T.Vector4(0, -1e5, 0, -1e5) },
      uTunnelSize: { value: new T.Vector2(tu?.halfWidth ?? 0, tu?.height ?? 0) },
    };
  }
  /**
   * The ground as 14 x 14 blocks of 150 m, each drawn as one RTIN mesh whose height error follows its
   * distance (rtin.ts): crests, steps and edges keep their vertices, flat fields and even slopes
   * become a few large triangles. (Before: 37.5 m chunks of a regular grid - the cultivated ones at
   * full resolution at every distance so the bunds would not sink - about 210 draws and 120 MB.)
   */
  buildChunks() {
    const t0 = performance.now();
    const h = this.height, n = h.n, s = h.spacing, half = this.data.extent / 2;
    // cultivated land: the fields and a margin around them (their bunds and terrace scarps)
    const field = new Uint8Array(n * n);
    for (const f of this.data.fields) {
      const [x0, z0, x1, z1] = f.bounds;
      const i0 = Math.max(0, Math.floor((x0 - 3 + half) / s)), i1 = Math.min(n - 1, Math.ceil((x1 + 3 + half) / s));
      const j0 = Math.max(0, Math.floor((z0 - 3 + half) / s)), j1 = Math.min(n - 1, Math.ceil((z1 + 3 + half) / s));
      for (let j = j0; j <= j1; j++) field.fill(1, j * n + i0, j * n + i1 + 1);
    }
    this.errors = rtinErrors(h, (i, j) => (field[j * n + i] ? FIELD_WEIGHT : 1));
    const make = (i0: number, j0: number, size: number): Block => {
      let minY = Infinity, maxY = -Infinity;
      for (let j = j0; j <= j0 + size; j += 2)
        for (let i = i0; i <= i0 + size; i += 2) {
          const y = h.data[j * n + i];
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      return { i0, j0, size, x0: i0 * s - half, z0: j0 * s - half, x1: (i0 + size) * s - half, z1: (j0 + size) * s - half, minY, maxY, meshes: [], level: -1, want: -1, on: false };
    };
    const per = (n - 1) / BLOCK;
    for (let gj = 0; gj < per; gj += 2)
      for (let gi = 0; gi < per; gi += 2) {
        const g = make(gi * BLOCK, gj * BLOCK, 2 * BLOCK);
        g.kids = [];
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const b = make((gi + di) * BLOCK, (gj + dj) * BLOCK, BLOCK);
          g.kids.push(b);
          this.blocks.push(b);
        }
        this.groups.push(g);
      }
    this.stats.ms = performance.now() - t0;
    // The hills' long evening shadows in the far cascades: big coarse tiles drawn into the shadow
    // maps only (FAR_CASTER alone, which the view camera does not see), one draw each instead of
    // every 37.5 m chunk again for each cascade.
    const shadowMat = new T.MeshBasicMaterial(), cells = n - 1;
    for (let bj = 0; bj < cells; bj += SHADOW_BLOCK)
      for (let bi = 0; bi < cells; bi += SHADOW_BLOCK) {
        const ci = Math.min(SHADOW_BLOCK, cells - bi) / SHADOW_STEP, cj = Math.min(SHADOW_BLOCK, cells - bj) / SHADOW_STEP, row = ci + 1;
        const pos: number[] = [], idx: number[] = [];
        for (let j = 0; j <= cj; j++)
          for (let i = 0; i <= ci; i++) {
            const gi = bi + i * SHADOW_STEP, gj = bj + j * SHADOW_STEP;
            pos.push(gi * s - half, h.cell(gi, gj) - 0.35, gj * s - half);   // (a little low: no false shade in hollows)
          }
        for (let j = 0; j < cj; j++)
          for (let i = 0; i < ci; i++) {
            const a = j * row + i;
            idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
          }
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new T.Mesh(g, shadowMat);
        m.castShadow = true;
        m.receiveShadow = false;
        m.layers.set(FAR_CASTER);
        m.matrixAutoUpdate = false;
        m.name = "terrain-shadow";
        this.group.add(m);
      }
  }
  /** the mesh of a block at a level (made once, kept while the block is near that level) */
  private mesh(b: Block, level: number) {
    let m = b.meshes[level];
    if (m) return m;
    const t0 = performance.now();
    const e = LEVELS[level];
    const r = rtinBlock(this.height, this.errors, b.i0, b.j0, b.size, e, Math.max(1.5, e * 4));
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(r.position, 3));
    g.setIndex(new T.BufferAttribute(r.index, 1));
    g.boundingBox = new T.Box3(new T.Vector3(b.x0, r.minY, b.z0), new T.Vector3(b.x1, r.maxY, b.z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new T.Sphere());
    m = new T.Mesh(g, b.mat ?? this.material);
    m.name = "terrain";
    m.receiveShadow = true;
    // (the near cascade takes the ground from these; beyond it the coarse shadow tiles stand in)
    m.castShadow = true;
    m.matrixAutoUpdate = false;
    m.visible = false;
    this.group.add(m);
    b.meshes[level] = m;
    this.stats.made++;
    this.stats.ms += performance.now() - t0;
    return m;
  }
  private show(b: Block, level: number) {
    const m = this.mesh(b, level);
    if (b.level === level) return;
    const old = b.level >= 0 ? b.meshes[b.level] : undefined;
    if (old) old.visible = false;
    m.visible = b.on;
    // keep the level just left (the camera may come back); drop the rest
    b.meshes.forEach((x, l) => {
      if (x && l !== level && l !== b.level) {
        x.geometry.dispose();
        this.group.remove(x);
        b.meshes[l] = undefined;
      }
    });
    b.level = level;
  }
  /** pixels of height error allowed on a 1080-line screen at 55 degrees (quality setting) */
  static tolerance(quality: string) {
    return QUALITY[quality as Quality].terrain.tolerance;
  }
  /** distance from a point to a block's box */
  private static dist(b: Block, c: T.Vector3) {
    const dx = Math.max(b.x0 - c.x, 0, c.x - b.x1), dz = Math.max(b.z0 - c.z, 0, c.z - b.z1);
    const dy = Math.max(b.minY - c.y, 0, c.y - b.maxY);
    return Math.hypot(dx, dy, dz);
  }
  private setOn(b: Block, on: boolean) {
    if (b.on === on) return;
    b.on = on;
    const m = b.level >= 0 ? b.meshes[b.level] : undefined;
    if (m) m.visible = on;
  }
  update(camera: T.Vector3, quality: string) {
    // half the screen-space error (the worst error of a level is about twice its nominal value)
    const k = 0.5 * Terrain.tolerance(quality) * (2 * Math.tan((55 * Math.PI) / 360)) / 1080;
    const level = (dist: number) => {
      let l = 0;
      while (l < LEVELS.length - 1 && LEVELS[l + 1] <= dist * k) l++;
      return l;
    };
    const farAt = QUALITY[quality as Quality].terrain.farMaterial;
    const visit = (b: Block, d: number) => {
      // the light material past farAt (the block's nearest point)
      b.mat = d > farAt ? this.farMaterial : this.material;
      for (const m of b.meshes) if (m && m.material !== b.mat) m.material = b.mat;
      let want = level(d);
      // hysteresis: a block only coarsens once it is 15% beyond the distance that allows it
      if (b.level >= 0 && want > b.level) want = Math.max(b.level, level(d * 0.85));
      b.want = want;
      if (want === b.level) return;
      // missing or far too coarse (a jump): make it now; otherwise in the queue, a few per frame
      if (b.level < 0 || b.meshes[want] || want < b.level - 2) this.show(b, want);
      else this.queue.add(b);
    };
    for (const g of this.groups) {
      const d = Terrain.dist(g, camera);
      // (a group switches to its four blocks a little before FAR_TIER, back to one mesh a little after)
      const far = d > FAR_TIER * (g.on ? 0.9 : 1.0);
      if (far) {
        visit(g, d);
        // the group's mesh is ready: it replaces the blocks
        if (g.level >= 0) {
          this.setOn(g, true);
          for (const b of g.kids!) this.setOn(b, false);
          continue;
        }
      }
      for (const b of g.kids!) {
        visit(b, Terrain.dist(b, camera));
        this.setOn(b, true);
      }
      this.setOn(g, false);
    }
    const t0 = performance.now();
    for (const b of this.queue) {
      this.queue.delete(b);
      if (b.want !== b.level) this.show(b, b.want);
      if (performance.now() - t0 > 2) break;
    }
  }
}
