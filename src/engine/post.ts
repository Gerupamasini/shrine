import * as T from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { QUALITY, type Quality } from "./quality";

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
type Stage = "main" | "ssao" | "rays" | "bloom" | "output";

/** depth to view position (shared by the AO passes) */
const VIEW_POS = /* glsl */ `
  uniform sampler2D tDepth; uniform mat4 uProjInv; uniform mat4 uProj;
  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }`;

/**
 * The frame after the scene: ambient occlusion and light shafts at half resolution, a bloom from a
 * chain of small targets, and one full-screen pass that puts them on the scene, tone-maps it and
 * gives it its finish (grade, vignette, grain).
 *
 * Before, six full-screen passes followed the scene - the AO composite, the shafts (48 samples at full
 * resolution), the bloom's own blend and copy, the tone mapping and the finish - each reading and
 * writing the whole frame in half floats.
 *
 * AO: depth only (no extra scene pass, so alpha-tested foliage occludes correctly), half resolution,
 * the view depth kept beside it so the depth-aware blur reads one texel per tap. Fades out with
 * distance: it grounds lanterns, steps, eaves, rocks and trunks near the walker.
 */
export class Post {
  target: T.WebGLRenderTarget;
  depth: T.DepthTexture;
  aoRT: T.WebGLRenderTarget;
  blurRT: T.WebGLRenderTarget;
  raysRT: T.WebGLRenderTarget;
  bloomDown: T.WebGLRenderTarget[] = [];
  bloomUp: T.WebGLRenderTarget[] = [];
  private ao: FullScreenQuad;
  private blur: FullScreenQuad;
  private rays: FullScreenQuad;
  private bright: FullScreenQuad;
  private down: FullScreenQuad;
  private up: FullScreenQuad;
  private final: FullScreenQuad;
  q: (typeof QUALITY)[Quality]["post"] = QUALITY.standard.post;
  /** profiler hook: time a stage of the frame */
  time: (stage: Stage, fn: () => void) => void = (_s, fn) => fn();
  /** strength of the shafts this frame (0: the sun is not in view) */
  raysStrength = 0;
  bloomStrength = 0.14;
  aoIntensity = 1;
  constructor(
    public renderer: T.WebGLRenderer,
    public scene: T.Scene,
    public camera: T.PerspectiveCamera,
  ) {
    this.depth = new T.DepthTexture(1, 1, T.UnsignedIntType);
    this.target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4, depthTexture: this.depth });
    const half = { type: T.HalfFloatType, depthBuffer: false } as const;
    this.aoRT = new T.WebGLRenderTarget(1, 1, { ...half, format: T.RGFormat });
    this.blurRT = new T.WebGLRenderTarget(1, 1, { ...half, format: T.RedFormat });
    this.raysRT = new T.WebGLRenderTarget(1, 1, half);
    for (let i = 0; i < 5; i++) {
      this.bloomDown.push(new T.WebGLRenderTarget(1, 1, half));
      if (i < 4) this.bloomUp.push(new T.WebGLRenderTarget(1, 1, half));
    }
    const mat = (o: T.ShaderMaterialParameters) => new T.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: VERT, ...o });
    const proj = () => ({ tDepth: { value: this.depth }, uProjInv: { value: new T.Matrix4() }, uProj: { value: new T.Matrix4() } });
    this.ao = new FullScreenQuad(
      mat({
        defines: { SAMPLES: 8 },
        uniforms: { ...proj(), uRadius: { value: 0.9 }, uRes: { value: new T.Vector2(1, 1) } },
        fragmentShader: /* glsl */ `
          ${VIEW_POS}
          uniform float uRadius; uniform vec2 uRes; varying vec2 vUv;
          float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
          void main() {
            float d0 = texture2D(tDepth, vUv).x;
            if (d0 >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 0.0); return; }
            vec3 p = viewPos(vUv);
            float dist = -p.z;
            if (dist > 160.0) { gl_FragColor = vec4(1.0, dist, 0.0, 0.0); return; }
            vec2 px = 1.0 / uRes;
            vec3 px1 = viewPos(vUv + vec2(px.x, 0.0)), py1 = viewPos(vUv + vec2(0.0, px.y));
            vec3 px0 = viewPos(vUv - vec2(px.x, 0.0)), py0 = viewPos(vUv - vec2(0.0, px.y));
            vec3 dx = abs(px1.z - p.z) < abs(p.z - px0.z) ? px1 - p : p - px0;
            vec3 dy = abs(py1.z - p.z) < abs(p.z - py0.z) ? py1 - p : p - py0;
            vec3 n = normalize(cross(dx, dy));
            float radius = uRadius * (1.0 + dist * 0.015);
            float rUv = radius * uProj[1][1] / max(dist, 0.1) * 0.5;
            float ang = ign(gl_FragCoord.xy) * 6.2831;
            float occ = 0.0;
            for (int i = 0; i < SAMPLES; i++) {
              float t = (float(i) + 0.5) / float(SAMPLES);
              float a = ang + float(i) * 2.39996;
              vec2 o = vec2(cos(a), sin(a)) * rUv * sqrt(t);
              vec3 s = viewPos(vUv + o);
              vec3 v = s - p;
              float l = length(v);
              float nd = dot(n, v) / max(l, 1e-3);
              occ += max(nd - 0.08, 0.0) * smoothstep(radius * 1.6, radius * 0.3, l);
            }
            float ao = 1.0 - occ / float(SAMPLES) * 1.6;
            ao = mix(ao, 1.0, smoothstep(80.0, 160.0, dist));
            // (view depth beside it: the blur weighs its taps without reading the depth again)
            gl_FragColor = vec4(clamp(ao, 0.0, 1.0), dist, 0.0, 0.0);
          }`,
      }),
    );
    this.blur = new FullScreenQuad(
      mat({
        uniforms: { tAO: { value: this.aoRT.texture }, uRes: { value: new T.Vector2(1, 1) } },
        fragmentShader: /* glsl */ `
          uniform sampler2D tAO; uniform vec2 uRes; varying vec2 vUv;
          void main() {
            float z0 = texture2D(tAO, vUv).g;
            float sum = 0.0, wsum = 0.0;
            for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
              vec2 s = texture2D(tAO, vUv + vec2(float(x), float(y)) * 2.0 / uRes).rg;
              float w = exp(-abs(s.y - z0) / max(z0 * 0.02, 0.05));
              sum += s.x * w;
              wsum += w;
            }
            gl_FragColor = vec4(sum / max(wsum, 1e-4));
          }`,
      }),
    );
    // light shafts: radial scattering of the bright sky around the sun (HDR, before tone mapping)
    this.rays = new FullScreenQuad(
      mat({
        defines: { SAMPLES: 24 },
        uniforms: { tScene: { value: this.target.texture }, uSun: { value: new T.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uAspect: { value: 1 } },
        fragmentShader: /* glsl */ `
          uniform sampler2D tScene; uniform vec2 uSun; uniform float uStrength, uAspect; varying vec2 vUv;
          void main() {
            vec2 d = (uSun - vUv) / float(SAMPLES);
            vec2 uv = vUv;
            vec3 acc = vec3(0.0);
            float w = 1.0, decay = pow(0.955, 48.0 / float(SAMPLES));
            for (int i = 0; i < SAMPLES; i++) {
              uv += d;
              vec3 c = texture2D(tScene, clamp(uv, 0.0, 1.0)).rgb;
              float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
              acc += c * smoothstep(2.2, 6.0, l) * w;
              w *= decay;
            }
            vec2 off = (vUv - uSun) * vec2(uAspect, 1.0);
            float fall = exp(-length(off) * 1.6);
            gl_FragColor = vec4(acc / float(SAMPLES) * uStrength * fall, 1.0);
          }`,
      }),
    );
    // bloom: bright pass to half resolution, a 13-tap downsample chain to 1/32, a tent upsample back
    this.bright = new FullScreenQuad(
      mat({
        uniforms: { tScene: { value: this.target.texture }, tAO: { value: this.blurRT.texture }, uAO: { value: 1 }, uTexel: { value: new T.Vector2() }, uThreshold: { value: 1.6 } },
        fragmentShader: /* glsl */ `
          uniform sampler2D tScene, tAO; uniform float uAO, uThreshold; uniform vec2 uTexel; varying vec2 vUv;
          void main() {
            vec3 c = (texture2D(tScene, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tScene, vUv + uTexel * vec2(0.5, -0.5)).rgb
                    + texture2D(tScene, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tScene, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25;
            c *= mix(1.0, texture2D(tAO, vUv).r, uAO);
            float l = dot(c, vec3(0.299, 0.587, 0.114));
            gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.01, l), 1.0);
          }`,
      }),
    );
    this.down = new FullScreenQuad(
      mat({
        uniforms: { tSrc: { value: null }, uTexel: { value: new T.Vector2() } },
        fragmentShader: /* glsl */ `
          uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
          vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
          void main() {
            // 13 taps (Jimenez 2014): a 4x4-texel box from overlapping bilinear reads, no flicker
            vec3 c = s(vec2(0.0)) * 0.125;
            c += (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
            c += (s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, -2.0)) + s(vec2(0.0, 2.0))) * 0.0625;
            c += (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.up = new FullScreenQuad(
      mat({
        uniforms: { tSrc: { value: null }, tLevel: { value: null }, uTexel: { value: new T.Vector2() }, uWeight: { value: 1 }, uSrcWeight: { value: 1 } },
        fragmentShader: /* glsl */ `
          uniform sampler2D tSrc, tLevel; uniform vec2 uTexel; uniform float uWeight, uSrcWeight; varying vec2 vUv;
          vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
          void main() {
            // tent upsample of the coarser level, plus this level's own
            vec3 c = s(vec2(0.0)) * 4.0;
            c += (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0;
            c += s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
            gl_FragColor = vec4(c / 16.0 * uSrcWeight + texture2D(tLevel, vUv).rgb * uWeight, 1.0);
          }`,
      }),
    );
    this.final = new FullScreenQuad(
      mat({
        uniforms: {
          tScene: { value: this.target.texture }, tAO: { value: this.blurRT.texture }, tRays: { value: this.raysRT.texture }, tBloom: { value: this.bloomUp[0].texture },
          uAO: { value: 1 }, uRays: { value: 0 }, uBloom: { value: 0 }, toneMappingExposure: { value: 1 },
          uTime: { value: 0 }, uGrain: { value: 0.018 }, uVignette: { value: 0.22 }, uBloomTexel: { value: new T.Vector2() },
        },
        fragmentShader: /* glsl */ `
          #include <tonemapping_pars_fragment>
          uniform sampler2D tScene, tAO, tRays, tBloom; uniform float uAO, uRays, uBloom, uTime, uGrain, uVignette; uniform vec2 uBloomTexel;
          varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
          void main(){
            vec3 c = texture2D(tScene, vUv).rgb;
            if (uAO > 0.0) c *= mix(1.0, texture2D(tAO, vUv).r, uAO);
            if (uRays > 0.0) c += texture2D(tRays, vUv).rgb;
            if (uBloom > 0.0) {
              vec3 b = texture2D(tBloom, vUv + uBloomTexel * vec2(-0.5, -0.5)).rgb + texture2D(tBloom, vUv + uBloomTexel * vec2(0.5, -0.5)).rgb
                     + texture2D(tBloom, vUv + uBloomTexel * vec2(-0.5, 0.5)).rgb + texture2D(tBloom, vUv + uBloomTexel * vec2(0.5, 0.5)).rgb;
              c += b * 0.25 * uBloom;
            }
            c = ACESFilmicToneMapping(c);
            c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
            // film finish: vignette, a little more saturation, warm highlights, slightly cool shadows, gentle S-curve, grain
            vec2 d = vUv - 0.5;
            vec3 col = c * (1.0 - uVignette * smoothstep(0.25, 0.85, length(d * vec2(1.25, 1.0))));
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(l), col, 1.14);
            col = mix(col, col * vec3(0.96, 1.0, 1.05), 1.0 - smoothstep(0.05, 0.4, l));
            col = mix(col, col * vec3(1.03, 1.0, 0.97), smoothstep(0.45, 0.9, l));
            col = clamp(col, 0.0, 1.0);
            col = col + (col * col * (3.0 - 2.0 * col) - col) * 0.25;
            col += (h(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    // (the tone mapping is this pass's own: three.js must not add its own to it; the sRGB conversion
    // comes from the prefix three.js gives every ShaderMaterial)
    (this.final.material as T.ShaderMaterial).toneMapped = false;
  }
  setQuality(q: Quality) {
    this.q = QUALITY[q].post;
    if (this.target.samples !== this.q.msaa) {
      this.target.samples = this.q.msaa;
      this.target.dispose();   // (re-created with the new sample count on its next use)
    }
    const ao = this.ao.material as T.ShaderMaterial, rays = this.rays.material as T.ShaderMaterial;
    if (this.q.ssao && ao.defines.SAMPLES !== this.q.ssao) (ao.defines.SAMPLES = this.q.ssao), (ao.needsUpdate = true);
    if (this.q.rays && rays.defines.SAMPLES !== this.q.rays) (rays.defines.SAMPLES = this.q.rays), (rays.needsUpdate = true);
  }
  setSize(w: number, h: number, ratio: number) {
    const W = Math.max(1, Math.floor(w * ratio)), H = Math.max(1, Math.floor(h * ratio));
    this.target.setSize(W, H);
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    this.aoRT.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    this.raysRT.setSize(hw, hh);
    for (const q of [this.ao, this.blur]) (q.material as T.ShaderMaterial).uniforms.uRes.value.set(hw, hh);
    this.bloomDown.forEach((t, i) => t.setSize(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))));
    this.bloomUp.forEach((t, i) => t.setSize(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))));
  }
  /** sunDir: world direction to the sun; strength fades with the sun leaving the view or setting */
  updateRays(camera: T.PerspectiveCamera, sunDir: T.Vector3, elevation: number, _q: Quality) {
    const p = this.v.copy(sunDir).multiplyScalar(4000).add(camera.position).project(camera);
    const fwd = this.f.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const facing = T.MathUtils.smoothstep(fwd.dot(sunDir), 0.2, 0.75);
    const u = (this.rays.material as T.ShaderMaterial).uniforms;
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    u.uAspect.value = camera.aspect;
    this.raysStrength = this.q.rays ? 0.55 * facing * T.MathUtils.smoothstep(elevation, -1, 3) : 0;
    u.uStrength.value = this.raysStrength;
  }
  private v = new T.Vector3();
  private f = new T.Vector3();
  private pass(q: FullScreenQuad, target: T.WebGLRenderTarget | null) {
    this.renderer.setRenderTarget(target);
    q.render(this.renderer);
  }
  draw(dt: number) {
    const r = this.renderer, q = this.q;
    this.time("main", () => {
      r.setRenderTarget(this.target);
      r.render(this.scene, this.camera);
    });
    const fu = (this.final.material as T.ShaderMaterial).uniforms;
    fu.uAO.value = q.ssao ? this.aoIntensity : 0;
    if (q.ssao)
      this.time("ssao", () => {
        const u = (this.ao.material as T.ShaderMaterial).uniforms;
        u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
        u.uProj.value.copy(this.camera.projectionMatrix);
        this.pass(this.ao, this.aoRT);
        this.pass(this.blur, this.blurRT);
      });
    fu.uRays.value = this.raysStrength > 0.001 ? 1 : 0;
    if (fu.uRays.value) this.time("rays", () => this.pass(this.rays, this.raysRT));
    fu.uBloom.value = q.bloom ? this.bloomStrength : 0;
    if (q.bloom)
      this.time("bloom", () => {
        const b = (this.bright.material as T.ShaderMaterial).uniforms;
        b.uTexel.value.set(1 / this.target.width, 1 / this.target.height);
        b.uAO.value = fu.uAO.value;
        this.pass(this.bright, this.bloomDown[0]);
        const d = (this.down.material as T.ShaderMaterial).uniforms;
        for (let i = 1; i < this.bloomDown.length; i++) {
          d.tSrc.value = this.bloomDown[i - 1].texture;
          d.uTexel.value.set(1 / this.bloomDown[i - 1].width, 1 / this.bloomDown[i - 1].height);
          this.pass(this.down, this.bloomDown[i]);
        }
        // the levels' weights follow the old UnrealBloomPass (radius 0.6): wider levels a little stronger
        const weights = [0.52, 0.56, 0.6, 0.64, 0.68];
        const u = (this.up.material as T.ShaderMaterial).uniforms;
        for (let i = this.bloomUp.length - 1; i >= 0; i--) {
          const src = i === this.bloomUp.length - 1 ? this.bloomDown[i + 1] : this.bloomUp[i + 1];
          u.tSrc.value = src.texture;
          u.tLevel.value = this.bloomDown[i].texture;
          u.uWeight.value = weights[i];
          // (the coarsest level enters through the upsample, with its own weight)
          u.uSrcWeight.value = i === this.bloomUp.length - 1 ? weights[i + 1] : 1;
          u.uTexel.value.set(1 / src.width, 1 / src.height);
          this.pass(this.up, this.bloomUp[i]);
        }
        fu.uBloomTexel.value.set(1 / this.bloomUp[0].width, 1 / this.bloomUp[0].height);
      });
    this.time("output", () => {
      fu.toneMappingExposure.value = r.toneMappingExposure;
      fu.uTime.value += dt;
      this.pass(this.final, null);
    });
  }
}
