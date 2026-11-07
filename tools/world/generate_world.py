"""Engine-independent world source for 夏陰 (Natsukage).

Units: metres. Axes: +X east, +Y up, +Z south (Three.js right-handed; north is -Z).
Everything is deterministic from SEED. Outputs go to public/world/.

Layout (see docs/TERRAIN_DESIGN.md):
  * a N-S mountain valley, floor 2-9 m, gently falling to the south
  * a small river along the west side of the valley floor: a 7-15 m stony bed between
    stone / concrete-block revetments, a 3-6 m low-flow channel between gravel bars,
    drop structures, a weir with an irrigation intake and a canal along the paddies
  * a narrow village road along the east side, houses on raised pads
  * paddies that follow the valley in irregular contour strips with levees
  * an eastern ridge spur carrying the shrine precinct at y = 42 m, reached by a
    200-step stone stair running west -> east (4 flights of 50, 3 landings)
  * a cleared lookout at the precinct's south-west edge facing the village
"""
from __future__ import annotations
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from noise import Perlin, fbm, ridged, smoothstep  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/world"
OUT.mkdir(parents=True, exist_ok=True)

SEED = 19940808
EXTENT = 1200.0
N = 1025
CELL = EXTENT / (N - 1)
H_MIN, H_RANGE = -20.0, 420.0

# ---- Shrine approach constants -------------------------------------------
STAIR_Z = -40.0
STAIR_X0 = 124.0          # front edge of the first riser
FOOT_Y = 7.0
RISE, TREAD, STEPS, FLIGHT, LANDING = 0.175, 0.34, 200, 50, 3.5
STAIR_W = 5.2
TOP_Y = FOOT_Y + STEPS * RISE                      # 42.0
STAIR_X1 = STAIR_X0 + 3 * (FLIGHT * TREAD + LANDING) + FLIGHT * TREAD  # 202.5
PRECINCT = dict(x0=STAIR_X1, x1=270.0, z0=-82.0, z1=-2.0, y=TOP_Y)
LOOKOUT = (205.0, TOP_Y, -4.6)
LOOK_DIR = math.radians(225.0)   # azimuth (deg from north, clockwise): south-west

rng = np.random.default_rng(SEED)

def _np(o):
    if isinstance(o, np.generic):
        return o.item()
    raise TypeError(type(o))

P1, P2, P3, P4, P5 = (Perlin(SEED + i) for i in range(5))

axis = np.linspace(-EXTENT / 2, EXTENT / 2, N)
X, Z = np.meshgrid(axis, axis)   # row = z, col = x


# ---- Large-scale geography --------------------------------------------------
def floor_base(z):
    """Valley floor falls ~0.6% towards the south."""
    return 5.6 - 0.0058 * np.asarray(z)


def valley_axis(z):
    z = np.asarray(z)
    return -70 + 45 * np.sin(z * 0.0042 + 0.4) + 12 * np.sin(z * 0.011)


def valley_half_width(z):
    z = np.asarray(z)
    return 255 + 45 * np.sin(z * 0.0061 + 1.1) + 25 * np.sin(z * 0.017)


def river_x(z):
    z = np.asarray(z)
    return -165 + 32 * np.sin(z * 0.0105 + 0.7) + 14 * np.sin(z * 0.029 + 2.0) + 6 * np.sin(z * 0.071)


def river_width(z):
    """Width of the low-flow water channel inside the bed (3.6-5.6 m)."""
    return 4.6 + 1.0 * np.sin(np.asarray(z) * 0.013 + 0.3)


# ---- River design ----------------------------------------------------------------
# A small valley river of the kind that runs along the foot of the hills in Tohoku farm
# valleys (see docs/TERRAIN_DESIGN.md, "川"): a 7-15 m stony bed between 1.5-2 m stone or
# concrete-block revetments with a concrete cap and a levee path; inside the bed a 3-6 m
# low-flow channel wanders between alternate gravel bars (pool at the outer bend, riffle
# where it crosses over); drop structures every ~100 m; a fixed weir whose pool feeds an
# irrigation intake and a concrete canal along the paddies. Upstream and at the ends the
# banks are plain earth slopes.
WALL_RUN = 0.75          # horizontal run of a 1:0.4 masonry revetment
CAP_W = 1.2              # concrete cap + gravel verge on top of a masonry revetment
PATH_W = 3.0             # levee path beyond the cap
REACH_SLOPE = 0.0015     # water surface slope between drop structures
WEIR_Z, BRIDGE_Z = 92.0, 140.0
POOL_Z0 = WEIR_Z - 135.0  # the weir backs the water up to the previous drop


def bed_half(z):
    z = np.asarray(z, dtype=np.float64)
    b = 6.0 + 0.9 * np.sin(z * 0.0093 + 1.3) + 0.4 * np.sin(z * 0.031)
    return b * (0.62 + 0.38 * smoothstep(-470.0, -380.0, z))


def bank_top(z):
    return floor_base(z) + 0.42


def _band(z, a, b, ramp=8.0):
    return smoothstep(a - ramp, a, z) * (1 - smoothstep(b, b + ramp, z))


def earth_bank(z, east):
    """1 = plain earth slope (dote), 0 = masonry revetment; per bank side."""
    z = np.asarray(z, dtype=np.float64)
    if east:
        return 1 - _band(z, -392.0, 432.0, 14.0)
    return 1 - np.clip(_band(z, -165.0, -48.0) + _band(z, 28.0, 218.0), 0, 1)


def wall_kind(z, east):
    """Revetment facing: 'block' (concrete kenchi blocks, rebuilt with the weir) or 'stone' (mossy dry masonry)."""
    return "block" if 30.0 <= z <= 212.0 else "stone"


_rr = np.random.default_rng(SEED + 31)
DROPS = []
_zz = -455.0
while _zz < 575.0:
    if not (POOL_Z0 - 55.0 < _zz < WEIR_Z + 42.0) and abs(_zz - BRIDGE_Z) > 16.0:
        DROPS.append(round(float(_zz), 1))
    _zz += float(_rr.uniform(82.0, 118.0))
MARKS = sorted(DROPS + [POOL_Z0, WEIR_Z])
_bounds = [-700.0] + MARKS + [700.0]
_reach_a, _reach_pool = [], []
for _r in range(len(_bounds) - 1):
    _a, _b = _bounds[_r], _bounds[_r + 1]
    if _b == WEIR_Z:
        # weir pool: level, 0.22 m below the water above the upstream drop
        _reach_a.append(_reach_a[-1] - REACH_SLOPE * (_a - _bounds[_r - 1]) - 0.22)
        _reach_pool.append(True)
    else:
        _m = 0.5 * (_a + _b)
        _reach_a.append(float(floor_base(_m)) - 1.45 + REACH_SLOPE * (_m - _a))
        _reach_pool.append(False)
_bounds_np, _reach_a_np, _reach_pool_np = np.array(_bounds), np.array(_reach_a), np.array(_reach_pool)


def water_level(z):
    """Water surface height: gently sloping reaches separated by drops (non-increasing downstream)."""
    z = np.asarray(z, dtype=np.float64)
    r = np.clip(np.searchsorted(_bounds_np, z, side="right") - 1, 0, len(_reach_a_np) - 1)
    return _reach_a_np[r] - np.where(_reach_pool_np[r], 0.0, REACH_SLOPE) * (z - _bounds_np[r])


DROP_INFO = []
for _i, _d in enumerate(MARKS):
    up = float(water_level(_d - 1e-3))
    dn = float(water_level(_d + 1e-3))
    assert up - dn > 0.18, (_d, up, dn)
    DROP_INFO.append(dict(z=_d, kind="weir" if _d == WEIR_Z else "drop", up=round(up, 3), down=round(dn, 3)))


def full_width(z):
    """1 where the water spreads from wall to wall: above and below each sill and in the weir pool."""
    z = np.asarray(z, dtype=np.float64)
    f = np.zeros_like(z)
    for d in MARKS:
        f = np.maximum(f, np.where(z <= d, 1 - smoothstep(3.0, 13.0, d - z), 1 - smoothstep(4.0, 11.0, z - d)))
    return np.maximum(f, weir_pool(z))


def weir_pool(z):
    z = np.asarray(z, dtype=np.float64)
    return smoothstep(POOL_Z0 + 6.0, POOL_Z0 + 32.0, z) * (z <= WEIR_Z)


def _phase(z):
    return np.asarray(z, dtype=np.float64) * 0.047 + 0.6


def low_off(z):
    """Lateral offset of the low-flow channel from the bed centre (alternate bars, ~134 m wavelength)."""
    amp = np.clip(bed_half(z) - river_width(z) / 2 - 0.9, 0, None)
    return amp * 0.85 * np.sin(_phase(z)) * (1 - full_width(z))


def chan_half(z):
    """Half-width of the wetted channel; crossings (riffles) are wider and shallower."""
    hw = (river_width(z) / 2 - 0.35) * (1 + 0.22 * (1 - np.abs(np.sin(_phase(z)))))
    fw = full_width(z)
    return hw * (1 - fw) + bed_half(z) * fw


