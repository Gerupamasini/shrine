import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../urls";
import type { Landscape, System } from "./landscape";
import type { Placement } from "./data";
import { MATERIALS } from "./materials";
import { isVehicle } from "../vehicles/specs";

const PROPS: Record<string, string> = {
  "prop-bucket": "props/wooden_bucket_01",
  "prop-barrels": "props/wooden_barrels_01",
  "prop-crate": "props/wooden_crate_01",
  "prop-basket": "props/wicker_basket_01",
  "prop-ladder": "props/wooden_ladder",
};

type Inst = { file: string; matrix: T.Matrix4 };

/** Places every built object from scene.json as instanced GLB parts. */
export class Architecture implements System {
  materials = new Map<string, T.Material>();
  dusk: { m: T.MeshStandardMaterial; base: number; ramp: number[] }[] = [];
  meshes: { mesh: T.InstancedMesh; centers: T.Vector3[]; far: number; near?: number; matrices: T.Matrix4[] }[] = [];
  constructor(public land: Landscape) {}
  material(src: T.Material): T.Material {
    const name = src.name;
    let m = this.materials.get(name);
    if (m) return m;
    // Vehicle GLBs carry their own clearcoat, micro-normal and roughness maps.
    // Replacing them with the generic architecture table would erase the authored finish.
    if (name.startsWith("vehicle_")) {
      const authored = this.land.lib.finish(src as T.MeshStandardMaterial);
      this.materials.set(name, authored);
      return authored;
    }
    const def = MATERIALS[name];
    if (def) {
      const std = this.land.lib.pbr(def) as T.MeshStandardMaterial;
      if (def.emissive) {
        std.emissive.set(def.emissive);
        std.emissiveIntensity = def.emissiveIntensity ?? 1;
        const dusk = (def as { dusk?: number[] }).dusk;
        if (dusk) this.dusk.push({ m: std, base: def.emissiveIntensity ?? 0, ramp: dusk });
      }
      m = std;
    } else {
      // Poly Haven props: keep their own textures
      const s = src as T.MeshStandardMaterial;
      s.aoMap = null;
      m = this.land.lib.finish(s);
    }
    this.materials.set(name, m);
    return m;
  }
  resolve(o: Placement, i: number): string[] {
    const a = o.asset, v = (o.variant as number | string | undefined) ?? 0;
    if (a.startsWith("minka-")) return [`architecture/${a}_${v}`];
    if (a === "naya") return [`architecture/naya_${i % 2}`];
    if (a === "toro") return [`architecture/${i % 3 === 0 ? "toro_1" : "toro"}`];
    if (a === "komainu") return [`architecture/komainu-${v}`];
    if (a === "jihanki") return [`architecture/jihanki_${v}`];
    if (a === "haka") return [`architecture/haka_${v}`];
    if (a === "denchu") return [`architecture/${i % 3 === 1 ? "denchu-trans" : "denchu"}`];
    if (PROPS[a]) return [PROPS[a]];
    return [`architecture/${a}`];
  }
  async load(progress: (p: number) => void) {
    const data = this.land.world.data;
    const height = this.land.world.height;
    const inst: Inst[] = [];
    const q = new T.Quaternion(), up = new T.Vector3(0, 1, 0);
    data.objects.forEach((o, i) => {
      // Movable cars are owned by VehicleFleet, never duplicated in static batches.
      if (isVehicle(o.asset)) return;
      const [x, y, z] = o.position;
      const yaw = o.rotation[1], s = o.scale[0];
      q.setFromAxisAngle(up, yaw);
      const base = new T.Matrix4().compose(new T.Vector3(x, y, z), q, new T.Vector3(s, s, s));
      const files = this.resolve(o, i);
      if (o.asset === "block-wall" || o.asset === "ishigaki") {
        const len = (o.length as number) ?? 10, n = Math.max(1, Math.round(len / 2));
        const hgt = (o.height as number) ?? 1;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * 2;
          // block walls leave a 4 m entrance in front of the house (gateway to the yard)
          if (o.asset === "block-wall" && Math.abs(off) < 2.1) continue;
          const local = new T.Matrix4().makeTranslation(off, 0, 0);
          if (o.asset === "ishigaki") local.multiply(new T.Matrix4().makeScale(1, hgt, 1));
          const m = base.clone().multiply(local);
          // block walls follow the ground along their length
          if (o.asset === "block-wall") {
            const p = new T.Vector3().setFromMatrixPosition(m);
            m.setPosition(p.x, height.sample(p.x, p.z), p.z);
          }
          inst.push({ file: files[0], matrix: m });
        }
        return;
      }
      for (const f of files) inst.push({ file: f, matrix: base });
    });
    inst.push({ file: "architecture/stairs", matrix: new T.Matrix4() });
    inst.push({ file: "architecture/road-ditch", matrix: new T.Matrix4() });
    inst.push({ file: "architecture/river-works", matrix: new T.Matrix4() });
    inst.push({ file: "architecture/road-markings", matrix: new T.Matrix4() });
    if ((data.streams ?? []).length) inst.push({ file: "architecture/stream-works", matrix: new T.Matrix4() });
    const byFile = new Map<string, T.Matrix4[]>();
    for (const it of inst) {
      if (!byFile.has(it.file)) byFile.set(it.file, []);
      byFile.get(it.file)!.push(it.matrix);
    }
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(
      [...byFile].map(async ([file, mats]) => {
        const vehicle = /architecture\/(kei-truck|kei-hatch|crown-sedan|light-truck|utility-wagon)$/.test(file);
        const levels = vehicle ? [0, 1] : [0];
        for (const level of levels) {
        const g = await loader.loadAsync(publicUrl(`assets/models/${file}${level ? "-lod1" : ""}.glb`));
        g.scene.updateMatrixWorld(true);
        g.scene.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          const matrices = mats.map((m) => m.clone().multiply(o.matrixWorld));
          const mesh = new T.InstancedMesh(o.geometry, this.material(o.material as T.Material), matrices.length);
          matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = !(mesh.material as T.Material).transparent;
          mesh.receiveShadow = true;
          mesh.name = file;
          mesh.computeBoundingSphere();
          o.geometry.computeBoundingSphere();
          const r = o.geometry.boundingSphere!.radius;
          this.meshes.push({ mesh, matrices, near: level ? 45 : 0, centers: matrices.map((m) => new T.Vector3().setFromMatrixPosition(m)), far: vehicle && !level ? 45 : file.includes("props") ? 120 : file.includes("stairs") || file.includes("road-ditch") || file.includes("river-works") || file.includes("road-markings") || file.includes("stream-works") ? 1e9 : 400 + r * 40 });
          this.land.scene.add(mesh);
        });
        }
        progress(++done / byFile.size);
      }),
    );
    this.buildWires();
  }
  /** Lit windows, vending machines and street lamps brighten as the evening darkens. */
  setTime(h: number) {
    for (const d of this.dusk) {
      const [a, b, full] = d.ramp;
      d.m.emissiveIntensity = d.base + (full - d.base) * T.MathUtils.smoothstep(h, a, b);
    }
  }
  /** Sagging power lines between consecutive poles (three conductors). */
  buildWires() {
    const poles = this.land.world.data.powerLine.poles;
    const pos: number[] = [];
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i + 1];
      // conductors sit across the road on the cross-arm, i.e. offset perpendicular to the span
      const sdx = b[0] - a[0], sdz = b[2] - a[2], sl = Math.hypot(sdx, sdz) || 1;
      const px = sdz / sl, pz = -sdx / sl;
      for (const off of [-0.75, 0, 0.75]) {
        const N = 16;
        const ax = a[0] + px * off, az = a[2] + pz * off, bx = b[0] + px * off, bz = b[2] + pz * off;
        const ay = a[1] + 9.55, by = b[1] + 9.55;
        for (let k = 0; k < N; k++) {
          const t0 = k / N, t1 = (k + 1) / N;
          const y0 = ay + (by - ay) * t0 - 0.65 * 4 * t0 * (1 - t0);
          const y1 = ay + (by - ay) * t1 - 0.65 * 4 * t1 * (1 - t1);
          pos.push(ax + (bx - ax) * t0, y0, az + (bz - az) * t0, ax + (bx - ax) * t1, y1, az + (bz - az) * t1);
        }
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    const m = new T.LineBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.85 });
    const lines = new T.LineSegments(g, this.land.lib.finish(m));
    this.land.scene.add(lines);
  }
  frame = 0;
  private culledAt = new T.Vector3(1e9, 0, 0);
  update(_dt: number, _t: number, cam: T.PerspectiveCamera) {
    // every 15th frame, or at once when the view has jumped (a teleport, a capture)
    if (this.frame++ % 15 && cam.position.distanceToSquared(this.culledAt) < 64) return;
    this.culledAt.copy(cam.position);
    // distance culling of small instanced parts (props, far houses keep rendering)
    for (const m of this.meshes) {
      if (m.far > 1e8) continue;
      let n = 0;
      for (let k = 0; k < m.matrices.length; k++) {
        const distance = m.centers[k].distanceTo(cam.position);
        if (distance >= m.far || distance < (m.near ?? 0)) continue;
        m.mesh.setMatrixAt(n++, m.matrices[k]);
      }
      m.mesh.count = n;
      m.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
