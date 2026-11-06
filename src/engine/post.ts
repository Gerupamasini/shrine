import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { Quality } from "./lighting";
import { SSAOPass } from "./ssao";

/** Gentle film finish: vignette, slight warm/cool split, fine grain. Applied after tone mapping. */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.018 }, uVignette: { value: 0.22 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*0.0) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.25, 0.85, length(d * vec2(1.25, 1.0)));
      vec3 col = c.rgb * v;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // photographic grade: a little more saturation, warm highlights, slightly cool shadows, gentle S-curve
      col = mix(vec3(l), col, 1.14);
      col = mix(col, col * vec3(0.96, 1.0, 1.05), 1.0 - smoothstep(0.05, 0.4, l));
      col = mix(col, col * vec3(1.03, 1.0, 0.97), smoothstep(0.45, 0.9, l));
      col = clamp(col, 0.0, 1.0);
      col = col + (col * col * (3.0 - 2.0 * col) - col) * 0.25;
      col += (h(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(col, c.a);
    }`,
};

/** Subtle crepuscular rays: radial scattering of the bright sky around the sun (HDR, pre tone-mapping). */
const RaysShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new T.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength, uAspect; varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.0) { gl_FragColor = base; return; }
      vec2 d = (uSun - vUv) / 48.0;
      vec2 uv = vUv;
      vec3 acc = vec3(0.0);
      float w = 1.0;
      for (int i = 0; i < 48; i++) {
        uv += d;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        acc += c * smoothstep(2.2, 6.0, l) * w;
        w *= 0.955;
      }
      vec2 off = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = exp(-length(off) * 1.6);
      gl_FragColor = vec4(base.rgb + acc / 48.0 * uStrength * fall, base.a);
    }`,
};

export class Post {
  rays: ShaderPass;
  ssao: SSAOPass;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  finish: ShaderPass;
  render: RenderPass;
  constructor(
    public renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.Camera,
  ) {
    const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.render = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.14, 0.6, 1.6);
    this.finish = new ShaderPass(FinishShader);
    this.rays = new ShaderPass(RaysShader);
    // RenderPass draws into composer.readBuffer (renderTarget2): give it a depth texture for SSAO
    const depth = new T.DepthTexture(1, 1, T.UnsignedIntType);
    (this.composer.renderTarget2 as T.WebGLRenderTarget).depthTexture = depth;
    this.ssao = new SSAOPass(camera as T.PerspectiveCamera, depth);
    this.composer.addPass(this.render);
    this.composer.addPass(this.ssao);
    this.composer.addPass(this.rays);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.finish);
  }
  setQuality(q: Quality) {
    this.bloom.enabled = q !== "low";
    this.ssao.enabled = q !== "low";
    (this.composer.renderTarget1 as T.WebGLRenderTarget).samples = q === "low" ? 0 : 4;
    (this.composer.renderTarget2 as T.WebGLRenderTarget).samples = q === "low" ? 0 : 4;
  }
  setSize(w: number, h: number, ratio: number) {
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
  }
  /** sunDir: world direction to the sun; strength fades with the sun leaving the view or setting */
  updateRays(camera: T.PerspectiveCamera, sunDir: T.Vector3, elevation: number, q: Quality) {
    const p = sunDir.clone().multiplyScalar(4000).add(camera.position).project(camera);
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const facing = T.MathUtils.smoothstep(fwd.dot(sunDir), 0.2, 0.75);
    const u = this.rays.uniforms;
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    u.uAspect.value = camera.aspect;
    u.uStrength.value = q === "low" ? 0 : 0.55 * facing * T.MathUtils.smoothstep(elevation, -1, 3);
    this.rays.enabled = u.uStrength.value > 0.001;
  }
  draw(dt: number) {
    this.finish.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
