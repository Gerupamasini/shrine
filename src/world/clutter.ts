import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../urls";
import type { Landscape, System } from "./landscape";
import type { InstanceRow } from "./data";
import type { Quality } from "../engine/lighting";
import { windHook } from "./vegetation";

/**
 * clutter.json kind -> Poly Haven CC0 models.
 * Plant sheets are split into single specimens ("plant_<i>" nodes, see tools/assets/process_models.mjs);
 * every instance shows exactly one specimen, chosen by a stable hash of its position.
 *  - scale: multiplier on the row scale
 *  - fit:   metres per unit of row scale: the specimen is sized so its largest dimension = row scale × fit
 *  - byVariant: row variant selects the file (crops: one crop per field)
 */
type KindDef = { files: string[]; far: number; plant?: boolean; shadow?: boolean; scale?: number; fit?: number; byVariant?: boolean };
const KINDS: Record<string, KindDef> = {
  fern: { files: ["fern_02"], far: 36, plant: true, scale: 1.6 },
  shrub: { files: ["shrub_02", "shrub_03", "shrub_04"], far: 62, plant: true, shadow: true, scale: 1.4 },
  weed: { files: ["weed_plant_02", "nettle_plant"], far: 30, plant: true, scale: 2.2 },
  rock_moss: { files: ["rock_moss_set_01", "rock_moss_set_02"], far: 75, shadow: true },
  boulder: { files: ["rock_07", "rock_moss_set_02"], far: 140, shadow: true, fit: 1.9 },
  river_stone: { files: ["stone_01", "rock_07"], far: 60, fit: 0.55 },
  stump: { files: ["tree_stump_01"], far: 70, shadow: true },
  log: { files: ["dead_tree_trunk"], far: 80, shadow: true },
  // vegetable rows: aubergine, edamame (bushy), taro (big leaves), leafy greens (rosettes)
  crop: { files: ["crop-bush", "crop-bush", "crop-leafy", "crop-low"], far: 22, plant: true, fit: 1, byVariant: true },
};

type Specimen = { parts: { geometry: T.BufferGeometry; material: T.Material; local: T.Matrix4 }[]; size: number };
type Batch = { rows: InstanceRow[]; meshes: { mesh: T.InstancedMesh; local: T.Matrix4 }[]; far: number; mul: number };

export class Clutter implements System {
  batches: Batch[] = [];
  mats = new Map<string, T.Material>();
  scale = 1;
  constructor(
    public land: Landscape,
    public items: Record<string, InstanceRow[]>,
  ) {}
  private material(src: T.MeshStandardMaterial, plant: boolean) {
    let m = this.mats.get(src.name);
    if (m) return m;
    src.aoMap = null;
    if (plant) {
      src.alphaTest = 0.5;
      src.transparent = false;
      src.side = T.DoubleSide;
      src.alphaToCoverage = true;
      (src as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
    }
    m = this.land.lib.finish(src);
    if (plant) windHook(m, 0.0);
    this.mats.set(src.name, m);
    return m;
  }
  /** Load a props GLB and return its specimens (plant_* nodes, or the whole model as one). */
  private async specimens(loader: GLTFLoader, file: string, plant: boolean): Promise<Specimen[]> {
    const g = await loader.loadAsync(publicUrl(`assets/models/props/${file}.glb`));
    g.scene.updateMatrixWorld(true);
    const roots = g.scene.children.filter((c) => /^plant_\d+$/.test(c.name));
    const groups = roots.length ? roots : [g.scene];
    return groups.map((root) => {
      const parts: Specimen["parts"] = [];
      // plant_* nodes are recentred on their base by their own node transform (process_models.mjs)
      const box = new T.Box3();
      root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const local = o.matrixWorld.clone();
        parts.push({ geometry: o.geometry, material: this.material(o.material as T.MeshStandardMaterial, plant), local });
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox!.clone().applyMatrix4(local));
      });
      const sz = box.getSize(new T.Vector3());
      return { parts, size: Math.max(sz.y, sz.x, sz.z, 0.01) };
    });
  }
  async load() {
    const loader = new GLTFLoader();
    const jobs: Promise<void>[] = [];
    for (const [kind, def] of Object.entries(KINDS)) {
      const rows = this.items[kind] ?? [];
      if (!rows.length) continue;
      jobs.push(
        (async () => {
          const unique = [...new Set(def.files)];
          const loaded = new Map<string, Specimen[]>();
          await Promise.all(unique.map(async (f) => loaded.set(f, await this.specimens(loader, f, !!def.plant))));
          // assign each row to (file, specimen)
          const buckets = new Map<string, { spec: Specimen; rows: InstanceRow[] }>();
          for (const r of rows) {
            const file = def.byVariant ? def.files[r[5] % def.files.length] : def.files[(r[5] + Math.floor(Math.abs(r[0] * 3.1 + r[2] * 1.7))) % def.files.length];
            const specs = loaded.get(file)!;
            const si = Math.floor(Math.abs(r[0] * 7.13 + r[2] * 3.71 + r[4] * 11.0)) % specs.length;
            const key = `${file}#${si}`;
            if (!buckets.has(key)) buckets.set(key, { spec: specs[si], rows: [] });
            buckets.get(key)!.rows.push(r);
          }
          for (const { spec, rows: mine } of buckets.values()) {
            const meshes = spec.parts.map((p) => {
              const mesh = new T.InstancedMesh(p.geometry, p.material, mine.length);
              mesh.count = 0;
              mesh.castShadow = !!def.shadow;
              mesh.receiveShadow = true;
              mesh.frustumCulled = false;
              mesh.name = `props/${kind}`;
              this.land.scene.add(mesh);
              return { mesh, local: p.local };
            });
            this.batches.push({ rows: mine, meshes, far: def.far, mul: def.fit ? def.fit / spec.size : def.scale ?? 1 });
          }
        })(),
      );
    }
    await Promise.all(jobs);
  }
  setQuality(q: Quality) {
    this.scale = q === "low" ? 0.55 : q === "high" ? 1.4 : 1;
    this.last.set(1e9, 0, 0);
  }
  last = new T.Vector3(1e9, 0, 0);
  private m = new T.Matrix4();
  private q = new T.Quaternion();
  private v = new T.Vector3();
  private s = new T.Vector3();
  private tmp = new T.Matrix4();
  update(_dt: number, _t: number, cam: T.PerspectiveCamera) {
    if (cam.position.distanceToSquared(this.last) < 4) return;
    this.last.copy(cam.position);
    const up = new T.Vector3(0, 1, 0);
    for (const b of this.batches) {
      const far = b.far * this.scale;
      let n = 0;
      for (const r of b.rows) {
        const dx = r[0] - cam.position.x, dz = r[2] - cam.position.z;
        if (dx * dx + dz * dz > far * far) continue;
        this.q.setFromAxisAngle(up, r[4]);
        this.m.compose(this.v.set(r[0], r[1], r[2]), this.q, this.s.setScalar(r[3] * b.mul));
        for (const p of b.meshes) p.mesh.setMatrixAt(n, this.tmp.copy(this.m).multiply(p.local));
        n++;
      }
      for (const p of b.meshes) {
        p.mesh.count = n;
        p.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