def bed_surface(u, z, x):
    """Bed height at lateral offset u (= x - river_x) for row z."""
    B, WL, fw, pool = bed_half(z), water_level(z), full_width(z), weir_pool(z)
    hw, c = chan_half(z), low_off(z)
    dc = np.abs(u - c)
    dmax = 0.16 + 0.5 * np.abs(np.sin(_phase(z))) ** 1.5
    dmax = dmax * (1 - pool) + (0.45 + 0.6 * smoothstep(POOL_Z0, WEIR_Z, z)) * pool
    chan = WL - 0.04 - dmax * np.clip(1 - (dc / np.maximum(hw, 0.5)) ** 2, 0, 1) + 0.07 * fbm(P3, x, z, 1.3, 2)
    bar = WL - 0.04 + 0.62 * smoothstep(0.0, 4.2, dc - hw) ** 0.85
    bump = 0.13 * fbm(P1, x, z, 3.2, 2) + 0.05 * fbm(P3, x, z, 1.1, 1)
    y = np.where(dc < hw, chan, bar + bump * smoothstep(0.0, 1.2, dc - hw))
    # sills, aprons and scour pools at every drop structure
    for info in DROP_INFO:
        d, up, dn = info["z"], info["up"], info["down"]
        weir = info["kind"] == "weir"
        apron = 5.0 if weir else 3.2
        y = np.where((z > d - 2.5) & (z <= d), np.minimum(y, up - 0.12), y)            # sediment up to the crest
        y = np.where((z > d - 0.7) & (z <= d + 0.35), up - 0.3, y)                       # under the sill block
        y = np.where((z > d + 0.35) & (z <= d + apron), dn - 0.16, y)                    # under the apron slab
        scour = (z > d + apron) & (z < d + apron + 7.0)
        y = np.where(scour, np.minimum(y, dn - 0.12 - 0.3 * np.sin(np.clip((z - d - apron) / 7.0, 0, 1) * np.pi)), y)
    return np.minimum(y, bank_top(z) - 1.0)


def road_x(z):
    z = np.asarray(z)
    return 62 + 22 * np.sin(z * 0.0072 + 0.5) + 6 * np.sin(z * 0.023)


def stair_profile(x):
    """Walking surface height along the stair centre line (ramp through nosings)."""
    x = np.asarray(x, dtype=np.float64)
    d = np.clip(x - STAIR_X0, 0, None)
    per = FLIGHT * TREAD + LANDING
    f = np.minimum(np.floor(d / per), 3)
    within = d - f * per
    steps_in = np.clip(within / TREAD, 0, FLIGHT)
    y = FOOT_Y + (f * FLIGHT + steps_in) * RISE
    return np.where(x < STAIR_X0, FOOT_Y, np.minimum(y, TOP_Y))


def mountains(x, z):
    ax = valley_axis(z)
    w = valley_half_width(z)
    d = np.abs(x - ax)
    rise = smoothstep(w * 0.7, w * 2.3, d)
    warp_x = x + 70 * fbm(P2, x, z, 420, 3)
    warp_z = z + 70 * fbm(P3, x, z, 420, 3)
    r = 0.5 * ridged(P1, warp_x, warp_z, 420, 5, gain=0.42) + 0.5 * (fbm(P4, warp_x, warp_z, 300, 5, gain=0.45) * 0.5 + 0.5)
    m = (55 + 200 * r) * rise ** 1.3 + 10 * fbm(P5, x, z, 70, 3) * rise
    # North end closes into a headwater valley, south opens but stays hilly.
    north = smoothstep(-260, -620, z) * (70 + 120 * ridged(P4, x, z, 260, 4)) * (1 - 0.65 * np.exp(-((x - river_x(z)) / 120) ** 2))
    south = smoothstep(420, 650, z) * 40 * (0.5 + fbm(P4, x, z, 200, 3))
    # Foothills inside the valley margins (terraces, bamboo, orchards).
    foot = smoothstep(w * 0.45, w * 0.85, d) * (5 + 9 * (fbm(P5, x, z, 120, 4) * 0.5 + 0.5))
    out = np.maximum(m + foot, north) + south * (1 - rise)
    return sun_gap(x, z, out)


SUN_ORIGIN = (120.0, -30.0)
SUN_AZ = math.radians(286.0)


def sun_gap(x, z, height):
    """A WNW side valley so the low evening sun (az 277-295 deg) reaches the village."""
    dx, dz = math.sin(SUN_AZ), -math.cos(SUN_AZ)
    rx_, rz_ = x - SUN_ORIGIN[0], z - SUN_ORIGIN[1]
    t = rx_ * dx + rz_ * dz
    p = np.abs(rx_ * dz - rz_ * dx)
    hw = 110 + 0.22 * np.maximum(t, 0)
    allowed = 6 + 0.042 * np.maximum(t, 0) + 18 * smoothstep(0.6, 1.6, p / hw)
    gap = (1 - smoothstep(0.55, 1.45, p / hw)) * smoothstep(120, 320, t)
    return height - np.maximum(height - allowed, 0) * gap


def shrine_spur(x, z):
    """Ridge spur from the eastern mountains to the precinct; flat bench on top."""
    cx, cz = 236.0, -42.0
    e = np.sqrt(((x - cx) / 105) ** 2 + ((z - cz) / 72) ** 2)
    spur = (TOP_Y + 6) * (1 - smoothstep(0.55, 1.55, e)) ** 1.15
    # Ridge line continuing east so the spur grows from the mountains.
    ridge = (TOP_Y + 30) * np.exp(-((z - cz) / 85) ** 2) * smoothstep(190, 420, x)
    return np.maximum(spur, ridge)


# ---- Height field ------------------------------------------------------------
h = floor_base(Z) + 0.35 * fbm(P5, X, Z, 45, 3)
h = h + mountains(X, Z)
h = np.maximum(h, shrine_spur(X, Z) + 3.5 * fbm(P2, X, Z, 50, 4) * smoothstep(0.0, 25.0, shrine_spur(X, Z)))

# Precinct bench, graded apron.
px0, px1, pz0, pz1 = PRECINCT["x0"], PRECINCT["x1"], PRECINCT["z0"], PRECINCT["z1"]
edge = np.maximum.reduce([px0 - X, X - px1, pz0 - Z, Z - pz1])
bench = 1 - smoothstep(0, 14, edge)
h = h * (1 - bench) + TOP_Y * bench
# A shoulder rising behind the precinct and the lookout's falling slope
lk = np.hypot(X - LOOKOUT[0], Z - LOOKOUT[2])
front = (X < px0 + 25) & (Z > -30)
# South-west rim: a 4 m stone retaining wall, then a steep wooded slope down to the hamlet.
rim = np.maximum(px0 - X, Z - pz1)  # outside distance beyond the west or south edge
rim_zone = (Z > -34) & (X < px0 + 30) & (X > px0 - 45) & (Z < pz1 + 45) & (np.maximum(px0 - X, Z - pz1) < 40)
fall = TOP_Y - 4.0 * smoothstep(0.0, 1.2, rim) - np.maximum(rim - 1.2, 0) * 0.62
fall = np.maximum(fall, h - 60 * (1 - smoothstep(25, 40, rim)))
h = np.where(rim_zone & (rim > 0), np.minimum(h, fall), h)

# Stair corridor: the hillside follows the stair, with low banks either side.
dz = np.abs(Z - STAIR_Z)
sy = stair_profile(X)
in_x = smoothstep(STAIR_X0 - 30, STAIR_X0 - 4, X) * (1 - smoothstep(STAIR_X1 + 2, STAIR_X1 + 10, X))
bank = sy + 0.25 + 0.42 * np.maximum(dz - STAIR_W / 2 - 0.5, 0) + 0.012 * np.maximum(dz - 8, 0) ** 2
reach = 1 - smoothstep(18, 60, dz)
target = np.where(dz < STAIR_W / 2 + 0.5, sy - 0.06, np.minimum(np.maximum(h, sy + 0.25), bank))
h = h * (1 - in_x * reach) + target * in_x * reach
# Foot terrace with a short stone-paved forecourt (x 98..124).
fore = (1 - smoothstep(0, 10, np.maximum.reduce([98 - X, X - STAIR_X0, np.abs(Z - STAIR_Z) - 9])))
h = h * (1 - fore) + FOOT_Y * fore

# River corridor (the channel itself is cut after the paddies, see "River channel").
rx = river_x(Z)
rd = np.abs(X - rx)
RB = bed_half(Z)
RIVER_KEEP = RB + WALL_RUN + CAP_W + PATH_W + 3.2     # bed + revetment + levee path + canal

# Road: graded slightly above the floor, cambered.
road = road_x(Z)
road_d = np.abs(X - road)
road_y = floor_base(Z) + 1.05
road_mask = (1 - smoothstep(2.4, 6.0, road_d)) * smoothstep(-560, -520, Z) * (1 - smoothstep(560, 590, Z))
h = h * (1 - road_mask) + road_y * road_mask
# Concrete side ditches (sokko) both sides of the road: a groove for tools/architecture to line.
DITCH_OFF = 2.45
groove = np.exp(-((road_d - DITCH_OFF) / 0.45) ** 2) * smoothstep(-520, -500, Z) * (1 - smoothstep(540, 560, Z))
h = h - 0.42 * groove

# Branch from the road to the stair forecourt (sloped access).
def segment_dist(px, pz, ax_, az_, bx, bz):
    vx, vz = bx - ax_, bz - az_
    t = np.clip(((px - ax_) * vx + (pz - az_) * vz) / (vx * vx + vz * vz), 0, 1)
    return np.hypot(px - (ax_ + vx * t), pz - (az_ + vz * t)), t

road_at_stair = float(road_x(STAIR_Z))
bd, bt = segment_dist(X, Z, road_at_stair, STAIR_Z, 100.0, STAIR_Z)
branch_y = floor_base(STAIR_Z) + 1.05 + (FOOT_Y - floor_base(STAIR_Z) - 1.05) * smoothstep(0.0, 1.0, bt)
bm = 1 - smoothstep(2.6, 6.5, bd)
h = h * (1 - bm) + branch_y * bm

# ---- Houses -----------------------------------------------------------------
houses = []
PRESETS = json.loads((ROOT / "tools/architecture/presets.json").read_text())

