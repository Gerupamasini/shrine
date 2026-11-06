import * as T from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { publicUrl } from "../urls";
import { atmosphereUniforms } from "./atmosphere";
import { solarPosition, sunDirection, sunlight } from "./sun";
import { SkyDome, type SkyMeta } from "./sky";

export type Quality = "low" | "standard" | "high";

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
    for (let i = 0; i < d.length; i += 4) {
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
  setupShadows(quality: Quality) {
    this.csm = new CSM({
      maxFar: 520,
      cascades: 3,
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
    for (const l of this.csm.lights) {
      l.shadow.normalBias = 0.04;
      l.shadow.radius = 2;
    }
    this.setShadowQuality(quality);
  }
  setShadowQuality(quality: Quality) {
    const size = quality === "high" ? 4096 : quality === "standard" ? 2048 : 1024;
    this.csm.maxFar = quality === "low" ? 280 : quality === "high" ? 700 : 520;
    for (const l of this.csm.lights) {
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose();
        (l.shadow as { map: T.WebGLRenderTarget | null }).map = null;
      }
    }
    this.csm.updateFrustums();
  }
  setTime(hours: number) {
    this.time = hours;
    const p = solarPosition(this.env0.date, hours, this.env0.latitude, this.env0.longitude, this.env0.timezone);
    this.azimuth = p.azimuth;
    this.elevation = p.elevation;
    sunDirection(p.azimuth, p.elevation, this.sunDir);
    const s = sunlight(p.elevation);
    this.sunColor.copy(s.color);
    this.sunIntensity = 7.5 * s.intensity;
    const el = p.elevation;
    const day = T.MathUtils.smoothstep(el, -6, 8); // 0 at deep twilight, 1 in late afternoon
    // CSM lights
    this.csm.lightDirection.copy(this.sunDir).negate();
    for (const l of this.csm.lights) {
      l.color.copy(this.sunColor);
      l.intensity = this.sunIntensity;
    }
    // Ambient: environment intensity follows the sky brightness.
    this.scene.environmentIntensity = T.MathUtils.lerp(0.12, 0.5, day);
    // three equirect u = (compassAz + 90)/360; align the env with the sky dome rotation
    this.scene.environmentRotation.set(0, T.MathUtils.degToRad(this.srcAz - p.azimuth - 90), 0);
    this.hemi.intensity = 0.0;
    // Atmosphere colours
    const u = atmosphereUniforms;
    u.uSunDir.value.copy(this.sunDir);
    const amb = new T.Color(0.26, 0.34, 0.46).lerp(new T.Color(0.2, 0.22, 0.32), 1 - day);
    u.uFogAmbient.value.copy(amb).multiplyScalar(T.MathUtils.lerp(0.18, 1.0, day));
    u.uFogSun.value.copy(this.sunColor).multiplyScalar(1.25 * s.intensity + 0.04);
    u.uFogDensity.value = 0.00036;
    u.uFogHeightFalloff.value = 0.0042;
    // Sky
    const su = this.sky.uniforms;
    su.uExposure.value = T.MathUtils.lerp(0.12, 1.0, T.MathUtils.smoothstep(el, -6, 6));
    su.uTint.value.setRGB(1, 1, 1).lerp(new T.Color(0.75, 0.8, 1.05), 1 - day);
    su.uHorizonTint.value.setRGB(1, 1, 1);
    su.uSunColor.value.copy(this.sunColor);
    su.uSunIntensity.value = s.intensity;
    this.renderer.toneMappingExposure = T.MathUtils.lerp(2.2, 1.05, day);
  }
  update() {
    this.camera.updateMatrixWorld();
    this.csm.update();
    this.sky.update(this.camera, this.azimuth, this.elevation);
  }
}
