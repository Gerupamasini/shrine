import * as T from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * Depth-only screen-space ambient occlusion (no extra scene pass, so alpha-tested
 * foliage occludes correctly). Half-resolution AO, depth-aware blur, applied to the
 * HDR colour before tone mapping. Fades out with distance: it grounds lanterns,
 * steps, eaves, rocks and trunks near the walker.
 */
export class SSAOPass extends Pass {
  aoRT: T.WebGLRenderTarget;
  blurRT: T.WebGLRenderTarget;
  aoQuad: FullScreenQuad;
  blurQuad: FullScreenQuad;
  compQuad: FullScreenQuad;
  intensity = 1.0;
  constructor(
    public camera: T.PerspectiveCamera,
    public depth: T.DepthTexture,
  ) {
    super();
    const opts = { type: T.HalfFloatType, format: T.RedFormat, depthBuffer: false } as const;
    this.aoRT = new T.WebGLRenderTarget(1, 1, opts);
    this.blurRT = new T.WebGLRenderTarget(1, 1, opts);
    const common = {
      tDepth: { value: depth },
      uProjInv: { value: new T.Matrix4() },
      uProj: { value: new T.Matrix4() },
      uRes: { value: new T.Vector2(1, 1) },
    };
    const viewPos = /* glsl */ `
      uniform sampler2D tDepth; uniform mat4 uProjInv, uProj; uniform vec2 uRes;
      vec3 viewPos(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return p.xyz / p.w;
      }`;
    this.aoQuad = new FullScreenQuad(
      new T.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { ...common, uRadius: { value: 0.9 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          ${viewPos}
          uniform float uRadius; varying vec2 vUv;
          float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
          void main() {
            float d0 = texture2D(tDepth, vUv).x;
            if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
            vec3 p = viewPos(vUv);
            float dist = -p.z;
            if (dist > 160.0) { gl_FragColor = vec4(1.0); return; }
            vec2 px = 1.0 / uRes;
            vec3 px1 = viewPos(vUv + vec2(px.x, 0.0)), py1 = viewPos(vUv + vec2(0.0, px.y));
            vec3 px0 = viewPos(vUv - vec2(px.x, 0.0)), py0 = viewPos(vUv - vec2(0.0, px.y));
            vec3 dx = abs(px1.z - p.z) < abs(p.z - px0.z) ? px1 - p : p - px0;
            vec3 dy = abs(py1.z - p.z) < abs(p.z - py0.z) ? py1 - p : p - py0;
            vec3 n = normalize(cross(dx, dy));
            float radius = uRadius * (1.0 + dist * 0.015);
            // projected radius in uv
            float rUv = radius * uProj[1][1] / max(dist, 0.1) * 0.5;
            float ang = ign(gl_FragCoord.xy) * 6.2831;
            float occ = 0.0;
            const int N = 12;
            for (int i = 0; i < N; i++) {
              float t = (float(i) + 0.5) / float(N);
              float a = ang + float(i) * 2.39996;
              vec2 o = vec2(cos(a), sin(a)) * rUv * sqrt(t);
              vec3 s = viewPos(vUv + o);
              vec3 v = s - p;
              float l = length(v);
              float nd = dot(n, v) / max(l, 1e-3);
              occ += max(nd - 0.08, 0.0) * smoothstep(radius * 1.6, radius * 0.3, l);
            }
            float ao = 1.0 - occ / float(N) * 1.6;
            ao = mix(ao, 1.0, smoothstep(80.0, 160.0, dist));
            gl_FragColor = vec4(clamp(ao, 0.0, 1.0));
          }`,
      }),
    );
    this.blurQuad = new FullScreenQuad(
      new T.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { ...common, tAO: { value: this.aoRT.texture } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          ${viewPos}
          uniform sampler2D tAO; varying vec2 vUv;
          void main() {
            float z0 = viewPos(vUv).z;
            float sum = 0.0, wsum = 0.0;
            for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
              vec2 uv = vUv + vec2(float(x), float(y)) * 2.0 / uRes;
              float z = viewPos(uv).z;
              float w = exp(-abs(z - z0) / max(abs(z0) * 0.02, 0.05));
              sum += texture2D(tAO, uv).r * w;
              wsum += w;
            }
            gl_FragColor = vec4(sum / max(wsum, 1e-4));
          }`,
      }),
    );
    this.compQuad = new FullScreenQuad(
      new T.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { tDiffuse: { value: null }, tAO: { value: this.blurRT.texture }, uIntensity: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse, tAO; uniform float uIntensity; varying vec2 vUv;
          void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            float ao = mix(1.0, texture2D(tAO, vUv).r, uIntensity);
            gl_FragColor = vec4(c.rgb * ao, c.a);
          }`,
      }),
    );
  }
  setSize(w: number, h: number) {
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    this.aoRT.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    for (const q of [this.aoQuad, this.blurQuad]) (q.material as T.ShaderMaterial).uniforms.uRes.value.set(hw, hh);
  }
  render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget) {
    for (const q of [this.aoQuad, this.blurQuad]) {
      const u = (q.material as T.ShaderMaterial).uniforms;
      u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
      u.uProj.value.copy(this.camera.projectionMatrix);
      u.tDepth.value = this.depth;
    }
    renderer.setRenderTarget(this.aoRT);
    this.aoQuad.render(renderer);
    renderer.setRenderTarget(this.blurRT);
    this.blurQuad.render(renderer);
    const cu = (this.compQuad.material as T.ShaderMaterial).uniforms;
    cu.tDiffuse.value = readBuffer.texture;
    cu.uIntensity.value = this.intensity;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compQuad.render(renderer);
  }
}
