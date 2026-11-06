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
    const n = 257,
      g = new THREE.PlaneGeometry(this.extent, this.extent, n - 1, n - 1);
    g.rotateX(-Math.PI / 2);
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
      c.setRGB(0.8 + noise, 0.84 + noise, 0.65 + noise);
      if (h > 55) c.lerp(new THREE.Color("#3a5042"), 0.55);
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
  const [data, buffer] = await Promise.all([
    fetch(publicUrl("world/scene.json")).then((r) => {
      if (!r.ok) throw Error("scene.json");
      return r.json() as Promise<WorldData>;
    }),
    fetch(publicUrl("world/heightmap.r16")).then((r) => {
      if (!r.ok) throw Error("heightmap");
      return r.arrayBuffer();
    }),
  ]);
  return {
    data,
    terrain: new Terrain(new Uint16Array(buffer), data.resolution, data.extent),
  };
}
