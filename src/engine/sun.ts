import * as T from "three";

/** NOAA solar position approximation. Returns azimuth (deg, from north, clockwise) and elevation (deg). */
export function solarPosition(date: string, hours: number, lat: number, lon: number, tz: number) {
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(y, 0, 1);
  const day = Math.floor((Date.UTC(y, m - 1, d) - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (hours - 12) / 24);
  const eqt =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hours * 60 + eqt + 4 * lon - 60 * tz;
  const ha = T.MathUtils.degToRad(tst / 4 - 180);
  const phi = T.MathUtils.degToRad(lat);
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(T.MathUtils.clamp(cosZ, -1, 1));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  let el = 90 - T.MathUtils.radToDeg(zen);
  // Standard atmospheric refraction near the horizon (Bennett), visual only.
  if (el > -1) el += 1.02 / Math.tan(T.MathUtils.degToRad(el + 10.3 / (el + 5.11))) / 60;
  return { azimuth: (T.MathUtils.radToDeg(az) + 360) % 360, elevation: el };
}

/** World direction towards the sun. World: +X east, +Y up, +Z south. */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out = new T.Vector3()) {
  const az = T.MathUtils.degToRad(azimuthDeg),
    el = T.MathUtils.degToRad(elevationDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Direct sunlight colour/intensity after atmospheric extinction (Kasten-Young air mass). */
export function sunlight(elevationDeg: number) {
  const el = Math.max(elevationDeg, -2);
  const airmass = 1 / (Math.sin(T.MathUtils.degToRad(Math.max(el, 0.0) + 0.0001)) + 0.50572 * Math.pow(Math.max(el, 0) + 6.07995, -1.6364));
  // Optical depths for a humid summer valley (Rayleigh + aerosol), per RGB (linear sRGB
  // primaries). At 18:00 (6.7°, air mass ~8) the beam comes out near 2900 K, linear
  // (1, 0.57, 0.24); the earlier values gave a pale 4000 K that never read as evening sun.
  const tau = [0.11, 0.18, 0.29];
  const c = tau.map((t) => Math.exp(-t * airmass));
  const horizonFade = T.MathUtils.smoothstep(el, -1.5, 2.5);
  const max = Math.max(...c);
  return {
    color: new T.Color(c[0] / max, c[1] / max, c[2] / max),
    intensity: max * horizonFade,
    airmass,
  };
}
