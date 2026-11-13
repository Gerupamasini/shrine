import * as T from "three";
import { addHook } from "../engine/hooks";
import type { Landscape, System } from "./landscape";
import type { WorldTextures } from "./grass";

type CanalData = { points: number[][]; depth: number; wallTop: number };
type RiverData = {
  points: number[][];
  bed: { points: number[][] };
  drops: { z: number; kind: string; apron: number }[];
  canal: { points: number[][]; culvert: number[]; depth: number; wallTop: number };
};

/**
 * Water of the river and the irrigation canal.
 *
 * The river surface is a ribbon of cross-sections along X spanning the whole bed (the
 * sills are laid along X as well). The water's edge is not modelled: each fragment
 * reads the bed height from the heightfield, so the surface ends exactly where it meets
 * the gravel bars. Depth drives absorption and opacity (the stony bed shows through the
 * shallows); white water appears on the overfalls, in the turbulent reach below each
 * drop and where thin water runs over stones (riffles). Reflections come from the sky,
 * cut off by the revetment and the trees on the opposite bank; the east wall faces the
 * evening sun and reflects warm, the west wall and the woods are in shade.
 * (Unity: river spline + HDRP/URP water with the same depth/foam inputs.)
 */
export class River implements System {
  meshes: T.Mesh[] = [];
  uniforms: Record<string, T.IUniform>;
  constructor(land: Landscape, wt: WorldTextures) {
    const R = land.world.data.river as unknown as RiverData;
    this.uniforms = {
      uTimeW: { value: 0 },
      tVegW: { value: wt.veg },
      tHeightW: { value: wt.height },
      uExtentW: { value: land.world.data.extent },
      uResW: { value: land.world.height.n },
    };
    const mat = this.material(land);
    this.add(land, this.river(R), mat);
    this.add(land, this.canal(R), mat);
    const streams = land.world.data.streams ?? [];
    if (streams.length) this.add(land, this.streams(streams), mat);
    for (const c of (land.world.data as unknown as { canals?: CanalData[] }).canals ?? []) this.add(land, this.feeder(c), mat);
  }
  /** Canals fed from the side brooks: open stretches only (not in the pipe under the road). */
  private feeder(c: CanalData) {
    const cp = c.points;
    const rows = cp.map((p, i) => {
      const a = cp[Math.min(i + 1, cp.length - 1)], b = cp[Math.max(i - 1, 0)];
      const dx = a[0] - b[0], dz = a[2] - b[2], l = Math.hypot(dx, dz) || 1;
      const next = cp[Math.min(i + 1, cp.length - 1)];
      const skip = (p[4] === 1 && next[4] === 1) || i === cp.length - 1;
      return { cx: p[0], y: p[1], z: p[2], ax: -dz / l, az: dx / l, half: p[3] / 2, dir: [dx / l, dz / l] as [number, number], fall: 0, foam: 0, riffle: 0.15, bank: c.wallTop, fixed: c.depth - 0.04, across: 3, skip };
    });
    return this.build(rows);
  }
  /** Side streams: the brook down its valley (shallow, broken water over cobbles) and the lined
   *  channel across the paddies; each run of [x, waterY, z, halfWidth] is a ribbon along its path. */
  private streams(list: { water: number[][][]; kind?: string }[]) {
    const rows: Parameters<River["build"]>[0] = [];
    for (const st of list)
      st.water.forEach((run, ri) => {
        run.forEach((p, i) => {
          const a = run[Math.min(i + 1, run.length - 1)], b = run[Math.max(i - 1, 0)];
          const dx = a[0] - b[0], dz = a[2] - b[2], l = Math.hypot(dx, dz) || 1;
          const brook = ri === 0 && st.kind !== "ditch";
          rows.push({ cx: p[0], y: p[1], z: p[2], ax: -dz / l, az: dx / l, half: p[3], dir: [dx / l, dz / l], fall: 0, foam: 0, riffle: brook ? 0.55 : 0.1,
            bank: 0.6, fixed: brook ? 0 : 0.2, across: 3, skip: i === run.length - 1 });
        });
      });
    return this.build(rows);
  }
  private add(land: Landscape, g: T.BufferGeometry, m: T.Material) {
    const mesh = new T.Mesh(g, m);
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    land.scene.add(mesh);
    this.meshes.push(mesh);
  }
  private build(rows: { cx: number; y: number; z: number; ax: number; az: number; half: number; dir: [number, number]; fall: number; foam: number; riffle: number; bank: number; fixed: number; across: number; skip?: boolean }[]) {
    const pos: number[] = [], uv: number[] = [], dirs: number[] = [], extra: number[] = [], wall: number[] = [], idx: number[] = [];
    let dist = 0, base = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (i > 0) dist += Math.hypot(r.cx - rows[i - 1].cx, r.z - rows[i - 1].z);
      for (let k = 0; k < r.across; k++) {
        const t = (k / (r.across - 1)) * 2 - 1;
        pos.push(r.cx + r.ax * t * r.half, r.y, r.z + r.az * t * r.half);
        uv.push(t * r.half, dist);
        dirs.push(r.dir[0], r.dir[1]);
        extra.push(r.fall, r.foam, r.fixed, r.riffle);
        wall.push(r.half, r.bank);
      }
      if (i < rows.length - 1 && !r.skip) {
        // wind the quads so they face up whichever way the cross-section runs
        const n = rows[i + 1], up = r.az * (n.cx - r.cx) - r.ax * (n.z - r.z) > 0;
        for (let k = 0; k < r.across - 1; k++) {
          const a = base + k, b = a + r.across;
          if (up) idx.push(a, a + 1, b, a + 1, b + 1, b);
          else idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      base += r.across;
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setAttribute("aDir", new T.Float32BufferAttribute(dirs, 2));
    g.setAttribute("aWater", new T.Float32BufferAttribute(extra, 4));
    g.setAttribute("aWall", new T.Float32BufferAttribute(wall, 2));
    g.setAttribute("normal", new T.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  private river(R: RiverData) {
    const pts = R.points, bed = R.bed.points;
    const topAt = (z: number) => {
      const i = Math.min(Math.max(Math.round((z - bed[0][1]) / (bed[1][1] - bed[0][1])), 0), bed.length - 1);
      return bed[i][3];
    };
    const rows = pts.map((p, i) => {
      const [x, y, z, w, fall, riffle = 0] = p;
      const a = pts[Math.min(i + 3, pts.length - 1)], b = pts[Math.max(i - 3, 0)];
      const dx = a[0] - b[0], dz = a[2] - b[2], l = Math.hypot(dx, dz) || 1;
      // turbulence below the drops fades over a few metres (longer below the weir)
      let foam = 0;
      for (const d of R.drops) {
        const s = z - d.z;
        if (s > 0 && s < 30) foam = Math.max(foam, Math.exp(-s / (d.kind === "weir" ? 7 : 4)) * (d.kind === "weir" ? 1 : 0.75));
      }
      return { cx: x, y, z, ax: 1, az: 0, half: w / 2 + 0.25, dir: [dx / l, dz / l] as [number, number], fall, foam, riffle, bank: topAt(z) - y, fixed: 0, across: 19 };
    });
    return this.build(rows);
  }
  private canal(R: RiverData) {
    const cp = R.canal.points, cul = R.canal.culvert;
    const rows = cp.map((p, i) => {
      const a = cp[Math.min(i + 1, cp.length - 1)], b = cp[Math.max(i - 1, 0)];
      const dx = a[0] - b[0], dz = a[2] - b[2], l = Math.hypot(dx, dz) || 1;
      const next = cp[Math.min(i + 1, cp.length - 1)];
      const skip = (p[2] + next[2]) / 2 > cul[0] && (p[2] + next[2]) / 2 < cul[1];
      return { cx: p[0], y: p[1], z: p[2], ax: -dz / l, az: dx / l, half: p[3] / 2, dir: [dx / l, dz / l] as [number, number], fall: 0, foam: 0, riffle: 0, bank: R.canal.wallTop, fixed: R.canal.depth - 0.04, across: 3, skip };
    });
    return this.build(rows);
  }
  private material(land: Landscape) {
    const m = new T.MeshStandardMaterial({ color: 0x0f1a17, roughness: 0.05, metalness: 0.0, transparent: true, depthWrite: false, envMapIntensity: 1.0 });
    land.lib.finish(m);
    const u = this.uniforms;
    addHook(m, "river2", (s) => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\n attribute vec2 aDir; attribute vec4 aWater; attribute vec2 aWall; varying vec2 vFlow; varying vec2 vDir; varying vec3 vWPos; varying vec4 vWater; varying vec2 vWall;",
        )
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n vFlow = uv; vDir = aDir; vWater = aWater; vWall = aWall; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `#include <common>
          uniform float uTimeW, uExtentW, uResW; uniform sampler2D tVegW, tHeightW;
          varying vec2 vFlow; varying vec2 vDir; varying vec3 vWPos; varying vec4 vWater; varying vec2 vWall;
          float bedHeight(vec2 xz) {
            vec2 f = clamp((xz / uExtentW + 0.5) * (uResW - 1.0), vec2(0.0), vec2(uResW - 1.001));
            ivec2 i = ivec2(floor(f)); vec2 a = fract(f);
            float h00 = texelFetch(tHeightW, i, 0).r, h10 = texelFetch(tHeightW, i + ivec2(1, 0), 0).r;
            float h01 = texelFetch(tHeightW, i + ivec2(0, 1), 0).r, h11 = texelFetch(tHeightW, i + ivec2(1, 1), 0).r;
            return mix(mix(h00, h10, a.x), mix(h01, h11, a.x), a.y);
          }
          float rh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(rh(i),rh(i+vec2(1,0)),f.x),mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x),f.y); }
          // analytic ripples in flow space (x = across, y = along, metres): sum of travelling waves
          vec2 rippleGrad(vec2 p, float t, float pix, float rough) {
            vec2 g = vec2(0.0);
            vec2 q = p + vec2(rn(p * 0.35 + vec2(0.0, -t * 0.3)), rn(p * 0.35 + 5.2 - vec2(0.0, t * 0.3))) * 0.6;
            for (int i = 0; i < 7; i++) {
              float fi = float(i);
              float ang = (fi - 3.0) * 0.41 + sin(fi * 7.1) * 0.25;
              float kl = 2.0 + fi * 1.45 + rough * fi * 0.9;
              vec2 k = vec2(sin(ang), cos(ang)) * kl;
              float a = 0.009 / (1.0 + fi * 0.55) * (1.0 + rough * 2.0);
              a *= 1.0 - smoothstep(0.35, 1.0, kl * pix);
              a *= 0.55 + 0.9 * rn(p * 0.22 + fi * 3.3);
              float w = sqrt(9.81 * kl) * 0.35 + 1.1 + rough * 1.5;
              g += k * a * cos(dot(k, q) - w * t + fi * 1.7);
            }
            return g;
          }`,
        )
        .replace(
          "#include <map_fragment>",
          /* glsl */ `float fall = vWater.x, foamBelow = vWater.y, fixedDepth = vWater.z;
          float depth = fixedDepth > 0.0 ? fixedDepth : vWPos.y - bedHeight(vWPos.xz);
          if (fall < 0.01 && depth < 0.0) discard;                       // dry gravel
          float dd = max(depth, 0.0);
          // clear valley water: faint green, tea-dark in the pools
          diffuseColor.rgb = mix(vec3(0.075, 0.088, 0.062), vec3(0.012, 0.03, 0.026), smoothstep(0.03, 0.85, dd));
          float alpha = clamp(0.05 + dd * 0.8, 0.0, 0.82) * smoothstep(0.0, 0.03, dd);
          // white water: overfalls, the churned reach below them, thin water racing over stones
          vec2 fq = vFlow * vec2(1.0, 0.55);
          float n1 = rn(fq * vec2(2.3, 1.0) - vec2(0.0, uTimeW * 1.5));
          float n2 = rn(fq * vec2(6.1, 2.6) - vec2(0.0, uTimeW * 2.9) + 3.7);
          float streak = smoothstep(0.42, 0.86, n1 * 0.62 + n2 * 0.48);
          // riffles: only where the channel crosses over (row factor), in the shallow middle, never along the calm edge
          float riffle = vWater.w * (1.0 - smoothstep(0.08, 0.24, dd)) * smoothstep(0.03, 0.08, dd);
          // overfall: a glassy sheet with white threads running down it
          float thread = smoothstep(0.38, 0.82, rn(vec2(vFlow.x * 6.5, vFlow.y * 1.1 - uTimeW * 4.0)) * 0.7 + rn(vec2(vFlow.x * 17.0, vFlow.y * 2.0 - uTimeW * 6.0)) * 0.4);
          // the low summer flow is uneven along the crest: glassy stretches between white ones
          thread *= 0.35 + 0.65 * smoothstep(0.3, 0.7, rn(vec2(vFlow.x * 0.45 + 3.3, 1.7)));
          // below the drop: patches of foam and bubbles drifting off, not a uniform sheet
          float b1 = rn(vFlow * vec2(1.7, 1.1) - vec2(0.0, uTimeW * 0.9));
          float b2 = rn(vFlow * vec2(4.6, 3.1) - vec2(0.0, uTimeW * 1.6) + 9.1);
          float blob = smoothstep(0.5, 0.86, b1 * 0.62 + b2 * 0.48);
          float foamAmt = clamp(fall * (0.28 + 0.7 * thread) + foamBelow * (0.1 + 0.85 * blob) * (0.6 + 0.4 * streak) + riffle * streak * 0.6, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.72, 0.7), foamAmt * 0.85);
          diffuseColor.a = mix(mix(alpha, 0.5 + 0.35 * thread, fall), 0.93, foamAmt);`,
        )
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.65, foamAmt);")
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `{ float pix = length(fwidth(vFlow));
            // choppier below the drops and over riffles, but not so fine that it turns to frosted glass
            float rough = clamp(foamBelow * 0.6 + riffle * 1.2, 0.0, 1.0);
            vec2 gr = rippleGrad(vFlow, uTimeW, pix, rough);
            vec2 along = normalize(vDir), across = vec2(-along.y, along.x);
            vec2 gw = across * gr.x + along * gr.y;
            vec3 wn3 = normalize(vec3(-gw.x, 1.0, -gw.y));
            // the overfall sheet leans downstream
            wn3 = normalize(mix(wn3, normalize(vec3(along.x, 0.6, along.y)), fall * 0.8));
            normal = normalize((viewMatrix * vec4(wn3, 0.0)).xyz); }`,
        )
        .replace(
          "#include <lights_fragment_maps>",
          /* glsl */ `#include <lights_fragment_maps>
          #if defined( RE_IndirectSpecular ) && defined( USE_FOG )
          {
            // what the reflected ray sees: sky above the far bank, else the revetment / woods
            // sky/bank test on a calmed normal: small ripples blur the edge of the reflected bank
            // instead of breaking it into blobs
            vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
            vec3 rv = reflect( -geometryViewDir, normalize( mix( upV, geometryNormal, 0.35 ) ) );
            vec3 rw = ( vec4( rv, 0.0 ) * viewMatrix ).xyz;
            float hl = max( length( rw.xz ), 1e-4 );
            float tanRay = rw.y / hl;
            vec2 hd = rw.xz / hl;
            float ax = abs( hd.x ) > 0.08 ? hd.x : ( hd.x >= 0.0 ? 0.08 : -0.08 );
            float toWall = ax > 0.0 ? vWall.x - vFlow.x : vWall.x + vFlow.x;
            float dh = max( toWall, 0.15 ) / abs( ax );
            float tanBank = vWall.y / dh;
            float forest = texture2D( tVegW, ( vWPos.xz + hd * ( dh + 9.0 ) ) / uExtentW + 0.5 ).r;
            float tanTrees = forest * 15.0 / ( dh + 12.0 );
            float hz = max( tanBank, tanTrees );
            float skyVis = smoothstep( hz - 0.04, hz + 0.16, tanRay );
            float lit = smoothstep( 0.1, 0.6, hd.x );                   // east wall, facing the low WNW sun
            vec3 bankCol = uFogAmbient * vec3( 0.15, 0.155, 0.13 ) + uFogSun * vec3( 0.11, 0.09, 0.065 ) * lit;
            vec3 treeCol = uFogAmbient * vec3( 0.055, 0.075, 0.05 );
            // the prefiltered environment is brighter than the graded sky dome: match what the eye sees above
            radiance = mix( tanRay < tanBank ? bankCol : treeCol, radiance * 0.62, skyVis );
          }
          #endif`,
        )
        .replace(
          "#include <opaque_fragment>",
          /* glsl */ `{
            // reflection is not attenuated by transparency: grazing views turn into a mirror (not the foam)
            float fres = 0.02 + 0.98 * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 5.0 );
            diffuseColor.a = mix( diffuseColor.a, 1.0, fres * ( 1.0 - foamAmt ) );
          }
          #include <opaque_fragment>`,
        );
    });
    return m;
  }
  update(dt: number) {
    this.uniforms.uTimeW.value += dt;
  }
}
