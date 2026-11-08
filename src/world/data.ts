import * as T from "three";
import { publicUrl } from "../urls";

export type Placement = {
  id: string;
  asset: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  collider?: { type: "box" | "cylinder"; halfExtents?: number[]; radius?: number; height?: number };
  [k: string]: unknown;
};
export type Step = { index: number; x: number; y: number; z: number; width: number; depth: number; rise: number };
export type WorldData = {
  seed: number;
  extent: number;
  resolution: number;
  heightEncoding: { minHeight: number; range: number };
  environment: { date: string; latitude: number; longitude: number; timezone: number; defaultTime: number; timeRange: [number, number] };
  landmarks: Record<string, [number, number, number, number, number]>;
  stair: { z: number; x0: number; x1: number; footY: number; topY: number; rise: number; tread: number; steps: number; flight: number; landing: number; width: number };
  precinct: { x0: number; x1: number; z0: number; z1: number; y: number };
  steps: Step[];
  objects: Placement[];
  fields: { id: string; level: number; bounds: number[]; type: string; tint: number; growth: number }[];
  river: {
    /** water surface rows [x, waterY, z, widthX, fall] (cross-sections along X over the bed) */
    points: number[][];
    /** [xCentre, z, halfWidth, bankTopY, toeYWest, toeYEast, earthWest, earthEast, blockFacing] */
    bed: { points: number[][]; wallRun: number; capWidth: number; pathWidth: number };
    drops: { z: number; kind: string; x: number; halfWidth: number; crestY: number; waterAbove: number; waterBelow: number; apron: number }[];
    intake: { z: number; side: string; sillY: number; waterY: number };
    canal: { points: number[][]; culvert: number[]; depth: number; wallTop: number };
    washSteps: { z: number; side: string; topY: number; toeY: number }[];
    bridgeZ: number;
    bridgeDeckY: number;
  };
  roads: { id: string; class?: string; width: number; surface: string; points: [number, number, number][] }[];
  hamlets?: { name: string; z: number; halfLength: number }[];
  /** roadside ditches: centre offset from the road axis, inner width, z range, farm-road crossings */
  ditch?: { offset: number; width: number; depth: number; zRange: [number, number]; crossings: number[] };
  /** road tunnel portal: face front at (x, y, z), bore heading dx/dz = slope, opening half width and height */
  tunnel?: { x: number; y: number; z: number; slope: number; halfWidth: number; height: number; faceHalfWidth: number; faceTop: number };
  powerLine: { poles: [number, number, number][]; wires: number; sag: number };
  budgets: Record<string, { triangles: number; drawCalls: number; pixelRatio: number }>;
};
export type InstanceRow = [number, number, number, number, number, number, number?];

export class Heightfield {
  constructor(
    public data: Float32Array,
    public n: number,
    public extent: number,
  ) {}
  /** Bilinear height at world x,z. */
  sample(x: number, z: number) {
    const n = this.n;
    const fx = T.MathUtils.clamp((x / this.extent + 0.5) * (n - 1), 0, n - 1.0001);
    const fz = T.MathUtils.clamp((z / this.extent + 0.5) * (n - 1), 0, n - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz), a = fx - ix, b = fz - iz;
    const d = this.data, i = iz * n + ix;
    return (d[i] * (1 - a) + d[i + 1] * a) * (1 - b) + (d[i + n] * (1 - a) + d[i + n + 1] * a) * b;
  }
  cell(i: number, j: number) {
    return this.data[T.MathUtils.clamp(j, 0, this.n - 1) * this.n + T.MathUtils.clamp(i, 0, this.n - 1)];
  }
  get spacing() {
    return this.extent / (this.n - 1);
  }
}

async function json<T>(path: string): Promise<T> {
  const r = await fetch(publicUrl(path));
  if (!r.ok) throw Error(`${path}: ${r.status}`);
  return r.json();
}
export async function loadImageData(path: string): Promise<ImageData> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(Error(path));
    im.src = publicUrl(path);
  });
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

export async function loadWorld() {
  const [data, raw, veg, clutter] = await Promise.all([
    json<WorldData>("world/scene.json"),
    fetch(publicUrl("world/heightmap.r16")).then((r) => {
      if (!r.ok) throw Error("heightmap");
      return r.arrayBuffer();
    }),
    json<{ trees: Record<string, InstanceRow[]> }>("world/vegetation.json"),
    json<{ items: Record<string, InstanceRow[]> }>("world/clutter.json"),
  ]);
  const u16 = new Uint16Array(raw);
  const f = new Float32Array(u16.length);
  const { minHeight, range } = data.heightEncoding;
  for (let i = 0; i < u16.length; i++) f[i] = (u16[i] / 65535) * range + minHeight;
  return { data, height: new Heightfield(f, data.resolution, data.extent), trees: veg.trees, clutter: clutter.items };
}
export type World = Awaited<ReturnType<typeof loadWorld>>;
