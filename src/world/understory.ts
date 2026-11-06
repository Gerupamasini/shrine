import * as T from "three";
import { addHook } from "../engine/hooks";
import { loadImageData, type Heightfield } from "./data";
import type { Landscape, System } from "./landscape";
import { windUniforms } from "./vegetation";

/**
 * Understory: young conifers and broadleaf shrubs (crossed photo cards) filling the
 * forest floor between the trunks, so hillsides read as layered woodland instead of
 * bare sunlit ground. Placement is generated from the forest-density mask with a
 * fixed seed (reproducible); each plant is 4 triangles.
 * (Unity: Terrain Detail / tree prototypes from the same atlases.)
 */
export class Understory implements System {
  meshes: T.InstancedMesh[] = [];
  update() {}
  async load(land: Landscape) {
    const [veg, s0, s1] = await Promise.all([loadImageData("world/vegetation-mask.png"), loadImageData("world/splat0.png"), loadImageData("world/splat1.png")]);
    const h: Heightfield = land.world.height;
    const E = land.world.data.extent, n = veg.width;
    const st = land.world.data.stair, pr = land.world.data.precinct;
    let seed = 20260807;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const rows: { x: number; y: number; z: number; s: number; yaw: number; cell: number; leaf: boolean; tint: number }[] = [];
    const px = (x: number, z: number) => {
      const i = Math.round((x / E + 0.5) * (n - 1)), j = Math.round((z / E + 0.5) * (n - 1));
      return (j * n + i) * 4;
    };
    const step = 2.4;
    for (let z = -E / 2 + 4; z < E / 2 - 4; z += step)
      for (let x = -E / 2 + 4; x < E / 2 - 4; x += step) {
        const xx = x + (rnd() - 0.5) * step, zz = z + (rnd() - 0.5) * step;
        const k = px(xx, zz);
        const forest = veg.data[k] / 255;
        if (rnd() > Math.min(1, forest * 1.1)) continue;
        const bare = (s0.data[k + 2] + s1.data[k] + s1.data[k + 1] + s1.data[k + 2] + s1.data[k + 3]) / 255;
        if (bare > 0.25) continue;
        if (xx > st.x0 - 4 && xx < st.x1 + 2 && Math.abs(zz - st.z) < st.width / 2 + 1.2) continue;
        if (xx > pr.x0 && xx < pr.x1 - 6 && zz > pr.z0 + 8 && zz < pr.z1 - 3) continue;
        // keep paths, the road and the lookout's view cone open
        const lk = land.world.data.landmarks.lookout;
        const ldx = xx - lk[0], ldz = zz - lk[2], ld = Math.hypot(ldx, ldz);
        if (ld < 20) continue;
        if (ld < 220) {
          const az = (Math.atan2(ldx, -ldz) * 180) / Math.PI;
          if (Math.abs(((az - lk[3] + 540) % 360) - 180) < 40) continue;
        }
        const road = land.world.data.roads[0].points;
        const ri = Math.max(0, Math.min(road.length - 1, Math.round((zz - road[0][2]) / 2.5)));
        if (Math.abs(xx - road[ri][0]) < 7) continue;
        // clumped: thickets and gaps rather than an even sprinkle
        const clump = 0.5 + 0.5 * Math.sin(xx * 0.061 + Math.sin(zz * 0.047) * 2.0) * Math.sin(zz * 0.053 + Math.sin(xx * 0.039) * 2.0);
        if (rnd() > 0.25 + clump * 1.1) continue;
        const leaf = rnd() < 0.62;
        rows.push({ x: xx, y: h.sample(xx, zz) - 0.05, z: zz, s: 1.6 + rnd() * 1.8 + rnd() * rnd() * 3.0, yaw: rnd() * Math.PI, cell: leaf ? Math.floor(rnd() * 16) : [12, 14, 12, 14, 13][Math.floor(rnd() * 5)], leaf, tint: rnd() });
      }
    const quad = () => {
      const a = new T.PlaneGeometry(1, 1);
      a.translate(0, 0.5, 0);
      const b = a.clone().rotateY(Math.PI / 2);
      const g = new T.BufferGeometry();
      const merged = [a, b];
      const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
      merged.forEach((q, qi) => {
        const base = pos.length / 3;
        pos.push(...q.attributes.position.array);
        uv.push(...q.attributes.uv.array);
        for (let i = 0; i < q.attributes.position.count; i++) nrm.push(qi ? 1 : 0, 0.6, qi ? 0 : 1);
        idx.push(...Array.from(q.index!.array, (v) => v + base));
      });
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
      g.setAttribute("normal", new T.Float32BufferAttribute(nrm, 3));
      g.setIndex(idx);
      return g;
    };
    for (const leaf of [true, false]) {
      const list = rows.filter((r) => r.leaf === leaf);
      const g = quad();
      const cell = new Float32Array(list.length), tint = new Float32Array(list.length);
      list.forEach((r, i) => ((cell[i] = r.cell), (tint[i] = r.tint)));
      g.setAttribute("aCell", new T.InstancedBufferAttribute(cell, 1));
      g.setAttribute("aTint", new T.InstancedBufferAttribute(tint, 1));
      const atlas = land.lib.texture(`assets/foliage/${leaf ? "leaf" : "needle"}-albedo.png`, true, false);
      atlas.flipY = false;
      const m = new T.MeshStandardMaterial({
        map: atlas,
        color: leaf ? "#a9b48a" : "#8e9c78",
        roughness: 0.85,
        alphaTest: 0.5,
        side: T.DoubleSide,
        alphaToCoverage: true,
      });
      (m as unknown as { defines: Record<string, string> }).defines = { FOLIAGE: "" };
      land.lib.finish(m);
      addHook(m, "understory", (s) => {
        Object.assign(s.uniforms, windUniforms);
        s.vertexShader = s.vertexShader
          .replace("#include <common>", "#include <common>\n attribute float aCell; attribute float aTint; varying vec2 vCellUv; varying float vUTint; uniform float uWindTime;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            vec2 cxy = vec2(mod(aCell, 4.0), floor(aCell / 4.0));
            vCellUv = (cxy + vec2(uv.x, 1.0 - uv.y)) / 4.0;
            vUTint = aTint;
            transformed.x += sin(uWindTime * 1.4 + instanceMatrix[3].x * 0.3) * 0.03 * position.y * position.y;`,
          );
        s.fragmentShader = s.fragmentShader
          .replace("#include <common>", "#include <common>\n varying vec2 vCellUv; varying float vUTint;")
          .replace(
            "#include <map_fragment>",
            "vec4 tc = texture2D(map, vCellUv); diffuseColor *= tc; diffuseColor.rgb *= mix(vec3(0.82, 0.9, 0.8), vec3(1.08, 1.04, 0.9), vUTint);",
          );
      });
      const mesh = new T.InstancedMesh(g, m, list.length);
      const mat = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0);
      list.forEach((r, i) => mesh.setMatrixAt(i, mat.compose(new T.Vector3(r.x, r.y, r.z), q.setFromAxisAngle(up, r.yaw), new T.Vector3(r.s * 0.95, r.s, r.s * 0.95))));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.name = "understory";
      land.scene.add(mesh);
      this.meshes.push(mesh);
    }
    return rows.length;
  }
}
