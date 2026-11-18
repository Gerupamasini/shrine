import { irrigationWorks } from './irrigation';
import type { Landscape } from "./landscape";
import { Vegetation } from "./vegetation";
import { Architecture } from "./architecture";
import { Clutter } from "./clutter";
import { GrassField, RiceCanopy, WorldTextures } from "./grass";
import { River } from "./water";
import { FarTerrain } from "./far";
import { Understory, crops } from "./understory";
import { Smoke } from "./smoke";
import { Signs } from "./signs";
import { Dragonflies } from "./insects";
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
  const smoke = new Smoke();
  const signs = new Signs();
  await Promise.all([
    smoke.load(land),
    signs.load(land),
    veg.load((p) => progress(0.3 + p * 0.3, "木立を育てています")),
    arch.load((p) => progress(0.6 + p * 0.2, "社と家並みを建てています")),
    clutter.load(),
    wt.load(),
    far.load(),
    under.load(land),
  ]);
  land.add(veg);
  land.add(under);                  // (keeps the shrub and crop card tiles near the camera)
  // forest on the ranges beyond the map: billboards out to ~2.6 km (1.8 km at low quality)
  {
    const low = land.quality === "low";
    const { sites, kinds } = far.treeSites(low ? 1800 : 2600, low ? 13 : 9.5);
    veg.addFarForest(sites, kinds);
  }
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
  // by distance: photographed clumps at the walker's feet, then blades (four, three segments each),
  // then sparser, simpler blades (three of two segments, a little wider) out to 42 m; beyond it the
  // ground's own grass texture. Each field is placed in tiles around the camera, only where it grows.
  geos.forEach((geometry, i) =>
    land.add(new GrassField(land, wt, { rice: false, spacing: 0.85, radius: 16, blades: 0, seed: i * 7.3, tile: 12, clump: { geometry, map, height: 0.3, scale: 2.2 } })),
  );
  land.add(new GrassField(land, wt, { rice: false, spacing: 0.4, radius: 27, inner: 11, blades: 4, segs: 3, tile: 16 }));
  land.add(new GrassField(land, wt, { rice: false, spacing: 0.52, radius: 42, inner: 24, blades: 3, segs: 2, width: 1.5, tile: 20, seed: 5.7, name: "grass-far" }));
  // rice hills: the photographed grass clump scaled to rice height (rice is a grass), in rows
  // (hills 30 cm apart, about a metre tall by early August, the canopy closed between the rows; only
  // as far as the canopy sheet fades in, about 10 m - beyond it they were hidden under the sheet)
  land.add(new GrassField(land, wt, { rice: true, spacing: 0.3, radius: 11.5, blades: 0, seed: 3.1, tile: 12, clump: { geometry: geos[0], map, height: 0.32, scale: 3.25 } }));
  land.add(new RiceCanopy(land, wt));
  land.add(new River(land, wt));
  land.add(smoke);
  land.add(new Dragonflies(land, wt, () => land.lighting.elevation));
  crops(land);
  irrigationWorks(land);
}