def place_houses():
    hamlets = [(-300.0, 7, 1), (-215.0, 10, 1), (-130.0, 8, -1), (-60.0, 11, 1), (25.0, 9, -1), (120.0, 11, 1), (215.0, 9, 1), (300.0, 8, -1)]
    kinds = ["kawara", "thatch", "tin", "kawara", "tin", "kawara", "thatch", "kawara", "kura-house", "tin", "kawara"]
    k = 0
    for hz, count, bias in hamlets:
        tries = 0
        placed = 0
        while placed < count and tries < 900:
            tries += 1
            z = hz + rng.normal(0, 34)
            side = 1 if rng.random() < (0.7 if bias > 0 else 0.35) else -1
            off = rng.uniform(13, 62) if side > 0 else rng.uniform(13, 46)
            x = float(road_x(z) + side * off)
            if abs(z - STAIR_Z) < 20 and x > road_x(z):
                continue
            if 85 < x < 140 and -66 < z < -14:
                continue
            if abs(z - STAIR_Z) < 18 and x > float(road_x(z)) - 4:
                continue
            if any(math.hypot(x - hx["x"], z - hx["z"]) < 22 for hx in houses):
                continue
            if abs(x - float(river_x(z))) < float(bed_half(z)) + 24:
                continue
            kind = kinds[k % len(kinds)]
            k += 1
            yaw = math.atan2(float(road_x(z + 1) - road_x(z - 1)), 2.0)
            # Houses face south or the road, with a little individual skew.
            face = (yaw + (math.pi / 2 if side < 0 else -math.pi / 2)) * 0.55 + rng.normal(0, 0.22)
            variant = int(rng.integers(0, 4))
            pre = PRESETS[{"kawara": "minka-kawara", "thatch": "minka-kayabuki", "tin": "minka-totan", "kura-house": "minka-kura"}[kind]][variant]
            houses.append(dict(x=x, z=z, kind=kind, yaw=face, w=pre["W"], d=pre["D"], side=int(side), variant=variant, wing=pre.get("wing"), storeys=pre["storeys"]))
            placed += 1

place_houses()
pad_level = {}
for i, hs in enumerate(houses):
    x, z = hs["x"], hs["z"]
    local = float(floor_base(z)) + 1.25
    # Pads cut into foothills where the ground is higher.
    m = np.hypot(X - x, Z - z) < 9
    ground = float(np.median(h[m]))
    level = max(local, min(ground, local + 2.6))
    pad_level[i] = level
    hs["y"] = round(level, 3)
    c, s = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    lx = (X - x) * c - (Z - z) * s
    lz = (X - x) * s + (Z - z) * c
    dist = np.maximum(np.abs(lx) - (hs["w"] / 2 + 7), np.abs(lz) - (hs["d"] / 2 + 8))
    wgt = 1 - smoothstep(0, 4, dist)
    h = h * (1 - wgt) + level * wgt

# ---- Paddies ------------------------------------------------------------------
mountain_factor = mountains(X, Z)
slope_ok = mountain_factor < 1.6
house_clear = np.ones_like(h, bool)
for hs in houses:
    house_clear &= np.hypot(X - hs["x"], Z - hs["z"]) > 17
paddy_region = (
    slope_ok & house_clear
    & (rd > RIVER_KEEP)
    & ~((np.abs(Z - BRIDGE_Z) < 3.4) & (X > rx) & (X < road + 3))   # farm road to the bridge
    & (road_d > 7.5)
    & (np.abs(X) < 575) & (Z > -520) & (Z < 575)
    & ~((X > road_at_stair - 6) & (X < STAIR_X0 + 4) & (np.abs(Z - STAIR_Z) < 13))
    & (shrine_spur(X, Z) < 3)
)
# Strip coordinates following the valley: t across the valley, s along it.
t = X - valley_axis(Z) + 9 * fbm(P3, X, Z, 90, 3)
s = Z + 10 * fbm(P4, X, Z, 110, 3)
band_edges = [-700.0]
while band_edges[-1] < 700:
    band_edges.append(band_edges[-1] + rng.uniform(24, 42))
band_edges = np.array(band_edges)
band = np.searchsorted(band_edges, t)
label = np.zeros_like(band)
nb = len(band_edges) + 1
for b in range(nb):
    sel = band == b
    if not sel.any():
        continue
    slant = rng.uniform(-0.35, 0.35)
    centre = band_edges[min(b, len(band_edges) - 1)]
    cuts = [-700.0]
    while cuts[-1] < 700:
        cuts.append(cuts[-1] + rng.uniform(26, 58))
    cuts = np.array(cuts)
    ss = s[sel] + (t[sel] - centre) * slant
    label[sel] = b * 1000 + np.searchsorted(cuts, ss)
label = np.where(paddy_region, label, -1)
ids, counts = np.unique(label[label >= 0], return_counts=True)
small = ids[counts * CELL * CELL < 320]
label[np.isin(label, small)] = -1
fields = []
paddy_level = np.full_like(h, np.nan)
for fid in np.unique(label[label >= 0]):
    m = label == fid
    lvl = float(np.percentile(h[m], 40)) - 0.2
    # cells far above/below the field level are banks, not field
    keep = m & (np.abs(h - lvl) < 1.4)
    label[m & ~keep] = -1
    if keep.sum() * CELL * CELL < 320:
        label[keep] = -1
        continue
    paddy_level[keep] = lvl
idx_fields = {}
field_type = np.zeros(h.shape, np.int8)
for fid in np.unique(label[label >= 0]):
    m = label == fid
    ys, xs = np.nonzero(m)
    idx_fields[int(fid)] = len(fields)
    fields.append(dict(
        id=f"paddy-{len(fields):03}", level=round(float(paddy_level[m][0]), 3),
        bounds=[round(float(axis[xs.min()]), 2), round(float(axis[ys.min()]), 2), round(float(axis[xs.max()]), 2), round(float(axis[ys.max()]), 2)],
        area=round(float(m.sum() * CELL * CELL), 1),
        tint=round(float(rng.uniform(-1, 1)), 3), growth=round(float(rng.uniform(0.85, 1.12)), 3),
    ))
    cx_, cz_ = float(axis[xs].mean()), float(axis[ys].mean())
    near_house = min(math.hypot(cx_ - hs["x"], cz_ - hs["z"]) for hs in houses)
    r_ = rng.random()
    ftype = "rice"
    if near_house < 75 and r_ < 0.35:
        ftype = "hatake"
    elif r_ < 0.07:
        ftype = "fallow"
    fields[-1]["type"] = ftype
    field_type[m] = {"rice": 1, "hatake": 2, "fallow": 3}[ftype]
is_paddy = label >= 0
# Levees (aze): any paddy cell bordering a different label is raised.
lab = label
border = np.zeros_like(is_paddy)
for sh in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
    border |= (np.roll(lab, sh, axis=(0, 1)) != lab)
interior = is_paddy & ~border
aze = is_paddy & border
neighbour_max = paddy_level.copy()
for sh in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
    neighbour_max = np.fmax(neighbour_max, np.roll(paddy_level, sh, axis=(0, 1)))
h = np.where(interior, paddy_level, h)
h = np.where(aze, np.fmax(neighbour_max, paddy_level) + 0.32, h)
# Banks: terrain next to fields is cut/filled to a <= 35 degree slope from the levee top.
from scipy import ndimage
dist_px, (iy, ix) = ndimage.distance_transform_edt(~is_paddy, return_indices=True)
dist_m = dist_px * CELL
near_lvl = paddy_level[iy, ix] + 0.32
bank_zone = (~is_paddy) & (dist_m < 14) & ~np.isnan(near_lvl)
tan35 = 0.7
h = np.where(bank_zone, np.clip(h, near_lvl - 0.05 - dist_m * tan35, near_lvl + dist_m * tan35), h)

# ---- River channel ----------------------------------------------------------------
# Cut after the paddies so the field banks cannot fill it. Cross-section from the bed
# centre outwards: bed (bars + low-flow channel) | revetment (1:0.4 masonry, or a 1:1.6
# earth slope) | concrete cap and verge | levee path | levee slope back to the ground
# (or a 1:0.9 cut where the western hills stand higher than the levee).
WASH_STEPS = [-247.0, 288.0]            # stone steps down the east wall (kawato / araiba)
def river_channel(h):
    u = X - rx
    a = np.abs(u)
    east = u >= 0
    sgn = np.where(east, 1.0, -1.0)
    B, top = RB, bank_top(Z)
    bed = bed_surface(u, Z, X)
    toe = bed_surface(sgn * B, Z, rx + sgn * B)
    # walls end in a wing against the earth bank: a hard switch, matching the river-works mesh
    earth = (np.where(east, earth_bank(Z, True), earth_bank(Z, False)) >= 0.5).astype(np.float64)
    run = WALL_RUN * (1 - earth) + 1.6 * np.maximum(top - toe, 0.3) * earth
    cap = CAP_W * (1 - earth)
    path = np.where(east, PATH_W, 1.2)
    wall_line = toe + np.clip((a - B) / run, 0, 1) * (top - toe)
    # A 1:0.4 wall is steeper than the 1.17 m grid can follow: under a masonry revetment and its
    # cap the ground is sunk out of sight (the river-works mesh is a closed solid over it, and
    # physics adds box colliders along the walls); earth banks are plain terrain.
    hidden = toe - 0.35
    inner = np.where(a < B, np.where(a > B - 0.8, np.minimum(bed, toe + 0.02), bed), wall_line * earth + hidden * (1 - earth))
    o = a - (B + run + cap + path)
    outer = np.where(h <= top, np.maximum(h, top - np.maximum(o, 0) * 0.5), np.minimum(h, top + np.maximum(o, 0) * 0.9))
    sec = np.where(a < B + run, inner, np.where(a < B + run + cap, top * earth + hidden * (1 - earth), np.where(o < 0, top, outer)))
    # washing steps: a 40 degree ramp under the stone steps, through the wall
    for zs in WASH_STEPS:
        ws = east & (np.abs(Z - zs) < 1.0) & (a > B - 0.6) & (a < B + run + cap)
        t_ = np.clip((a - (B - 0.6)) / (run + cap + 0.6), 0, 1)
        sec = np.where(ws, toe - 0.05 + t_ * (top - toe), sec)
    return sec, dict(toe=toe, earth=earth, run=run, cap=cap, path=path)

h, _sec = river_channel(h)

