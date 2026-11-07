import * as T from "three";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import type { WorldTextures } from "./grass";

/**
 * The stream: a ribbon over the centreline with per-vertex water depth taken from
 * the heightfield. Depth drives absorption and opacity (the stony bed shows through
 * the shallows); a procedural flow normal moves downstream; reflections come from the
 * sky environment, so the sunset sky and the low sun glint on the surface.
 * (Unity: rebuild with a river spline + HDRP/URP water shader.)
 */
export class River implements System {
  mesh: T.Mesh;
  uniforms: Record<string, T.IUniform> = { uTimeW: { value: 0 } };
  constructor(land: Landscape, wt: WorldTextures) {
    this.uniforms.tVegW = { value: wt.veg };
    this.uniforms.uExtentW = { value: land.world.data.extent };
    const pts = land.world.data.river.points;
    const h = land.world.height;
    const across = 9;
    const pos: number[] = [], uv: number[] = [], depth: number[] = [], dirs: number[] = [], idx: number[] = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z, w] = pts[i];
      const p = pts[Math.min(i + 1, pts.length - 1)], q = pts[Math.max(i - 1, 0)];
      const dx = p[0] - q[0], dz = p[2] - q[2], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      if (i > 0) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][2]);
      const half = w / 2 + 0.6;
      for (let k = 0; k < across; k++) {
        const t = k / (across - 1) * 2 - 1;
        const px = x + nx * t * half, pz = z + nz * t * half;
        pos.push(px, y, pz);
        uv.push(t * half, dist);
        dirs.push(dx / l, dz / l);
        depth.push(y - h.sample(px, pz));
      }
      if (i < pts.length - 1)
        for (let k = 0; k < across - 1; k++) {
          const a = i * across + k, b = a + across;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setAttribute("aDepth", new T.Float32BufferAttribute(depth, 1));
    g.setAttribute("aDir", new T.Float32BufferAttribute(dirs, 2));
    g.setAttribute("normal", new T.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new T.MeshStandardMaterial({ color: 0x0f1a17, roughness: 0.06, metalness: 0.0, transparent: true, depthWrite: false, envMapIntensity: 1.0 });
    land.lib.finish(m);
    const u = this.uniforms;
    addHook(m, "river", (s) => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\n attribute float aDepth; attribute vec2 aDir; varying float vDepth; varying vec2 vFlow; varying vec2 vDir; varying vec3 vWPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n vDepth = aDepth; vFlow = uv; vDir = aDir; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uTimeW, uExtentW; uniform sampler2D tVegW; varying float vDepth; varying vec2 vFlow; varying vec2 vDir; varying vec3 vWPos;
          // analytic ripples in flow space (x = across, y = along, metres): sum of travelling waves
          float rh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(rh(i),rh(i+vec2(1,0)),f.x),mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x),f.y); }
          vec2 rippleGrad(vec2 p, float t, float pix) {
            vec2 g = vec2(0.0);
            // flow warps the wave field so crests are never straight lines
            vec2 q = p + vec2(rn(p * 0.35 + vec2(0.0, -t * 0.3)), rn(p * 0.35 + 5.2 - vec2(0.0, t * 0.3))) * 1.4;
            const int N = 7;
            for (int i = 0; i < N; i++) {
              float fi = float(i);
              float ang = (fi - 3.0) * 0.41 + sin(fi * 7.1) * 0.25;     // mostly downstream
              float kl = 2.0 + fi * 1.45;
              vec2 k = vec2(sin(ang), cos(ang)) * kl;                    // wavenumber
              float a = 0.006 / (1.0 + fi * 0.55);                       // amplitude
              a *= 1.0 - smoothstep(0.35, 1.0, kl * pix);                // drop waves finer than ~2 px
              a *= 0.55 + 0.9 * rn(p * 0.22 + fi * 3.3);                 // patchy: calm and rippled areas
              float w = sqrt(9.81 * kl) * 0.35 + 1.1;
              float ph = dot(k, q) - w * t + fi * 1.7;
              g += k * a * cos(ph);
            }
            return g;
          }`,
        )
        .replace(
          "#include <map_fragment>",
          `float d = max(vDepth, 0.0);
          float edge = smoothstep(0.0, 0.06, d);
          // clear mountain stream: the bed shows through the shallows, tea-green in the deeper run
          diffuseColor.rgb = mix(vec3(0.09, 0.1, 0.07), vec3(0.018, 0.035, 0.03), smoothstep(0.05, 0.9, d));
          diffuseColor.a = edge * clamp(0.22 + d * 0.75, 0.0, 0.84);`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `{ float pix = length(fwidth(vFlow)); vec2 gr = rippleGrad(vFlow, uTimeW, pix);
            vec2 along = normalize(vDir), across = vec2(-along.y, along.x);
            vec2 gw = across * gr.x + along * gr.y;               // gradient in world xz
            vec3 wn3 = normalize(vec3(-gw.x, 1.0, -gw.y));
            normal = normalize((viewMatrix * vec4(wn3, 0.0)).xyz); }`,
        )
        .replace(
          "#include <lights_fragment_maps>",
          `#include <lights_fragment_maps>
          #if defined( RE_IndirectSpecular ) && defined( USE_FOG )
          {
            // reflections of the wooded banks: low reflected rays hit trees and slopes, not sky
            vec3 rv = reflect( -geometryViewDir, geometryNormal );
            vec3 rw = ( vec4( rv, 0.0 ) * viewMatrix ).xyz;
            // how high is the horizon in the reflected direction? wooded banks raise it, open paddies don't
            vec2 probe = vWPos.xz + normalize( rw.xz + vec2( 1e-4 ) ) * 22.0;
            float forest = texture2D( tVegW, probe / uExtentW + 0.5 ).r;
            float hz = mix( 0.035, 0.5, forest );
            float skyVis = smoothstep( hz, hz + 0.22, rw.y );
            vec3 bank = uFogAmbient * vec3( 0.11, 0.15, 0.1 );
            radiance = mix( bank, radiance, skyVis );
          }
          #endif`,
        )
        .replace(
          "#include <opaque_fragment>",
          `{
            // reflection is not attenuated by transparency: grazing views turn into a mirror
            float fres = 0.02 + 0.98 * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 5.0 );
            diffuseColor.a = mix( diffuseColor.a, 1.0, fres );
          }
          #include <opaque_fragment>`,
        );
    });
    this.mesh = new T.Mesh(g, m);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    land.scene.add(this.mesh);
  }
  update(dt: number) {
    this.uniforms.uTimeW.value += dt;
  }
}
