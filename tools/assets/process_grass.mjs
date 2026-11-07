// Extract photographic grass clumps from Poly Haven grass_medium_01 (CC0) for the GPU grass field.
// Writes public/assets/foliage/grass-clumps.glb (nodes clump_0..2, centred, decimated) and
// grass-clump-albedo.png (base colour + alpha merged).
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { getBounds, simplify, weld, prune, dedup } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { bleed } from "./bleed.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, ".cache/polyhaven/foliage/grass_medium_01");
const io = new NodeIO();
await MeshoptSimplifier.ready;
const doc = await io.read(path.join(DIR, "grass_medium_01_1k.gltf"));
const keep = ["grass_medium_01_tall_a_LOD0", "grass_medium_01_tall_b_LOD0", "grass_medium_01_tall_c_LOD0"];
const root = doc.getRoot();
for (const n of root.listNodes()) {
  if (!keep.includes(n.getName())) {
    n.dispose();
    continue;
  }
  const b = getBounds(n);
  const t = n.getTranslation();
  n.setTranslation([t[0] - (b.min[0] + b.max[0]) / 2, t[1] - b.min[1], t[2] - (b.min[2] + b.max[2]) / 2]);
  n.setName(`clump_${keep.indexOf(n.getName())}`);
}
await doc.transform(prune(), weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio: 0.6, error: 0.004 }), dedup());
// texture: merge colour and alpha; the runtime loads it separately
const diff = path.join(DIR, "textures/grass_medium_01_diff_1k.jpg");
const alpha = path.join(DIR, "textures/grass_medium_01_Alpha_1k.png");
const a = await sharp(alpha).greyscale().resize(1024, 1024).raw().toBuffer();
const rgbRaw = await sharp(diff).removeAlpha().resize(1024, 1024).raw().toBuffer();
const joined = await sharp(rgbRaw, { raw: { width: 1024, height: 1024, channels: 3 } }).joinChannel(a, { raw: { width: 1024, height: 1024, channels: 1 } }).raw().toBuffer();
bleed(joined, 1024, 1024, 32);
await sharp(joined, { raw: { width: 1024, height: 1024, channels: 4 } }).png({ palette: false }).toFile(path.join(ROOT, "public/assets/foliage/grass-clump-albedo.png"));
for (const tex of root.listTextures()) tex.dispose();
for (const m of root.listMaterials()) m.setName("grass_clump").setAlphaMode("MASK").setDoubleSided(true);
await io.write(path.join(ROOT, "public/assets/foliage/grass-clumps.glb"), doc);
for (const n of root.listNodes()) {
  let tris = 0;
  for (const p of n.getMesh()?.listPrimitives() ?? []) tris += p.getIndices().getCount() / 3;
  const b = getBounds(n);
  console.log(n.getName(), tris, b.max[1].toFixed(2));
}
