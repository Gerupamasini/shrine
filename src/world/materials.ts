import * as T from "three";
import type { PbrDef } from "../engine/library";
import table from "../../public/world/materials.json";

type Def = PbrDef & { emissive?: string; emissiveIntensity?: number; doubleSided?: boolean };

/**
 * Material name (as written into the GLBs by tools/architecture) -> photographic PBR set.
 * Source of truth: public/world/materials.json (also used for the Unity port).
 */
export const MATERIALS: Record<string, Def> = Object.fromEntries(
  Object.entries(table.architecture as Record<string, Def>).map(([k, v]) => [k, { ...v, side: v.doubleSided ? T.DoubleSide : T.FrontSide }]),
);
