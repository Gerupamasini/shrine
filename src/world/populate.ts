import type { Landscape } from "./landscape";
import { Vegetation } from "./vegetation";
import { Architecture } from "./architecture";
import { Clutter } from "./clutter";
import { GrassField, RiceCanopy, WorldTextures } from "./grass";
import { River } from "./water";
import { FarTerrain } from "./far";
import { Understory, crops } from "./understory";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../urls";

/** Adds every scene system to the landscape (vegetation, architecture, water ...). */
export async function populate(land: Landscape, progress: (p: number, label: string) => void) {
  const veg = new Vegetation(land, land.world.trees);
  const arch = new Architecture(land);
  const clutter = new Clutter(land, land.world.clutter);
  const wt = new WorldTextures(land);
  const far = new FarTerrain(land);
  const under = new Understory();
  await Promise.all([
    veg.load((p) => progress(0.3 + p * 0.3, "木立を育てています")),
    arch.load((p) => progress(0.6 + p * 0.2, "社と家並みを建てています")),
    clutter.load(),
    wt.load(),
    far.load(),
    under.load(land),
  ]);
  land.add(veg);
  land.add(arch);
  land.add(clutter);
  // near: photographed grass clumps (Poly Haven grass_medium_01); beyond: procedural blades
  const clumps = await new GLTFLoader().loadAsync(publicUrl("assets/foliage/grass-clumps.glb"));
  const map = land.lib.texture("assets/foliage/grass-clump-albedo.png", true, false);
  map.flipY = false;
  clumps.scene.updateMatrixWorld(true);
  const geos: T.BufferGeometry[] = [];
  clumps.scene.traverse((o) => {
    if (o instanceof T.Mesh) geos.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  geos.forEach((geometry, i) =>
    land.add(new GrassField(land, wt, { rice: false, spacing: 0.85, radius: 20, blades: 0, seed: i * 7.3, clump: { geometry, map, height: 0.3, scale: 2.2 } })),
  );
  land.add(new GrassField(land, wt, { rice: false, spacing: 0.4, radius: 42, inner: 14, blades: 4 }));
  // rice hills: the photographed grass clump scaled to rice height (rice is a grass), in rows
  land.add(new GrassField(land, wt, { rice: true, spacing: 0.36, radius: 14, blades: 0, seed: 3.1, clump: { geometry: geos[0], map, height: 0.32, scale: 2.9 } }));
  land.add(new RiceCanopy(land, wt));
  land.add(new River(land, wt));
  crops(land);
}
