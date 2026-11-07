// Colour bleed for alpha-tested foliage textures: fills transparent texels with the colour of
// the nearest opaque texels so that mip-maps don't fringe leaves with the black background.
export function bleed(rgba, w, h, passes = 24) {
  const n = w * h;
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) known[i] = rgba[i * 4 + 3] > 127 ? 1 : 0;
  let frontier = known.slice();
  for (let p = 0; p < passes; p++) {
    const next = frontier.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (frontier[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!frontier[j]) continue;
            r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; c++;
          }
        if (c) {
          rgba[i * 4] = r / c; rgba[i * 4 + 1] = g / c; rgba[i * 4 + 2] = b / c;
          next[i] = 1;
        }
      }
    frontier = next;
  }
  return rgba;
}
