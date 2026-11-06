// Portable distant vegetation placements, matching the renderer's deterministic sampler.
import fs from "node:fs/promises";
import * as T from "three";
const raw = await fs.readFile("public/world/heightmap.r16");
const height = (x, z) => {
  const fx = (x / 1200 + 0.5) * 512,
    fz = (z / 1200 + 0.5) * 512,
    ix = Math.floor(fx),
    iz = Math.floor(fz),
    a = fx - ix,
    b = fz - iz;
  const h = (i, j) => (raw.readUInt16LE((j * 513 + i) * 2) / 65535) * 256 - 8;
  return (
    (h(ix, iz) * (1 - a) + h(ix + 1, iz) * a) * (1 - b) +
    (h(ix, iz + 1) * (1 - a) + h(ix + 1, iz + 1) * a) * b
  );
};
let seed = 1876;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const entries = [];
for (const species of ["broadleaf", "cedar0"]) {
  let count = 0;
  for (let i = 0; i < 35000 && count < 5500; i++) {
    const x = (random() - 0.5) * 1180,
      z = (random() - 0.5) * 1180,
      y = height(x, z);
    if (y < 14 || Math.hypot(x, z + 120) < 205) continue;
    const size =
        species === "broadleaf" ? 18 + random() * 10 : 21 + random() * 10,
      rotation = random() * 6.28,
      scale = [size * (0.8 + random() * 0.3), size, size],
      color = new T.Color().setHSL(
        0.2 + random() * 0.035,
        0.08 + random() * 0.1,
        0.66 + random() * 0.16,
      );
    entries.push({
      asset: species,
      position: [x, y - 1, z],
      rotation: [0, rotation, 0],
      scale,
      color: color.toArray(),
    });
    count++;
  }
}
await fs.writeFile(
  "public/world/canopy.json",
  JSON.stringify(
    {
      seed: 1876,
      units: "meters",
      up: "Y",
      representation:
        "three crossed alpha-clipped impostor planes; source GLBs supplied",
      entries,
    },
    (_, v) => (typeof v === "number" ? +v.toFixed(5) : v),
  ),
);
console.log("Exported", entries.length, "distant canopy placements");
