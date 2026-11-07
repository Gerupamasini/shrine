// Decimate cached Poly Haven glTF models into runtime GLBs.
// node tools/assets/process_models.mjs
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, dedup, prune, textureCompress, join, flatten, getBounds } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { bleed } from "./bleed.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/assets/sources.json"), "utf8"));
const OUT = path.join(ROOT, "public/assets/models/props");
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

function triangles(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  return n;
}

const only = process.argv[2];
const SPLIT = new Set(["fern_02", "shrub_02", "shrub_03", "shrub_04", "weed_plant_02", "nettle_plant", "rock_moss_set_01", "rock_moss_set_02"]);
const report = {};
// low-poly copies of a few photographed plants for vegetable rows on the hatake (crop-*.glb)
const CROPS = [
  { id: "nettle_plant", out: "crop-leafy", targetTris: 2000, error: 0.12 },
  { id: "weed_plant_02", out: "crop-low", targetTris: 1500, error: 0.12 },
  { id: "shrub_03", out: "crop-bush", targetTris: 1600, error: 0.12 },
];
for (const m of [...SRC.polyhaven.models, ...CROPS]) {
  if (only && m.id !== only) continue;
  const dir = path.join(ROOT, ".cache/polyhaven/models", m.id);
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".gltf"));
  const doc = await io.read(path.join(dir, file));
  const before = triangles(doc);
  // merge Poly Haven's separate alpha masks into the base colour (glTF alpha lives in baseColor.a)
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getAlphaMode() === "OPAQUE") continue;
    const tex = mat.getBaseColorTexture();
    if (!tex) continue;
    const uri = tex.getURI();
    const alphaFile = fs.readdirSync(path.join(dir, "textures")).find((f) => /alpha_1k\.png$/i.test(f) && f.startsWith(uri.split("/").pop().replace(/_diff_1k\.(jpg|png)$/, "_")));
    if (!alphaFile) { console.warn("no alpha for", m.id, uri); continue; }
    const rgb = sharp(await sharp(Buffer.from(tex.getImage())).toColourspace("srgb").removeAlpha().raw().toBuffer(), { raw: { width: (await sharp(Buffer.from(tex.getImage())).metadata()).width, height: (await sharp(Buffer.from(tex.getImage())).metadata()).height, channels: 3 } });
    const alpha = await sharp(path.join(dir, "textures", alphaFile)).greyscale().resize(1024, 1024).raw().toBuffer();
    // keep a true RGBA PNG at runtime size: palette quantisation drops the alpha channel
    const full = await rgb.resize(1024, 1024).joinChannel(alpha, { raw: { width: 1024, height: 1024, channels: 1 } }).png().toBuffer();
    const small = await sharp(full).resize(512, 512).raw().toBuffer();
    bleed(small, 512, 512);
    const png = await sharp(small, { raw: { width: 512, height: 512, channels: 4 } }).png({ palette: false, compressionLevel: 9 }).toBuffer();
    tex.setImage(new Uint8Array(png)).setMimeType("image/png").setURI(uri.replace(/\.jpg$/, ".png"));
    mat.setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true);
  }
  // multi-plant sheets (Poly Haven ships 4-6 specimens side by side): keep each plant as its own
  // node "plant_<i>", recentred on its base, so the runtime places one specimen per instance
  const split = SPLIT.has(m.id);
  if (split) {
    await doc.transform(weld({ tolerance: 0.0001 }), flatten());
    let i = 0;
    for (const n of doc.getRoot().listScenes()[0].listChildren()) {
      if (!n.getMesh()) continue;
      const b = getBounds(n);
      const t = n.getTranslation();
      // plants stand on their base; rocks keep their original burial depth
      const y = m.id.startsWith("rock_") ? t[1] : t[1] - b.min[1];
      n.setTranslation([t[0] - (b.min[0] + b.max[0]) / 2, y, t[2] - (b.min[2] + b.max[2]) / 2]);
      n.setName(`plant_${i++}`);
    }
  } else await doc.transform(weld({ tolerance: 0.0001 }), flatten(), join());
  const ratio = Math.min(1, m.targetTris / before);
  if (ratio < 1)
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: m.error ?? 0.01, lockBorder: false }));
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, resize: [512, 512], quality: 86, formats: /jpeg/ }),
  );
  for (const mat of doc.getRoot().listMaterials()) mat.setName(`ph_${m.out ?? m.id}_${mat.getName()}`);
  const after = triangles(doc);
  const outName = m.out ?? m.id;
  await io.write(path.join(OUT, `${outName}.glb`), doc);
  report[outName] = { source: m.id, before: Math.round(before), after: Math.round(after), bytes: fs.statSync(path.join(OUT, `${outName}.glb`)).size };
  console.log(outName, report[outName]);
}
fs.writeFileSync(path.join(ROOT, "docs/prop-decimation.json"), JSON.stringify(report, null, 1));
