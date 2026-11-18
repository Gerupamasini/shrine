"""The land beyond the map: the whole catchment of the Kamisawa river, 14 km square.

The map (2.1 km) and the hills right around it were grown by region.py in a 4.8 km square; beyond
that the land used to be noise (ridged ranges) and the river's valley ended against them. Here the
same stream-power erosion grows the land out to 7 km on every side of the map, held to it:

  * the map is fixed ground (its own heights);
  * the river's valley floor is designed on beyond the map: north up the headwater gorge to where
    it forks (2.3 km north of the map's centre), south down a winding gorge to the edge of the sheet;
  * lines of weakness lay out where the larger tributaries run (SEEDS), the uplift where the
    summits stand (HIGHS);
  * everything else is uplifted and worn down by streams (area^m * slope) and soil creep until a
    drainage network has formed: side valleys branching uphill, sharp ridges between them,
    concave stream profiles, and summits where the uplift is strongest (north-west, south-west).

The computation covers a 16.4 km square at `n` cells; its edge, 1.2 km outside the 14 km sheet, is
held at the level of the neighbouring basins, so the divides of the river's own catchment fall
near the sheet's edge and the outermost streams leave it.

build(inp) -> dict with
  far    (FAR_N x FAR_N) heights of the 14 km sheet
  mid    (MID_N x MID_N) heights of the 4.8 km square around the map (inside the map: the map itself)
  cover  (MID_N x MID_N x 3) land cover of the 4.8 km square (R wooded slope, G open valley floor)
  h, area, fixed  the computed square (for drawing the drainage network)
"""
from __future__ import annotations
import hashlib, math, time
from pathlib import Path
import numpy as np
from scipy import ndimage
from scipy.interpolate import PchipInterpolator

from noise import Perlin, fbm, ridged, smoothstep
import region

DOMAIN = 16400.0
FAR_EXTENT, FAR_N = 14000.0, 769          # 18.2 m cells
MID_EXTENT, MID_N = 4800.0, 769           # 6.25 m cells
FAR_MIN, FAR_RANGE = -60.0, 1060.0        # encoding of far-heightmap.png

PARAMS = dict(
    steps=560, k=0.2, m=0.45, uplift=3.8, creep_m=12.0, talus=0.95,
    core=200.0, blend=650.0, edge=400.0,              # the regional model holds this far beyond the map, then fades out
    floor_slope_s=0.0042,                 # the river's floor below the 4.8 km square, falling south
    v=2,
)

# The river's valley beyond the 4.8 km square, (z, x of the middle of the floor): it winds down a
# gorge to the south edge of the sheet; to the north the floor ends where the headwater gorge forks.
TRUNK_S = [(3000, -200), (3500, -420), (4000, -160), (4500, 40), (5000, -150), (5500, -380),
           (6000, -230), (6500, 20), (7000, -260), (7500, -420), (8300, -330)]
TRUNK_HEAD = -2300.0

