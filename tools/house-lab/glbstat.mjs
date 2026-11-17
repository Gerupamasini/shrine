import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const out = {};
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const n = (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
    const k = p.getMaterial()?.getName();
    out[k] = (out[k] ?? 0) + n; total += n;
    if (process.env.MAT && k === process.env.MAT) {
      const pos = p.getAttribute("POSITION"), idx = p.getIndices();
      const pts = []; for (let i = 0; i < Math.min(12, idx.getCount()); i++) pts.push(pos.getElement(idx.getScalar(i), []).map((v) => +v.toFixed(2)));
      console.log(k, JSON.stringify(pts));
    }
  }
  console.log(f.split("/").pop(), total, JSON.stringify(out));
}
