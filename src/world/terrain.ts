import * as T from "three";
import { publicUrl } from "../urls";
import type { Library } from "../engine/library";
import { addHook } from "../engine/hooks";
import type { Heightfield, WorldData } from "./data";

/** Terrain layers in splat order (splat0..2 RGBA) and their tile size in metres. `fixed` = sample without the anti-tiling rotation (directional textures). */
export const TERRAIN_LAYERS = [
  { id: "leafy_grass", size: 3.2, tint: [0.62, 0.78, 0.5] },
  { id: "forest_leaves_02", size: 3.0, tint: [0.52, 0.56, 0.42] },
  { id: "stony_dirt_path", size: 2.6, tint: [0.95, 0.92, 0.88] },
  { id: "mossy_rock", size: 4.5, tint: [0.9, 0.92, 0.86] },
  { id: "brown_mud_leaves_01", size: 2.4, tint: [0.8, 0.78, 0.72] },
  { id: "river_small_rocks", size: 2.2, tint: [0.9, 0.9, 0.88] },
  { id: "gravel_floor_02", size: 1.6, tint: [0.56, 0.54, 0.5] },
  { id: "worn_asphalt", size: 3.5, tint: [1.5, 1.75, 2.0] },
  { id: "farm_furrows", size: 4.2, tint: [0.78, 0.72, 0.66], fixed: true },
];
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

const CHUNK = 32; // cells per chunk (37.5 m)