# Farm road (nodo) from the village road to the bridge, raised above the paddies.
BRIDGE_X0 = float(river_x(BRIDGE_Z))
track_x0 = BRIDGE_X0 + float(bed_half(BRIDGE_Z)) + WALL_RUN + CAP_W + PATH_W
track_x1 = float(road_x(BRIDGE_Z)) - 2.0
track_t = np.clip((X - track_x0) / (track_x1 - track_x0), 0, 1)
track_y = float(bank_top(BRIDGE_Z)) + (float(floor_base(BRIDGE_Z)) + 1.05 - float(bank_top(BRIDGE_Z))) * track_t
track_zd = np.abs(Z - BRIDGE_Z)
in_track = (X > track_x0 - 2.0) & (X < track_x1 + 1.0)
h = np.where(in_track, np.maximum(h, track_y - np.maximum(track_zd - 1.5, 0) * 0.67), h)
h = np.where(in_track & (track_zd < 1.6), track_y, h)

# Irrigation canal (concrete U-channel, 0.6 m wide) fed by the weir intake, along the
# land side of the east levee, gently graded (1/1000) so it ends up level with the fields.
CANAL_Z0, CANAL_Z1, CANAL_W, CANAL_D = WEIR_Z - 6.0, 372.0, 1.2, 0.42
CULVERT = (BRIDGE_Z - 1.9, BRIDGE_Z + 1.9)   # the farm road crosses on a pipe culvert
def canal_x(z):
    return river_x(z) + bed_half(z) + WALL_RUN + CAP_W + PATH_W + 1.6
canal_pts = []
_s, _prev = 0.0, None
_wy0 = float(water_level(WEIR_Z - 7.0)) - 0.12
for zc in np.arange(CANAL_Z0, CANAL_Z1 + 0.01, 2.0):
    xc = float(canal_x(zc))
    if _prev is not None:
        _s += math.hypot(xc - _prev[0], zc - _prev[1])
    canal_pts.append([round(xc, 3), round(_wy0 - 0.001 * _s, 3), round(float(zc), 3), CANAL_W])
    _prev = (xc, zc)
_cz = np.array([p[2] for p in canal_pts]); _cy = np.array([p[1] for p in canal_pts])
canal_wy = np.interp(Z, _cz, _cy)
cdx = np.abs(X - canal_x(Z))
in_canal = (Z >= CANAL_Z0) & (Z <= CANAL_Z1) & ~((Z > CULVERT[0]) & (Z < CULVERT[1]))
canal_top = canal_wy + 0.22
# the channel is wider than the grid spacing, so every row has a sample inside it
h = np.where(in_canal & (cdx < CANAL_W / 2), canal_wy - CANAL_D - 0.1, h)
h = np.where(in_canal & (cdx >= CANAL_W / 2) & (cdx < CANAL_W / 2 + 0.14), np.minimum(h, canal_top - 0.04), h)
h = np.where(in_canal & (cdx >= CANAL_W / 2 + 0.14) & (cdx < 4.0), np.minimum(h, canal_top - 0.04 + (cdx - CANAL_W / 2 - 0.14) * 1.0), h)

# ---- Encode height -------------------------------------------------------------
h = np.clip(h, H_MIN, H_MIN + H_RANGE)
raw = np.rint((h - H_MIN) / H_RANGE * 65535).astype("<u2")
raw.tofile(OUT / "heightmap.r16")
Image.fromarray(raw.astype(np.uint16)).save(OUT / "heightmap.png")
hq = raw.astype(np.float64) / 65535 * H_RANGE + H_MIN

def sample(x, z):
    fx = (x / EXTENT + 0.5) * (N - 1)
    fz = (z / EXTENT + 0.5) * (N - 1)
    ix, iz = int(min(max(fx, 0), N - 2)), int(min(max(fz, 0), N - 2))
    a, b = fx - ix, fz - iz
    return float((hq[iz, ix] * (1 - a) + hq[iz, ix + 1] * a) * (1 - b) + (hq[iz + 1, ix] * (1 - a) + hq[iz + 1, ix + 1] * a) * b)

# ---- Surface masks ---------------------------------------------------------------
gy, gx = np.gradient(hq, CELL)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
forest_density = np.clip(smoothstep(1.0, 6, mountain_factor) + smoothstep(2, 10, shrine_spur(X, Z) - 2), 0, 1)
forest_density = np.clip(forest_density * (0.75 + 0.5 * (fbm(P1, X, Z, 140, 3) * 0.5 + 0.5)), 0, 1)
pre = (X > px0 - 1) & (X < px1) & (Z > pz0) & (Z < pz1)
forest_density = np.where(pre, 0, forest_density)
forest_density = np.where(is_paddy | (road_d < 6) | (rd < RB + _sec['run'] + _sec['cap'] + 1.0), 0, forest_density)
rock = smoothstep(50, 62, slope) * (1 - is_paddy)
# River bed: wet cobbles at and under the water, dry grey gravel on the bars, grass over the high bars.
WLg = water_level(Z)
above = hq - WLg
earth_s = _sec["earth"]
in_bed = (1 - smoothstep(RB + 0.1, RB + 0.5, rd)) * (1 - earth_s) + (1 - smoothstep(RB + 0.3, RB + 1.6, rd)) * earth_s
nb_ = 0.08 * fbm(P2, X, Z, 2.5, 2)
riverbed = in_bed * (1 - smoothstep(0.03, 0.12, above + nb_))
# grass takes the higher, older parts of the bars in patches (bar vegetation in August)
patch = fbm(P4, X, Z, 7.0, 3)
bar = in_bed * (1 - riverbed) * (1 - smoothstep(0.32, 0.5, above + 0.45 * patch + nb_))
wall_band = (1 - earth_s) * (rd > RB - 0.3) * (rd < RB + _sec["run"] + _sec["cap"] + 0.15)
asphalt = (1 - smoothstep(1.9, 2.4, road_d)) * smoothstep(-560, -520, Z) * (1 - smoothstep(560, 590, Z))
branch = (1 - smoothstep(1.8, 2.3, bd))
dirt = np.clip(branch + (1 - smoothstep(0.8, 1.4, np.abs(Z - STAIR_Z))) * ((X > 92) & (X < STAIR_X0)) * 0, 0, 1)
# Farm tracks: every few band edges become 2.5 m dirt tracks through the paddies.
track = np.zeros_like(h)
for i, e in enumerate(band_edges):
    if i % 3 == 1:
        track = np.maximum(track, (1 - smoothstep(1.0, 1.6, np.abs(t - e))) * (~is_paddy | aze))
track = track * ((rd > RIVER_KEEP) & (road_d > 2.3) & (mountain_factor < 3))
# Levee path and the farm road to the bridge: two wheel ruts with grass between them.
def ruts(d):
    return np.maximum(1 - smoothstep(0.16, 0.36, np.abs(d - 0.68)), 0.3 * (1 - smoothstep(0.9, 1.3, d)))
levee_c = RB + _sec["run"] + _sec["cap"] + _sec["path"] / 2
levee_path = (X > rx) * ruts(np.abs(rd - levee_c)) * smoothstep(-560, -540, Z) * (1 - smoothstep(580, 595, Z))
farm_road = ((X > track_x0 - 1.0) & (X < track_x1 + 0.5)) * ruts(track_zd)
track = np.maximum(track, np.maximum(levee_path, farm_road))
dirt = np.clip(dirt + track * 0.85, 0, 1)
# road shoulders: packed earth and gravel between the asphalt edge and the ditch
shoulder = (1 - smoothstep(2.1, 2.9, road_d)) * smoothstep(1.7, 2.1, road_d) * smoothstep(-560, -520, Z)
dirt = np.maximum(dirt, shoulder * 0.9)
for hs in houses:
    dist = np.hypot(X - hs["x"], Z - hs["z"])
    dirt = np.maximum(dirt, (1 - smoothstep(6, 12, dist)) * 0.32 * (0.6 + 0.8 * (fbm(P2, X, Z, 4, 2) * 0.5 + 0.5)))
gravel = pre * (1 - smoothstep(-3.0, 1.0, edge))  # the whole precinct floor is gravel up to its rim
forest_density = np.maximum(forest_density, pre * smoothstep(-6, 0, edge) * 0.5)
rice = interior & (field_type == 1)
paddy_mud = rice.astype(np.float64)
furrows = ((field_type == 2) & is_paddy).astype(np.float64)
forest_floor = forest_density
grass = np.ones_like(h)
rock = rock * (1 - in_bed) * (1 - wall_band)
layers = dict(grass=grass, forest=forest_floor, dirt=dirt, rock=rock, paddy=paddy_mud, riverbed=riverbed, gravel=gravel, asphalt=asphalt, furrows=furrows, bar=bar)
order = ["grass", "forest", "dirt", "rock", "paddy", "riverbed", "gravel", "asphalt", "furrows", "bar"]
# Paint with priorities: later layers cover earlier ones.
wgt = {k: np.zeros_like(h) for k in order}
remaining = np.ones_like(h)
for k in reversed(order):
    v = np.clip(layers[k], 0, 1) * remaining if k != "grass" else remaining
    wgt[k] = v
    remaining = remaining - v
for idx, group in enumerate([order[:4], order[4:8], order[8:]]):
    rgba = np.stack([wgt[k] for k in group] + [np.zeros_like(h)] * (4 - len(group)), -1)
    Image.fromarray(np.uint8(np.rint(np.clip(rgba, 0, 1) * 255)), "RGBA").save(OUT / f"splat{idx}.png")
# Vegetation/paddy auxiliary map: R=forest density, G=paddy id hash, B=paddy interior, A=grass density
grass_density = np.clip(wgt["grass"] * (1 - 0.6 * forest_density) + wgt["forest"] * 0.25 + aze * 0.8, 0, 1)
# nothing grows through the revetments, the canal or the wet margin; sparse tufts on the dry gravel
grass_density = grass_density * (1 - wall_band) * (1 - riverbed) * (1 - 0.8 * wgt["bar"]) * ~(in_canal & (cdx < CANAL_W / 2 + 0.3))
pid = np.where(is_paddy, (label * 2654435761 % 251 + 3), 0) % 255
aux = np.stack([forest_density, pid / 255.0, rice.astype(float), grass_density], -1)
Image.fromarray(np.uint8(np.rint(np.clip(aux, 0, 1) * 255)), "RGBA").save(OUT / "vegetation-mask.png")
# Paddy level map (float -> uint16 heights in same encoding), used for rice canopy.
pl = np.where(is_paddy & (field_type == 1), paddy_level, H_MIN)
Image.fromarray(np.rint((pl - H_MIN) / H_RANGE * 65535).astype(np.uint16)).save(OUT / "paddy-level.png")

