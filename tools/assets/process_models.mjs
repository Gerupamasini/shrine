// Decimate cached Poly Haven glTF models into runtime GLBs.
// node tools/assets/process_models.mjs
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, dedup, prune, textureCompress, join, flatten } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

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
const report = {};
for (const m of SRC.polyhaven.models) {
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
    const rgb = sharp(Buffer.from(tex.getImage())).removeAlpha();
    const alpha = await sharp(path.join(dir, "textures", alphaFile)).greyscale().resize(1024, 1024).raw().toBuffer();
    const png = await rgb.resize(1024, 1024).joinChannel(alpha, { raw: { width: 1024, height: 1024, channels: 1 } }).png().toBuffer();
    tex.setImage(new Uint8Array(png)).setMimeType("image/png").setURI(uri.replace(/\.jpg$/, ".png"));
    mat.setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true);
  }
  await doc.transform(weld({ tolerance: 0.0001 }), flatten(), join());
  const ratio = Math.min(1, m.targetTris / before);
  if (ratio < 1)
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: m.id === "boulder_01" ? 0.05 : 0.01, lockBorder: false }));
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, resize: [512, 512], quality: 86 }),
  );
  for (const mat of doc.getRoot().listMaterials()) mat.setName(`ph_${m.id}_${mat.getName()}`);
  const after = triangles(doc);
  await io.write(path.join(OUT, `${m.id}.glb`), doc);
  report[m.id] = { before: Math.round(before), after: Math.round(after), bytes: fs.statSync(path.join(OUT, `${m.id}.glb`)).size };
  console.log(m.id, report[m.id]);
}
fs.writeFileSync(path.join(ROOT, "docs/prop-decimation.json"), JSON.stringify(report, null, 1));
