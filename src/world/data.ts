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
  roads: { id: string; class?: string; access?: "vehicle" | "foot"; passingPlace?: [number, number, number] | null; width: number; surface: string; points: [number, number, number][] }[];
  irrigation?: { links: { source: string; target: string; kind: string; covered: boolean; points: number[][] }[]; supplied: string[]; unresolved: string[] };
  /** Ordered rural legs plus the existing road connecting their endpoints. */
  ruralLoops?: { id: string; roads: string[]; returnVia: string }[];
  hamlets?: { name: string; z: number; halfLength: number }[];
  /** roadside ditches: centre offset from the road axis, inner width, z range, farm-road crossings */
  ditch?: { offset: number; width: number; depth: number; zRange: [number, number]; crossings: number[] };
  /** side streams: the brook [x, bedY, z] down its valley, then a lined channel to the river; water runs [x, waterY, z, halfWidth] */
  streams?: { name: string; z: number; width: number; brook: number[][]; water: number[][][]; covers: { kind: string; x0: number; x1: number }[] }[];
  temple?: { x: number; y: number; z: number; yaw: number; halfWidth: number; halfDepth: number };
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
export type Raster = { width: number; height: number; data: Uint8ClampedArray };

/** The pixels of a world raster (PNG), RGBA, exactly as written. Not through a 2D canvas: a canvas
 *  premultiplies by alpha, and these rasters keep data in their alpha channel (the grass density of the
 *  vegetation mask, the fourth layer of a splat map) - wherever it is 0 the other three channels read
 *  back as 0 (inside every rice field the rice mask read as "no rice"). */
export function loadImageData(path: string): Promise<Raster> {
  // (several systems read the same rasters: decode each once)
  let p = rasters.get(path);
  if (!p) {
    p = fetch(publicUrl(path)).then(async (r) => {
      if (!r.ok) throw Error(`${path}: ${r.status}`);
      return decodePng(await r.arrayBuffer());
    });
    rasters.set(path, p);
  }
  return p;
}
const rasters = new Map<string, Promise<Raster>>();

/** Decode a non-interlaced 8-bit PNG (grey, grey + alpha, RGB or RGBA) to straight RGBA. */
export async function decodePng(buf: ArrayBuffer): Promise<Raster> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let off = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  while (off < u8.length) {
    const len = dv.getUint32(off), name = String.fromCharCode(...u8.subarray(off + 4, off + 8));
    if (name === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = u8[off + 16];
      type = u8[off + 17];
      interlace = u8[off + 20];
    }
    if (name === "IDAT") idat.push(u8.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (depth !== 8 || !ch || interlace) throw Error(`PNG: unsupported format (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const joined = new Uint8Array(idat.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of idat) joined.set(a, p), (p += a.length);
  const raw = new Uint8Array(await new Response(new Blob([joined]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const stride = w * ch;
  const out = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, q = x * ch;
      if (ch >= 3) (out[o] = cur[q]), (out[o + 1] = cur[q + 1]), (out[o + 2] = cur[q + 2]), (out[o + 3] = ch === 4 ? cur[q + 3] : 255);
      else (out[o] = out[o + 1] = out[o + 2] = cur[q]), (out[o + 3] = ch === 2 ? cur[q + 1] : 255);
    }
    [prev, cur] = [cur, prev];
  }
  return { width: w, height: h, data: out };
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
