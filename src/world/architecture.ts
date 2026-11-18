import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../urls";
import type { Landscape, System } from "./landscape";
import type { Placement } from "./data";
import { MATERIALS } from "./materials";
import { applyFacade, facadeUniforms, type FacadeKind } from "../engine/facade";
import type { Library } from "../engine/library";
import { isVehicle } from "../vehicles/specs";
import { FAR_CASTER, SHADOW_ONLY } from "../engine/lighting";
import { QUALITY, type Quality } from "../engine/quality";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type DuskRamp = { m: T.MeshStandardMaterial; base: number; ramp: number[] };

/** Material for a building part named in materials.json (photographic PBR set + facade shading). */
export function buildingMaterial(lib: Library, name: string, dusk: DuskRamp[] = []): T.MeshStandardMaterial | null {
  const def = MATERIALS[name];
  if (!def) return null;
  const std = lib.pbr(def) as T.MeshStandardMaterial;
  std.name = name;
  if (def.emissive) {
    std.emissive.set(def.emissive);
    std.emissiveIntensity = def.emissiveIntensity ?? 1;
    const ramp = (def as { dusk?: number[] }).dusk;
    if (ramp) dusk.push({ m: std, base: def.emissiveIntensity ?? 0, ramp });
  }
  return applyFacade(std, (def.facade ?? "base") as FacadeKind);
}

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
  dusk: DuskRamp[] = [];
  /** the shadow stand-ins: one batch for the big casters (drawn into the far cascades too), one for
   *  the rest; every placement an instance, culled against each cascade on its own */
  shadowItems: { batch: T.BatchedMesh; id: number; center: T.Vector3; far: number; shown: boolean }[] = [];
  /** every placed part in the material batches. lod: 0 / 1 for buildings with a far model (houses,
   *  barns): the near parts show inside `lodDist`, the far parts beyond it, in the same batches */
  items: { batch: T.BatchedMesh; id: number; center: T.Vector3; far: number; shown: boolean; lod?: number }[] = [];
  /** stand-in shadow casters are drawn depth-only: any opaque material does */
  shadowMaterial = new T.MeshBasicMaterial();
  /** distance at which houses and barns change to their far model (quality setting) */
  lodDist = 60;
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
    const built = buildingMaterial(this.land.lib, name, this.dusk);
    if (built) {
      m = built;
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
    const registry = (await fetch(publicUrl("assets/models/architecture/index.json")).then((r) => r.json())).assets as Record<string, { lod1?: boolean }>;
    let done = 0;
    type Part = { material: T.Material; geometry: T.BufferGeometry; matrices: T.Matrix4[]; far: number; lod?: number };
    const parts: Part[] = [];
    const proxies: { geometry: T.BufferGeometry; matrices: T.Matrix4[]; far: number; farCaster: boolean }[] = [];
    await Promise.all(
      [...byFile].map(async ([file, mats]) => {
        const lodded = !!registry[file.replace(/^architecture\//, "")]?.lod1;
        const levels = lodded ? [0, 1] : [0];
        for (const level of levels) {
        const g = await loader.loadAsync(publicUrl(`assets/models/${file}${level ? "-lod1" : ""}.glb`));
        g.scene.updateMatrixWorld(true);
        // buildings and other big pieces shade the ground beyond the first shadow cascade; props,
        // posts, signs, low walls and the channel linings only near the camera
        const size = new T.Box3().setFromObject(g.scene).getSize(new T.Vector3());
        const farCaster = !file.includes("props") && !/road-ditch|road-markings|stream-works/.test(file) && Math.max(size.x, size.y, size.z) > 3.5 && size.y > 2.2;
        // The shadow of each model comes from one stand-in: all its opaque parts merged (positions
        // only), drawn into the shadow maps alone. A house is some twenty parts, one per material,
        // and each part was drawn again for every cascade: most of the shadow draw calls.
        const shadowParts: T.BufferGeometry[] = [];
        let reach = 0;
        const casts = !/road-markings/.test(file);
        g.scene.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          const material = this.material(o.material as T.Material);
          const geometry = bake(o.geometry, o.matrixWorld);
          // the shadow stand-in of a house comes from its far model (the near one only adds sash
          // bars, grilles and rafters to it)
          if (casts && !material.transparent && level === levels.length - 1) {
            const sg = new T.BufferGeometry().setAttribute("position", geometry.getAttribute("position"));
            sg.setIndex(geometry.index);
            shadowParts.push(sg);
          }
          geometry.computeBoundingSphere();
          const r = geometry.boundingSphere!.radius;
          const far = file.includes("props") ? 120 : /stairs|road-ditch|river-works|road-markings|stream-works/.test(file) ? 1e9 : 400 + r * 40;
          reach = Math.max(reach, far);
          parts.push({ material, geometry, matrices: mats, far, lod: lodded ? level : undefined });
        });
        if (shadowParts.length) {
          const merged = mergeGeometries(shadowParts, false);
          if (merged) proxies.push({ geometry: merged, matrices: mats, far: reach, farCaster });
        }
        }
        progress(++done / byFile.size);
      }),
    );
    // Every part of every model, batched by material: one BatchedMesh per material (and attribute
    // set) holds each part's geometry once and an instance per placement, culled per instance and
    // drawn with one multi-draw. With an instanced mesh per model part the village was 300-540 draw
    // calls; this is about one per material.
    const groups = new Map<string, Part[]>();
    for (const p of parts) {
      const key = p.material.uuid + "|" + Object.keys(p.geometry.attributes).sort().join(",");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    for (const list of groups.values()) {
      let verts = 0, idx = 0, insts = 0;
      for (const p of list) (verts += p.geometry.getAttribute("position").count), (idx += p.geometry.index!.count), (insts += p.matrices.length);
      const material = list[0].material;
      const batch = new T.BatchedMesh(insts, verts, idx, material);
      batch.sortObjects = material.transparent;
      batch.perObjectFrustumCulled = true;
      batch.castShadow = false;
      batch.receiveShadow = true;
      batch.name = `architecture/${material.name}`;
      for (const p of list) {
        const gid = batch.addGeometry(p.geometry);
        for (const m of p.matrices) {
          const id = batch.addInstance(gid);
          batch.setMatrixAt(id, m);
          this.items.push({ batch, id, center: new T.Vector3().setFromMatrixPosition(m), far: p.far, shown: true, lod: p.lod });
        }
      }
      this.land.scene.add(batch);
    }
    // The shadow stand-ins in two batches. As an instanced mesh per model they were drawn whole into
    // every cascade they touched (all the houses of the village into the near one); in a batch each
    // placement is culled against each cascade's own frustum, and a cascade is one multi-draw.
    for (const big of [true, false]) {
      const list = proxies.filter((p) => p.farCaster === big);
      if (!list.length) continue;
      let verts = 0, idx = 0, insts = 0;
      for (const p of list) (verts += p.geometry.getAttribute("position").count), (idx += p.geometry.index!.count), (insts += p.matrices.length);
      const batch = new T.BatchedMesh(insts, verts, idx, this.shadowMaterial);
      batch.perObjectFrustumCulled = true;
      batch.sortObjects = false;
      batch.castShadow = true;
      batch.receiveShadow = false;
      batch.layers.set(SHADOW_ONLY);
      if (big) batch.layers.enable(FAR_CASTER);
      batch.name = big ? "architecture#shadow-far" : "architecture#shadow-near";
      for (const p of list) {
        const gid = batch.addGeometry(p.geometry);
        for (const m of p.matrices) {
          const id = batch.addInstance(gid);
          batch.setMatrixAt(id, m);
          this.shadowItems.push({ batch, id, center: new T.Vector3().setFromMatrixPosition(m), far: p.far, shown: true });
        }
      }
      batch.computeBoundingSphere();
      this.land.scene.add(batch);
    }
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
  setQuality(q: Quality) {
    this.lodDist = QUALITY[q].buildings.lod;
    facadeUniforms.uFcDetail.value = QUALITY[q].buildings.detail;
    this.culledAt.set(1e9, 0, 0);
  }
  frame = 0;
  private culledAt = new T.Vector3(1e9, 0, 0);
  update(_dt: number, _t: number, cam: T.PerspectiveCamera) {
    // every 15th frame, or at once when the view has jumped (a teleport, a capture)
    if (this.frame++ % 15 && cam.position.distanceToSquared(this.culledAt) < 64) return;
    this.culledAt.copy(cam.position);
    // distance culling of small parts (props, far houses keep rendering)
    for (const it of this.items) {
      if (it.far > 1e8) continue;
      const d = it.center.distanceTo(cam.position);
      const show = it.lod === 0 ? d < this.lodDist : it.lod === 1 ? d >= this.lodDist && d < it.far : d < it.far;
      if (show !== it.shown) (it.shown = show), it.batch.setVisibleAt(it.id, show);
    }
    for (const it of this.shadowItems) {
      if (it.far > 1e8) continue;
      const show = it.center.distanceTo(cam.position) < it.far;
      if (show !== it.shown) (it.shown = show), it.batch.setVisibleAt(it.id, show);
    }
  }
}

/** A model part as float attributes (the GLBs are quantized: int16 positions, int8 normals) with the
 *  node's transform baked in, indexed: what a BatchedMesh needs of every geometry it takes. */
function bake(src: T.BufferGeometry, matrix: T.Matrix4) {
  const g = new T.BufferGeometry();
  // _occl: the sky occlusion baked into the buildings (src/engine/facade.ts)
  for (const name of ["position", "normal", "uv", "uv1", "color", "_occl"]) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const n = a.itemSize, out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = a.getComponent(i, c);
    g.setAttribute(name, new T.BufferAttribute(out, n));
  }
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  const count = g.getAttribute("position").count;
  g.setIndex(src.index ? new T.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1) : new T.BufferAttribute(Uint32Array.from({ length: count }, (_, i) => i), 1));
  return g.applyMatrix4(matrix);
}