export class Terrain {
  group = new T.Group();
  chunks: { meshes: T.Mesh[]; center: T.Vector3; lod: number }[] = [];
  material!: T.MeshStandardMaterial;
  uniforms: Record<string, T.IUniform> = {};
  normalMap: T.DataTexture;
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
    const [albedo, normal, arm, splat0, splat1, veg, splat2] = await Promise.all([
      textureArray(base("albedo.jpg"), size, true),
      textureArray(base("normal.jpg"), size, false),
      textureArray(base("arm.jpg"), size, false),
      loadImage("world/splat0.png"),
      loadImage("world/splat1.png"),
      loadImage("world/vegetation-mask.png"),
      loadImage("world/splat2.png"),
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
      uLayerFixed: { value: [...TERRAIN_LAYERS.map((l) => ("fixed" in l && l.fixed ? 1 : 0)), ...Array(NL - TERRAIN_LAYERS.length).fill(0)] },
      uWet: { value: 0.0 },
    });
    const m = (this.material = new T.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    this.lib.finish(m);
    addHook(m, "terrain-v3", (s) => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTW;")
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
          uniform vec3 uLayerTint[12];
          vec3 tAlb; vec3 tNrm; vec3 tArmV; vec3 tWorldN;
          float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x),f.y); }
          // Two differently rotated/scaled samples blended by noise hide tiling.
          void sampleLayer(int i, vec2 xz, float w, inout vec3 alb, inout vec3 nrm, inout vec3 armv, inout float hsum) {
            float s = uLayerScale[i];
            vec2 uv1 = xz * s;
            vec2 uv2 = uLayerFixed[i] > 0.5 ? uv1 + vec2(0.37, 0.0) : mat2(0.8, -0.6, 0.6, 0.8) * xz * s * 0.63 + 0.37;
            float b = smoothstep(0.35, 0.65, vnoise(xz * 0.045 + float(i) * 7.1));
            vec4 a1 = texture(tAlbedo, vec3(uv1, float(i))), a2 = texture(tAlbedo, vec3(uv2, float(i)));
            vec3 n1 = texture(tNormal, vec3(uv1, float(i))).xyz * 2. - 1., n2 = texture(tNormal, vec3(uv2, float(i))).xyz * 2. - 1.;
            if (uLayerFixed[i] < 0.5) n2.xy = mat2(0.8, 0.6, -0.6, 0.8) * n2.xy;
            vec3 r1 = texture(tArm, vec3(uv1, float(i))).xyz, r2 = texture(tArm, vec3(uv2, float(i))).xyz;
            alb += mix(a1.rgb, a2.rgb, b) * uLayerTint[i] * w;
            nrm += mix(n1, n2, b) * w;
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
            for (int i = 0; i < 12; i++) { float w = wts[i] / max(total, 1e-4); if (w > 0.02 && i < LAYERS) sampleLayer(i, vTW.xz, w, alb, nrm, armv, hs); }
            alb /= max(hs, 1e-4); nrm /= max(hs, 1e-4); armv /= max(hs, 1e-4);
            // macro variation (sun-bleached patches, damp hollows, forest shade)
            vec4 veg = texture2D(tVeg, tuv);
            float macro = vnoise(vTW.xz * 0.012) * 0.6 + vnoise(vTW.xz * 0.05) * 0.4;
            alb *= mix(0.82, 1.12, macro);
            alb = mix(alb, alb * vec3(0.78, 0.82, 0.72), veg.r * 0.6);
            tAlb = alb; tNrm = normalize(nrm); tArmV = armv;
            tArmV.r *= mix(1.0, 0.55, veg.r);
            tWorldN = normalize(texture2D(tTerrainNormal, tuv).xyz * 2. - 1.);
          }`,
        )
        .replace("#include <map_fragment>", "terrainSample();\n diffuseColor.rgb *= tAlb;")
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
    this.buildChunks();
    return this;
  }
  /** Square chunks, three index-shared LODs, skirts to hide cracks. */
  buildChunks() {
    const n = this.height.n - 1;
    const per = n / CHUNK;
    const geoCache: T.BufferGeometry[][] = [];
    for (let cj = 0; cj < per; cj++)
      for (let ci = 0; ci < per; ci++) {
        const meshes = [1, 4, 8].map((step) => {
          const g = this.chunkGeometry(ci * CHUNK, cj * CHUNK, step);
          const mesh = new T.Mesh(g, this.material);
          mesh.receiveShadow = true;
          mesh.castShadow = step <= 4;
          mesh.visible = false;
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
          return mesh;
        });
        geoCache.push(meshes.map((m) => m.geometry));
        const s = this.height.spacing;
        const cx = ((ci + 0.5) * CHUNK * s) - this.data.extent / 2;
        const cz = ((cj + 0.5) * CHUNK * s) - this.data.extent / 2;
        this.chunks.push({ meshes, center: new T.Vector3(cx, this.height.sample(cx, cz), cz), lod: -1 });
      }
  }
  chunkGeometry(i0: number, j0: number, step: number) {
    const h = this.height, s = h.spacing, half = this.data.extent / 2;
    const cells = CHUNK / step, row = cells + 1;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= cells; j++)
      for (let i = 0; i <= cells; i++) {
        const gi = i0 + i * step, gj = j0 + j * step;
        pos.push(gi * s - half, h.cell(gi, gj), gj * s - half);
      }
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        const a = j * row + i;
        // alternate diagonals for a more isotropic surface
        if ((i + j) % 2) idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
        else idx.push(a, a + row, a + row + 1, a, a + row + 1, a + 1);
      }
    // skirts
    const skirt = (list: number[]) => {
      for (let k = 0; k < list.length - 1; k++) {
        const a = list[k], b = list[k + 1];
        const base = pos.length / 3;
        pos.push(pos[a * 3], pos[a * 3 + 1] - 2.5, pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1] - 2.5, pos[b * 3 + 2]);
        idx.push(a, base, b, b, base, base + 1, a, b, base, b, base + 1, base);
      }
    };
    const top = [...Array(row).keys()], bottom = top.map((i) => cells * row + i);
    const left = top.map((j) => j * row), right = top.map((j) => j * row + cells);
    if (step > 1) [top, bottom, left, right].forEach(skirt);
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    const nrm = new Float32Array(pos.length).fill(0);
    for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
    g.setAttribute("normal", new T.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  update(camera: T.Vector3, quality: string) {
    const near = quality === "low" ? 120 : 220, mid = quality === "low" ? 300 : 480;
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camera.x, c.center.z - camera.z);
      const lod = d < near ? 0 : d < mid ? 1 : 2;
      if (lod === c.lod) continue;
      c.meshes.forEach((m, i) => (m.visible = i === lod));
      c.lod = lod;
    }
  }
}
