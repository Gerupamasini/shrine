import * as T from "three";
import { atmosphereUniforms } from "./atmosphere";

export type SkyMeta = {
  backdrop: { file: string; scale: number; coverage: [number, number] };
  sourceSunPixelAzimuthDeg: number;
  sourceSunElevationDeg: number;
};

/**
 * Sky dome: CC0 photographic cloud panorama (Poly Haven evening_road_01_puresky)
 * rotated so its glow sits at the computed sun azimuth, with the elevation
 * remapped near the horizon so the glow follows the sun's height. The sun disc
 * and its aureole are analytic so they move with the time of day.
 */
export class SkyDome {
  mesh: T.Mesh;
  uniforms = {
    uBackdrop: { value: null as T.Texture | null },
    uScale: { value: 1 },
    uSunAz: { value: 0 },
    uSunEl: { value: 0 },
    uSrcAz: { value: 0 },
    uSrcEl: { value: 10 },
    uExposure: { value: 1 },
    uTint: { value: new T.Color(1, 1, 1) },
    uHorizonTint: { value: new T.Color(1, 1, 1) },
    uSunColor: { value: new T.Color(1, 0.8, 0.6) },
    uSunIntensity: { value: 1 },
    uBottom: { value: -11.25 },
    ...atmosphereUniforms,
  };
  constructor(meta: SkyMeta, texture: T.Texture) {
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = T.RepeatWrapping;
    texture.wrapT = T.ClampToEdgeWrapping;
    texture.anisotropy = 4;
    this.uniforms.uBackdrop.value = texture;
    this.uniforms.uScale.value = meta.backdrop.scale;
    this.uniforms.uSrcAz.value = meta.sourceSunPixelAzimuthDeg;
    this.uniforms.uSrcEl.value = meta.sourceSunElevationDeg;
    this.uniforms.uBottom.value = meta.backdrop.coverage[1];
    const mat = new T.ShaderMaterial({
      uniforms: this.uniforms,
      side: T.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBackdrop;
        uniform float uScale, uSunAz, uSunEl, uSrcAz, uSrcEl, uExposure, uBottom, uSunIntensity;
        uniform vec3 uTint, uHorizonTint, uSunColor, uSunDir, uFogAmbient, uFogSun;
        varying vec3 vDir;
        const float PI = 3.14159265;
        vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
        void main() {
          vec3 d = normalize(vDir);
          float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
          float az = degrees(atan(d.x, -d.z));
          // keep the glow at the sun: rotate in azimuth, warp elevation near the horizon
          float srcAz = az - uSunAz + uSrcAz;
          float w = clamp(1.0 - max(el, 0.0) / 50.0, 0.0, 1.0);
          float srcEl = el + (uSrcEl - uSunEl) * w * w;
          // seam-free wrap: take derivatives from whichever of two offset u's is continuous here
          float ua = fract(srcAz / 360.0), ub = fract(srcAz / 360.0 + 0.5) - 0.5;
          float v = (90.0 - srcEl) / (90.0 - uBottom);
          vec2 dxa = vec2(dFdx(ua), dFdx(v)), dya = vec2(dFdy(ua), dFdy(v));
          vec2 dxb = vec2(dFdx(ub), dFdx(v)), dyb = vec2(dFdy(ub), dFdy(v));
          bool useB = abs(dxb.x) + abs(dyb.x) < abs(dxa.x) + abs(dya.x);
          vec3 sky = srgbToLinear(textureGrad(uBackdrop, vec2(ua, clamp(v, 0.001, 0.999)), useB ? dxb : dxa, useB ? dyb : dya).rgb);
          // undo the soft shoulder used when encoding (approximate)
          sky = sky + max(sky - 0.85, 0.0) * 1.6 * sky;
          sky *= uScale * uExposure * uTint;
          // late-summer evening grade of the (afternoon) photographic sky:
          //  * clouds (low-saturation texels) take warm light on the sun side, lavender away from it
          //  * the blue is paled by humidity, the whole dome warms towards the low sun
          float lum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
          float sat = (max(sky.r, max(sky.g, sky.b)) - min(sky.r, min(sky.g, sky.b))) / max(max(sky.r, max(sky.g, sky.b)), 1e-4);
          float cloud = 1.0 - smoothstep(0.12, 0.42, sat);
          float sunward = pow(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5, 2.0);
          vec3 warm = mix(vec3(0.82, 0.78, 0.86), vec3(1.25, 0.95, 0.7), sunward);
          sky = mix(mix(vec3(lum), sky, 0.62) * vec3(1.02, 1.0, 0.95), vec3(lum) * warm, cloud * 0.85);
          sky = sky * (1.0 + 0.35 * sunward * smoothstep(40.0, 0.0, el)) + vec3(0.035, 0.032, 0.03) * uExposure;
          float anti = pow(max(-dot(d, vec3(uSunDir.x, 0.0, uSunDir.z)), 0.0), 2.0) * exp(-max(el - 2.0, 0.0) / 10.0);
          sky += vec3(0.32, 0.2, 0.22) * anti * 0.35 * uExposure;
          // horizon haze consistent with the aerial perspective of the terrain
          float haze = exp(-max(el + 1.0, 0.0) / 7.0);
          float mu = dot(d, uSunDir);
          float g = 0.72;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.0796;
          vec3 hz = (uFogAmbient + uFogSun * clamp(hg * 1.4, 0.0, 1.0)) * uHorizonTint;
          sky = mix(sky, hz, haze * 0.75);
          if (el < 0.0) sky = mix(sky, hz, smoothstep(0.0, -4.0, el));
          // analytic sun disc + aureole
          float cosSun = cos(radians(0.27));
          float disc = smoothstep(cosSun - 0.00002, cosSun + 0.00001, mu);
          float aureole = pow(max(mu, 0.0), 900.0) * 1.2 + pow(max(mu, 0.0), 60.0) * 0.18;
          float occl = smoothstep(-0.6, 0.4, el);
          sky += uSunColor * uSunIntensity * (disc * 60.0 + aureole) * occl;
          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new T.Mesh(new T.SphereGeometry(1, 64, 32), mat);
    this.mesh.scale.setScalar(5000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }
  update(camera: T.Camera, sunAz: number, sunEl: number) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uSunAz.value = sunAz;
    this.uniforms.uSunEl.value = sunEl;
  }
}