# ---- Vegetation placement ---------------------------------------------------------
rv = np.random.default_rng(SEED + 7)
trees = {k: [] for k in ["sugi", "hinoki", "akamatsu", "broadleaf", "bamboo", "keyaki"]}

def on_approach(x, z, margin=0.0):
    """Village road -> foot torii branch path and the stone forecourt."""
    return road_at_stair - 4 < x < STAIR_X0 + 1 and abs(z - STAIR_Z) < 5.5 + margin

def river_corridor(x, z, extra=0.0):
    """Bed, revetment, cap and levee path of the river, the canal and the farm road to the bridge."""
    u = x - float(river_x(z))
    B = float(bed_half(z))
    e = float(earth_bank(z, u >= 0))
    reach = B + WALL_RUN * (1 - e) + 3.0 * e + CAP_W * (1 - e) + (PATH_W + 0.8 if u >= 0 else 0.6)
    if abs(u) < reach + extra:
        return True
    if CANAL_Z0 - 2 < z < CANAL_Z1 + 2 and abs(x - float(canal_x(z))) < 1.7 + extra:
        return True
    return track_x0 - 3 < x < track_x1 + 2 and abs(z - BRIDGE_Z) < 3.2 + extra

def blocked(x, z, top=None):
    if abs(z - STAIR_Z) < STAIR_W / 2 + 1.6 and STAIR_X0 - 26 < x < STAIR_X1 + 2:
        return True
    if on_approach(x, z, 1.0):
        return True
    if px0 - 1 < x < px1 - 4 and pz0 + 6 < z < pz1 - 2:
        return True
    if abs(x - float(road_x(z))) < 5.5:
        return True
    if river_corridor(x, z):
        return True
    # lookout view cone: keep tree crowns below the sight line.
    dx, dz_ = x - LOOKOUT[0], z - LOOKOUT[2]
    dist = math.hypot(dx, dz_)
    if dist < 14:
        return True
    if dist < 230:
        az = math.atan2(dx, -dz_) % (2 * math.pi)
        in_view = dist < 190 and abs((az - LOOK_DIR + math.pi) % (2 * math.pi) - math.pi) < math.radians(38)
        # second sector towards the 17:30-18:30 sun (azimuth 281-290 deg): the sunset stays visible
        in_sun = abs((az - SUN_AZ + math.pi) % (2 * math.pi) - math.pi) < math.radians(17)
        if in_view or in_sun:
            # trees may grow in the view cone if their crowns stay below the sight line
            sight = LOOKOUT[1] + 1.62 - 2.0 - dist * math.tan(math.radians(13.0))
            if top is None or top > sight:
                return True
    for hs in houses:
        reach = max(hs["w"], hs["d"]) / 2 + 5 + (5 if hs.get("wing") else 0)
        if math.hypot(x - hs["x"], z - hs["z"]) < reach:
            return True
    return False

def cell(arr, x, z):
    i = int(round((z / EXTENT + 0.5) * (N - 1)))
    j = int(round((x / EXTENT + 0.5) * (N - 1)))
    return arr[min(max(i, 0), N - 1), min(max(j, 0), N - 1)]

def add_tree(kind, x, z, scale, lean=0.0):
    y = sample(x, z)
    trees[kind].append([round(x, 2), round(y, 3), round(z, 2), round(scale, 3), round(float(rv.random() * math.tau), 3), int(rv.integers(0, 4)), round(lean, 3)])

# Shrine grove: old giants lining the stair and the precinct.
for side in (-1, 1):
    x = STAIR_X0 - 18
    while x < STAIR_X1 + 4:
        x += rv.uniform(4.0, 7.5)
        off = rv.uniform(STAIR_W / 2 + 2.2, STAIR_W / 2 + 5.5)
        z = STAIR_Z + side * off
        kind = "sugi" if rv.random() < 0.82 else "hinoki"
        add_tree(kind, x + rv.uniform(-1, 1), z, rv.uniform(1.15, 1.45))
        if rv.random() < 0.6:
            add_tree("sugi", x + rv.uniform(-2, 2), STAIR_Z + side * rv.uniform(11, 20), rv.uniform(1.0, 1.35))
for i in range(260):
    ang = rv.random() * math.tau
    rad = rv.uniform(0, 1)
    x = (px0 + px1) / 2 + math.cos(ang) * (px1 - px0) * 0.5 * (0.9 + 0.5 * rad)
    z = (pz0 + pz1) / 2 + math.sin(ang) * (pz1 - pz0) * 0.5 * (0.9 + 0.5 * rad)
    if blocked(x, z):
        continue
    kind = rv.choice(["sugi", "sugi", "sugi", "hinoki", "keyaki", "broadleaf"])
    add_tree(str(kind), x, z, rv.uniform(1.0, 1.5) if kind == "sugi" else rv.uniform(0.9, 1.25))
# Precinct sacred tree (shinboku) near the haiden.
trees["sugi"].append([248.0, round(sample(248, -70), 3), -70.0, 1.75, 0.6, 0, 0.0])

# General forest via jittered grid + density.
spacing = 5.3
gridx = np.arange(-596, 596, spacing)
for gz in np.arange(-596, 596, spacing):
    for gxv in gridx:
        x = gxv + rv.uniform(-0.5, 0.5) * spacing
        z = gz + rv.uniform(-0.5, 0.5) * spacing
        fd = cell(forest_density, x, z)
        if fd <= 0.05 or rv.random() > min(1.0, fd * 1.25):
            continue
        y = sample(x, z)
        if blocked(x, z, top=y + 13.0):
            continue
        sl = cell(slope, x, z)
        if sl > 62:
            continue
        plantation = fbm(P2, np.array(x), np.array(z), 160, 3) > -0.05
        ridge = cell(mountain_factor, x, z) > 150 or sl < 12 and y > 120
        r = rv.random()
        if ridge and r < 0.45:
            kind = "akamatsu"
        elif plantation and y < 260:
            kind = "sugi" if r < 0.82 else "hinoki"
        else:
            kind = "broadleaf" if r < 0.8 else ("akamatsu" if r < 0.9 else "hinoki")
        scale = rv.uniform(0.75, 1.15) * (1.0 if kind != "broadleaf" else rv.uniform(0.8, 1.15))
        if blocked(x, z):
            # inside the lookout's view cone: only low broadleaf scrub whose crowns stay below the sight line
            kind = "broadleaf"
            scale = rv.uniform(0.45, 0.7)
        add_tree(kind, x, z, scale)

# Bamboo groves on foothills behind the village.
for k in range(16):
    hs = houses[int(rv.integers(0, len(houses)))]
    cx = hs["x"] + (hs["x"] - float(road_x(hs["z"]))) * 0.0 + rv.uniform(-50, 50) + 30 * hs["side"]
    cz = hs["z"] + rv.uniform(-45, 45)
    for i in range(int(rv.integers(60, 140))):
        x = cx + rv.normal(0, 9)
        z = cz + rv.normal(0, 6)
        if blocked(x, z) or cell(is_paddy.astype(float), x, z) > 0.5 or abs(x - float(road_x(z))) < 9:
            continue
        add_tree("bamboo", x, z, rv.uniform(0.75, 1.1), lean=rv.normal(0, 0.05))
# Yard trees and house windbreaks (yashikirin).
for hs in houses:
    for i in range(int(rv.integers(2, 6))):
        ang = hs["yaw"] + math.pi + rv.uniform(-1.0, 1.0)
        rad = rv.uniform(9, 16)
        x, z = hs["x"] + math.sin(ang) * rad, hs["z"] + math.cos(ang) * rad
        if blocked(x, z) or cell(is_paddy.astype(float), x, z) > 0.5:
            continue
        kind = rv.choice(["sugi", "keyaki", "broadleaf", "broadleaf"])
        add_tree(str(kind), x, z, rv.uniform(0.6, 1.0))
# Riverside trees: a wooded strip along the west bank, a few trees on the east levee,
# willow scrub on the high gravel bars and bamboo flood-defence groves (suigai-bobirin).
def bank_reach(z, east):
    B = float(bed_half(z))
    e = float(earth_bank(z, east))
    return B + WALL_RUN * (1 - e) + 3.0 * e + CAP_W * (1 - e) + (PATH_W + 0.8 if east else 0.6)
is_paddy_f = is_paddy.astype(float)
riparian_shrubs = []
for z in np.arange(-540, 590, 3.0):
    # clumps and open stretches, not an avenue: density follows a slow noise along the bank
    grove = float(fbm(P5, np.array(-170.0), np.array(z), 38.0, 2)) * 0.5 + 0.5
    if rv.random() < 0.75 * smoothstep(0.42, 0.7, grove):
        x = float(river_x(z)) - bank_reach(z, False) - rv.uniform(0.6, 5.5)
        zz = z + rv.uniform(-1.4, 1.4)
        if not blocked(x, zz) and cell(is_paddy_f, x, zz) < 0.5:
            r_ = rv.random()
            kind, sc = ("keyaki", rv.uniform(0.75, 1.1)) if r_ < 0.12 else ("sugi", rv.uniform(0.6, 0.95)) if r_ < 0.2 else ("broadleaf", rv.uniform(0.35, 1.0))
            add_tree(kind, x, zz, sc)
            # undergrowth at the foot of the bank trees
            for k_ in range(int(rv.integers(1, 4))):
                riparian_shrubs.append((x + rv.normal(0, 1.6), zz + rv.normal(0, 1.8)))
    if rv.random() < 0.07 and not (CANAL_Z0 - 4 < z < CANAL_Z1 + 4):
        x = float(river_x(z)) + bank_reach(z, True) + rv.uniform(0.8, 2.0)
        if not blocked(x, z) and cell(is_paddy_f, x, z) < 0.5:
            add_tree("broadleaf", x, z, rv.uniform(0.45, 0.7))
