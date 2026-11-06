import type { Landscape } from "./landscape";
import { Vegetation } from "./vegetation";
import { Architecture } from "./architecture";
import { Clutter } from "./clutter";
import { GrassField, RiceCanopy, WorldTextures } from "./grass";
import { River } from "./water";
import { FarTerrain } from "./far";

/** Adds every scene system to the landscape (vegetation, architecture, water ...). */
export async function populate(land: Landscape, progress: (p: number, label: string) => void) {
  const veg = new Vegetation(land, land.world.trees);
  const arch = new Architecture(land);
  const clutter = new Clutter(land, land.world.clutter);
  const wt = new WorldTextures(land);
  const far = new FarTerrain(land);
  await Promise.all([
    veg.load((p) => progress(0.3 + p * 0.3, "木立を育てています")),
    arch.load((p) => progress(0.6 + p * 0.2, "社と家並みを建てています")),
    clutter.load(),
    wt.load(),
    far.load(),
  ]);
  land.add(veg);
  land.add(arch);
  land.add(clutter);
  land.add(new GrassField(land, wt, { rice: false, spacing: 0.34, radius: 40, blades: 4 }));
  land.add(new GrassField(land, wt, { rice: true, spacing: 0.3, radius: 22, blades: 7 }));
  land.add(new RiceCanopy(land, wt));
  land.add(new River(land));
}
