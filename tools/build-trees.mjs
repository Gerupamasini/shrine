import * as T from "three";
import { Tree } from "./vendor/ez-tree.mjs";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import fs from "node:fs/promises";
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((v) => {
      this.result = v;
      this.onloadend?.();
    });
  }
};
for (const [name, preset, height] of [
  ["cedar0", "pine_large", 26],
  ["cedar1", "pine_large", 23],
  ["cedar2", "pine_large", 28],
  ["broadleaf", "oak_large", 17],
]) {
  const options = JSON.parse(await fs.readFile(`tools/vendor/${preset}.json`));
  options.seed += name === "cedar1" ? 731 : name === "cedar2" ? 301 : 0;
  if (preset === "pine_large") {
    options.branch.children[0] = 65;
    options.branch.angle[1] = 100;
    options.branch.start[1] = 0.25;
    options.leaves.size = 4.4;
    options.leaves.count = 15;
  } else {
    options.branch.children[0] = 7;
    options.branch.children[1] = 4;
    options.branch.children[2] = 3;
    options.leaves.count = 8;
  }
  const tree = new Tree();
  tree.loadFromJson(options);
  const bounds = new T.Box3().setFromObject(tree);
  const scale = height / (bounds.max.y - bounds.min.y);
  const details = [
    {},
    { sectionStride: 3, segmentFactor: 0.5, leafStride: 3, leafScale: 1.5 },
    {
      sectionStride: 6,
      segmentFactor: 0.25,
      leafStride: 10,
      leafScale: 2.7,
      billboard: "single",
    },
  ];
  for (let i = 0; i < 3; i++) {
    if (i > 0 && name !== "cedar0" && name !== "broadleaf") continue;
    const geos = tree.createGeometry(details[i]);
    const g = new T.Group();
    for (const [part, geo] of Object.entries(geos)) {
      geo.scale(scale, scale, scale);
      const mat = new T.MeshStandardMaterial({
        name:
          part === "branches"
            ? "photobark"
            : name === "broadleaf"
              ? "oak-leaves"
              : "pine-leaves",
        color: 0xffffff,
        roughness: 1,
        side: part === "leaves" ? T.DoubleSide : T.FrontSide,
      });
      g.add(new T.Mesh(geo, mat));
    }
    const file =
      i === 0
        ? name
        : (name === "broadleaf" ? "broadleaf" : "cedar") +
          (i === 1 ? "-low" : "-far");
    const buffer = await new GLTFExporter().parseAsync(g, { binary: true });
    await fs.writeFile(`public/assets/models/${file}.glb`, Buffer.from(buffer));
    console.log(file, Math.round(buffer.byteLength / 1024), "KiB");
  }
}