for z in np.arange(-520, 580, 3.5):
    if rv.random() > 0.3 or float(full_width(z)) > 0.05:
        continue
    B, c, hw = float(bed_half(z)), float(low_off(z)), float(chan_half(z))
    side = 1.0 if c < 0 else -1.0                     # the bar opposite the channel
    width = B - side * c - hw
    if width < 4.2:
        continue
    u = c + side * (hw + 1.8 + rv.uniform(0, width - 3.2))
    if float(bed_surface(np.array(u), np.array(z), np.array(float(river_x(z)) + u))) > float(water_level(z)) + 0.3:
        add_tree("broadleaf", float(river_x(z)) + u, z, rv.uniform(0.3, 0.5))
for zc in [-300.0, -8.0, 252.0, 405.0]:
    for i in range(int(rv.integers(170, 240))):
        z = zc + rv.normal(0, 13)
        x = float(river_x(z)) - bank_reach(z, False) - 0.6 - abs(rv.normal(2.4, 1.6))
        if blocked(x, z) or cell(is_paddy_f, x, z) > 0.5:
            continue
        add_tree("bamboo", x, z, rv.uniform(0.8, 1.1), lean=abs(rv.normal(0.04, 0.04)))
# an old zelkova at the west bridgehead
_bt = (BRIDGE_X0 - bank_reach(BRIDGE_Z, False) - 3.2, BRIDGE_Z - 5.5)
add_tree("keyaki", _bt[0], _bt[1], 1.15)

# ---- Ground clutter (near the walkable core only) -------------------------------
clutter = {k: [] for k in ["fern", "shrub", "weed", "rock_moss", "boulder", "river_stone", "stump", "log", "susuki", "reed", "crop"]}
def add_clutter(kind, x, z, scale, variant=0, sink=0.0):
    # keep the stair treads, landings and the forecourt clear
    reach = {"rock_moss": 1.1, "boulder": 1.4, "log": 2.5, "stump": 0.6}.get(kind, 0.35) * scale
    if on_approach(x, z, reach):
        return
    if STAIR_X0 - 30 < x < STAIR_X1 + 3 and abs(z - STAIR_Z) < STAIR_W / 2 + 0.5 + reach:
        return
    clutter[kind].append([round(x, 2), round(sample(x, z) - sink, 3), round(z, 2), round(scale, 3), round(float(rv.random() * math.tau), 3), int(variant)])

core = lambda x, z: (60 < x < 300 and -120 < z < 40) or (-220 < x < 140 and -200 < z < 420)
for i in range(22000):
    x, z = rv.uniform(-260, 300), rv.uniform(-220, 420)
    if not core(x, z):
        continue
    fd = cell(forest_density, x, z)
    if blocked(x, z) and not (abs(z - STAIR_Z) > STAIR_W / 2 + 0.4 and STAIR_X0 - 2 < x < STAIR_X1):
        continue
    if cell(is_paddy.astype(float), x, z) > 0.5 or abs(x - float(road_x(z))) < 3:
        continue
    r = rv.random()
    if fd > 0.3:
        if r < 0.5: add_clutter("fern", x, z, rv.uniform(0.7, 1.5))
        elif r < 0.75: add_clutter("shrub", x, z, rv.uniform(0.6, 1.3), int(rv.integers(0, 3)))
        elif r < 0.87: add_clutter("rock_moss", x, z, rv.uniform(0.5, 1.6), int(rv.integers(0, 2)), sink=0.15)
        elif r < 0.93: add_clutter("stump", x, z, rv.uniform(0.7, 1.1))
        elif r < 0.96: add_clutter("log", x, z, rv.uniform(0.6, 1.0))
    else:
        if r < 0.35: add_clutter("weed", x, z, rv.uniform(0.6, 1.2), int(rv.integers(0, 2)))
        elif r < 0.5: add_clutter("susuki", x, z, rv.uniform(0.8, 1.3))
        elif r < 0.56: add_clutter("shrub", x, z, rv.uniform(0.5, 1.0), int(rv.integers(0, 3)))
# Ferns and moss rocks hugging the stair edges.
for i in range(1700):
    x = rv.uniform(STAIR_X0 - 4, STAIR_X1)
    side = rv.choice([-1, 1])
    z = STAIR_Z + side * rv.uniform(STAIR_W / 2 + 0.9, STAIR_W / 2 + 8)
    r = rv.random()
    if r < 0.62: add_clutter("fern", x, z, rv.uniform(0.7, 1.6))
    elif r < 0.8: add_clutter("rock_moss", x, z, rv.uniform(0.3, 0.7), int(rv.integers(0, 2)), sink=0.2)
    elif r < 0.92: add_clutter("shrub", x, z, rv.uniform(0.6, 1.1), int(rv.integers(0, 3)))
    else: add_clutter("weed", x, z, rv.uniform(0.5, 1.0), int(rv.integers(0, 2)))
# Vegetable rows on the hatake, on the ridges of the farm_furrows texture
# (tile 4.2 m, 7 ridges per tile, ridge phase measured from the albedo: z = 0.6 * (n + 0.4722)).
FURROW_PITCH, FURROW_PHASE = 4.2 / 7, 0.4722
hat = (field_type == 2) & interior
for f in fields:
    if f.get("type") != "hatake":
        continue
    x0b, z0b, x1b, z1b = f["bounds"]
    crop = int(rv.integers(0, 4))           # one crop per field: eggplant/edamame/taro/greens
    n0 = math.ceil(z0b / FURROW_PITCH - FURROW_PHASE)
    zr = (n0 + FURROW_PHASE) * FURROW_PITCH
    while zr < z1b:
        x = x0b + rv.uniform(0, 0.4)
        step_ = [0.55, 0.4, 0.7, 0.3][crop]
        while x < x1b:
            if cell(hat.astype(float), x, zr) > 0.5 and cell(hat.astype(float), x + 0.6, zr) > 0.5 and cell(hat.astype(float), x - 0.6, zr) > 0.5:
                clutter["crop"].append([round(x, 2), round(sample(x, zr) + 0.04, 3), round(zr, 2), round(float([0.75, 0.55, 0.95, 0.42][crop] * rv.uniform(0.8, 1.2)), 3), round(float(rv.random() * math.tau), 3), crop])
            x += step_ * rv.uniform(0.85, 1.15)
        zr += FURROW_PITCH

# River stones along the water margin and through the riffles, riprap at the outer bends
# and below the drops, reed (tsuruyoshi) patches on the bars, susuki on the earth banks.
for z in np.arange(-540, 585, 0.8):
    B, c, hw = float(bed_half(z)), float(low_off(z)), float(chan_half(z))
    rxz, fw = float(river_x(z)), float(full_width(z))
    rif = (1 - abs(math.sin(float(_phase(z))))) * (1 - fw)
    for k in range(4 + int(3 * rif)):
        r_ = rv.random()
        if r_ < 0.55:
            u = c + rv.choice([-1, 1]) * (hw + rv.normal(0.2, 0.7))          # along the water's edge
        elif r_ < 0.55 + 0.35 * (0.3 + rif):
            u = c + rv.uniform(-hw, hw)                                      # cobbles breaking the surface
        else:
            u = rv.uniform(-B + 0.4, B - 0.4)
        if abs(u) < B - 0.35:
            add_clutter("river_stone", rxz + u, z + rv.uniform(-0.4, 0.4), rv.uniform(0.3, 1.15) * (1.15 if abs(u - c) < hw else 1.0), int(rv.integers(0, 3)), sink=0.1)
    if fw < 0.3 and abs(c) > 0.55 * max(B - hw - 0.9, 0.1) and rv.random() < 0.4:
        add_clutter("boulder", rxz + math.copysign(B - rv.uniform(0.35, 1.0), c), z, rv.uniform(0.4, 0.75), int(rv.integers(0, 2)), sink=0.3)
    if fw < 0.2 and rv.random() < 0.5:
        u0 = c + rv.choice([-1, 1]) * (hw + rv.uniform(0.4, 2.6))
        if abs(u0) < B - 0.7:
            for i in range(int(rv.integers(18, 40))):
                u = u0 + rv.normal(0, 0.75)
                if abs(u) < B - 0.4:
                    add_clutter("reed", rxz + u, z + rv.normal(0, 1.3), rv.uniform(0.75, 1.3), int(rv.integers(0, 3)))
for (x, z) in riparian_shrubs:
    if not river_corridor(x, z) and cell(is_paddy_f, x, z) < 0.5:
        add_clutter("shrub", x, z, rv.uniform(0.7, 1.3), int(rv.integers(0, 3)))
for info in DROP_INFO:
    d = info["z"]
    apron = 5.0 if info["kind"] == "weir" else 3.2
    for i in range(int(float(bed_half(d)) * 2.4)):
        zz = d + apron + rv.uniform(0.3, 5.5)
        add_clutter("boulder", float(river_x(zz)) + rv.uniform(-1, 1) * (float(bed_half(zz)) - 0.6), zz, rv.uniform(0.4, 0.8), int(rv.integers(0, 2)), sink=0.35)
for z in np.arange(-540, 585, 1.2):
    for east in (False, True):
        e = float(earth_bank(z, east))
        sgn = 1.0 if east else -1.0
        B = float(bed_half(z))
        if rv.random() < 0.45 * e:
            u = sgn * (B + rv.uniform(0.4, 2.8))
            add_clutter("susuki", float(river_x(z)) + u, z, rv.uniform(0.8, 1.3))
        elif rv.random() < 0.05:
            u = sgn * (bank_reach(z, east) + rv.uniform(0.2, 1.6))
            if not (east and CANAL_Z0 - 2 < z < CANAL_Z1 + 2):
                add_clutter("susuki", float(river_x(z)) + u, z, rv.uniform(0.7, 1.1))