# Lines of weakness the larger valleys follow, (points (x, z) from the mouth up, half width m, depth m).
# Everything drains to the river: the side valleys of the map run on outwards, long tributaries come
# in from both sides about a kilometre apart, slanting downstream as they join, and above the fork
# the headwaters spread out. (The lines are wiggled with noise when they are laid down.)
FORK = (-320, -2300)
SEEDS = [
    ([(1040, -485), (2200, -850), (3400, -1150), (4700, -1700), (6000, -2200), (8200, -2700)], 240, 75),  # Okusawa, on east
    ([(1040, 232), (2100, 80), (3400, -150), (4700, -450), (6200, -700), (8200, -1000)], 240, 75),        # Miyazawa, on east
    ([(-120, 2500), (1000, 2200), (2300, 1700), (3600, 1300), (5000, 900), (6600, 700), (8200, 500)], 250, 80),
    ([(-150, 3800), (1200, 3500), (2600, 3100), (4000, 2800), (5600, 2600), (8200, 2300)], 250, 80),
    ([(-120, 5300), (1300, 5000), (2800, 4700), (4400, 4600), (6000, 4300), (8200, 4000)], 240, 75),
    ([(-250, 6700), (1500, 6750), (3200, 6450), (5000, 6850), (7000, 7300), (8200, 7600)], 220, 70),
    ([(-1040, -150), (-2000, -500), (-3200, -800), (-4400, -1200), (-5800, -1500), (-8200, -1900)], 250, 80),  # west
    ([(-4400, -1200), (-5000, -2200), (-5600, -3200), (-6500, -4000), (-8200, -4300)], 220, 70),
    ([(-250, 2200), (-1400, 1800), (-2700, 1400), (-4000, 1000), (-5500, 700), (-8200, 300)], 250, 80),
    ([(-200, 3700), (-1500, 3300), (-2900, 2900), (-4400, 2500), (-6000, 2300), (-8200, 2000)], 250, 80),
    ([(-260, 5300), (-1500, 5200), (-2700, 5600), (-3600, 6400), (-4200, 7400), (-4400, 8200)], 220, 75),
    ([FORK, (500, -2700), (1400, -3100), (2600, -3500), (4000, -4000), (5600, -4600), (8200, -5000)], 250, 80),  # NE
    ([(2600, -3500), (3200, -4600), (4100, -5600), (5200, -6600), (6200, -8200)], 220, 70),
    ([FORK, (-250, -3200), (-150, -4100), (0, -5000), (-100, -6000), (-300, -8200)], 240, 75),                 # N
    ([FORK, (-1100, -2800), (-2000, -3300), (-3200, -3700), (-4600, -4200), (-6200, -4600), (-8200, -5000)], 250, 80),  # NW
    ([(-3200, -3700), (-3800, -4800), (-4600, -5800), (-5600, -7000), (-6400, -8200)], 220, 70),
]

# where the uplift is strongest (x, z, gain, radius m): the two summits (NW ~840 m, SW ~790 m) and
# the high ground along the north edge
HIGHS = [(-2750, -6000, 0.52, 1500), (-4950, 4900, 0.82, 1300), (-500, -6900, 0.3, 1800), (1500, 5800, 0.15, 1500)]


def _smooth_line(pts, step=20.0):
    """Densify a polyline through `pts` with a monotone spline along its length."""
    p = np.asarray(pts, float)
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    t = np.arange(0, s[-1] + step * 0.5, step)
    return np.stack([PchipInterpolator(s, p[:, 0])(t), PchipInterpolator(s, p[:, 1])(t)], -1)


def _line_field(shape, xs, zs, line, cell):
    """Distance (m) from every cell to a densified polyline, and the index of its nearest vertex."""
    mask = np.zeros(shape, bool)
    i = np.clip(np.round((line[:, 0] - xs[0]) / cell).astype(int), 0, shape[1] - 1)
    j = np.clip(np.round((line[:, 1] - zs[0]) / cell).astype(int), 0, shape[0] - 1)
    mask[j, i] = True
    d, (jj, ii) = ndimage.distance_transform_edt(~mask, return_indices=True)
    return d * cell, jj, ii


PARAMS_G = dict(near=0.6, ease=0.62)


def region_weight(x, z, half_map, fade=None):
    """1 in the band around the map where the regional model of the hills holds (narrow on the west
    side, where the regional model had a saddle), fading to 0 over `fade` m beyond it (default: out
    to PARAMS["blend"])."""
    box = np.maximum(np.abs(x), np.abs(z)) - half_map
    az = np.degrees(np.arctan2(x, -z)) % 360
    west = smoothstep(250.0, 262.0, az) * (1 - smoothstep(305.0, 317.0, az))
    core = PARAMS["core"] * (1 - west) + 15.0 * west
    end = core + fade if fade is not None else PARAMS["blend"] * (1 - west) + 260.0 * west
    return 1 - smoothstep(core, end, box)


