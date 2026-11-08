import * as T from "three";
import { addHook } from "../engine/hooks";
import { publicUrl } from "../urls";
import type { Landscape, System } from "./landscape";
import { windUniforms } from "./vegetation";

/**
 * Thin columns of evening smoke from a few houses: the bath stove chimneys of tiled and tin
 * houses and the ridge vent of thatched ones (scene.json objects with `smoke: true`; the local
 * source point per house model is in architecture/index.json). Each column is a stream of
 * camera-facing puffs rising ~20 m over 28 s, widening and drifting with the breeze. Unlit:
 * the colour comes from the sky ambient plus forward scattering when the sun is behind it.
 * (Unity: a VFX Graph / Shuriken smoke trail with the same timing.)
 */
export class Smoke implements System {
  mesh?: T.Mesh;
  uniforms = { uTimeS: { value: 0 } };
  async load(land: Landscape) {
    const index = await fetch(publicUrl("assets/models/architecture/index.json")).then((r) => r.json());
    const src: number[] = [], seed: number[] = [];
    const PUFFS = 32;
    let k = 0;
    for (const o of land.world.data.objects) {
      if (!o.smoke) continue;
      const local = index.assets?.[`${o.asset}_${o.variant}`]?.smoke as number[] | undefined;
      if (!local) continue;
      const yaw = o.rotation[1], c = Math.cos(yaw), s = Math.sin(yaw);
      const [lx, ly, lz] = local;
      const x = o.position[0] + lx * c + lz * s, z = o.position[2] - lx * s + lz * c, y = o.position[1] + ly;
      for (let i = 0; i < PUFFS; i++) {
        src.push(x, y, z);
        seed.push(k * 0.618 + 0.13, i / PUFFS, 0.6 + 0.4 * ((k * 0.37) % 1));
      }
      k++;
    }
    if (!k) return;
    const base = new T.PlaneGeometry(1, 1);
    const g = new T.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    g.setAttribute("aSrc", new T.InstancedBufferAttribute(new Float32Array(src), 3));
    g.setAttribute("aSeedS", new T.InstancedBufferAttribute(new Float32Array(seed), 3));
    g.instanceCount = src.length / 3;
    const m = land.lib.finish(new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true }));
    const u = this.uniforms;
    addHook(m, "smoke", (sh) => {
      Object.assign(sh.uniforms, u, windUniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute vec3 aSrc; attribute vec3 aSeedS; uniform float uTimeS, uWindStrength; uniform vec2 uWindDir;
          varying vec2 vPuff; varying float vAlphaS; varying float vSeed;`,
        )
        .replace(
          "#include <begin_vertex>",
          `float age = fract(uTimeS / 28.0 + aSeedS.y + aSeedS.x * 0.37);
          float hgt = age * 15.0 + age * age * 6.0;
          vec3 c = aSrc + vec3(0.0, hgt, 0.0);
          // the evening breeze bends the column more the higher it rises; a slow meander
          c.xz += uWindDir * uWindStrength * age * age * 14.0;
          c.xz += vec2(sin(uTimeS * 0.21 + aSeedS.x * 6.0 + age * 5.0), cos(uTimeS * 0.17 + aSeedS.x * 4.0 + age * 4.3)) * (0.25 + age * 1.9);
          float size = 0.45 + age * 4.8;
          float rot = aSeedS.x * 6.28 + age * 2.0 + aSeedS.y * 9.0;
          vec2 p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 transformed = c + (right * p.x + up * p.y) * size;
          vPuff = position.xy * 2.0;
          vSeed = aSeedS.x * 13.1 + aSeedS.y * 7.7;
          vAlphaS = smoothstep(0.0, 0.07, age) * pow(1.0 - age, 1.7) * aSeedS.z;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec2 vPuff; varying float vAlphaS; varying float vSeed;
          float sh21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float sn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(sh21(i),sh21(i+vec2(1,0)),f.x),mix(sh21(i+vec2(0,1)),sh21(i+vec2(1,1)),f.x),f.y); }`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          {
            float n = sn(vPuff * 2.2 + vSeed) * 0.6 + sn(vPuff * 5.1 - vSeed) * 0.4;
            float r = length(vPuff) + (n - 0.5) * 0.55;
            float a = (1.0 - smoothstep(0.25, 1.0, r)) * vAlphaS * 0.3;
            #ifdef USE_FOG
              vec3 vd = normalize(vFogWorld - cameraPosition);
              float fw = pow(max(dot(vd, normalize(uSunDir)), 0.0), 5.0);
              diffuseColor.rgb = uFogAmbient * 0.45 + uFogSun * (0.06 + 0.5 * fw);
            #else
              diffuseColor.rgb = vec3(0.5);
            #endif
            diffuseColor.a = a;
          }`,
        );
    });
    const mesh = new T.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    land.scene.add(mesh);
    this.mesh = mesh;
  }
  update(dt: number) {
    this.uniforms.uTimeS.value += dt;
  }
}
