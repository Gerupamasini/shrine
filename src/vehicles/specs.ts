import designs from "../../tools/vehicles/source/designs.json";

/** One dimensional source for the authored mesh, wheels, collider and driving view. */
export const vehicleSpecs = new Map(designs.map((d) => [d.id, {
  id: d.id, label: d.label.split(" / ")[0], width: d.w, length: d.l, height: d.h,
  wheelbase: d.wheelbase, frontAxle: d.frontAxle, radius: d.r,
  track: d.track ?? d.w - d.tire * 1.1, mass: d.kei ? 800 : 1600,
  centerHeight: d.kei ? .60 : .68, suspension: .24,
  eye: [-d.w * .23, d.id === "kei-truck" ? 1.30 : d.h - .25, d.id === "kei-truck" ? .77 : .35] as const,
}]));
export type VehicleSpec = NonNullable<ReturnType<typeof vehicleSpecs.get>>;
export const isVehicle = (asset: string) => vehicleSpecs.has(asset);