def _erode(h0, fixed, cell, uplift, k, m, steps, creep, talus, log):
    """region.erode, with the creep in cells and the uplift and erodibility as arrays."""
    t0 = time.time()
    h = region.fill_depressions(h0, fixed)
    hold = h.copy()
    up = np.where(fixed, 0.0, uplift)
    kk = k.ravel()
    cell_area = np.full(h.size, cell * cell)
    for it in range(steps):
        h = h + up
        if it % 20 == 19:
            # creep and slope failure leave pits; a pit swallows its water and rises with the uplift,
            # so every so often the land is made to drain again (long valleys, walled edge)
            h = region.fill_depressions(h, fixed, eps=0.002)
        rec, dist = region._receivers(h, fixed, cell)
        area = region._accumulate(rec, cell_area)
        c = kk * area ** m / dist
        h = region._implicit_incision(h.ravel(), rec, c).reshape(h.shape)
        if creep > 0:
            h = ndimage.gaussian_filter(h, creep, mode="nearest")
        lo = ndimage.minimum_filter(h, size=3, mode="nearest")
        h = h - 0.4 * np.maximum(h - lo - talus * cell * 1.2, 0)
        h = np.where(fixed, hold, h)
        if it % 80 == 79:
            log(f"  beyond: step {it + 1}/{steps}  {time.time() - t0:.0f}s  max {h.max():.0f} m")
    h = region.fill_depressions(np.where(fixed, hold, h), fixed, eps=0.002)
    rec, dist = region._receivers(h, fixed, cell)
    area = region._accumulate(rec, cell_area).reshape(h.shape)
    return h, area


