import * as T from "three";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";

/**
 * Frame profiler for offline measurement (tools/perf/profile.mjs). Counts draw calls and triangles of
 * every draw, split into the shadow pass and the main pass and by system (object or material name),
 * and times each stage. Timings are wall-clock with a `gl.finish()` at every stage boundary, so the
 * GPU work of a stage is inside its own number (on SwiftShader the "GPU" is the CPU; on real hardware
 * the finishes remove the CPU/GPU overlap, so the stages add up to more than a pipelined frame).
 */
export type Stage = "sim" | "update" | "shadow" | "main" | "ssao" | "rays" | "bloom" | "output" | "finish";
export type FrameRecord = {
  ms: number;
  stages: Partial<Record<Stage, number>>;
  main: { calls: number; tris: number };
  shadow: { calls: number; tris: number };
};

export class Profiler {
  enabled = false;
  /** false: wait for the GPU only at the start and end of a frame, so the stage times are the CPU's
   *  (submission included) and the rest of the frame is the GPU's */
  stageSync = true;
  pass: "main" | "shadow" = "main";
  frame: FrameRecord = Profiler.empty();
  /** per system: [main calls, main tris, shadow calls, shadow tris], summed over the recorded frames */
  systems = new Map<string, number[]>();
  private gl: WebGL2RenderingContext;
  constructor(public renderer: T.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    const r = renderer as unknown as { renderBufferDirect: (...a: unknown[]) => void };
    const draw = r.renderBufferDirect.bind(renderer);
    const info = renderer.info.render;
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      if (!this.enabled) return draw(camera, scene, geometry, material, object, group);
      const c0 = info.calls, t0 = info.triangles;
      draw(camera, scene, geometry, material, object, group);
      const dc = info.calls - c0, dt = info.triangles - t0;
      const p = this.frame[this.pass];
      p.calls += dc;
      p.tris += dt;
      const key = Profiler.key(object as T.Object3D, material as T.Material);
      let e = this.systems.get(key);
      if (!e) this.systems.set(key, (e = [0, 0, 0, 0]));
      const o = this.pass === "main" ? 0 : 2;
      e[o] += dc;
      e[o + 1] += dt;
    };
    const sm = renderer.shadowMap;
    const shadow = sm.render.bind(sm);
    sm.render = (lights: T.Light[], scene: T.Scene, camera: T.Camera) => {
      if (!this.enabled) return shadow(lights, scene, camera);
      this.stageWait();
      const t = performance.now(), prev = this.pass;
      this.pass = "shadow";
      shadow(lights, scene, camera);
      this.stageWait();
      this.pass = prev;
      this.add("shadow", performance.now() - t);
    };
  }
  static empty(): FrameRecord {
    return { ms: 0, stages: {}, main: { calls: 0, tris: 0 }, shadow: { calls: 0, tris: 0 } };
  }
  static key(o: T.Object3D, m: T.Material) {
    if (o.name) return o.name.replace(/_\d+(_lod\d)?$/, "$1").replace(/^(props)\/.*/, "$1").replace(/#shadow$/, "#shadow");
    const k = (m.customProgramCacheKey?.() ?? "").split("|").pop() ?? "";
    return k && !k.includes("(") && !k.includes("{") ? k : m.type;
  }
  /** Time each stage of the frame through Post's hook (the main pass's time excludes the shadow maps). */
  wrapPost(post: { time: (stage: never, fn: () => void) => void }) {
    const p = post as unknown as { time: (stage: Stage, fn: () => void) => void };
    const plain = p.time;
    p.time = (stage, fn) => {
      if (!this.enabled) return plain(stage, fn);
      this.stageWait();
      const t = performance.now();
      const s0 = this.frame.stages.shadow ?? 0;
      fn();
      this.stageWait();
      this.add(stage, performance.now() - t - ((this.frame.stages.shadow ?? 0) - s0));
    };
  }
  /** Time each pass of the post chain (the render pass's time excludes the shadow maps). */
  wrapComposer(composer: EffectComposer, names: Stage[]) {
    composer.passes.forEach((p, i) => {
      const render = p.render.bind(p);
      const stage = names[i];
      p.render = (...a: Parameters<typeof p.render>) => {
        if (!this.enabled || !p.enabled) return render(...a);
        this.stageWait();
        const t = performance.now();
        const s0 = this.frame.stages.shadow ?? 0;
        render(...a);
        this.stageWait();
        this.add(stage, performance.now() - t - ((this.frame.stages.shadow ?? 0) - s0));
      };
    });
  }
  stageWait() {
    if (this.stageSync) this.sync();
  }
  private px = new Uint8Array(4);
  /** Wait for the GPU: Chrome's gl.finish() does not block, a 1-pixel read-back does (it has to run
   *  after everything queued before it). The read framebuffer binding is restored for three.js. */
  sync() {
    const gl = this.gl;
    const prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
  }
  add(stage: Stage, ms: number) {
    this.frame.stages[stage] = (this.frame.stages[stage] ?? 0) + ms;
  }
  begin() {
    this.frame = Profiler.empty();
    this.sync();
    return performance.now();
  }
  /** time a CPU stage (no GPU work inside) */
  time<R>(stage: Stage, fn: () => R): R {
    const t = performance.now();
    const r = fn();
    this.add(stage, performance.now() - t);
    return r;
  }
  end(t0: number) {
    this.sync();
    this.frame.ms = performance.now() - t0;
    return this.frame;
  }
  /** Rough GPU memory held by the scene: vertex/index buffers and textures (with mips) it references,
   *  plus the render targets of the shadow maps and the post chain. */
  memory(scene: T.Scene, targets: T.WebGLRenderTarget[]) {
    const buffers = new Set<ArrayBufferView>(), textures = new Set<T.Texture>();
    let geo = 0, tex = 0, rt = 0;
    const addTex = (t: unknown) => {
      if (t && (t as T.Texture).isTexture) textures.add(t as T.Texture);
    };
    scene.traverse((o) => {
      const m = o as T.Mesh;
      if (m.geometry) {
        const g = m.geometry as T.BufferGeometry;
        for (const a of Object.values(g.attributes)) {
          const arr = (a as T.BufferAttribute).array as unknown as ArrayBufferView;
          if (arr && !buffers.has(arr)) (buffers.add(arr), (geo += arr.byteLength));
        }
        const idx = g.index?.array as unknown as ArrayBufferView | undefined;
        if (idx && !buffers.has(idx)) (buffers.add(idx), (geo += idx.byteLength));
        const im = (m as unknown as T.InstancedMesh).instanceMatrix?.array as unknown as ArrayBufferView | undefined;
        if (im && !buffers.has(im)) (buffers.add(im), (geo += im.byteLength));
      }
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) addTex(v);
        const u = (mat as T.ShaderMaterial).uniforms;
        if (u) for (const v of Object.values(u)) addTex(v?.value);
      }
    });
    for (const t of textures) {
      const img = t.image as { width?: number; height?: number; depth?: number; data?: ArrayBufferView } | undefined;
      if (!img?.width) continue;
      const layers = (t as T.DataArrayTexture).isDataArrayTexture ? img.depth ?? 1 : 1;
      const bpp = t.type === T.FloatType ? 4 : t.type === T.HalfFloatType ? 2 : 1;
      const ch = t.format === T.RedFormat ? 1 : 4;
      tex += img.width * img.height! * layers * ch * bpp * (t.generateMipmaps || t.mipmaps?.length ? 4 / 3 : 1);
    }
    for (const r of targets) {
      const s = r.samples ? r.samples : 1;
      const bpp = r.texture.type === T.HalfFloatType ? 8 : 4;
      rt += r.width * r.height * (bpp + (r.depthBuffer ? 4 : 0)) * s + (r.samples ? r.width * r.height * bpp : 0);
    }
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    const mb = (b: number) => Math.round(b / 1048576);
    return { geometryMB: mb(geo), textureMB: mb(tex), targetsMB: mb(rt), jsHeapMB: mb(heap), textures: textures.size };
  }
}