# ---- Built objects -------------------------------------------------------------
objects = []
def obj(asset, x, y, z, yaw=0.0, scale=1.0, collider=None, **kw):
    o = dict(id=f"{asset}-{len(objects):04}", asset=asset, position=[round(x, 3), round(y, 3), round(z, 3)],
             rotation=[0, round(yaw, 4), 0], scale=[scale, scale, scale])
    if collider:
        o["collider"] = collider
    o.update(kw)
    objects.append(o)
    return o

# Steps: each block is listed for engines that rebuild the stair.
steps = []
for i in range(STEPS):
    f, k = divmod(i, FLIGHT)
    x_front = STAIR_X0 + f * (FLIGHT * TREAD + LANDING) + k * TREAD
    depth = TREAD if k < FLIGHT - 1 or f == 3 else TREAD + LANDING
    steps.append(dict(index=i + 1, x=round(x_front, 4), y=round(FOOT_Y + (i + 1) * RISE, 4), z=STAIR_Z,
                      width=STAIR_W, depth=round(depth, 4), rise=RISE))
# West-facing approach: torii and lanterns face the village (yaw = +pi/2 means local +Z -> world +X?)
FACE_WEST = -math.pi / 2  # local +Z (front) turned to world -X
obj("torii-stone", 110.0, FOOT_Y, STAIR_Z, FACE_WEST, 1.0, landmark="foot")
obj("torii-wood", STAIR_X1 + 4.0, TOP_Y, STAIR_Z, FACE_WEST, 0.92, landmark="top")
obj("sekihi", 104.0, FOOT_Y, STAIR_Z - 6.5, FACE_WEST + 0.2, 1.0)
for x in [116.0, 121.0]:
    for side in (-1, 1):
        obj("toro", x, FOOT_Y, STAIR_Z + side * 3.6, FACE_WEST, 1.0, collider={"type": "box", "halfExtents": [0.45, 1.0, 0.45]})
for i in [24, 49, 99, 149]:
    st = steps[i]
    for side in (-1, 1):
        x = st["x"] + (1.6 if (i + 1) % 50 == 0 else 0.2)
        obj("toro", x, st["y"], STAIR_Z + side * (STAIR_W / 2 + 0.8), FACE_WEST, 0.9)
obj("sekihi", STAIR_X0 + 3 * (FLIGHT * TREAD + LANDING) - 1.5, FOOT_Y + 150 * RISE, STAIR_Z + STAIR_W / 2 + 1.6, FACE_WEST - 0.3, 0.8)

SANDO_END = 246.0
obj("haiden", 250.0, TOP_Y, STAIR_Z, FACE_WEST, 1.0, collider={"type": "box", "halfExtents": [6.4, 4.0, 4.6]})
obj("honden", 262.5, TOP_Y, STAIR_Z, FACE_WEST, 1.0, collider={"type": "box", "halfExtents": [3.4, 3.5, 3.4]})
obj("saisen", 244.3, TOP_Y, STAIR_Z, FACE_WEST, 1.0, collider={"type": "box", "halfExtents": [0.75, 0.5, 0.45]})
obj("komainu", 236.0, TOP_Y, STAIR_Z - 3.6, FACE_WEST, 1.0, variant="a", collider={"type": "box", "halfExtents": [0.6, 1.0, 0.6]})
obj("komainu", 236.0, TOP_Y, STAIR_Z + 3.6, FACE_WEST, 1.0, variant="un", collider={"type": "box", "halfExtents": [0.6, 1.0, 0.6]})
for x in [214.0, 224.0, 240.5]:
    for side in (-1, 1):
        obj("toro", x, TOP_Y, STAIR_Z + side * 3.4, FACE_WEST, 1.0, collider={"type": "box", "halfExtents": [0.45, 1.0, 0.45]})
obj("temizuya", 219.0, TOP_Y, -33.0, FACE_WEST, 1.0, collider={"type": "box", "halfExtents": [1.6, 1.4, 1.1]})
obj("shamusho", 226.0, TOP_Y, -66.0, 0.0, 1.0, collider={"type": "box", "halfExtents": [6.0, 3.0, 3.8]})
obj("ema", 241.0, TOP_Y, -51.5, 0.0, 1.0, collider={"type": "box", "halfExtents": [1.6, 1.0, 0.4]})
obj("shimenawa-tree", 248.0, sample(248, -70), -70.0, 0.0, 1.75)
obj("bench", 212.0, TOP_Y, -4.6, math.radians(225) + math.pi, 1.0, collider={"type": "box", "halfExtents": [0.9, 0.25, 0.3]})
obj("fence-lookout", px0 - 1.0, TOP_Y - 0.05, -14.0, math.pi / 2, 1.0)
obj("fence-lookout", px0 + 12.0, TOP_Y - 0.05, pz1 + 1.0, 0.0, 1.0)

for i, hs in enumerate(houses):
    asset = {"kawara": "minka-kawara", "thatch": "minka-kayabuki", "tin": "minka-totan", "kura-house": "minka-kura"}[hs["kind"]]
    obj(asset, hs["x"], hs["y"], hs["z"], hs["yaw"], 1.0, variant=hs["variant"], size=[round(hs["w"], 2), round(hs["d"], 2)],
        collider={"type": "box", "halfExtents": [hs["w"] / 2 + 0.3, 3.0 * hs["storeys"], hs["d"] / 2 + 0.3]},
        **({"wing": {"offset": hs["wing"][:2], "halfExtents": [hs["wing"][2] / 2 + 0.3, 2.6, hs["wing"][3] / 2 + 0.3]}} if hs.get("wing") else {}))
    c, s_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    def local(lx, lz):
        return hs["x"] + lx * c + lz * s_, hs["z"] - lx * s_ + lz * c
    bx, bz = local(hs["w"] / 2 + 5.5, -1.5)
    obj("naya", bx, hs["y"], bz, hs["yaw"], rng.uniform(0.85, 1.1), collider={"type": "box", "halfExtents": [2.6, 1.8, 2.1]})
    if i % 3 == 0:
        wx, wz = local(0, hs["d"] / 2 + 6.5)
        obj("block-wall", wx, hs["y"], wz, hs["yaw"], 1.0, length=round(hs["w"] + 6, 2))
    if i % 4 == 1:
        tx, tz = local(-hs["w"] / 2 - 3.5, hs["d"] / 2 + 3)
        obj("kei-truck", tx, hs["y"], tz, hs["yaw"] + math.pi / 2, 1.0, collider={"type": "box", "halfExtents": [0.75, 0.9, 1.7]})
    for k in range(2):
        px_, pz_ = local(rng.uniform(-hs["w"] / 2, hs["w"] / 2), -hs["d"] / 2 - 2.2)
        obj(str(rng.choice(["prop-bucket", "prop-barrels", "prop-crate", "prop-basket", "prop-ladder"])), px_, hs["y"], pz_, float(rng.random() * math.tau), 1.0)
    # stone retaining wall where the pad stands above the paddies/road
    if hs["y"] - float(floor_base(hs["z"])) > 1.6:
        rx_, rz_ = local(0, hs["d"] / 2 + 8)
        obj("ishigaki", rx_, hs["y"], rz_, hs["yaw"], 1.0, length=round(hs["w"] + 10, 2), height=round(hs["y"] - float(floor_base(hs["z"])) - 0.4, 2))

# Utility poles along the road, with wires.
poles = []
zp = -300.0
while zp < 380:
    x = float(road_x(zp)) - 3.4
    poles.append([round(x, 2), round(sample(x, zp), 3), round(zp, 2)])
    obj("denchu", x, sample(x, zp), zp, math.atan2(float(road_x(zp + 1) - road_x(zp - 1)), 2.0), 1.0,
        collider={"type": "cylinder", "radius": 0.16, "height": 9.0})
    zp += rng.uniform(32, 40)
# Road mirror / bus stop / jizo at junction.
obj("jizo", float(road_at_stair) + 4.0, sample(road_at_stair + 4, STAIR_Z - 5), STAIR_Z - 5.0, FACE_WEST, 1.0)
obj("bus-stop", float(road_x(60)) + 3.2, sample(road_x(60) + 3.2, 60), 60.0, -math.pi / 2, 1.0)
# drinks vending machines (lit at dusk): by the bus stop and at the shrine road junction, facing the road
for vx, vz, vv in [(float(road_x(56)) + 3.6, 56.0, 0), (road_at_stair + 4.6, STAIR_Z + 6.5, 1), (float(road_x(-215)) + 3.8, -215.0, 0)]:
    obj("jihanki", vx, sample(vx, vz), vz, -math.pi / 2, 1.0, variant=vv, collider={"type": "box", "halfExtents": [0.55, 0.95, 0.4]})

# Bridge where the farm road crosses the river: a concrete slab across the bed, deck level
# with the levee path, laid along the road (a 9 degree skew to the stream).
BRIDGE_DECK = float(bank_top(BRIDGE_Z)) + 0.12
_sb = float(bed_half(BRIDGE_Z))
BRIDGE_SPAN = round(2 * (_sb + WALL_RUN) + 1.2, 2)
obj("bridge", BRIDGE_X0, BRIDGE_DECK - 0.4, BRIDGE_Z, 0.0, 1.0, span=BRIDGE_SPAN, width=3.2,
    collider={"type": "box", "halfExtents": [BRIDGE_SPAN / 2, 0.2, 1.6]})
# a water-god stone (suijin-hi) under the zelkova at the west bridgehead
obj("sekihi", _bt[0] + 2.0, sample(_bt[0] + 2.0, _bt[1] + 2.2), _bt[1] + 2.2, math.pi / 2 + 0.25, 0.75)

# ---- River / road / canal geometry data ------------------------------------------
# Water surface rows along the bed centre. Each row is a cross-section along X (the
# sills are laid along X too), spanning the bed; the wetted edge is where the surface
# meets the bed. A drop is written as two "fall" rows (crest, foot of the overfall).
river_pts = []
_marks = list(MARKS)
def _row(z, y, fall=0):
    # riffle: where the low-flow channel crosses over between bars (wide, shallow, broken water)
    rif = (1 - abs(math.sin(float(_phase(z))))) * (1 - float(full_width(z)))
    river_pts.append([round(float(river_x(z)), 3), round(float(y), 3), round(float(z), 3), round(2 * float(bed_half(z)), 3), fall, round(rif, 2)])
