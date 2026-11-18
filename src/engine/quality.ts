/**
 * Quality presets, one table for every system: the render scale is only one of the knobs. Each row
 * sets the load of one part of the frame - shadows, vegetation, terrain and building detail, screen
 * effects - so a setting can be tuned where the time goes, not only by drawing fewer pixels.
 * (docs/PERFORMANCE_BUDGET.md lists them with what each costs.)
 */
export type Quality = "low" | "standard" | "high";

export const QUALITY = {
  low: {
    /** device pixel ratio cap (the adaptive resolution scales below it) */
    pixelRatio: 0.75,
    /** cascades, range (m), map size of the first cascade and of the cached far ones */
    shadow: { cascades: 2, far: 240, near: 1024, farSize: 1024 },
    /** terrain: screen error allowed (px at 1080 lines), distance of the light far-terrain material (m) */
    terrain: { tolerance: 3, farMaterial: 160 },
    /** trees: mesh LOD0 / LOD1 reach (m); billboards thin from `thin` m down to `keep` of them */
    trees: { lod0: 26, lod1: 90, thin: 600, keep: 0.25 },
    /** grass: density, radius scale; rice: reach of the leaf-tip layers (m) */
    grass: { density: 0.45, radius: 0.68, riceLayers: 60 },
    /** props and shrubs: reach scale */
    clutter: 0.55,
    /** houses: near-model reach (m); building surface detail (weathering, relief) reach (m) */
    buildings: { lod: 35, detail: 60 },
    /** MSAA samples; SSAO samples (0 = off); light shafts samples (0 = off); bloom */
    post: { msaa: 0, ssao: 0, rays: 0, bloom: false },
  },
  standard: {
    pixelRatio: 1,
    shadow: { cascades: 3, far: 520, near: 2048, farSize: 2048 },
    terrain: { tolerance: 1.5, farMaterial: 220 },
    trees: { lod0: 45, lod1: 140, thin: 900, keep: 0.4 },
    grass: { density: 0.8, radius: 0.88, riceLayers: 160 },
    clutter: 1,
    buildings: { lod: 60, detail: 110 },
    post: { msaa: 4, ssao: 8, rays: 24, bloom: true },
  },
  high: {
    pixelRatio: 1.5,
    shadow: { cascades: 3, far: 700, near: 4096, farSize: 4096 },
    terrain: { tolerance: 1, farMaterial: 320 },
    trees: { lod0: 70, lod1: 210, thin: 1200, keep: 0.5 },
    grass: { density: 1, radius: 1, riceLayers: 220 },
    clutter: 1.4,
    buildings: { lod: 90, detail: 180 },
    post: { msaa: 4, ssao: 12, rays: 40, bloom: true },
  },
} as const satisfies Record<Quality, unknown>;
