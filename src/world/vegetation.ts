import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../urls";
import { addHook } from "../engine/hooks";
import { darkenFringe } from "../engine/library";
import type { Landscape, System } from "./landscape";
import type { InstanceRow } from "./data";
import { FAR_CASTER } from "../engine/lighting";
import { QUALITY, type Quality } from "../engine/quality";

export const SPECIES = ["sugi", "hinoki", "akamatsu", "broadleaf", "keyaki", "bamboo"] as const;
const VARIANTS = 4;
const ATLAS_COLS = 8, CELL_W = 256, CELL_H = 512;

export const windUniforms = {
  uWindTime: { value: 0 },
  uWindDir: { value: new T.Vector2(0.8, 0.6) },
  uWindStrength: { value: 0.55 },
};

/** Vertex wind driven by COLOR_0 weights (R trunk sway, G branch flex, B flutter phase). */
export function windHook(m: T.Material, amount = 1) {
  addHook(m, "wind" + amount, (s) => {
    Object.assign(s.uniforms, windUniforms);
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uWindTime, uWindStrength; uniform vec2 uWindDir;
        #ifndef USE_COLOR
        attribute vec3 color;
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float ph = dot(ip.xz, vec2(0.071, 0.113));
          float t = uWindTime;
          float gust = 0.55 + 0.3 * sin(t * 0.43 + ph * 0.5) + 0.15 * sin(t * 1.21 + ph);
          float sway = color.r * color.r * uWindStrength * ${amount.toFixed(2)};
          transformed.xz += uWindDir * sway * gust * (0.35 + 0.2 * sin(t * 0.9 + ph * 2.0));
          float flex = color.g * uWindStrength * ${amount.toFixed(2)};
          transformed.y += sin(t * 1.9 + ph * 3.0 + color.b * 6.28) * 0.04 * flex;
          transformed += objectNormal * sin(t * 5.3 + color.b * 6.2831 + ph * 7.0) * 0.025 * flex;
        }`,
      );
  });
}

type Part = { geometry: T.BufferGeometry; material: T.Material; mesh?: T.InstancedMesh };
type Variant = {
  species: string; v: number; rows: InstanceRow[]; lods: Part[][]; cell: number; size: [number, number]; height: number;
  /** row indices by grid cell */
  grid?: Map<number, number[]>;
  /** every tree's instance matrix, composed once (the trees never move) */
  mats?: Float32Array;
  /** one instance buffer per LOD, shared by its parts (bark, foliage): written and sent once */
  shared?: T.InstancedBufferAttribute[];
  /** per LOD: instances written, and how many of them (the first) the first shadow cascade can see */
  count?: number[];
  nearCount?: number[];
};

/** side of the cells the trees are bucketed in, so an update visits only those near the camera */
const GRID = 48;

export class Vegetation implements System {
  variants: Variant[] = [];
  materials = new Map<string, T.Material>();
  atlas!: { albedo: T.Texture; normal: T.Texture };
  dist = { lod0: 45, lod1: 140 };
  lastPos = new T.Vector3(1e9, 0, 0);
  lastQuat = new T.Quaternion();
  frame = 0;
  total = 0;
  constructor(
    public land: Landscape,
    public trees: Record<string, InstanceRow[]>,
  ) {}
  material(name: string): T.Material {
    const have = this.materials.get(name);
    if (have) return have;
    const lib = this.land.lib;
    let m: T.Material;
    const bark: Record<string, [string, string]> = {
      bark_sugi: ["japanese_cedar_bark", "#d8cfc4"],
      bark_hinoki: ["metasequoia_bark", "#d9c2b0"],
      bark_pine: ["pine_bark", "#e6c3a4"],
      bark_broadleaf: ["japanese_zelkova_bark", "#5f5b53"],
      bark_keyaki: ["japanese_zelkova_bark", "#8d877c"],
    };
    if (bark[name]) {
      m = lib.pbr({ tex: bark[name][0], color: bark[name][1], size: 1 });
      // double-sided: open branch ends and a camera brushing a trunk show bark, not a hole
      m.side = T.DoubleSide;
      windHook(m, 0.6);
    } else if (name === "bamboo_culm") {
      const mm = new T.MeshStandardMaterial({ map: lib.texture("assets/foliage/bamboo-culm-albedo.jpg", true), roughness: 0.55 });
      m = lib.finish(mm);
      windHook(m, 1.6);
    } else {
      const atlas: Record<string, [string, string | null, string]> = {
        foliage_sugi: ["needle", "needle", "#8c9a78"],
        foliage_hinoki: ["needle", "needle", "#93a37e"],
        foliage_pine: ["pine", "pine", "#a6ad86"],
        foliage_broadleaf: ["leaf", "leaf", "#b8c098"],
        bamboo_leaf: ["bamboo-leaf", null, "#c4cfa0"],
      };
      const [alb, nrm, col] = atlas[name] ?? ["leaf", "leaf", "#ffffff"];
      const mm = new T.MeshStandardMaterial({
        map: lib.texture(`assets/foliage/${alb}-albedo.png`, true, false),
        normalMap: nrm ? lib.texture(`assets/foliage/${nrm}-normal.png`, false, false) : null,
        color: col,
        roughness: 0.82,
        alphaTest: 0.5,
        side: T.DoubleSide,
        alphaToCoverage: true,
      });
      // glTF UV convention (v down): the atlas must not be flipped
      if (mm.map) mm.map.flipY = false;
      if (mm.normalMap) mm.normalMap.flipY = false;
      mm.normalScale.set(0.6, 0.6);
      (mm as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "", CROWN_NORMALS: "" };
      m = lib.finish(mm);
      darkenFringe(m);
      windHook(m, name === "bamboo_leaf" ? 1.6 : 1.0);
    }
    m.name = name;   // the impostor bake tells bark from foliage by name
    this.materials.set(name, m);
    return m;
  }
  async load(progress: (p: number) => void) {
    const loader = new GLTFLoader();
    const bySpecies: Record<string, InstanceRow[][]> = {};
    for (const s of SPECIES) {
      bySpecies[s] = [...Array(VARIANTS)].map(() => []);
      for (const r of this.trees[s] ?? []) bySpecies[s][r[5] % VARIANTS].push(r);
    }
    let done = 0;
    const jobs: Promise<void>[] = [];
    SPECIES.forEach((s, si) => {
      for (let v = 0; v < VARIANTS; v++)
        jobs.push(
          loader.loadAsync(publicUrl(`assets/models/trees/${s}_${v}.glb`)).then((g) => {
            const lods: Part[][] = [[], []];
            g.scene.traverse((o) => {
              if (!(o instanceof T.Mesh)) return;
              let p: T.Object3D | null = o;
              let lod = -1;
              while (p && lod < 0) {
                const mm = /_lod(\d)$/.exec(p.name);
                if (mm) lod = +mm[1];
                p = p.parent;
              }
              if (lod < 0) return;
              const matName = (o.material as T.Material).name;
              o.geometry.computeBoundingSphere();
              lods[lod].push({ geometry: o.geometry, material: this.material(matName) });
            });
            const box = new T.Box3().setFromObject(g.scene.getObjectByName(`${s}_${v}_lod0`) ?? g.scene);
            const size = box.getSize(new T.Vector3());
            this.variants.push({
              species: s, v, rows: bySpecies[s][v], lods, cell: si * VARIANTS + v,
              size: [Math.max(size.x, size.z) * 1.04, size.y * 1.02], height: size.y,
            });
            progress(++done / (SPECIES.length * VARIANTS));
          }),
        );
    });
    await Promise.all(jobs);
    this.variants.sort((a, b) => a.cell - b.cell);
    const mm = new T.Matrix4(), e = new T.Euler(), q = new T.Quaternion(), pp = new T.Vector3(), sc = new T.Vector3();
    for (const v of this.variants) {
      v.mats = new Float32Array(v.rows.length * 16);
      v.rows.forEach((r, i) => {
        e.set(r[6] ?? 0, r[4], 0, "YXZ");
        mm.compose(pp.set(r[0], r[1] - 0.2 * r[3], r[2]), q.setFromEuler(e), sc.setScalar(r[3]));
        mm.toArray(v.mats!, i * 16);
      });
      v.shared = v.lods.map(() => new T.InstancedBufferAttribute(new Float32Array(Math.max(1, v.rows.length) * 16), 16).setUsage(T.DynamicDrawUsage));
      v.count = [0, 0];
      v.nearCount = [0, 0];
      v.lods.forEach((parts, lod) =>
        parts.forEach((p) => {
          const m = new T.InstancedMesh(p.geometry, p.material, 1);
          m.instanceMatrix = v.shared![lod];
          m.count = 0;
          m.castShadow = true;
          m.layers.enable(FAR_CASTER);                  // (trees shade the slopes far off)
          m.receiveShadow = true;
          m.frustumCulled = false;
          m.name = `${v.species}_${v.v}_lod${lod}`;
          // The first shadow cascade (redrawn every frame) takes only the trees that fall in its view
          // of the sun: they are written first, see update(). The far cascades take them all.
          m.onBeforeShadow = (_r, _o, _c, shadowCamera) => {
            if (shadowCamera === this.land.lighting.csm.lights[0].shadow.camera) m.count = v.nearCount![lod];
          };
          m.onAfterShadow = () => (m.count = v.count![lod]);
          p.mesh = m;
          this.land.scene.add(m);
        }),
      );
    }
    this.total = this.variants.reduce((s, v) => s + v.rows.length, 0);
    const half = this.land.world.data.extent / 2, gn = Math.ceil((2 * half) / GRID);
    this.gridN = gn;
    for (const v of this.variants) {
      v.grid = new Map();
      v.rows.forEach((r, i) => {
        const key = Math.floor((r[2] + half) / GRID) * gn + Math.floor((r[0] + half) / GRID);
        let list = v.grid!.get(key);
        if (!list) v.grid!.set(key, (list = []));
        list.push(i);
      });
    }
    await this.bakeImpostors();
    this.buildImpostorMesh();
  }
  /** Render every variant's LOD0 from the side into albedo/normal atlases (once, on the GPU). */
  async bakeImpostors() {
    const r = this.land.renderer;
    await this.land.lib.ready();
    const rows = Math.ceil(this.variants.length / ATLAS_COLS);
    const W = ATLAS_COLS * CELL_W, H = rows * CELL_H;
    const mk = () => {
      const rt = new T.WebGLRenderTarget(W, H, { generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, samples: 4 });
      return rt;
    };
    const rtA = mk(), rtN = mk();
    rtA.texture.colorSpace = T.SRGBColorSpace;
    const scene = new T.Scene();
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new T.Color()), prevAlpha = r.getClearAlpha();
    const prevTone = r.toneMapping;
    r.toneMapping = T.NoToneMapping;
    // foliage cards keep their crown normals on both faces (see CROWN_NORMALS); bark flips on the
    // inside of open branch ends only
    const normalMat = (src: T.MeshStandardMaterial) =>
      new T.ShaderMaterial({
        uniforms: { map: { value: src.map }, alphaTest: { value: 0.5 }, uFlip: { value: src.name?.startsWith("bark") ? 1 : 0 } },
        side: T.DoubleSide,
        vertexShader: `varying vec3 vN; varying vec2 vUv; void main(){ vUv=uv; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform sampler2D map; uniform float alphaTest, uFlip; varying vec3 vN; varying vec2 vUv;
          void main(){ float a = texture2D(map, vUv).a; if (a < alphaTest) discard;
            vec3 n = normalize(vN); if (!gl_FrontFacing && uFlip > 0.5) n = -n; if (n.z < 0.0) n.z = -n.z * 0.3;
            gl_FragColor = vec4(normalize(n) * 0.5 + 0.5, 1.0); }`,
      });
    const albedoMat = (src: T.MeshStandardMaterial) =>
      new T.MeshBasicMaterial({ map: src.map, color: src.color, alphaTest: src.alphaTest || 0, side: T.DoubleSide, transparent: false });
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    r.setClearColor(0x000000, 0);
    for (const pass of ["albedo", "normal"] as const) {
      r.setRenderTarget(pass === "albedo" ? rtA : rtN);
      r.setScissorTest(false);
      r.clear();
      r.setScissorTest(true);
      for (const v of this.variants) {
        scene.clear();
        for (const p of v.lods[0]) {
          const src = p.material as T.MeshStandardMaterial;
          const mesh = new T.Mesh(p.geometry, pass === "albedo" ? albedoMat(src) : normalMat(src));
          if (pass === "albedo" && src.name?.startsWith("bark")) (mesh.material as T.MeshBasicMaterial).color.multiplyScalar(0.8);
          scene.add(mesh);
        }
        const [w, h] = v.size;
        cam.left = -w / 2;
        cam.right = w / 2;
        cam.top = h;
        cam.bottom = 0;
        cam.position.set(0, 0, 100);
        cam.lookAt(0, 0, 0);
        cam.updateProjectionMatrix();
        const col = v.cell % ATLAS_COLS, row = Math.floor(v.cell / ATLAS_COLS);
        const y = H - (row + 1) * CELL_H;
        r.setViewport(col * CELL_W, y, CELL_W, CELL_H);
        r.setScissor(col * CELL_W, y, CELL_W, CELL_H);
        r.render(scene, cam);
        scene.traverse((o) => (o as T.Mesh).material && ((o as T.Mesh).material as T.Material).dispose());
      }
    }
    r.setScissorTest(false);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.toneMapping = prevTone;
    r.setViewport(0, 0, r.domElement.width / r.getPixelRatio(), r.domElement.height / r.getPixelRatio());
    this.atlas = { albedo: rtA.texture, normal: rtN.texture };
    (this as unknown as { atlasRows: number }).atlasRows = rows;
  }
  /** the billboard chunks: in-map forest (300 m) and the ranges beyond the map (650 m) */
  impostorChunks: { mesh: T.InstancedMesh; n: number; x0: number; z0: number; x1: number; z1: number; far: boolean }[] = [];
  impostorMaterial!: T.MeshStandardMaterial;
  /** thinning of distant billboards: x = distance (m) from which they thin, y = least share kept */
  thin = { value: new T.Vector2(450, 0.2) };
  buildImpostorMaterial() {
    const rows = (this as unknown as { atlasRows: number }).atlasRows;
    const m = new T.MeshStandardMaterial({ map: this.atlas.albedo, roughness: 0.85, alphaTest: 0.42, side: T.DoubleSide, alphaToCoverage: true });
    (m as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
    this.land.lib.finish(m);
    const u = { tImpNormal: { value: this.atlas.normal }, uAtlasGrid: { value: new T.Vector2(ATLAS_COLS, rows) }, uNearCut: this.nearCut, uThin: this.thin };
    addHook(m, "impostor", (s) => {
      Object.assign(s.uniforms, u, windUniforms);
      s.vertexShader = s.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute float aCell; attribute vec2 aSize; attribute float aTint; attribute float aRank;
          uniform vec2 uAtlasGrid, uThin; uniform float uWindTime, uWindStrength, uNearCut; uniform vec2 uWindDir;
          varying vec2 vImpUv; varying vec3 vRight; varying vec3 vToCam; varying float vTint; varying float vImpFar;`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `vec3 ipos = instanceMatrix[3].xyz;
          vec2 tc = normalize(cameraPosition.xz - ipos.xz + vec2(1e-4));
          vRight = vec3(tc.y, 0.0, -tc.x);
          vToCam = vec3(tc.x, 0.0, tc.y);
          vec3 objectNormal = vToCam;`,
        )
        .replace(
          "#include <begin_vertex>",
          `float idist = distance(ipos.xz, cameraPosition.xz);
          // far off, a share of the trees stands for the wood: the rest (by rank) shrink away and the
          // ones kept grow a little, wider more than taller, so the stands keep their cover and their
          // ragged ridgelines with fewer billboards
          float keep = clamp(uThin.x * uThin.x / max(idist * idist, 1.0), uThin.y, 1.0);
          float stay = 1.0 - smoothstep(keep * 0.88, keep, aRank);
          vec2 grow = vec2(pow(keep, -0.42), pow(keep, -0.16)) * stay;
          vec3 transformed = vRight * position.x * aSize.x * grow.x + vec3(0.0, position.y * aSize.y * grow.y, 0.0);
          float sway = position.y * position.y * uWindStrength * 0.25 * (0.6 + 0.4 * sin(uWindTime * 0.5 + ipos.x * 0.07));
          transformed.xz += uWindDir * sway;
          vec2 cellXY = vec2(mod(aCell, uAtlasGrid.x), floor(aCell / uAtlasGrid.x));
          vImpUv = (cellXY + vec2(position.x + 0.5, 1.0 - position.y)) / uAtlasGrid;
          vImpUv.y = 1.0 - vImpUv.y;
          vTint = aTint;
          vImpFar = smoothstep(500.0, 700.0, idist);
          // near trees are meshes: their billboard collapses to a point
          if (idist < uNearCut || stay <= 0.0) transformed = vec3(0.0);`,
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform sampler2D tImpNormal; uniform vec2 uAtlasGrid; varying vec2 vImpUv; varying vec3 vRight; varying vec3 vToCam; varying float vTint; varying float vImpFar;`,
        )
        .replace(
          "#include <map_fragment>",
          `vec4 texel = texture2D(map, vImpUv);
          diffuseColor *= texel;
          diffuseColor.rgb *= mix(vec3(0.9, 0.95, 0.85), vec3(1.08, 1.04, 0.96), vTint);`,
        )
        .replace("#include <alphatest_fragment>", "if (diffuseColor.a < alphaTest) discard; diffuseColor.a = 1.0;")
        .replace(
          "#include <normal_fragment_maps>",
          `{ // (far off the baked crown normal is no longer seen: a rounded crown facing the camera)
            vec3 ln = vImpFar < 0.99 ? texture2D(tImpNormal, vImpUv).xyz * 2.0 - 1.0 : vec3(0.0);
            ln = mix(ln, vec3((vImpUv.x * uAtlasGrid.x - floor(vImpUv.x * uAtlasGrid.x)) * 1.2 - 0.6, 0.45, 0.65), vImpFar);
            vec3 wn = normalize(vRight * ln.x + vec3(0.0, 1.0, 0.0) * ln.y + vToCam * ln.z);
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`,
        );
    });
    this.impostorMaterial = m;
  }
  /**
   * Billboards for every tree, in chunks the camera culls (one draw each), each chunk's trees ordered
   * by a random rank so that a distant chunk draws only the first share of them (see the thinning in
   * the shader). Static buffers, written once.
   */
  private billboardChunks(trees: { x: number; y: number; z: number; s: number; cell: number; w: number; h: number }[], size: number, far: boolean, name: string) {
    const half = this.land.world.data.extent / 2;
    const buckets = new Map<string, typeof trees>();
    for (const t of trees) {
      const key = `${Math.floor((t.x + half) / size)},${Math.floor((t.z + half) / size)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(t);
    }
    const plane = new T.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    for (const list of buckets.values()) {
      const rank = (t: (typeof trees)[0]) => ((Math.sin(t.x * 91.73 + t.z * 47.11) * 43758.5453) % 1 + 1) % 1;
      const ranked = list.map((t) => [rank(t), t] as const).sort((a, b) => a[0] - b[0]);
      const n = ranked.length;
      const g = new T.InstancedBufferGeometry();
      for (const k of ["position", "uv", "normal"]) g.setAttribute(k, plane.getAttribute(k));
      g.setIndex(plane.getIndex());
      const cell = new Float32Array(n), sz = new Float32Array(n * 2), tint = new Float32Array(n), rk = new Float32Array(n);
      const mesh = new T.InstancedMesh(g, this.impostorMaterial, n);
      const im = mesh.instanceMatrix.array as Float32Array;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      ranked.forEach(([r, t], k) => {
        const o = k * 16;
        im.fill(0, o, o + 16);
        im[o] = t.s; im[o + 5] = t.s; im[o + 10] = t.s; im[o + 15] = 1;
        im[o + 12] = t.x; im[o + 13] = t.y; im[o + 14] = t.z;
        cell[k] = t.cell;
        sz[k * 2] = t.w;
        sz[k * 2 + 1] = t.h;
        tint[k] = ((t.x * 12.9898 + t.z * 78.233) % 1 + 1) % 1;
        rk[k] = r;
        x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z);
        y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y + t.h * t.s * 2);
      });
      g.setAttribute("aCell", new T.InstancedBufferAttribute(cell, 1));
      g.setAttribute("aSize", new T.InstancedBufferAttribute(sz, 2));
      g.setAttribute("aTint", new T.InstancedBufferAttribute(tint, 1));
      g.setAttribute("aRank", new T.InstancedBufferAttribute(rk, 1));
      mesh.count = n;
      // (the thinned billboards grow up to ~2x: pad the bounds for culling)
      const pad = 30;
      mesh.boundingSphere = new T.Box3(new T.Vector3(x0 - pad, y0, z0 - pad), new T.Vector3(x1 + pad, y1 + pad, z1 + pad)).getBoundingSphere(new T.Sphere());
      mesh.castShadow = false;
      mesh.receiveShadow = !far;
      mesh.name = name;
      this.land.scene.add(mesh);
      this.impostorChunks.push({ mesh, n, x0, z0, x1, z1, far });
    }
  }
  buildImpostorMesh() {
    this.buildImpostorMaterial();
    const trees: Parameters<Vegetation["billboardChunks"]>[0] = [];
    for (const v of this.variants)
      for (const r of v.rows) trees.push({ x: r[0], y: r[1] - 0.3 * r[3], z: r[2], s: r[3], cell: v.cell, w: v.size[0], h: v.size[1] });
    this.billboardChunks(trees, 300, false, "impostor");
  }
  /**
   * Billboards for the forest beyond the map (sites from FarTerrain): static, in 650 m chunks culled by
   * the camera and thinned with distance like the map's own. Species follow the same plantation/ridge
   * pattern as inside the map; at these distances the baked side views give the ridgelines their
   * ragged tree silhouette instead of a smooth, bald slope.
   */
  addFarForest(sites: Float32Array, kinds: Uint8Array) {
    const n = kinds.length;
    if (!n || !this.impostorMaterial) return;
    const trees: Parameters<Vegetation["billboardChunks"]>[0] = [];
    for (let i = 0; i < n; i++) {
      const v = this.variants[kinds[i] * VARIANTS + (i % VARIANTS)], sc = sites[i * 4 + 3];
      trees.push({ x: sites[i * 4], y: sites[i * 4 + 1], z: sites[i * 4 + 2], s: 1, cell: v.cell, w: v.size[0] * sc, h: v.size[1] * sc });
    }
    this.billboardChunks(trees, 650, true, "far-forest");
  }
  /** the share of a chunk's billboards that can be kept at its nearest point (the rest are not sent) */
  private updateImpostors(cam: T.Vector3) {
    const [D0, kMin] = [this.thin.value.x, this.thin.value.y];
    for (const c of this.impostorChunks) {
      const dx = Math.max(c.x0 - cam.x, 0, cam.x - c.x1), dz = Math.max(c.z0 - cam.z, 0, cam.z - c.z1);
      const d = Math.hypot(dx, dz);
      const keep = Math.min(1, Math.max(kMin, (D0 * D0) / Math.max(d * d, 1)));
      c.mesh.count = Math.min(c.n, Math.ceil(c.n * keep) + 1);
      // all of it within the mesh LODs' reach: nothing to draw
      const fx = Math.max(Math.abs(c.x0 - cam.x), Math.abs(c.x1 - cam.x)), fz = Math.max(Math.abs(c.z0 - cam.z), Math.abs(c.z1 - cam.z));
      c.mesh.visible = Math.hypot(fx, fz) > this.nearCut.value - 1;
    }
  }
  gridN = 1;
  nearCut = { value: 140 };
  setQuality(q: Quality) {
    const t = QUALITY[q].trees;
    this.dist = { lod0: t.lod0, lod1: t.lod1 };
    this.nearCut.value = this.dist.lod1;
    this.thin.value.set(t.thin, t.keep);
    this.lastPos.set(1e9, 0, 0);
  }
  private frustum = new T.Frustum();
  private nearList: number[][] = [[], []];
  private restList: number[][] = [[], []];
  /** the sun moved: the trees in the first shadow cascade's view are sorted again */
  setTime() {
    this.lastPos.set(1e9, 0, 0);
  }
  private vp = new T.Matrix4();
  private sphere = new T.Sphere();
  update(_dt: number, t: number, cam: T.PerspectiveCamera) {
    windUniforms.uWindTime.value = t;
    this.frame++;
    const moved = cam.position.distanceToSquared(this.lastPos) > 0.8;
    const turned = cam.quaternion.angleTo(this.lastQuat) > 0.03;
    // (standing still nothing changes: a new time of day or quality setting resets lastPos)
    if (!moved && !turned) return;
    if (moved) this.updateImpostors(cam.position);
    this.lastPos.copy(cam.position);
    this.lastQuat.copy(cam.quaternion);
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const { lod0, lod1 } = this.dist;
    const cx = cam.position.x, cz = cam.position.z;
    // only the grid cells within reach of the mesh LODs (the billboards beyond are static)
    const half = this.land.world.data.extent / 2, gn = this.gridN, reach = lod1 + 2;
    const i0 = Math.max(0, Math.floor((cx - reach + half) / GRID)), i1 = Math.min(gn - 1, Math.floor((cx + reach + half) / GRID));
    const j0 = Math.max(0, Math.floor((cz - reach + half) / GRID)), j1 = Math.min(gn - 1, Math.floor((cz + reach + half) / GRID));
    // the first shadow cascade's box in light space, with a margin for the camera moving or turning a
    // little before the next update
    const L = this.land.lighting, nb = L.nearBox, lm = L.toLight.elements;
    for (const v of this.variants) {
      const counts = [0, 0], near = this.nearList, rest = this.restList;
      near[0].length = near[1].length = rest[0].length = rest[1].length = 0;
      const mats = v.mats!;
      for (let gj = j0; gj <= j1; gj++)
        for (let gi = i0; gi <= i1; gi++) {
          const rows = v.grid!.get(gj * gn + gi);
          if (!rows) continue;
          for (const k of rows) {
            const r = v.rows[k];
            const dx = r[0] - cx, dz = r[2] - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= lod1 * lod1) continue;
            const sc = r[3];
            this.sphere.center.set(r[0], r[1] + v.height * sc * 0.5, r[2]);
            this.sphere.radius = v.height * sc * 0.6 + 2;
            const d = Math.sqrt(d2);
            // near trees outside the view still cast shadows into it
            if (d > 70 && !this.frustum.intersectsSphere(this.sphere)) continue;
            const lod = d < lod0 ? 0 : 1;
            // in the first cascade's view of the sun?
            const y = r[1] + v.height * sc * 0.5;
            const lx = lm[0] * r[0] + lm[4] * y + lm[8] * r[2] + lm[12], ly = lm[1] * r[0] + lm[5] * y + lm[9] * r[2] + lm[13];
            const lz = lm[2] * r[0] + lm[6] * y + lm[10] * r[2] + lm[14];
            const reach = nb.half + this.sphere.radius + 6;
            const inNear = Math.abs(lx - nb.cx) < reach && Math.abs(ly - nb.cy) < reach && lz < nb.cz + this.sphere.radius && lz > nb.cz - nb.depth;
            (inNear ? near : rest)[lod].push(k);
            counts[lod]++;
          }
        }
      for (const lod of [0, 1]) {
        const out = v.shared![lod].array as Float32Array;
        let i = 0;
        for (const k of near[lod]) out.set(mats.subarray(k * 16, k * 16 + 16), i++ * 16);
        v.nearCount![lod] = i;
        for (const k of rest[lod]) out.set(mats.subarray(k * 16, k * 16 + 16), i++ * 16);
        v.count![lod] = i;
      }
      for (const lod of [0, 1]) {
        // only the part of the buffer in use is sent
        const a = v.shared![lod];
        a.clearUpdateRanges();
        if (counts[lod]) {
          a.addUpdateRange(0, counts[lod] * 16);
          a.needsUpdate = true;
        }
        for (const p of v.lods[lod]) p.mesh!.count = counts[lod];
      }
    }
  }
}