for z in np.arange(-600, 600.01, 1.0):
    while _marks and _marks[0] <= z:
        d = _marks.pop(0)
        info = next(i for i in DROP_INFO if i["z"] == d)
        _row(d - 0.03, info["up"])
        _row(d, info["up"] - 0.04, 1)
        _row(d + (0.42 if info["kind"] == "weir" else 0.32), info["down"], 1)
        _row(d + 0.75, info["down"])
    if any(-0.1 < z - i["z"] < 0.85 for i in DROP_INFO):
        continue
    _row(z, water_level(z))
bed_pts = []
for z in np.arange(-600, 600.01, 1.5):
    B = float(bed_half(z))
    xz = float(river_x(z))
    toe = [float(bed_surface(np.array(sg * B), np.array(z), np.array(xz + sg * B))) for sg in (-1.0, 1.0)]
    bed_pts.append([round(xz, 3), round(float(z), 3), round(B, 3), round(float(bank_top(z)), 3), round(toe[0], 3), round(toe[1], 3),
                    round(float(earth_bank(z, False)), 3), round(float(earth_bank(z, True)), 3), 1 if wall_kind(z, True) == "block" else 0])
drops_out = []
for info in DROP_INFO:
    d = info["z"]
    drops_out.append(dict(z=d, kind=info["kind"], x=round(float(river_x(d)), 3), halfWidth=round(float(bed_half(d)), 3),
                          crestY=round(info["up"] - 0.06, 3), waterAbove=info["up"], waterBelow=info["down"],
                          apron=5.0 if info["kind"] == "weir" else 3.2))
INTAKE_Z = WEIR_Z - 6.0
river_meta = {
    "points": river_pts, "format": "[x, waterY, z, widthX, fall, riffle]",
    "note": "cross-sections along X centred on the bed; the water's edge is where waterY meets the terrain; fall=1 rows are the crest and foot of an overfall",
    "bed": {"points": bed_pts, "format": "[xCentre, z, halfWidth, bankTopY, toeYWest, toeYEast, earthWest, earthEast, blockFacing]",
            "wallRun": WALL_RUN, "capWidth": CAP_W, "pathWidth": PATH_W,
            "note": "earth=1: plain earth slope (1:1.6); earth=0: masonry revetment 1:0.4 from the toe to the bank top; blockFacing=1: concrete kenchi blocks, 0: mossy dry stone"},
    "drops": drops_out,
    "intake": {"z": INTAKE_Z, "side": "east", "sillY": round(float(water_level(INTAKE_Z)) - 0.55, 3), "waterY": round(float(water_level(INTAKE_Z)), 3)},
    "canal": {"points": canal_pts, "format": "[x, waterY, z, width]", "culvert": list(CULVERT), "depth": CANAL_D, "wallTop": 0.22},
    "washSteps": [dict(z=zs, side="east", topY=round(float(bank_top(zs)), 3),
                       toeY=round(float(bed_surface(np.array(float(bed_half(zs))), np.array(zs), np.array(float(river_x(zs) + bed_half(zs))))), 3)) for zs in WASH_STEPS],
    "bridgeZ": BRIDGE_Z, "bridgeDeckY": round(BRIDGE_DECK, 3),
}
road_pts = []
for z in np.arange(-540, 580, 2.5):
    x = float(road_x(z))
    road_pts.append([round(x, 3), round(sample(x, z), 3), round(float(z), 3)])
branch_pts = []
for k in range(0, 41):
    tt = k / 40
    x = road_at_stair + (98.0 - road_at_stair) * tt
    branch_pts.append([round(x, 3), round(sample(x, STAIR_Z), 3), STAIR_Z])

landmarks = {
    "foot": [104.0, FOOT_Y + 1.62, STAIR_Z, 90.0, -2.0],            # x,y,z, yaw(deg), pitch(deg)
    "stairs": [STAIR_X0 + 60.0, float(stair_profile(STAIR_X0 + 60)) + 1.62, STAIR_Z, 90.0, 12.0],
    "shrine": [STAIR_X1 + 9.0, TOP_Y + 1.62, STAIR_Z, 90.0, 0.0],
    "lookout": [LOOKOUT[0], TOP_Y + 1.62, LOOKOUT[2], 225.0, -9.0],
    "village": [float(road_x(70)) , sample(road_x(70), 70) + 1.62, 70.0, 10.0, 0.0],
    "river": [BRIDGE_X0 + 2.2, BRIDGE_DECK + 1.62, BRIDGE_Z - 0.4, 352.0, -9.0],
    "weir": [float(river_x(106)) - float(bed_half(106)) - WALL_RUN - 0.6, float(bank_top(106)) + 0.25 + 1.62, 106.0, 18.0, -14.0],
    "paddies": [-40.0, sample(-40, 200) + 1.62, 200.0, 70.0, -2.0],
}

meta = {
    "version": 3,
    "seed": SEED,
    "units": "meters",
    "up": "Y",
    "axes": "+X east, +Y up, +Z south (north = -Z). Right-handed (Three.js).",
    "extent": EXTENT,
    "resolution": N,
    "heightEncoding": {"file": "heightmap.r16", "format": "uint16-le", "minHeight": H_MIN, "range": H_RANGE,
                       "row0": "z=-600", "column0": "x=-600", "formula": "y = raw/65535*range + minHeight"},
    "splat": {"files": ["splat0.png", "splat1.png", "splat2.png"], "layers": order,
              "materials": {"grass": "leafy_grass", "forest": "forest_leaves_02", "dirt": "stony_dirt_path", "rock": "mossy_rock",
                            "paddy": "brown_mud_leaves_01", "riverbed": "river_small_rocks", "gravel": "gravel_floor_02", "asphalt": "worn_asphalt", "furrows": "farm_furrows", "bar": "ganges_river_pebbles"}},
    "vegetationMask": {"file": "vegetation-mask.png", "channels": ["forestDensity", "paddyIdHash", "paddyInterior", "grassDensity"]},
    "paddyLevel": {"file": "paddy-level.png", "encoding": "same as heightEncoding, uint16 PNG"},
    "environment": {"date": "1994-08-08", "latitude": 38.32, "longitude": 141.02, "timezone": 9, "defaultTime": 18.0,
                    "timeRange": [17.0, 19.0], "sky": "assets/sky/evening_road_01_puresky", "notes": "Sun position from a standard solar position algorithm (NOAA approximation)."},
    "landmarks": landmarks,
    "stair": {"axis": "+X", "z": STAIR_Z, "x0": STAIR_X0, "x1": round(STAIR_X1, 3), "footY": FOOT_Y, "topY": TOP_Y,
              "rise": RISE, "tread": TREAD, "steps": STEPS, "flight": FLIGHT, "landing": LANDING, "width": STAIR_W},
    "precinct": PRECINCT,
    "steps": steps,
    "objects": objects,
    "fields": fields,
    "river": river_meta,
    "roads": [{"id": "village-road", "width": 4.0, "surface": "asphalt", "points": road_pts},
              {"id": "shrine-branch", "width": 3.6, "surface": "dirt", "points": branch_pts}],
    "powerLine": {"poles": poles, "wires": 3, "sag": 0.6},
    "ditch": {"offset": DITCH_OFF, "width": 0.45, "depth": 0.42, "zRange": [-500, 540], "crossings": [BRIDGE_Z]},
    "budgets": {"high": {"triangles": 4500000, "drawCalls": 900, "pixelRatio": 1.5},
                "standard": {"triangles": 2800000, "drawCalls": 650, "pixelRatio": 1.0},
                "low": {"triangles": 1200000, "drawCalls": 400, "pixelRatio": 0.8}},
}
(OUT / "scene.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1, default=_np))
(OUT / "vegetation.json").write_text(json.dumps({
    "format": "[x, y, z, scale, yawRadians, variant, lean]", "seed": SEED + 7, "trees": trees}, separators=(",", ":"), default=_np))
(OUT / "clutter.json").write_text(json.dumps({
    "format": "[x, y, z, scale, yawRadians, variant]", "seed": SEED + 7, "items": clutter}, separators=(",", ":"), default=_np))

# ---- Far mountains (outside the 1.2 km map) -----------------------------------------
FN, FEXT = 257, 14000.0
fa = np.linspace(-FEXT / 2, FEXT / 2, FN)
FX, FZ = np.meshgrid(fa, fa)
fr = np.hypot(FX, FZ)
ang = np.arctan2(FX, -FZ)
far = (90 + 330 * ridged(P3, FX, FZ, 2600, 6)) * smoothstep(500, 2600, fr)
far += (120 + 380 * ridged(P4, FX * 1.3, FZ * 1.3, 1800, 5)) * smoothstep(3000, 6500, fr) * (0.7 + 0.3 * np.cos(ang * 3 + 1))
far += 40 * fbm(P5, FX, FZ, 300, 4)
sector = np.abs(((np.degrees(ang) % 360) - 286.0 + 180) % 360 - 180)
far_gap = 1 - smoothstep(9, 20, sector)
far = far - np.maximum(far - (0.028 * fr), 0) * far_gap
far = np.clip(far, 0, 1600)
Image.fromarray(np.rint(far / 1600 * 65535).astype(np.uint16)).save(OUT / "far-heightmap.png")
meta_far = {"file": "far-heightmap.png", "resolution": FN, "extent": FEXT, "minHeight": 0, "range": 1600,
            "note": "Distant ranges for the horizon. The inner 1.2 km is covered by the detailed terrain."}
(OUT / "far-terrain.json").write_text(json.dumps(meta_far, indent=1))

counts = {k: len(v) for k, v in trees.items()}
print(f"terrain {N}x{N}, houses {len(houses)}, fields {len(fields)}, trees {counts}, clutter {{k: len(v) for k,v in clutter.items()}}")
print("clutter", {k: len(v) for k, v in clutter.items()}, "objects", len(objects))
