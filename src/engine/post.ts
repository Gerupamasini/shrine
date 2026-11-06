import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { Quality } from "./lighting";

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
      col = mix(col, col * vec3(0.97, 1.0, 1.04), 1.0 - smoothstep(0.05, 0.45, l)); // cool shadows
      col += (h(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Post {
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
    this.composer.addPass(this.render);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.finish);
  }
  setQuality(q: Quality) {
    this.bloom.enabled = q !== "low";
    (this.composer.renderTarget1 as T.WebGLRenderTarget).samples = q === "low" ? 0 : 4;
    (this.composer.renderTarget2 as T.WebGLRenderTarget).samples = q === "low" ? 0 : 4;
  }
  setSize(w: number, h: number, ratio: number) {
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
  }
  draw(dt: number) {
    this.finish.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
