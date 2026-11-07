import * as T from "three";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import type { WorldTextures } from "./grass";

/**
 * Dragonflies over the paddies at dusk: wandering gliders (Pantala flavescens, "shoryo tombo",
 * the dragonflies of the Bon season) that swarm low over rice and grass in early August.
 * A camera-following grid of slots, each anchored to a world cell so the swarm does not travel
 * with the walker; a slot is empty over forest, roads and water. Each insect glides in loose
 * loops 1-3.5 m above the ground. They thin out after sunset.
 */
export class Dragonflies implements System {
  mesh: T.Mesh;
  uniforms: Record<string, T.IUniform>;
  constructor(land: Landscape, wt: WorldTextures, private elevation: () => number) {
    const SPACING = 3.2, GRID = 15;
    const offsets: number[] = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) offsets.push((i - GRID / 2) * SPACING, (j - GRID / 2) * SPACING);
    // body (thin box) and two pairs of wings: aPart 0 = body, 1 = wing
    const pos: number[] = [], part: number[] = [], idx: number[] = [];
    const quad = (pts: number[][], pt: number) => {
      const b = pos.length / 3;
      for (const p of pts) { pos.push(...p); part.push(pt); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
    };
    const L = 0.048, wd = 0.004;
    quad([[-wd, 0, -L / 2], [wd, 0, -L / 2], [wd, 0, L / 2], [-wd, 0, L / 2]], 0);
    quad([[0, -wd, -L / 2], [0, wd, -L / 2], [0, wd, L / 2], [0, -wd, L / 2]], 0);
    for (const [z0, span] of [[0.012, 0.042], [0.0, 0.044]] as const)
      for (const s of [-1, 1]) quad([[0, 0, z0], [s * span, 0.002, z0 + 0.004], [s * span, 0.002, z0 - 0.006], [0, 0, z0 - 0.009]], 1);
    const g = new T.InstancedBufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("aPart", new T.Float32BufferAttribute(part, 1));
    g.setIndex(idx);
    g.setAttribute("aOffset", new T.InstancedBufferAttribute(new Float32Array(offsets), 2));
    g.instanceCount = GRID * GRID;
    this.uniforms = {
      uCamD: { value: new T.Vector2() },
      uTimeD: { value: 0 },
      uActiveD: { value: 1 },
      uSpacingD: { value: SPACING },
      tHeightD: { value: wt.height },
      tVegD: { value: wt.veg },
      uExtentD: { value: land.world.data.extent },
      uResD: { value: land.world.height.n },
    };
    const m = land.lib.finish(new T.MeshBasicMaterial({ color: 0xffffff, fog: true }));
    const u = this.uniforms;
    addHook(m, "dragonflies", (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute vec2 aOffset; attribute float aPart;
          uniform vec2 uCamD; uniform float uTimeD, uActiveD, uSpacingD, uExtentD, uResD; uniform sampler2D tHeightD, tVegD;
          varying float vPartD;
          float dh21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float groundD(vec2 xz) {
            vec2 f = clamp((xz / uExtentD + 0.5) * (uResD - 1.0), vec2(0.0), vec2(uResD - 1.001));
            ivec2 i = ivec2(floor(f)); vec2 a = fract(f);
            return mix(mix(texelFetch(tHeightD, i, 0).r, texelFetch(tHeightD, i + ivec2(1, 0), 0).r, a.x),
                       mix(texelFetch(tHeightD, i + ivec2(0, 1), 0).r, texelFetch(tHeightD, i + ivec2(1, 1), 0).r, a.x), a.y);
          }
          vec2 loopD(float ph, float h1, float h2) {
            return vec2(cos(ph), sin(ph * 1.31 + h2 * 3.0)) * (1.4 + h1 * 2.6) + vec2(sin(ph * 0.37 + h1 * 9.0), cos(ph * 0.29)) * 1.3;
          }`,
        )
        .replace(
          "#include <begin_vertex>",
          `vec2 cell = floor(uCamD / uSpacingD) * uSpacingD + aOffset;
          float h1 = dh21(cell * 0.731), h2 = dh21(cell.yx * 1.37 + 3.1), h3 = dh21(cell * 2.17 + 7.7);
          vec2 home = cell + (vec2(h1, h2) - 0.5) * uSpacingD;
          vec4 veg = texture2D(tVegD, home / uExtentD + 0.5);
          // over rice and grass, not over woods, roads or water; about half the slots are taken
          float dens = clamp(veg.b * 1.2 + veg.a * 0.7 - veg.r * 2.0, 0.0, 1.0) * uActiveD;
          float on = step(h3, dens * 0.6);
          float sp = 0.32 + h2 * 0.35;
          float ph = uTimeD * sp + h1 * 6.2832;
          vec2 off = loopD(ph, h1, h2);
          vec2 vel = loopD(ph + 0.05, h1, h2) - off;
          float yaw = atan(vel.x, vel.y);
          vec3 p = vec3(home.x + off.x, 0.0, home.y + off.y);
          p.y = groundD(p.xz) + 1.0 + h2 * 2.5 + sin(ph * 0.8 + h3 * 6.0) * 0.35;
          vec3 q = position;
          // gliding, with now and then a burst of wingbeats
          float beat = smoothstep(0.6, 0.9, sin(uTimeD * 0.9 + h3 * 20.0));
          if (aPart > 0.5) q.y += sin(uTimeD * 70.0 + h1 * 40.0) * 0.012 * beat * abs(q.x) / 0.044;
          q.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * q.xz;     // local +z -> heading
          vec3 transformed = p + q * on;
          vPartD = aPart;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n varying float vPartD;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          #ifdef USE_FOG
            vec3 amb = uFogAmbient, sun = uFogSun;
          #else
            vec3 amb = vec3(0.5), sun = vec3(0.5);
          #endif
          // amber body; wings catch the light of the western sky
          diffuseColor.rgb = vPartD < 0.5 ? amb * vec3(0.32, 0.22, 0.09) + sun * vec3(0.05, 0.035, 0.01) : amb * vec3(0.55, 0.58, 0.6) + sun * 0.12;`,
        );
    });
    this.mesh = new T.Mesh(g, m);
    this.mesh.frustumCulled = false;
    land.scene.add(this.mesh);
  }
  update(dt: number, _t: number, cam: T.PerspectiveCamera) {
    this.uniforms.uTimeD.value += dt;
    this.uniforms.uCamD.value.set(cam.position.x, cam.position.z);
    // thin out after sunset (sun elevation in degrees)
    this.uniforms.uActiveD.value = T.MathUtils.smoothstep(this.elevation(), -4, 1.5);
  }
}