def _compute(inp, n, log):
    seed = int(inp["seed"])
    P = [Perlin(seed + 60 + i) for i in range(5)]
    cell = DOMAIN / (n - 1)
    xs = np.linspace(-DOMAIN / 2, DOMAIN / 2, n)
    zs = xs.copy()
    X, Z = np.meshgrid(xs, zs)
    zt = inp["zt"]
    tab = lambda key, z: np.interp(z, zt, inp[key])
    half_map = float(inp["map_extent"]) / 2

    # ---- the river's valley, on beyond the 4.8 km square
    zS = np.array([2400.0] + [p[0] for p in TRUNK_S])
    xS = np.array([float(tab("axis", 2400.0))] + [p[1] for p in TRUNK_S])
    s_pc = PchipInterpolator(zS, xS)

    def axis(z):
        a = tab("axis", z)
        ws = smoothstep(1900.0, 2600.0, z)
        return a * (1 - ws) + s_pc(np.clip(z, zS[0], zS[-1])) * ws

    def half(z):
        hz = tab("half", z)
        return np.where(z > 1500.0, np.interp(z, [1500.0, 2400.0, 3200.0, 5000.0, 9000.0], [float(tab("half", 1500.0)), 120.0, 62.0, 46.0, 42.0]), hz)

    f2400 = float(tab("floor", 2400.0))
    def floor(z):
        return np.where(z > 2400.0, f2400 - PARAMS["floor_slope_s"] * (z - 2400.0), tab("floor", z))

    AX = axis(Z)
    du = np.abs(X - AX)
    in_map = (np.abs(X) < half_map - 0.5 * cell) & (np.abs(Z) < half_map - 0.5 * cell)
    trunk = (Z > TRUNK_HEAD) & (du <= np.maximum(0.62 * half(Z), 1.6 * cell)) & ~in_map
    h_trunk = floor(Z) + 0.015 * du

    # ---- the map: fixed, at its own heights (averaged over a cell)
    mh = inp["map_h"]
    mn = mh.shape[0]
    ms = ndimage.gaussian_filter(mh, max(cell / (2 * half_map / (mn - 1)) / 2.5, 0.01))
    gi = (X / (2 * half_map) + 0.5) * (mn - 1)
    gj = (Z / (2 * half_map) + 0.5) * (mn - 1)
    h_map = ndimage.map_coordinates(ms, [np.clip(gj, 0, mn - 1), np.clip(gi, 0, mn - 1)], order=1)

    # the regional model of the hills (region.py, 4.8 km): it holds for a band around the map, so
    # the ridges and side valleys that cross the map's edge run on unchanged into the new land. West
    # of the map, where the regional model had a low saddle, the new hills take over at once.
    rh = inp["region_h"]
    rn = rh.shape[0]
    rE = float(inp["region_extent"])
    ri = (X / rE + 0.5) * (rn - 1)
    rj = (Z / rE + 0.5) * (rn - 1)
    h_reg = ndimage.map_coordinates(rh, [np.clip(rj, 0, rn - 1), np.clip(ri, 0, rn - 1)], order=1)
    box = np.maximum(np.abs(X), np.abs(Z)) - half_map
    core = (region_weight(X, Z, half_map, fade=1.0) > 0.999) & ~in_map

    # the edge of the computed square: the level of the neighbouring basins beyond the divide (the
    # land drains off it there; walled, the edge grew a high rim with no valleys)
    edge = np.zeros(X.shape, bool)
    edge[:2, :] = edge[-2:, :] = edge[:, :2] = edge[:, -2:] = True
    h_edge = PARAMS["edge"] + 90 * fbm(P[1], X, Z, 3000, 2)

    fixed = in_map | core | trunk | edge
    hfix = np.where(in_map, h_map, np.where(trunk, h_trunk, np.where(edge, h_edge, h_reg)))

    # ---- the starting surface: rising away from the river, and away from the map and the band of
    # the regional model around it from the heights at its rim (so no trough runs round the band, to
    # become a stream along it), lowered along the lines of weakness
    d_fix = ndimage.distance_transform_edt(~(in_map | trunk)) * cell
    d_trunk = ndimage.distance_transform_edt(~trunk) * cell
    held = in_map | core
    d_held, (hj, hi) = ndimage.distance_transform_edt(~held, return_indices=True)
    rim = ndimage.gaussian_filter(hfix[hj, hi], 90.0 / cell)
    rs = np.random.default_rng(seed + 61)
    from_river = floor(np.clip(Z, TRUNK_HEAD, None)) + 0.075 * d_trunk - 0.02 * Z
    from_map = rim + 0.05 * d_held * cell
    base = np.maximum(from_river, from_map) + 50 * fbm(P[0], X, Z, 2600, 4) + 20 * fbm(P[1], X, Z, 700, 3)
    lower = np.zeros(X.shape)
    for pts, hw, depth in SEEDS:
        line = _smooth_line(pts)
        wig = 170 * fbm(P[0], line[:, 0] + 911.0, line[:, 1] - 377.0, 800, 3)
        tan = np.gradient(line, axis=0)
        tan /= np.maximum(np.hypot(tan[:, 0], tan[:, 1]), 1e-6)[:, None]
        line = line + np.stack([-tan[:, 1], tan[:, 0]], -1) * wig[:, None] * smoothstep(150.0, 900.0, np.hypot(line[:, 0] - pts[0][0], line[:, 1] - pts[0][1]))[:, None]
        d_l, _, _ = _line_field(X.shape, xs, zs, line, cell)
        lower = np.maximum(lower, depth * np.exp(-(d_l / hw) ** 2))
    start = base - lower * smoothstep(0.0, 300.0, d_held * cell) + 6 * fbm(P[4], X, Z, 120, 3) + rs.normal(0, 0.05, X.shape)
    h0 = np.where(fixed, hfix, start)

    # ---- uplift: as by the map near the river, easing off far out (where the valleys are long),
    # strongest on the high ground
    g = PARAMS_G["near"] * (1 - PARAMS_G["ease"] * smoothstep(1500.0, 9000.0, d_fix))
    for hx, hz, gain, rad in HIGHS:
        g = g + gain * np.exp(-((X - hx) ** 2 + (Z - hz) ** 2) / rad ** 2)
    g = g * (1 + 0.22 * fbm(P[2], X, Z, 2200, 3)) * (1 - 0.12 * np.clip(Z / 7000.0, -1, 1))
    uplift = PARAMS["uplift"] * np.clip(g, 0.05, None)
    k = PARAMS["k"] * (1 + 0.4 * fbm(P[3], X, Z, 900, 3))

    h, area = _erode(h0, fixed, cell, uplift, k, PARAMS["m"], PARAMS["steps"], PARAMS["creep_m"] / cell,
                     PARAMS["talus"], log)
    floors = trunk.astype(np.uint8)
    return dict(h=h, area=area, fixed=fixed, floors=floors, xs=xs)


def _key(inp, n):
    hsh = hashlib.sha256()
    for k in sorted(inp):
        hsh.update(k.encode())
        hsh.update(np.ascontiguousarray(inp[k]).tobytes())
    hsh.update(repr(sorted(PARAMS.items())).encode())
    hsh.update(str(n).encode())
    hsh.update(Path(__file__).read_bytes())
    hsh.update(Path(region.__file__).read_bytes())
    return hsh.hexdigest()[:16]


