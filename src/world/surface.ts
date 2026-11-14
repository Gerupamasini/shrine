import type { WorldData } from './data';
export type Surface = 'asphalt' | 'gravel' | 'grass';
/** Shared road-footprint query for sound and tyres; paved junctions take priority. */
export function surfaceAt(data: WorldData, x: number, z: number): Surface {
  let result: Surface = 'grass';
  for (const road of data.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i-1], b = road.points[i];
      if (x < Math.min(a[0],b[0])-road.width || x > Math.max(a[0],b[0])+road.width || z < Math.min(a[2],b[2])-road.width || z > Math.max(a[2],b[2])+road.width) continue;
      const dx=b[0]-a[0], dz=b[2]-a[2], t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz || 1)));
      if (Math.hypot(x-a[0]-t*dx,z-a[2]-t*dz) <= road.width/2) {
        if (road.surface === 'asphalt') return 'asphalt';
        result='gravel';
      }
    }
  }
  return result;
}
