import * as T from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { publicUrl } from "../urls";
import { atmosphereUniforms } from "./atmosphere";
import { solarPosition, sunDirection, sunlight } from "./sun";
import { SkyDome, type SkyMeta } from "./sky";

import { QUALITY, type Quality } from "./quality";
export type { Quality };

/** Layer of the shadow casters big enough to matter beyond the first cascade (trees, buildings,
 *  hills). Everything else - shrubs, props, crops, cars, low walls - casts only near the camera. */
export const FAR_CASTER = 1;
/** Layer of stand-ins drawn only into the shadow maps (merged building parts, coarse hills). */
export const SHADOW_ONLY = 2;

/**
 * Time-of-day lighting: real solar position, cascaded sun shadows, sky dome,
 * image-based ambient (sun removed from the HDR so it is not counted twice),
 * and aerial-perspective colours. All values are art-directed in linear HDR and
 * tone-mapped once at the end of the post chain.
 */
export class Lighting {
  csm!: CSM;
  sky!: SkyDome;
  env: T.Texture | null = null;
  sunDir = new T.Vector3();
  azimuth = 0;
  elevation = 0;
  sunColor = new T.Color();
  sunIntensity = 0;
  hemi = new T.HemisphereLight(0xb7c8dc, 0x4a4a36, 0.0);
  time = 18;
  /**
   * Light balance. At 18:00 a clear, humid evening has roughly six times more light in the sun's
   * beam than the whole sky gives a horizontal surface (direct normal vs diffuse horizontal
   * irradiance). The earlier balance was nearer two, with the sky four times the sun on flat
   * ground: the valley was lit mostly by the blue-grey sky and never caught the low gold light.
   *  sun        irradiance of the beam per unit of transmitted sunlight (sunlight().intensity)
   *  env        environment (sky) intensity [deep twilight, late afternoon]
   *  exposure   tone-mapping exposure [deep twilight, late afternoon]
   *  envSat     saturation kept in the sky light; envTint multiplies it (linear RGB)
   */
  tune = {
    sun: 15,
    env: [0.1, 0.3] as [number, number],
    exposure: [2.6, 1.55] as [number, number],
    envSat: 0.8,
    envTint: [1.03, 1.0, 0.95] as [number, number, number],
    fogAmbient: [0.3, 0.33, 0.4] as [number, number, number],
    fogSun: 1.6,
  };
  constructor(
    public renderer: T.WebGLRenderer,
    public scene: T.Scene,
    public camera: T.PerspectiveCamera,
    public env0: { date: string; latitude: number; longitude: number; timezone: number },
  ) {}
  async init(quality: Quality) {
    const [meta, tex, hdr] = await Promise.all([
      fetch(publicUrl("assets/sky/sky.json")).then((r) => r.json() as Promise<SkyMeta>),
      new T.TextureLoader().loadAsync(publicUrl("assets/sky/backdrop.jpg")),
      new RGBELoader().setDataType(T.FloatType).loadAsync(publicUrl("assets/sky/environment_1k.hdr")),
    ]);
    this.sky = new SkyDome(meta, tex);
    this.scene.add(this.sky.mesh);
    // Remove the sun from the environment: the directional light provides it.
    const d = hdr.image.data as Float32Array;
    const t = this.tune;
    for (let i = 0; i < d.length; i += 4) {
      // same humid-evening grade as the sky dome: paler blue, a little warmer
      const l0 = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      d[i] = (l0 + (d[i] - l0) * t.envSat) * t.envTint[0];
      d[i + 1] = (l0 + (d[i + 1] - l0) * t.envSat) * t.envTint[1];
      d[i + 2] = (l0 + (d[i + 2] - l0) * t.envSat) * t.envTint[2];
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (l > 6) {
        const s = 6 / l;
        d[i] *= s;
        d[i + 1] *= s;
        d[i + 2] *= s;
      }
    }
    hdr.mapping = T.EquirectangularReflectionMapping;
    hdr.needsUpdate = true;
    const pm = new T.PMREMGenerator(this.renderer);
    this.env = pm.fromEquirectangular(hdr).texture;
    pm.dispose();
    hdr.dispose();
    this.scene.environment = this.env;
    this.srcAz = meta.sourceSunPixelAzimuthDeg;
    this.scene.add(this.hemi);
    this.setupShadows(quality);
  }
  srcAz = 0;
  /** materials that receive the cascaded shadows (re-set up when the number of cascades changes) */
  private shadowed = new Set<T.Material>();
  /**
   * Cascaded sun shadows. The first cascade is fitted to the view every frame and holds every caster:
   * the car, the walker's surroundings, shrubs and props. The others are squares centred on the camera
   * that hold the big casters only (FAR_CASTER: trees, buildings, the hills), and are drawn again only
   * when the camera has moved a few percent of their size or the sun has moved - not every frame and
   * not when the view turns: the cascade a pixel falls in is chosen by its distance from the camera,
   * not its depth along the view, so a camera-centred square covers it whichever way the view faces.
   * One far cascade is redrawn per frame at most. Static casters only: what they hold does not move,
   * so a map drawn a moment ago is exact (no lag or offset while driving).
   */
  setupShadows(quality: Quality) {
    const cascades = QUALITY[quality].shadow.cascades;
    this.csm?.remove();
    this.csm = new CSM({
      maxFar: 520,
      cascades,
      mode: "practical",
      parent: this.scene,
      shadowMapSize: 2048,
      lightDirection: new T.Vector3(0, -1, 0),
      camera: this.camera,
      lightIntensity: 3,
      lightNear: 1,
      lightFar: 2400,
      lightMargin: 320,
      shadowBias: -0.00012,
    });
    this.csm.fade = true;
    // cascades by distance from the camera (CSMShader selects them by view depth)
    const chunk = T.ShaderChunk.lights_fragment_begin;
    const depth = "float linearDepth = (vViewPosition.z) / (shadowFar - cameraNear);";
    if (chunk.includes(depth)) T.ShaderChunk.lights_fragment_begin = chunk.replace(depth, "float linearDepth = length(vViewPosition) / (shadowFar - cameraNear);");
    else if (!chunk.includes("length(vViewPosition)")) console.warn("CSM distance patch failed");
    this.csm.lights.forEach((l, i) => {
      l.shadow.normalBias = 0.04;
      l.shadow.radius = 2;
      l.shadow.autoUpdate = i === 0;
    });
    if (!this.wrapped) this.wrapShadowPass();
    this.wrapped = true;
    this.cascadeCount = cascades;
    this.setShadowQuality(quality);
    // materials set up for another number of cascades recompile against this one
    for (const m of this.shadowed) this.applyCsm(m);
  }
  private wrapped = false;
  private cascadeCount = 3;
  /** Set a material up for the cascaded shadows (once; re-applied when the cascades are rebuilt). */
  setupMaterial(m: T.Material) {
    this.shadowed.add(m);
    this.applyCsm(m);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (s, r) => {
      prev.call(m, s, r);
      // the current CSM's uniforms (same as CSM.setupMaterial, but not bound to one CSM instance)
      const csm = this.csm, breaks: T.Vector2[] = [];
      (csm as unknown as { _getExtendedBreaks(t: T.Vector2[]): void })._getExtendedBreaks(breaks);
      s.uniforms.CSM_cascades = { value: breaks };
      s.uniforms.cameraNear = { value: this.camera.near };
      s.uniforms.shadowFar = { value: Math.min(this.camera.far, csm.maxFar) };
      (csm.shaders as unknown as Map<T.Material, unknown>).set(m, s);
    };
  }
  private applyCsm(m: T.Material) {
    const d = ((m as T.ShaderMaterial).defines ??= {});
    const changed = d.CSM_CASCADES !== this.cascadeCount;
    d.USE_CSM = 1;
    d.CSM_CASCADES = this.cascadeCount;
    d.CSM_FADE = "";
    (this.csm.shaders as unknown as Map<T.Material, unknown>).set(m, null);
    if (changed) m.needsUpdate = true;
  }
  setShadowQuality(quality: Quality) {
    const q = QUALITY[quality].shadow;
    if (q.cascades !== this.cascadeCount) return this.setupShadows(quality);
    const near = q.near, far = q.farSize;
    this.csm.maxFar = q.far;
    this.csm.lights.forEach((l, i) => {
      const size = i === 0 ? near : far;
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose();
        (l.shadow as { map: T.WebGLRenderTarget | null }).map = null;
      }
    });
    this.csm.updateFrustums();
    this.fitFar();
  }
  /** far cascades: [light-space centre drawn at, radius, distance moved before a redraw, sun then] */
  private far: { at: T.Vector3; world: T.Vector3; R: number; move: number; sun: T.Vector3; valid: boolean }[] = [];
  /** draws of the far cascades so far (for the profile) */
  farDraws = 0;
  private static LIGHT_MARGIN = 700;
  private fitFar() {
    const csm = this.csm, far = Math.min(this.camera.far, csm.maxFar);
    const old = this.far;
    this.far = [];
    csm.lights.forEach((l, i) => {
      if (i === 0) return;
      const b = csm.breaks[i], dist = b * far;
      // the fade band past the cascade's far edge (CSM._updateShadowBounds) and the slack for moving
      const fade = 0.25 * b * b * (far - this.camera.near);
      const move = Math.max(12, 0.06 * dist);
      const R = dist + fade + move;
      const c = l.shadow.camera;
      c.left = c.bottom = -R;
      c.right = c.top = R;
      c.near = 1;
      c.far = 2 * R + Lighting.LIGHT_MARGIN + 100;
      c.updateProjectionMatrix();
      // (a refit for a new field of view keeps a far map drawn at the same size)
      const o = old[i];
      this.far[i] = o && Math.abs(o.R - R) < 1e-6 && l.shadow.map ? o : { at: new T.Vector3(1e9, 0, 0), world: new T.Vector3(), R, move, sun: new T.Vector3(), valid: false };
    });
  }
  private fov = 0;
  private aspect = 0;
  /** the first cascade's view of the sun in light space (centre, half size, depth), for casters that
   *  are culled against it on the CPU (the trees) */
  nearBox = { cx: 0, cy: 0, cz: 0, half: 0, depth: 0 };
  /** world to light space (x, y across the sun's view, z towards the sun) */
  toLight = new T.Matrix4();
  /** redraw every far cascade on the next frame (a teleport, a new time of day) */
  invalidateShadows() {
    for (const f of this.far) if (f) f.valid = false;
    this.forceAll = true;
  }
  private forceAll = true;
  private lastCam = new T.Vector3(1e9, 0, 0);
  private lo = new T.Matrix4();
  private loInv = new T.Matrix4();
  private v = new T.Vector3();
  private updateFar() {
    const csm = this.csm, dir = csm.lightDirection;
    this.lo.lookAt(new T.Vector3(), dir, new T.Vector3(0, 1, 0));
    this.loInv.copy(this.lo).invert();
    const p = this.v.copy(this.camera.position).applyMatrix4(this.loInv);
    // a jump (teleport, first frame): every far cascade now, not one per frame
    if (this.camera.position.distanceTo(this.lastCam) > 60) this.forceAll = true;
    this.lastCam.copy(this.camera.position);
    let budget = 1;
    csm.lights.forEach((l, i) => {
      const f = this.far[i];
      if (!f) return;
      const stale = !f.valid || f.sun.dot(dir) < 0.999995 || Math.hypot(p.x - f.at.x, p.y - f.at.y) > f.move;
      if (stale && (budget > 0 || this.forceAll)) {
        budget--;
        const texel = (2 * f.R) / l.shadow.mapSize.x;
        f.at.set(Math.floor(p.x / texel) * texel, Math.floor(p.y / texel) * texel, p.z);
        f.world.set(f.at.x, f.at.y, p.z + f.R + Lighting.LIGHT_MARGIN).applyMatrix4(this.lo);
        f.sun.copy(dir);
        f.valid = true;
        l.shadow.needsUpdate = true;
        this.farDraws++;
      }
      // (CSM.update placed it for the view; only the position it was drawn from matters)
      l.position.copy(f.world);
      l.target.position.copy(f.world).add(dir);
    });
    this.forceAll = false;
    const l0 = csm.lights[0], c0 = this.v.copy(l0.position).applyMatrix4(this.loInv);
    this.toLight.copy(this.loInv);
    Object.assign(this.nearBox, { cx: c0.x, cy: c0.y, cz: c0.z, half: l0.shadow.camera.right, depth: l0.shadow.camera.far });
  }
  setTime(hours: number) {
    this.time = hours;
    const p = solarPosition(this.env0.date, hours, this.env0.latitude, this.env0.longitude, this.env0.timezone);
    this.azimuth = p.azimuth;
    this.elevation = p.elevation;
    sunDirection(p.azimuth, p.elevation, this.sunDir);
    const s = sunlight(p.elevation);
    this.sunColor.copy(s.color);
    const t = this.tune;
    this.sunIntensity = t.sun * s.intensity;
    const el = p.elevation;
    const day = T.MathUtils.smoothstep(el, -6, 8); // 0 at deep twilight, 1 in late afternoon
    // CSM lights
    this.csm.lightDirection.copy(this.sunDir).negate();
    for (const l of this.csm.lights) {
      l.color.copy(this.sunColor);
      l.intensity = this.sunIntensity;
    }
    // Ambient: environment intensity follows the sky brightness.
    this.scene.environmentIntensity = T.MathUtils.lerp(t.env[0], t.env[1], day);
    // three equirect u = (compassAz + 90)/360; align the env with the sky dome rotation
    this.scene.environmentRotation.set(0, T.MathUtils.degToRad(this.srcAz - p.azimuth - 90), 0);
    this.hemi.intensity = T.MathUtils.lerp(.015, .10, day); // low sky fill preserves road edges in forest shade
    // Atmosphere colours
    const u = atmosphereUniforms;
    u.uSunDir.value.copy(this.sunDir);
    const amb = new T.Color(...t.fogAmbient).lerp(new T.Color(0.2, 0.22, 0.32), 1 - day);
    u.uFogAmbient.value.copy(amb).multiplyScalar(T.MathUtils.lerp(0.18, 1.0, day));
    u.uFogSun.value.copy(this.sunColor).multiplyScalar(t.fogSun * s.intensity + 0.04);
    u.uFogDensity.value = 0.00036;
    u.uFogHeightFalloff.value = 0.0042;
    // Sky
    const su = this.sky.uniforms;
    su.uExposure.value = T.MathUtils.lerp(0.12, 1.0, T.MathUtils.smoothstep(el, -6, 6));
    su.uTint.value.setRGB(1, 1, 1).lerp(new T.Color(0.75, 0.8, 1.05), 1 - day);
    su.uHorizonTint.value.setRGB(1, 1, 1);
    su.uSunColor.value.copy(this.sunColor);
    su.uSunIntensity.value = s.intensity;
    this.renderer.toneMappingExposure = T.MathUtils.lerp(t.exposure[0], t.exposure[1], day);
  }
  update() {
    this.camera.updateMatrixWorld();
    // the first cascade is fitted to the view frustum: refit it when the field of view changes
    // (wider while driving fast) or the window's shape does
    if (this.camera.fov !== this.fov || this.camera.aspect !== this.aspect) {
      this.fov = this.camera.fov;
      this.aspect = this.camera.aspect;
      this.csm.updateFrustums();
      this.fitFar();
    }
    this.csm.update();
    this.updateFar();
    this.sky.update(this.camera, this.azimuth, this.elevation);
  }
  private shadowPending = true;
  /** a new frame: the next render of the scene draws the shadow maps (once, however many passes) */
  renderShadows() {
    this.shadowPending = true;
  }
  /**
   * The renderer's shadow pass, split: the near cascade (to ~90 m) is drawn with every caster, the
   * two far ones with the big casters only (FAR_CASTER: trees, buildings, hills). The renderer tests
   * shadow casters against the view camera's layers, so a cascade cannot be given layers of its own;
   * the far cascades get a stand-in camera that sees only that layer. Shrubs, props and crops in the
   * far cascades were most of the shadow draw calls. And the maps are drawn once a frame, not again
   * for every pass that renders the scene; the far ones only when updateFar() marked them.
   */
  private wrapShadowPass() {
    const sm = this.renderer.shadowMap, render = sm.render.bind(sm);
    const big = new T.Object3D(), all = new T.Object3D();
    big.layers.set(FAR_CASTER);
    all.layers.set(0);
    all.layers.enable(SHADOW_ONLY);
    sm.render = (lights: T.Light[], scene: T.Scene, camera: T.Camera) => {
      if (!lights.length) return;
      if (!this.shadowPending) return;
      this.shadowPending = false;
      const cascades = this.csm.lights as T.Light[];
      const near = lights.filter((l) => l === cascades[0] || !cascades.includes(l));
      // (cached far cascades are skipped by the renderer unless they were marked for a redraw)
      const far = lights.filter((l) => l !== cascades[0] && cascades.includes(l) && (l as T.DirectionalLight).shadow.needsUpdate);
      void camera;
      render(near, scene, all as unknown as T.Camera);
      if (far.length) render(far, scene, big as unknown as T.Camera);
    };
  }
}