def compute(inp, cache_dir: Path, n: int = 1025, log=print):
    f = cache_dir / f"beyond-{n}-{_key(inp, n)}.npz"
    if f.exists():
        log(f"  beyond: cached {f.name}")
        with np.load(f) as z:
            return {k: z[k] for k in z.files}
    out = _compute(inp, n, log)
    cache_dir.mkdir(parents=True, exist_ok=True)
    for old in cache_dir.glob(f"beyond-{n}-*.npz"):
        old.unlink()
    np.savez_compressed(f, **out)
    return out


def _resample(field, extent, x, z, order=3):
    m = field.shape[0]
    return ndimage.map_coordinates(field, [(z / extent + 0.5) * (m - 1), (x / extent + 0.5) * (m - 1)], order=order, mode="nearest")


def build(inp, cache_dir: Path, n: int = 1025, log=print):
    """The far sheet, the 4.8 km square around the map and its land cover (see the module notes)."""
    res = compute(inp, cache_dir, n, log)
    h = res["h"]
    pre = ndimage.spline_filter(h, order=3, mode="nearest")
    samp = lambda x, z: ndimage.map_coordinates(pre, [(z / DOMAIN + 0.5) * (h.shape[0] - 1), (x / DOMAIN + 0.5) * (h.shape[0] - 1)],
                                                order=3, mode="nearest", prefilter=False)
    fa = np.linspace(-FAR_EXTENT / 2, FAR_EXTENT / 2, FAR_N)
    FX, FZ = np.meshgrid(fa, fa)
    far = samp(FX, FZ)

    ma = np.linspace(-MID_EXTENT / 2, MID_EXTENT / 2, MID_N)
    MX, MZ = np.meshgrid(ma, ma)
    mid = samp(MX, MZ)
    # by the map: the regional model itself, at its own 6.25 m (the same grid as this square); the
    # new land was grown against it there, so they meet within a cell or two
    wb = region_weight(MX, MZ, float(inp["map_extent"]) / 2, fade=120.0)
    if inp["region_h"].shape == mid.shape and float(inp["region_extent"]) == MID_EXTENT:
        mid = mid * (1 - wb) + inp["region_h"] * wb
    # inside the map: the map itself, averaged over a mid cell
    mh = inp["map_h"]
    half_map = float(inp["map_extent"]) / 2
    ms = ndimage.gaussian_filter(mh, (MID_EXTENT / (MID_N - 1)) / (2 * half_map / (mh.shape[0] - 1)) / 2.5)
    inside = (np.abs(MX) <= half_map) & (np.abs(MZ) <= half_map)
    w_in = np.clip((half_map - np.maximum(np.abs(MX), np.abs(MZ))) / 12.0, 0, 1)
    mid = mid * (1 - w_in) + _resample(ms, 2 * half_map, MX, MZ, 1) * w_in

    # the river's trench (its low terrace and the scarps either side) runs on out of the map and
    # fades back to the floor of the gorge by the edge of the square (the far mesh cannot hold it)
    zt = inp["zt"]
    rx = np.interp(MZ, zt, inp["river"])
    rfloor = np.interp(MZ, zt, inp["floor"]) - np.interp(MZ, zt, inp["drop"])
    du = np.abs(MX - rx)
    trench = rfloor - 0.6 + np.maximum(du - 16.0, 0.0) * float(inp["scarp"])
    beyond = smoothstep(half_map - 40.0, half_map + 10.0, np.abs(MZ)) * (1 - smoothstep(1900.0, 2350.0, np.abs(MZ)))
    in_trench = (beyond > 0) & (trench < mid)
    mid = np.where(in_trench, mid + (trench - mid) * beyond, mid)

    # land cover: the valley floors beyond the map are open (fields, the bottom of the trench)
    fl = _resample(res["floors"].astype(float), DOMAIN, MX, MZ, 1)
    slope = np.hypot(*np.gradient(mid, MID_EXTENT / (MID_N - 1)))
    open_ = np.clip(smoothstep(0.25, 0.6, fl) * (1 - smoothstep(0.08, 0.2, slope)), 0, 1)
    open_ = np.maximum(open_, (in_trench & (du < 22.0)).astype(float))
    cover = np.stack([1 - open_, open_, np.zeros_like(mid)], -1)
    return dict(far=far, mid=mid, cover=cover, h=h, area=res["area"], fixed=res["fixed"], floors=res["floors"])
