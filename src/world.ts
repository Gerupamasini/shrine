import { publicUrl } from "./urls";
import * as THREE from "three";
export type Placement = {
  id: string;
  asset: string;
  position: number[];
  rotation: number[];
  scale: number[];
  collider?: { type: string; radius?: number; halfExtents?: number[] };
};
export type WorldData = {
  seed: number;
  canopy: (Placement & { color: number[] })[];
  extent: number;
  resolution: number;
  objects: Placement[];
  steps: {
    index: number;
    x: number;
    y: number;
    z: number;
    width: number;
    depth: number;
    rise: number;
  }[];
  fields: { id: string; center: number[]; size: number[] }[];
  landmarks: Record<string, number[]>;
  budgets: Record<string, any>;
};
export class Terrain {
  constructor(
    public samples: Uint16Array,
    public resolution = 513,
    public extent = 1200,
  ) {}
  sample(x: number, z: number) {
    const n = this.resolution;
    const fx = THREE.MathUtils.clamp(
        (x / this.extent + 0.5) * (n - 1),
        0,
        n - 1.001,
      ),
      fz = THREE.MathUtils.clamp(
        (z / this.extent + 0.5) * (n - 1),
        0,
        n - 1.001,
      );
    const ix = Math.floor(fx),
      iz = Math.floor(fz),
      a = fx - ix,
      b = fz - iz;
    const h = (i: number, j: number) =>
      (this.samples[j * n + i] / 65535) * 256 - 8;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(h(ix, iz), h(ix + 1, iz), a),
      THREE.MathUtils.lerp(h(ix, iz + 1), h(ix + 1, iz + 1), a),
      b,
    );
  }
  geometry() {
    // Keep the 16-bit source spacing around farms and the narrow river. Coarse
    // samples outside the basin share the same vertices, so there are no LOD cracks.
    const axis = (lo: number, hi: number) => {
      const a: number[] = [];
      for (let i = 0; i <= 512; i++) {
        const v = (i / 512 - 0.5) * this.extent;
        if (i % 2 === 0 || (v >= lo && v <= hi)) a.push(v);
      }
      return a;
    };
    const xs = axis(-210, 210),
      zs = axis(-165, 370),
      positions: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    for (const z of zs)
      for (const x of xs) {
        positions.push(x, 0, z);
        uv.push(x / this.extent + 0.5, 0.5 - z / this.extent);
      }
    for (let j = 0; j < zs.length - 1; j++)
      for (let i = 0; i < xs.length - 1; i++) {
        const a = j * xs.length + i;
        indices.push(
          a,
          a + xs.length,
          a + 1,
          a + 1,
          a + xs.length,
          a + xs.length + 1,
        );
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i),
        h = this.sample(x, z);
      p.setY(i, h);
      const noise =
        (Math.sin(x * 0.29 + z * 0.12) + Math.sin(x * 0.067 - z * 0.075)) *
        0.025;
      c.setRGB(0.67 + noise, 0.73 + noise, 0.47 + noise);
      if (h > 15) c.lerp(new THREE.Color("#92a271"), 0.45);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }
}
export function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export async function loadWorld() {
  const [data, buffer, canopy] = await Promise.all([
    fetch(publicUrl("world/scene.json")).then((r) => {
      if (!r.ok) throw Error("scene.json");
      return r.json() as Promise<WorldData>;
    }),
    fetch(publicUrl("world/heightmap.r16")).then((r) => {
      if (!r.ok) throw Error("heightmap");
      return r.arrayBuffer();
    }),
    fetch(publicUrl("world/canopy.json")).then((r) => {
      if (!r.ok) throw Error("canopy.json");
      return r.json();
    }),
  ]);
  data.canopy = canopy.entries;
  return {
    data,
    terrain: new Terrain(new Uint16Array(buffer), data.resolution, data.extent),
  };
}
