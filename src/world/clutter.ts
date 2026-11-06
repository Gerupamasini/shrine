import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../urls";
import type { Landscape, System } from "./landscape";
import type { InstanceRow } from "./data";
import type { Quality } from "../engine/lighting";
import { windHook } from "./vegetation";

/** clutter.json kind -> Poly Haven CC0 models (variant picks among them) */
const KINDS: Record<string, { files: string[]; far: number; plant?: boolean; shadow?: boolean }> = {
  fern: { files: ["fern_02"], far: 45, plant: true },
  shrub: { files: ["shrub_02", "shrub_03", "shrub_04"], far: 80, plant: true, shadow: true },
  weed: { files: ["weed_plant_02", "nettle_plant"], far: 45, plant: true },
  rock_moss: { files: ["rock_moss_set_01", "rock_moss_set_02"], far: 90, shadow: true },
  boulder: { files: ["rock_07", "rock_09"], far: 140, shadow: true },
  river_stone: { files: ["stone_01", "rock_09", "rock_07"], far: 60 },
  stump: { files: ["tree_stump_01"], far: 70, shadow: true },
  log: { files: ["dead_tree_trunk"], far: 80, shadow: true },
};

type Batch = { rows: InstanceRow[]; parts: { mesh: T.InstancedMesh; local: T.Matrix4 }[]; far: number };

export class Clutter implements System {
  batches: Batch[] = [];
  mats = new Map<string, T.Material>();
  scale = 1;
  constructor(
    public land: Landscape,
    public items: Record<string, InstanceRow[]>,
  ) {}
  async load() {
    const loader = new GLTFLoader();
    const jobs: Promise<void>[] = [];
    for (const [kind, def] of Object.entries(KINDS)) {
      const rows = this.items[kind] ?? [];
      def.files.forEach((file, fi) => {
        const mine = rows.filter((r) => r[5] % def.files.length === fi);
        if (!mine.length) return;
        jobs.push(
          loader.loadAsync(publicUrl(`assets/models/props/${file}.glb`)).then((g) => {
            g.scene.updateMatrixWorld(true);
            const parts: Batch["parts"] = [];
            g.scene.traverse((o) => {
              if (!(o instanceof T.Mesh)) return;
              const src = o.material as T.MeshStandardMaterial;
              let m = this.mats.get(src.name);
              if (!m) {
                src.aoMap = null;
                if (def.plant) {
                  src.alphaTest = 0.5;
                  src.transparent = false;
                  src.side = T.DoubleSide;
                  src.alphaToCoverage = true;
                  (src as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
                }
                m = this.land.lib.finish(src);
                if (def.plant) windHook(m, 0.0);
                this.mats.set(src.name, m);
              }
              const mesh = new T.InstancedMesh(o.geometry, m, mine.length);
              mesh.count = 0;
              mesh.castShadow = !!def.shadow;
              mesh.receiveShadow = true;
              mesh.frustumCulled = false;
              this.land.scene.add(mesh);
              parts.push({ mesh, local: o.matrixWorld.clone() });
            });
            this.batches.push({ rows: mine, parts, far: def.far });
          }),
        );
      });
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
        this.m.compose(this.v.set(r[0], r[1], r[2]), this.q, this.s.setScalar(r[3]));
        for (const p of b.parts) p.mesh.setMatrixAt(n, this.m.clone().multiply(p.local));
        n++;
      }
      for (const p of b.parts) {
        p.mesh.count = n;
        p.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
