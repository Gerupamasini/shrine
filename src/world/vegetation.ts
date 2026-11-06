import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../urls";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import type { InstanceRow } from "./data";
import type { Quality } from "../engine/lighting";

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
type Variant = { species: string; v: number; rows: InstanceRow[]; lods: Part[][]; cell: number; size: [number, number]; height: number };

export class Vegetation implements System {
  variants: Variant[] = [];
  materials = new Map<string, T.Material>();
  impostor!: T.InstancedMesh;
  impostorCell!: T.InstancedBufferAttribute;
  impostorSize!: T.InstancedBufferAttribute;
  impostorTint!: T.InstancedBufferAttribute;
  atlas!: { albedo: T.Texture; normal: T.Texture };
  dist = { lod0: 45, lod1: 140, max: 2400 };
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
      bark_broadleaf: ["japanese_zelkova_bark", "#7b766c"],
      bark_keyaki: ["japanese_zelkova_bark", "#a8a296"],
    };
    if (bark[name]) {
      m = lib.pbr({ tex: bark[name][0], color: bark[name][1], size: 1 });
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
      mm.normalScale.set(0.6, 0.6);
      (mm as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
      m = lib.finish(mm);
      windHook(m, name === "bamboo_leaf" ? 1.6 : 1.0);
    }
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
    for (const v of this.variants)
      v.lods.forEach((parts, lod) =>
        parts.forEach((p) => {
          const m = new T.InstancedMesh(p.geometry, p.material, Math.max(1, v.rows.length));
          m.count = 0;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
          m.instanceMatrix.setUsage(T.DynamicDrawUsage);
          m.name = `${v.species}_${v.v}_lod${lod}`;
          p.mesh = m;
          this.land.scene.add(m);
        }),
      );
    this.total = this.variants.reduce((s, v) => s + v.rows.length, 0);
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
    const normalMat = (src: T.MeshStandardMaterial) =>
      new T.ShaderMaterial({
        uniforms: { map: { value: src.map }, alphaTest: { value: 0.5 } },
        side: T.DoubleSide,
        vertexShader: `varying vec3 vN; varying vec2 vUv; void main(){ vUv=uv; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform sampler2D map; uniform float alphaTest; varying vec3 vN; varying vec2 vUv;
          void main(){ float a = texture2D(map, vUv).a; if (a < alphaTest) discard;
            vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; if (n.z < 0.0) n.z = -n.z * 0.3;
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
  buildImpostorMesh() {
    const rows = (this as unknown as { atlasRows: number }).atlasRows;
    const g = new T.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    const n = this.total;
    this.impostorCell = new T.InstancedBufferAttribute(new Float32Array(n), 1);
    this.impostorSize = new T.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.impostorTint = new T.InstancedBufferAttribute(new Float32Array(n), 1);
    for (const a of [this.impostorCell, this.impostorSize, this.impostorTint]) a.setUsage(T.DynamicDrawUsage);
    g.setAttribute("aCell", this.impostorCell);
    g.setAttribute("aSize", this.impostorSize);
    g.setAttribute("aTint", this.impostorTint);
    const m = new T.MeshStandardMaterial({ map: this.atlas.albedo, roughness: 0.85, alphaTest: 0.42, side: T.DoubleSide, alphaToCoverage: true });
    (m as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
    this.land.lib.finish(m);
    const u = { tImpNormal: { value: this.atlas.normal }, uAtlasGrid: { value: new T.Vector2(ATLAS_COLS, rows) } };
    addHook(m, "impostor", (s) => {
      Object.assign(s.uniforms, u, windUniforms);
      s.vertexShader = s.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute float aCell; attribute vec2 aSize; attribute float aTint;
          uniform vec2 uAtlasGrid; uniform float uWindTime, uWindStrength; uniform vec2 uWindDir;
          varying vec2 vImpUv; varying vec3 vRight; varying vec3 vToCam; varying float vTint;`,
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
          `vec3 transformed = vRight * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);
          float sway = position.y * position.y * uWindStrength * 0.25 * (0.6 + 0.4 * sin(uWindTime * 0.5 + ipos.x * 0.07));
          transformed.xz += uWindDir * sway;
          vec2 cellXY = vec2(mod(aCell, uAtlasGrid.x), floor(aCell / uAtlasGrid.x));
          vImpUv = (cellXY + vec2(position.x + 0.5, 1.0 - position.y)) / uAtlasGrid;
          vImpUv.y = 1.0 - vImpUv.y;
          vTint = aTint;`,
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform sampler2D tImpNormal; varying vec2 vImpUv; varying vec3 vRight; varying vec3 vToCam; varying float vTint;`,
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
          `{ vec3 ln = texture2D(tImpNormal, vImpUv).xyz * 2.0 - 1.0;
            vec3 wn = normalize(vRight * ln.x + vec3(0.0, 1.0, 0.0) * ln.y + vToCam * ln.z);
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`,
        );
    });
    const mesh = new T.InstancedMesh(g, m, Math.max(1, n));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.impostor = mesh;
    this.land.scene.add(mesh);
  }
  setQuality(q: Quality) {
    this.dist = q === "low" ? { lod0: 26, lod1: 90, max: 1600 } : q === "high" ? { lod0: 70, lod1: 210, max: 2600 } : { lod0: 45, lod1: 140, max: 2200 };
    this.lastPos.set(1e9, 0, 0);
  }
  private m = new T.Matrix4();
  private q = new T.Quaternion();
  private e = new T.Euler();
  private p = new T.Vector3();
  private s = new T.Vector3();
  private frustum = new T.Frustum();
  private sphere = new T.Sphere();
  update(_dt: number, t: number, cam: T.PerspectiveCamera) {
    windUniforms.uWindTime.value = t;
    this.frame++;
    const moved = cam.position.distanceToSquared(this.lastPos) > 0.8;
    const turned = cam.quaternion.angleTo(this.lastQuat) > 0.03;
    if (!moved && !turned && this.frame % 20) return;
    this.lastPos.copy(cam.position);
    this.lastQuat.copy(cam.quaternion);
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const { lod0, lod1, max } = this.dist;
    const cx = cam.position.x, cz = cam.position.z;
    let imp = 0;
    const im = this.impostor.instanceMatrix.array as Float32Array;
    for (const v of this.variants) {
      const counts = [0, 0];
      const parts0 = v.lods[0], parts1 = v.lods[1];
      for (const r of v.rows) {
        const dx = r[0] - cx, dz = r[2] - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > max * max) continue;
        const sc = r[3];
        this.sphere.center.set(r[0], r[1] + v.height * sc * 0.5, r[2]);
        this.sphere.radius = v.height * sc * 0.6 + 2;
        const inView = this.frustum.intersectsSphere(this.sphere);
        const d = Math.sqrt(d2);
        const lod = d < lod0 ? 0 : d < lod1 ? 1 : 2;
        // near trees outside the view still cast shadows into it
        if (!inView && (lod === 2 || d > 70)) continue;
        if (lod < 2) {
          this.e.set(r[6] ?? 0, r[4], 0, "YXZ");
          this.q.setFromEuler(this.e);
          this.m.compose(this.p.set(r[0], r[1] - 0.2 * sc, r[2]), this.q, this.s.setScalar(sc));
          const parts = lod === 0 ? parts0 : parts1;
          const i = counts[lod]++;
          for (const p of parts) p.mesh!.setMatrixAt(i, this.m);
        } else {
          const k = imp * 16;
          im[k] = sc; im[k + 1] = 0; im[k + 2] = 0; im[k + 3] = 0;
          im[k + 4] = 0; im[k + 5] = sc; im[k + 6] = 0; im[k + 7] = 0;
          im[k + 8] = 0; im[k + 9] = 0; im[k + 10] = sc; im[k + 11] = 0;
          im[k + 12] = r[0]; im[k + 13] = r[1] - 0.3 * sc; im[k + 14] = r[2]; im[k + 15] = 1;
          (this.impostorCell.array as Float32Array)[imp] = v.cell;
          (this.impostorSize.array as Float32Array)[imp * 2] = v.size[0];
          (this.impostorSize.array as Float32Array)[imp * 2 + 1] = v.size[1];
          (this.impostorTint.array as Float32Array)[imp] = ((r[0] * 12.9898 + r[2] * 78.233) % 1 + 1) % 1;
          imp++;
        }
      }
      parts0.forEach((p) => ((p.mesh!.count = counts[0]), (p.mesh!.instanceMatrix.needsUpdate = true)));
      parts1.forEach((p) => ((p.mesh!.count = counts[1]), (p.mesh!.instanceMatrix.needsUpdate = true)));
    }
    this.impostor.count = imp;
    this.impostor.instanceMatrix.needsUpdate = true;
    this.impostorCell.needsUpdate = this.impostorSize.needsUpdate = this.impostorTint.needsUpdate = true;
  }
}
