"""Engine-independent world source for 夏陰 (Natsukage).

Units: metres. Axes: +X east, +Y up, +Z south (Three.js right-handed; north is -Z).
Everything is deterministic from SEED. Outputs go to public/world/.

Layout (see docs/TERRAIN_DESIGN.md):
  * a N-S mountain valley, floor 2-9 m, gently falling to the south
  * a stream (4-6 m wide) meandering along the west side of the valley floor
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
    return 4.6 + 1.0 * np.sin(np.asarray(z) * 0.013 + 0.3)


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

# River channel.
rx = river_x(Z)
rw = river_width(Z)
rd = np.abs(X - rx)
water_level = floor_base(Z) - 1.45
bed = water_level - 0.25 - 0.45 * (1 - smoothstep(0, rw / 2, rd)) + 0.9 * smoothstep(rw / 2 - 0.4, rw / 2 + 2.6, rd)
channel = 1 - smoothstep(rw / 2 + 1.2, rw / 2 + 3.4, rd)
valley_open = smoothstep(-640, -560, Z)
h = h * (1 - channel * valley_open) + bed * channel * valley_open

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
            if abs(x - float(river_x(z))) < 30:
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
    & (np.abs(X - rx) > rw / 2 + 7)
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

# Irrigation channel along the road side (concrete U-channel, 0.6 m wide).
canal_x = road + np.where(X > road, 4.2, -4.2)

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
forest_density = np.where(is_paddy | (road_d < 6), 0, forest_density)
rock = smoothstep(50, 62, slope) * (1 - is_paddy)
riverbed = (1 - smoothstep(rw / 2 - 0.2, rw / 2 + 1.8, rd)) * valley_open
asphalt = (1 - smoothstep(1.9, 2.4, road_d)) * smoothstep(-560, -520, Z) * (1 - smoothstep(560, 590, Z))
branch = (1 - smoothstep(1.8, 2.3, bd))
dirt = np.clip(branch + (1 - smoothstep(0.8, 1.4, np.abs(Z - STAIR_Z))) * ((X > 92) & (X < STAIR_X0)) * 0, 0, 1)
# Farm tracks: every few band edges become 2.5 m dirt tracks through the paddies.
track = np.zeros_like(h)
for i, e in enumerate(band_edges):
    if i % 3 == 1:
        track = np.maximum(track, (1 - smoothstep(1.0, 1.6, np.abs(t - e))) * (~is_paddy | aze))
track = track * ((np.abs(X - rx) > rw / 2 + 2) & (road_d > 2.3) & (mountain_factor < 3))
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
layers = dict(grass=grass, forest=forest_floor, dirt=dirt, rock=rock, paddy=paddy_mud, riverbed=riverbed, gravel=gravel, asphalt=asphalt, furrows=furrows)
order = ["grass", "forest", "dirt", "rock", "paddy", "riverbed", "gravel", "asphalt", "furrows"]
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

def blocked(x, z, top=None):
    if abs(z - STAIR_Z) < STAIR_W / 2 + 1.6 and STAIR_X0 - 26 < x < STAIR_X1 + 2:
        return True
    if on_approach(x, z, 1.0):
        return True
    if px0 - 1 < x < px1 - 4 and pz0 + 6 < z < pz1 - 2:
        return True
    if abs(x - float(road_x(z))) < 5.5:
        return True
    if abs(x - float(river_x(z))) < float(river_width(z)) / 2 + 1.2:
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
# Riverside trees.
for z in np.arange(-500, 560, 9):
    if rv.random() < 0.45:
        side = rv.choice([-1, 1])
        x = float(river_x(z)) + side * (float(river_width(z)) / 2 + rv.uniform(2.5, 6))
        if not blocked(x, z) and cell(is_paddy.astype(float), x, z) < 0.5:
            add_tree("broadleaf", x, z, rv.uniform(0.45, 0.8))

# ---- Ground clutter (near the walkable core only) -------------------------------
clutter = {k: [] for k in ["fern", "shrub", "weed", "rock_moss", "boulder", "river_stone", "stump", "log", "susuki", "crop"]}
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

# River stones and boulders.
for z in np.arange(-260, 470, 1.6):
    for k in range(3):
        rwz = float(river_width(z))
        x = float(river_x(z)) + rv.uniform(-rwz / 2 - 1.6, rwz / 2 + 1.6)
        if rv.random() < 0.55:
            add_clutter("river_stone", x, z + rv.uniform(-0.8, 0.8), rv.uniform(0.25, 0.9), int(rv.integers(0, 3)), sink=0.18)
    if rv.random() < 0.18:
        x = float(river_x(z)) + rv.choice([-1, 1]) * rv.uniform(1.0, float(river_width(z)) / 2 + 2.2)
        add_clutter("boulder", x, z, rv.uniform(0.35, 0.9), int(rv.integers(0, 2)), sink=0.35)

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

# Bridge where a farm track crosses the stream.
BRIDGE_Z = 140.0
bx = float(river_x(BRIDGE_Z))
obj("bridge", bx, float(floor_base(BRIDGE_Z)) + 0.55, BRIDGE_Z, math.atan2(float(river_x(BRIDGE_Z + 1) - river_x(BRIDGE_Z - 1)), 2.0), 1.0,
    span=round(float(river_width(BRIDGE_Z)) + 6, 2), collider={"type": "box", "halfExtents": [5.5, 0.2, 1.4]})

# ---- River / road / canal geometry data ------------------------------------------
river_pts = []
for z in np.arange(-600, 601, 2.5):
    river_pts.append([round(float(river_x(z)), 3), round(float(floor_base(z) - 1.45), 3), round(float(z), 3), round(float(river_width(z)), 3)])
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
    "river": [float(river_x(140)) + 6.0, float(floor_base(140)) + 1.6, 128.0, 300.0, -6.0],
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
                            "paddy": "brown_mud_leaves_01", "riverbed": "river_small_rocks", "gravel": "gravel_floor_02", "asphalt": "worn_asphalt", "furrows": "farm_furrows"}},
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
    "river": {"points": river_pts, "format": "[x, waterY, z, width]", "bridgeZ": BRIDGE_Z},
    "roads": [{"id": "village-road", "width": 4.0, "surface": "asphalt", "points": road_pts},
              {"id": "shrine-branch", "width": 3.6, "surface": "dirt", "points": branch_pts}],
    "powerLine": {"poles": poles, "wires": 3, "sag": 0.6},
    "ditch": {"offset": DITCH_OFF, "width": 0.45, "depth": 0.42, "zRange": [-500, 540]},
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
