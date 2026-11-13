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
import os
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from noise import Perlin, fbm, ridged, smoothstep  # noqa: E402
import region  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/world"
OUT.mkdir(parents=True, exist_ok=True)

SEED = 19940808
EXTENT = 1500.0
N = 1281
CELL = EXTENT / (N - 1)
HALF = EXTENT / 2
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

import time as _time
_t0 = _time.time()
def _tick(label):
    """Progress line with the elapsed time (the generator takes a couple of minutes)."""
    print(f"[{_time.time() - _t0:6.1f}s] {label}", flush=True)

def _np(o):
    if isinstance(o, np.generic):
        return o.item()
    raise TypeError(type(o))

P1, P2, P3, P4, P5 = (Perlin(SEED + i) for i in range(5))

axis = np.linspace(-EXTENT / 2, EXTENT / 2, N)
X, Z = np.meshgrid(axis, axis)   # row = z, col = x


# ---- Large-scale geography --------------------------------------------------
def floor_base(z):
    """Valley floor falls ~0.6% towards the south; the headwater gorge beyond the map is steeper."""
    z = np.asarray(z, dtype=np.float64)
    return 5.6 - 0.0058 * z + 0.02 * np.maximum(-900.0 - z, 0)


# The valley is drawn through control points (z, x of the middle of the floor, half width of the
# floor): a narrow, winding floor between steep hills that opens into small basins where the side
# valleys come in - the centre of the village sits in the widest one - and pinches into the river's
# gorge north of the village. (See docs/TERRAIN_DESIGN.md: modelled on the valleys of hill villages,
# where the fields are strips across a floor only 150-300 m wide.)
VALLEY = np.array([
    (-2600, -330, 26), (-1500, -290, 30), (-1000, -240, 34), (-760, -196, 44), (-610, -150, 66),
    (-470, -92, 102), (-330, -62, 116), (-190, -74, 100), (-40, -22, 122), (110, -46, 150),
    (250, -86, 126), (390, -94, 102), (520, -66, 106), (680, -30, 118), (900, -6, 124),
    (1500, -40, 150), (2600, -90, 185)], dtype=np.float64)

def _valley_table():
    from scipy.interpolate import PchipInterpolator
    from scipy.ndimage import gaussian_filter1d
    zt = np.arange(-2700.0, 2700.5, 1.0)
    zc = np.clip(zt, VALLEY[0, 0], VALLEY[-1, 0])
    ax = gaussian_filter1d(PchipInterpolator(VALLEY[:, 0], VALLEY[:, 1])(zc), 28.0, mode="nearest")
    hf = gaussian_filter1d(PchipInterpolator(VALLEY[:, 0], VALLEY[:, 2])(zc), 28.0, mode="nearest")
    # the river keeps to the western foot of the hills, swinging out a little where the floor is wide;
    # the prefectural road follows the eastern foot
    rv = ax - hf + 24 + 16 * (0.5 + 0.5 * np.sin(zt * 0.0105 + 1.0)) * np.clip((hf - 60) / 60, 0, 1)
    rd = ax + hf - 34 - 8 * (0.5 + 0.5 * np.sin(zt * 0.0088 + 2.2)) * np.clip((hf - 60) / 60, 0, 1)
    # the old road keeps close to the hill foot and bends with it, round the spurs and into the
    # mouths of the side valleys, rather than cutting across the floor in one sweep
    rd = rd + 5.0 * np.sin(zt * 0.023 + 0.8) * np.clip((hf - 60) / 50, 0, 1)
    return zt, ax, hf, gaussian_filter1d(rv, 14.0, mode="nearest"), gaussian_filter1d(rd, 9.0, mode="nearest")

_VZ, _VAX, _VHF, _VRIVER, _VROAD = _valley_table()


def river_base_x(z):
    """The river's line down the valley: along the western edge of the floor in long bends. The
    hamlet of Kawamuko, its apron and the side valleys are laid out from this line."""
    return np.interp(np.asarray(z, dtype=np.float64), _VZ, _VRIVER)


# Through the village centre (the weir, the bridge) the river was straightened and walled in a
# river improvement; above and below it keeps its own course: it meanders across the floor, with
# point bars inside the bends and cut banks outside them.
CHAN_Z0, CHAN_Z1 = -50.0, 226.0
MEANDER_L = 280.0


def natural_w(z):
    """1 in the natural reaches, 0 in the straightened reach through the village centre."""
    z = np.asarray(z, dtype=np.float64)
    return 1 - smoothstep(CHAN_Z0 - 34.0, CHAN_Z0, z) * (1 - smoothstep(CHAN_Z1, CHAN_Z1 + 34.0, z))


def meander_s(z):
    """Phase along the meanders (irregular wavelength, ~280 m). The outer bends on the east fall at the
    hamlets' washing places (z = -250 and 300)."""
    z = np.asarray(z, dtype=np.float64)
    return z * (2 * np.pi / MEANDER_L) + 0.55 * np.sin(z * 0.0105 + 0.4) + 1.34


def river_x(z):
    """Centre line of the river bed: the valley line plus the meanders of the natural reaches
    (none in the gorge north of the village, where the hills hold the river)."""
    z = np.asarray(z, dtype=np.float64)
    amp = 10.5 * natural_w(z) * smoothstep(-640.0, -560.0, z) * (1 - smoothstep(HALF - 70.0, HALF + 30.0, z))
    return river_base_x(z) + amp * np.sin(meander_s(z))


def valley_axis(z):
    """Middle of the valley floor."""
    return np.interp(np.asarray(z, dtype=np.float64), _VZ, _VAX)


def valley_floor_half(z):
    """Half width of the level valley floor."""
    return np.interp(np.asarray(z, dtype=np.float64), _VZ, _VHF)


def valley_half_width(z):
    """Scale of the valley cross-section: the floor is 0.7 of it, the hills are full height at 2.3."""
    return valley_floor_half(z) / 0.7


def river_width(z):
    """Width of the low-flow water channel inside the bed (4.3-6.9 m; pools spread wider)."""
    z = np.asarray(z, dtype=np.float64)
    return 5.6 + 0.85 * np.sin(z * 0.013 + 0.3) + 0.45 * np.sin(z * 0.041 + 1.0)


# ---- River design ----------------------------------------------------------------
_tick('River design')
# A small valley river of the kind that runs along the foot of the hills in Tohoku farm
# valleys (see docs/TERRAIN_DESIGN.md, "川"). Through the village centre it runs straight between
# concrete-block revetments with a concrete cap and a levee path, held by drop structures and a
# fixed weir whose pool feeds an irrigation intake. Above and below, the river keeps a natural
# course: a 12-18 m stony bed winding across the floor between earth banks, the low-flow
# channel against the outer bank of every bend (a pool, up to 0.8 m deep) and crossing over
# between them in shallow riffles (0.1-0.25 m) past point bars of gravel, grass and willow
# scrub. Old dry-stone revetments, broken in places, protect the outer bends that press on the
# fields and the hamlets' washing places.
WALL_RUN = 0.75          # horizontal run of a 1:0.4 masonry revetment
CAP_W = 1.2              # concrete cap + gravel verge on top of a masonry revetment
PATH_W = 3.0             # levee path beyond the cap
REACH_SLOPE = 0.0015     # water surface slope between drop structures
WEIR_Z, BRIDGE_Z = 92.0, 140.0
POOL_Z0 = WEIR_Z - 135.0  # the weir backs the water up to the head of the walled reach
WL_NAT = 1.45             # natural reaches: water this far below the valley floor
WL_CHAN = 1.25            # walled reach: held higher by the drop structures


def _band(z, a, b, ramp=8.0):
    return smoothstep(a - ramp, a, z) * (1 - smoothstep(b, b + ramp, z))


def bed_half(z):
    """Half width of the bed between the banks: 10-14.6 m walled, 11-20 m in the natural reaches
    (widest at the apex of a bend, where the point bar is)."""
    z = np.asarray(z, dtype=np.float64)
    nat = natural_w(z)
    b_chan = 6.0 + 0.9 * np.sin(z * 0.0093 + 1.3) + 0.4 * np.sin(z * 0.031)
    b_nat = 6.0 + 3.0 * np.abs(np.sin(meander_s(z) - 0.15)) + 0.7 * np.sin(z * 0.027 + 2.1)
    b = b_chan * (1 - nat) + b_nat * nat
    return b * (0.62 + 0.38 * smoothstep(-640.0, -540.0, z))


def bank_top(z):
    return floor_base(z) + 0.42


# Bank protection, per side: (z0, z1, facing) - "block" concrete kenchi blocks laid diagonally
# (the river improvement through the centre), "kenchi" cut granite, "stone" old mossy dry stone.
# Old walls stand at the outer bends that bear on the fields; some have fallen in, leaving gaps.
_rw = np.random.default_rng(SEED + 32)
REVET = {True: [(CHAN_Z0 - 4.0, CHAN_Z1 + 4.0, "block")], False: [(CHAN_Z0 - 4.0, CHAN_Z1 + 4.0, "block")]}
_zq = np.arange(-HALF, HALF, 0.5)
_ms = meander_s(_zq)
_apex = []                                   # (z, east?) at the apex of every natural bend
for _k in range(1, len(_zq) - 1):
    for _east, _tgt in ((True, np.pi / 2), (False, -np.pi / 2)):
        _a0 = (_ms[_k - 1] - _tgt) % (2 * np.pi)
        _a1 = (_ms[_k] - _tgt) % (2 * np.pi)
        if _a1 < _a0 and natural_w(_zq[_k]) > 0.99 and -540.0 < _zq[_k] < HALF - 60:
            _apex.append((float(_zq[_k]), _east))
WASH_STEPS = []                              # stone steps down the east wall (kawato / araiba) by the hamlets
for _z0, _east in _apex:
    if not _east:
        continue                             # western outer bends cut into the wooded hill foot: left alone
    near_hamlet = min(abs(_z0 - (-250.0)), abs(_z0 - 300.0)) < 40
    if True:
        a_, b_ = _z0 - _rw.uniform(30, 45), _z0 + _rw.uniform(18, 32)
        if near_hamlet and not WASH_STEPS or (near_hamlet and min(abs(w_ - _z0) for w_ in WASH_STEPS) > 200):
            WASH_STEPS.append(round(_z0 - 6.0, 1))
        if not near_hamlet:
            g_ = _rw.uniform(a_ + 12, b_ - 12)   # a collapsed stretch
            REVET[True] += [(a_, g_ - 3.0, "stone"), (g_ + 3.0 + _rw.uniform(0, 4), b_, "stone")]
        else:
            REVET[True].append((a_, b_, "stone"))
# below the centre the old road to Kawamuko ran along the west bank: a short kenchi wall there
REVET[False].append((CHAN_Z1 + 4.0, CHAN_Z1 + 46.0, "kenchi"))
# where a western bend cuts towards the foot of the Kawamuko terraces, an old wall, partly fallen
for _z0, _east in _apex:
    if not _east and 340.0 < _z0 < 470.0:
        REVET[False] += [(_z0 - 34.0, _z0 - 6.0, "stone"), (_z0 + 2.0, _z0 + 26.0, "stone")]
assert len(WASH_STEPS) == 2, WASH_STEPS
assert all(any(a_ + 2 < w_ < b_ - 2 for a_, b_, _ in REVET[True]) for w_ in WASH_STEPS), "washing steps need a wall"
_FACING = {"stone": 0, "block": 1, "kenchi": 2}
_bank_tab = {}
for _side in (False, True):
    e_ = np.ones_like(_zq)
    f_ = np.zeros_like(_zq)
    for a_, b_, k_ in REVET[_side]:
        m_ = (_zq >= a_) & (_zq <= b_)
        e_[m_] = 0.0
        f_[m_] = _FACING[k_]
    _bank_tab[_side] = (e_, f_)


def earth_bank(z, east):
    """1 = plain earth bank (natural slope), 0 = masonry revetment; per bank side."""
    e_, _ = _bank_tab[bool(east)]
    return np.interp(np.asarray(z, dtype=np.float64), _zq, e_)


def wall_facing(z, east):
    """Revetment facing code at z: 0 old dry stone, 1 concrete kenchi blocks, 2 cut granite."""
    _, f_ = _bank_tab[bool(east)]
    i_ = np.clip(np.rint((np.asarray(z, dtype=np.float64) + HALF) / 0.5).astype(int), 0, len(_zq) - 1)
    return f_[i_]


def wall_kind(z, east):
    return {0: "stone", 1: "block", 2: "kenchi"}[int(wall_facing(z, east))]


DROPS = [178.0, 222.0]                        # drop structures in the walled reach below the weir
MARKS = sorted(DROPS + [POOL_Z0, WEIR_Z])
_reach_a, _reach_pool = [], []


def _z_eff(z):
    """Riffle-pool profile of the natural reaches: the surface falls steeply over the riffles where the
    channel crosses between bends and lies nearly level along the pools (two of each per meander)."""
    z = np.asarray(z, dtype=np.float64)
    return z + (MEANDER_L / (4 * np.pi)) * 0.6 * np.sin(2 * (meander_s(z) - 0.25))


def _wl_nat(z):
    return floor_base(_z_eff(z)) - WL_NAT


for _r in range(len(MARKS) - 1):
    _a, _b = MARKS[_r], MARKS[_r + 1]
    if _b == WEIR_Z:
        # weir pool: level, 0.22 m below the natural water just above its head
        _reach_a.append(float(_wl_nat(_a - 1e-3)) - 0.22)
        _reach_pool.append(True)
    else:
        _m = 0.5 * (_a + _b)
        _reach_a.append(float(floor_base(_m)) - WL_CHAN + REACH_SLOPE * (_m - _a))
        _reach_pool.append(False)
_bounds_np, _reach_a_np, _reach_pool_np = np.array(MARKS), np.array(_reach_a), np.array(_reach_pool)


def water_level(z):
    """Water surface height: riffle-pool profile in the natural reaches, gently sloping reaches
    separated by drops in the walled one (non-increasing downstream everywhere)."""
    z = np.asarray(z, dtype=np.float64)
    r = np.clip(np.searchsorted(_bounds_np, z, side="right") - 1, 0, len(_reach_a_np) - 1)
    chan = _reach_a_np[r] - np.where(_reach_pool_np[r], 0.0, REACH_SLOPE) * (z - _bounds_np[r])
    return np.where((z < MARKS[0]) | (z >= MARKS[-1]), _wl_nat(z), chan)


DROP_INFO = []
for _i, _d in enumerate(MARKS):
    up = float(water_level(_d - 1e-3))
    dn = float(water_level(_d + 1e-3))
    assert up - dn > 0.18, (_d, up, dn)
    DROP_INFO.append(dict(z=_d, kind="weir" if _d == WEIR_Z else "drop", up=round(up, 3), down=round(dn, 3)))
_zt_ = np.arange(-HALF - 50, HALF + 50, 0.25)
assert np.all(np.diff(water_level(_zt_)) <= 1e-9), "water level must not rise downstream"


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
    """Bar phase: alternate bars (~134 m) in the walled reach; in the natural reaches the meander
    itself, lagging a little so each pool lies just past the apex of its bend."""
    z = np.asarray(z, dtype=np.float64)
    nat = natural_w(z)
    return (z * 0.047 + 0.6) * (1 - nat) + (meander_s(z) - 0.25) * nat


def low_off(z):
    """Lateral offset of the low-flow channel from the bed centre: towards the outer bank of each
    bend (natural reaches), between alternate bars (walled reach)."""
    amp = np.clip(bed_half(z) - river_width(z) / 2 - 0.9, 0, None)
    return amp * 0.88 * np.sin(_phase(z)) * (1 - full_width(z))


def chan_half(z):
    """Half-width of the wetted channel; crossings (riffles) are wider and shallower."""
    hw = (river_width(z) / 2 - 0.35) * (1 + 0.24 * (1 - np.abs(np.sin(_phase(z)))))
    fw = full_width(z)
    return hw * (1 - fw) + bed_half(z) * fw


def earth_slope(z, east):
    """Run per unit height of an earth bank: 1:1.6; steeper (1:0.9) where the channel cuts into the
    outer bank of a natural bend, gentler (1:2.3) on the inside of the bend."""
    sgn = 1.0 if east else -1.0
    k = sgn * np.sin(_phase(z)) * natural_w(z) * (1 - full_width(z))
    return 1.6 - 0.7 * np.clip(k, 0, 1) + 0.7 * np.clip(-k, 0, 1)


def bank_ext(z, east):
    """Horizontal reach of the bank from the edge of the bed to the bank top (with the cap of a wall)."""
    e = earth_bank(z, east)
    return (WALL_RUN + CAP_W) * (1 - e) + earth_slope(z, east) * 2.2 * e


def levee_path_x(z):
    """Centre of the path along the top of the east bank."""
    return river_x(z) + bed_half(z) + bank_ext(z, True) + PATH_W / 2


# The irrigation canal from the weir runs straight along the field edges, not round every bend of
# the river: a smooth line just outside the furthest reach of the east bank and its path.
from scipy.ndimage import maximum_filter1d as _maxf1, gaussian_filter1d as _gf1
_ctab_z = np.arange(-HALF - 60.0, HALF + 60.0, 1.0)
_ctab_x = _gf1(_maxf1(river_x(_ctab_z) + bed_half(_ctab_z) + bank_ext(_ctab_z, True) + PATH_W, size=91), 14.0) + 1.6


def canal_x(z):
    return np.interp(np.asarray(z, dtype=np.float64), _ctab_z, _ctab_x)


def bed_surface(u, z, x):
    """Bed height at lateral offset u (= x - river_x) for row z."""
    B, WL, fw, pool = bed_half(z), water_level(z), full_width(z), weir_pool(z)
    hw, c = chan_half(z), low_off(z)
    nat = natural_w(z)
    ph = np.abs(np.sin(_phase(z)))
    dc = np.abs(u - c)
    # riffles 0.1-0.25 m, pools to 0.8 m (natural) / 0.7 m (walled); the deepest line of a pool
    # hugs the outer bank of its bend
    dmax = (0.2 + 0.5 * ph ** 1.5) * (1 - nat) + (0.1 + 0.7 * ph ** 1.4) * nat
    dmax = dmax * (1 - pool) + (0.45 + 0.6 * smoothstep(POOL_Z0, WEIR_Z, z)) * pool
    cd = c + np.sign(c) * 0.3 * hw * ph * nat * (1 - fw)
    span = np.where(u - cd > 0, np.maximum(c + hw - cd, 0.5), np.maximum(cd - (c - hw), 0.5))
    chan = WL - 0.04 - dmax * np.clip(1 - ((u - cd) / span) ** 2, 0, 1) + 0.07 * fbm(P3, x, z, 1.3, 2)
    # bars: gravel rising from the water's edge; inside a natural bend a broad point bar that
    # climbs to a grassy bench (the ground the river takes back in a flood)
    rise = (0.62 + 0.33 * nat) * smoothstep(0.0, 4.2 + 3.0 * nat, dc - hw) ** 0.85
    bar = WL - 0.04 + rise
    bump = 0.13 * fbm(P1, x, z, 3.2, 2) + 0.05 * fbm(P3, x, z, 1.1, 1) + 0.12 * nat * fbm(P4, x, z, 9.0, 2)
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
    """Centre line of the prefectural road: along the eastern foot of the hills."""
    return np.interp(np.asarray(z, dtype=np.float64), _VZ, _VROAD)


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
    # the ridge behind it runs back into the hills, where the regional model takes over
    ridge = (TOP_Y + 30) * np.exp(-((z - cz) / 85) ** 2) * smoothstep(190, 420, x) * (1 - smoothstep(380, 520, x))
    return np.maximum(spur, ridge)


# ---- Hills: a regional landform model --------------------------------------------------
_tick('Hills: a regional landform model')
# The hills are grown, not drawn (tools/world/region.py): a 4.8 km square around the map is
# uplifted and worn down by streams until side valleys (sawa), spurs and hollows have formed
# around the surfaces that are designed by hand - the valley floor, the long footslope of
# Kawamuko and the shrine spur. `mountains0` is only the pattern of uplift: where the ranges
# stand high and where the ground stays low.
TUNNEL_Z = -HALF + (round((-560.0 + HALF) / CELL - 0.5) + 0.5) * CELL   # portal face, between two terrain rows

def head_closure(x, z):
    """0..1: north of the village the eastern hills step out across the road line, leaving only
    the river's gorge; the prefectural road goes through them in a tunnel."""
    zz = z + 14 * fbm(P1, x, z, 120, 2)
    along = smoothstep(TUNNEL_Z + 22, TUNNEL_Z - 70, zz) * (1 - smoothstep(TUNNEL_Z - 210, TUNNEL_Z - 300, zz))
    return along * smoothstep(-52, 26, x - road_x(z) + 18 * fbm(P2, x, z, 90, 2))

KAWA_DW_ = 150.0                 # (KAWA_DW below: the lane of Kawamuko this far from the river line)
def kawamuko_apron(x, z):
    """Kawamuko: an old fan surface west of the river, a long even footslope (about 1 in 8.5)
    terraced for rice. Returns (height above the floor, 0..1 weight of the designed surface)."""
    dw = river_base_x(z) - x - 14
    def prof(d_):
        d_ = np.maximum(d_, 0)
        a_ = 0.082 * d_ + 0.00017 * d_ ** 2                  # gentle by the river, steeper under the hills
        return a_ + (2.4 * fbm(P3, x, z, 150, 2) + 1.5 * np.sin(z * 0.033 + 0.7 + 0.004 * d_)) * smoothstep(15, 110, d_)
    # the hamlet's lane runs along a level bench (an old river terrace, widened where the houses
    # stand): ~42 m wide, then a short steep scarp back up to the slope
    db = KAWA_DW_ + 9.0 * np.sin((z - 150.0) * 0.021)
    d0, d1 = db - 20.0, db + 22.0
    a0, a1 = prof(d0), prof(d1)
    a = prof(dw)
    bench = smoothstep(d0 - 6.0, d0, dw) * (1 - smoothstep(d1, d1 + 14.0, dw))
    flat = a0 + (a1 - a0) * smoothstep(d1, d1 + 14.0, dw)
    zone = smoothstep(95.0, 135.0, z) * (1 - smoothstep(330.0, 370.0, z))
    a = a + (np.minimum(flat, a) - a) * bench * zone
    edge = 28 * fbm(P1, x, z, 110, 2)
    w = smoothstep(-5 + edge, 45 + edge, z) * (1 - smoothstep(405 + edge, 455 + edge, z)) * (x < river_base_x(z)) * (1 - smoothstep(235 + edge, 275 + edge, dw))
    return np.maximum(a, 0), w

def _seg_dist(px, pz, a, b):
    vx, vz = b[0] - a[0], b[1] - a[1]
    t = np.clip(((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz), 0, 1)
    return np.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t)), t

# lines of weakness where the larger side valleys run: (mouth, head, strength 0..1, half width m)
SAWA_SEEDS = [((float(road_x(-380.0)) + 40, -380.0), (780.0, -500.0), 0.8, 60.0),      # Okusawa, east
              ((float(road_x(232.0)) + 40, 232.0), (700.0, 120.0), 0.8, 60.0),         # behind the shrine hill, east
              ((float(road_x(500.0)) + 40, 500.0), (790.0, 640.0), 0.75, 55.0),        # Minamizawa, east
              ((float(river_base_x(478.0)) - 40, 478.0), (-790.0, 380.0), 0.75, 55.0)]      # south of Kawamuko, west

def mountains0(x, z):
    ax = valley_axis(z)
    w = valley_half_width(z)
    d = np.abs(x - ax)
    rise = smoothstep(w * 0.7, w * 2.3, d)
    wx = x + 90 * fbm(P2, x, z, 520, 3)
    wz = z + 90 * fbm(P3, x, z, 520, 3)
    r_big = ridged(P1, wx, wz, 880, 4, gain=0.45)
    r_med = fbm(P4, wx, wz, 330, 4, gain=0.5) * 0.5 + 0.5
    relief = 55 + 150 * r_big + 75 * r_med
    gain = 1 + 0.85 * smoothstep(650, 2300, d)
    m = relief * gain * rise ** 1.25 + 9 * fbm(P5, x, z, 80, 3) * rise
    # low benches inside the valley margins (hamlet sites, bamboo, orchards)
    foot = smoothstep(w * 0.45, w * 0.85, d) * (5 + 9 * (fbm(P5, x, z, 120, 4) * 0.5 + 0.5))
    out = np.maximum(m + foot, 0.85 * relief * head_closure(x, z))
    out = np.maximum(out, shrine_spur(x, z))
    ap, aw = kawamuko_apron(x, z)
    out = out * (1 - aw) + np.minimum(out, ap) * aw
    out = sun_gap(x, z, out)
    for a, b, strength, hw in SAWA_SEEDS:
        dd, t = _seg_dist(x, z, a, b)
        out = out * (1 - strength * (1 - 0.5 * t) * np.exp(-(dd / hw) ** 2))
    return np.maximum(out, 0)

REGION_EXTENT, REGION_N = 4800.0, 769
REGION_CELL = REGION_EXTENT / (REGION_N - 1)
_ra = np.linspace(-REGION_EXTENT / 2, REGION_EXTENT / 2, REGION_N)
RX, RZ = np.meshgrid(_ra, _ra)
REGION_PARAMS = dict(steps=240, k=0.2, m=0.45, uplift=1.5, creep=0.5, talus=0.95, edge=60.0, v=10)
REGION_PARAMS.update(json.loads(os.environ.get("REGION_TUNE", "{}")))      # for tuning runs only

def _region_inputs():
    m0 = mountains0(RX, RZ)
    ap, aw = kawamuko_apron(RX, RZ)
    sp = shrine_spur(RX, RZ)
    # designed surfaces keep their height: 0 = free hillside, otherwise the height above the floor
    floor = m0 < 0.25
    design = np.zeros_like(m0)
    design = np.where(aw > 0.5, ap, design)
    design = np.where((sp > 4.0) & (RX < 345), sp, design)
    return m0, floor, design

def _region_compute():
    from scipy import ndimage as ndi
    m0, floor, design = _region_inputs()
    fl = floor_base(RZ)
    hard = design > 0
    fixed = floor | hard
    edge = np.zeros_like(fixed)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    edge &= ~fixed
    rs = np.random.default_rng(SEED + 5)
    dist = ndi.distance_transform_edt(~fixed) * REGION_CELL
    start = 6 + 0.006 * dist + 5 * fbm(P4, RX, RZ, 260, 4) + 1.0 * fbm(P5, RX, RZ, 60, 3) + rs.normal(0, 0.12, m0.shape)
    h0 = fl + np.where(floor, 0.0, np.where(design > 0, design, start))
    h0 = np.where(edge, fl + REGION_PARAMS["edge"], h0)         # the level of the neighbouring valleys
    uplift = REGION_PARAMS["uplift"] * np.clip((m0 / 95.0) ** 0.8, 0.08, 1.35)
    rock = REGION_PARAMS["k"] * (1 + 0.45 * fbm(P2, RX, RZ, 700, 3))        # harder and softer ground
    h1, area = region.erode(h0, floor | edge, REGION_CELL, hard=hard, uplift=uplift, steps=REGION_PARAMS["steps"], k=rock, m=REGION_PARAMS["m"],
                            creep=REGION_PARAMS["creep"], talus=REGION_PARAMS["talus"])
    paths = region.channel_paths(h1, area, floor | edge, REGION_CELL)
    h2, yatsu = region.valley_floors(h1, area, fixed | edge, REGION_CELL, width_k=0.05, width_max=40.0, a_field=6.0e5)
    h2 = np.where(fixed | edge, h2, ndi.gaussian_filter(h2, 0.6, mode="nearest"))
    # the designed surfaces meet the grown hills without a crease: soften a band along their outline
    dz_ = design > 0
    band = np.minimum(ndi.distance_transform_edt(dz_), ndi.distance_transform_edt(~dz_)) * REGION_CELL
    wgt_ = (1 - smoothstep(0.0, 34.0, band)) * ~floor
    h2 = h2 * (1 - wgt_) + ndi.gaussian_filter(h2, 3.0, mode="nearest") * wgt_
    M = np.maximum(h2 - fl, 0)
    M = np.where(floor, 0.0, sun_gap(RX, RZ, M))
    ofs = np.cumsum([0] + [len(p_) for p_ in paths])
    return dict(M=M, area=area, fixed=fixed, yatsu=yatsu, stream_pts=np.concatenate(paths) if paths else np.zeros((0, 4)), stream_ofs=ofs)

_m0, _floor0, _design0 = _region_inputs()
REGION = region.cached([_m0, _design0], REGION_PARAMS, ROOT / ".cache", _region_compute)
_mount = region.sampler(REGION["M"], REGION_EXTENT)
_yatsu = region.sampler(REGION["yatsu"], REGION_EXTENT)

def mountains(x, z):
    """Height of the hills above the valley floor (0 on the floor), from the regional model."""
    return np.maximum(_mount(x, z), 0)

def region_streams():
    """Side-valley streams as world polylines [(x, z, y, drained m2), ...] from the mouth upstream."""
    out = []
    o = REGION["stream_ofs"]
    for k in range(len(o) - 1):
        p_ = REGION["stream_pts"][o[k]:o[k + 1]]
        x_ = p_[:, 0] * REGION_CELL - REGION_EXTENT / 2
        z_ = p_[:, 1] * REGION_CELL - REGION_EXTENT / 2
        out.append(np.stack([x_, z_, p_[:, 2], p_[:, 3]], -1))
    return out


# ---- Height field ------------------------------------------------------------
_tick('Height field')
h = floor_base(Z) + 0.35 * fbm(P5, X, Z, 45, 3)
# the floor rises gently from the river towards the eastern hill foot (low alluvial fans),
# so the paddies step down towards the river
h = h + 0.75 * smoothstep(river_x(Z) + 25.0, road_x(Z) - 25.0, X)
_M = mountains(X, Z)
# small-scale relief the 6 m regional grid cannot hold: hummocks, old slips, tree-throw mounds
h = h + _M + 0.55 * fbm(P5, X, Z, 16, 3) * smoothstep(3.0, 28.0, _M)
# Where a side valley opens onto the floor, its brook has spread gravel out of the mouth in a low
# fan: a cone about 2.4 m high at the apex, ~110 m across, opening towards the floor. (The road,
# the hamlets and the fields then sit on it: the road runs in a shallow cut across the fan.)
for (_ma, _mb, _str, _mhw) in SAWA_SEEDS:
    _ux, _uz = _ma[0] - _mb[0], _ma[1] - _mb[1]
    _ul = math.hypot(_ux, _uz)
    _ux, _uz = _ux / _ul, _uz / _ul                      # out of the valley, onto the floor
    _ax, _az = _ma[0] - 14.0 * _ux, _ma[1] - 14.0 * _uz  # apex a little inside the mouth
    _r = np.hypot(X - _ax, Z - _az)
    _cos = ((X - _ax) * _ux + (Z - _az) * _uz) / np.maximum(_r, 1e-3)
    _fan = 2.4 * np.clip(1 - _r / 112.0, 0, 1) ** 1.5 * smoothstep(-0.45, 0.2, _cos) * (1 + 0.15 * fbm(P3, X, Z, 30, 2))
    _fan = _fan * smoothstep(7.0, 22.0, np.abs(X - road_x(Z)))   # the road runs through it in a cutting
    h = h + _fan * (1 - smoothstep(1.0, 8.0, _M))
# (the spur itself is stamped exactly; the ridge behind it is left to the regional model)
_sp = shrine_spur(X, Z) * (1 - smoothstep(312.0, 345.0, X))
h = np.maximum(h, _sp + 3.5 * fbm(P2, X, Z, 50, 4) * smoothstep(0.0, 25.0, _sp))

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
RIVER_KEEP = RB + np.maximum(bank_ext(Z, True), bank_ext(Z, False)) + PATH_W + 3.2     # bed + bank + levee path + canal

# Main road (prefectural road, kendo): 6 m of asphalt, two lanes with a dashed centre line and
# edge lines, gravel shoulders and concrete side ditches; graded slightly above the floor.
ROAD_HALF = 3.0
road = road_x(Z)
road_d = np.abs(X - road)
road_y = floor_base(Z) + 1.05
# Concrete side ditches (sokko) both sides of the road. The ground stays level over them: the
# terrain shader cuts the ditch opening (src/world/terrain.ts) and tools/architecture lines it.
DITCH_OFF = ROAD_HALF + 0.75
# At the head of the valley the hills close in and the road leaves through a tunnel (zuido): north
# of the portal it runs inside the hill, so nothing is cut there.
TUNNEL_TOP = 8.8                        # top of the portal face above the road
TUNNEL_SLOPE = float(road_x(TUNNEL_Z + 1.0) - road_x(TUNNEL_Z - 1.0)) / 2.0   # dx/dz of the bore
ROAD_Z0, ROAD_Z1 = TUNNEL_Z, HALF - 25.0
# Grading as road works do it: carriageway, shoulders and ditches flat at road level; beyond them
# the ground meets the road on 1:1 cut slopes and 1:1.5 fill slopes (never sheer walls). Behind
# the portal the hill is trimmed to a steep headwall over the face and kept above the bore.
W_FLAT = ROAD_HALF + 2.3                # (a full terrain cell beyond the ditch's outer wall)
dl = np.maximum(road_d - W_FLAT, 0.0)
behind = np.maximum(TUNNEL_Z - Z, 0.0)
TUNNEL_FACE = 9.0                       # half width of the portal face wall
face_top = np.where(road_d < TUNNEL_FACE - 0.6, TUNNEL_TOP, dl)      # beside the face the cut slopes run on
cut_top = road_y + np.where(Z < TUNNEL_Z, np.maximum(dl, face_top + 1.6 * behind), dl)
fill_bot = road_y - dl / 1.5
graded = np.clip(h, fill_bot, cut_top)
bore = (Z < TUNNEL_Z) & (road_d < 7.0)
graded = np.where(bore, np.maximum(graded, road_y + TUNNEL_TOP), graded)
# the south end runs off the map on the ground (fade the grading out over the last metres)
graded = h + (graded - h) * (1 - smoothstep(HALF - 30, HALF - 2, Z))
h = graded

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

# ---- Settlement ----------------------------------------------------------------------
_tick('Settlement')
# The village follows the pattern of a Tohoku valley village (docs/TERRAIN_DESIGN.md, "集落"):
#  * a small centre (machi) where the town road from the bridge meets the prefectural road:
#    shop-houses and public buildings in a row on both sides, fronts on the road, close together
#    (general store, liquor and tobacco shop, post office, police box, JA branch with its rice
#    warehouse, community hall, barber, fire lookout) - the services that cluster on the main road
#  * farm hamlets along the road on the gently rising foot of the eastern hills: houses that front
#    the road face it, those set back face south behind an igune windbreak on the north and west
#  * Kawamuko across the river above its terraced paddies, and farmsteads alone among the paddies
#    beside the farm road, each ringed by igune
# Roads form a hierarchy: the paved prefectural road, paved town roads (to the bridge and up to
# Kawamuko), gravel farm roads, and short gravel driveways from each yard to the nearest road.
houses = []
lanes = []            # driveways: [(x, z, y), ...]
ditch_crossings = [BRIDGE_Z, STAIR_Z]
PRESETS = json.loads((ROOT / "tools/architecture/presets.json").read_text())
KIND_ASSET = {"kawara": "minka-kawara", "thatch": "minka-kayabuki", "tin": "minka-totan", "kura-house": "minka-kura"}
HAMLETS = [  # name, centre z, half length along the road, houses, valley-side share, kinds in turn
    # the houses gather around the centre; only a small cluster stands apart at the mouth of Okusawa
    ("kaminosawa", -428.0, 22.0, 5, 0.3, ["thatch", "tin", "thatch", "kawara", "tin"]),
    # Nakazato: the oldest farm hamlet - big thatched farmhouses and a storehouse, set back facing south
    ("nakazato", -255.0, 40.0, 8, 0.35, ["thatch", "thatch", "kura-house", "thatch", "kawara"]),
    # Miyashita: below the shrine, round its meeting hall
    ("miyashita", -108.0, 46.0, 13, 0.35, ["kawara", "thatch", "kura-house", "kawara", "tin"]),
    # Shimojuku: the old post road - tiled houses in a close row fronting the road
    ("shimojuku", 268.0, 40.0, 14, 0.4, ["kawara", "kawara", "tin", "kawara"]),
    # Minamizawa: newer houses (tin roofs, block walls) among older farms
    ("minamizawa", 365.0, 40.0, 9, 0.35, ["tin", "kawara", "tin", "thatch"]),
]
# share of a hamlet's houses in the row fronting the road (the rest stand back as farmsteads)
ROADSIDE_SHARE = {"kaminosawa": 0.45, "nakazato": 0.2, "miyashita": 0.45, "shimojuku": 0.85, "minamizawa": 0.5}
MACHI_Z = (50.0, 204.0)                            # the village centre along the main road
FIRE_TOWER = (float(road_x(70.0)) + 7.5, 70.0)    # hinomi-yagura at the north end of the centre
# the temple stands on a bench at the foot of the eastern hills between Nakazato and Miyashita
TEMPLE_Z = -188.0
CLINIC_Z = 452.0                                   # the village clinic, the last building at the south end of the village
gy0, gx0 = np.gradient(h, CELL)
slope0 = np.degrees(np.arctan(np.hypot(gx0, gy0)))
mountain0 = _M

def at(arr, x, z):
    i = int(round((z / EXTENT + 0.5) * (N - 1)))
    j = int(round((x / EXTENT + 0.5) * (N - 1)))
    return float(arr[min(max(i, 0), N - 1), min(max(j, 0), N - 1)])

def road_dir(z):
    """Unit direction of the main road at z (dx, dz) and its angle from +Z."""
    dx = float(road_x(z + 1) - road_x(z - 1)) / 2
    l = math.hypot(dx, 1.0)
    return dx / l, 1.0 / l, math.atan2(dx, 1.0)

def facing_road_yaw(x, z):
    """Yaw that turns a building's front (local +Z) towards the main road."""
    _, _, th = road_dir(z)
    return th - math.pi / 2 if x > float(road_x(z)) else th + math.pi / 2

def farm_road_dist(x, z):
    best = 1e9
    for fr in farm_roads:
        for (ax_, az_), (bx_, bz_) in zip(fr, fr[1:]):
            vx, vz = bx_ - ax_, bz_ - az_
            t_ = min(max(((x - ax_) * vx + (z - az_) * vz) / (vx * vx + vz * vz), 0), 1)
            best = min(best, math.hypot(x - ax_ - vx * t_, z - az_ - vz * t_))
    return best

# The old road (kyudo) through Shimojuku. The prefectural road was laid out straighter across the
# floor in the 1960s; the old post road keeps to the hill foot a little east of it and the houses of
# Shimojuku still front it, close together. It leaves the new road just south of the Miyazawa
# bridge and rejoins it at the south end of the hamlet. (4 m, paved, no markings.)
KYUDO_Z = (232.0, 352.0)
def kyudo_off(z):
    z = np.asarray(z, dtype=np.float64)
    s_ = smoothstep(KYUDO_Z[0], KYUDO_Z[0] + 24.0, z) * (1 - smoothstep(KYUDO_Z[1] - 26.0, KYUDO_Z[1], z))
    return (28.0 + 3.0 * np.sin(z * 0.06)) * s_
kyudo = [(float(road_x(z_)) + float(kyudo_off(z_)), float(z_)) for z_ in np.arange(KYUDO_Z[0], KYUDO_Z[1] + 0.01, 3.0)]
def kyudo_dist(x, z):
    best = 1e9
    for (ax_, az_), (bx_, bz_) in zip(kyudo, kyudo[1:]):
        vx, vz = bx_ - ax_, bz_ - az_
        t_ = min(max(((x - ax_) * vx + (z - az_) * vz) / (vx * vx + vz * vz), 0), 1)
        best = min(best, math.hypot(x - ax_ - vx * t_, z - az_ - vz * t_))
    return best
def kyudo_at(z):
    """(x, unit direction) of the old road at z."""
    x0_, x1_ = float(road_x(z - 1) + kyudo_off(z - 1)), float(road_x(z + 1) + kyudo_off(z + 1))
    l_ = math.hypot(x1_ - x0_, 2.0)
    return (x0_ + x1_) / 2, ((x1_ - x0_) / l_, 2.0 / l_)

def house_ok(x, z, gap=23.0, road_gap=11.0):
    if farm_road_dist(x, z) < 14:
        return False
    if KYUDO_Z[0] - 5 < z < KYUDO_Z[1] + 5 and kyudo_dist(x, z) < 8.5:
        return False
    if abs(z - STAIR_Z) < 20 and x > float(road_x(z)) - 4:
        return False
    if 85 < x < 140 and -66 < z < -14:
        return False
    if math.hypot(x - FIRE_TOWER[0], z - FIRE_TOWER[1]) < 17 or abs(z - BRIDGE_Z) < 12:
        return False
    if abs(z - TEMPLE_Z) < 34 and x > float(road_x(z)) + 8:        # the temple and the lane up to it
        return False
    if abs(z - CLINIC_Z) < 22 and x > float(road_x(z)):
        return False
    if stream_dist(x, z) < 15:
        return False
    if abs(x - float(river_x(z))) < float(bed_half(z)) + 24 or abs(x - float(road_x(z))) < road_gap:
        return False
    return all(math.hypot(x - o["x"], z - o["z"]) >= max(gap, (max(o["w"], o["d"]) + 2) if o["group"] == "machi" else 0) for o in houses)

def add_house(x, z, kind, yaw, group, side, asset=None, w=None, d=None, storeys=1, front=11.0, back=6.0, variant=None):
    variant = int(rng.integers(0, 4)) if variant is None else variant
    if asset is None:
        pre = PRESETS[KIND_ASSET[kind]][variant]
        w, d, storeys, wing = pre["W"], pre["D"], pre["storeys"], pre.get("wing")
    else:
        wing = None
    hs = dict(x=x, z=z, kind=kind, yaw=yaw, w=w, d=d, side=int(side), variant=variant, wing=wing, storeys=storeys,
              group=group, asset=asset or KIND_ASSET[kind], front=front, back=back)
    # the barn stands on the side of the yard away from the road, the kitchen garden opposite
    hs["barn"] = 1 if (group not in ("sankyo", "kawamuko") and x > float(road_x(z)) and x - float(road_x(z)) < 32) else -1
    # houses that front a road face it; the others face south behind their igune
    hs["roadside"] = group == "machi" or abs(yaw - facing_road_yaw(x, z)) < 0.5 and abs(x - float(road_x(z))) < 26
    houses.append(hs)
    return hs

# Farm roads (gravel, 3 m): one along the middle of the valley floor, and cross roads from the
# main road down to the river levee (or to the canal, where it runs along the levee).
def canal_x_(z):
    return float(canal_x(z))
# in the gaps between hamlets, and between the fields of the long reaches (every 90-130 m: each
# field must be reached by a farm road for the tiller, the transplanter and the harvest)
FARM_CROSS = [-368.0, -300.0, -200.0, -130.0, 5.0, 220.0, 316.0, 428.0, 496.0, 560.0, 620.0, 676.0]
farm_roads = []
mid_pts = []
for z in np.arange(-470.0, 690.1, 6.0):
    xm = 0.5 * (float(levee_path_x(z)) + float(road_x(z))) + 8.0 * math.sin(z * 0.006 + 1.1)
    mid_pts.append((xm, float(z)))
farm_roads.append(mid_pts)
for zc in FARM_CROSS:
    x1 = float(road_x(zc)) - ROAD_HALF - 0.4
    x0 = (canal_x_(zc) + 1.2) if (WEIR_Z - 8 < zc < 375) else float(levee_path_x(zc))
    pts = [(x0 + (x1 - x0) * t, zc + 2.0 * math.sin(t * math.pi) * (1 if zc > 0 else -1)) for t in np.linspace(0, 1, 24)]
    farm_roads.append(pts)
    ditch_crossings.append(zc)

# ---- Side streams (sawa) ---------------------------------------------------------------
_tick('Side streams (sawa)')
# The two larger side valleys on the east bring a stream into the village: a stony brook down
# the valley (its course is the drainage line of the regional model), a box culvert under the
# prefectural road, then a concrete-lined channel (sanmenbari) straight across the paddies to
# the river, covered where the farm road and the levee path cross it.
STREAM_W, STREAM_NAT = 1.5, 1.3          # inner width of the lined channel; half width of the brook's bed
def _smooth_path(pts, step=4.0, sigma=2.5):
    from scipy.ndimage import gaussian_filter1d
    p_ = np.asarray(pts, dtype=np.float64)
    seg = np.hypot(np.diff(p_[:, 0]), np.diff(p_[:, 1]))
    L_ = np.concatenate([[0.0], np.cumsum(seg)])
    u_ = np.arange(0.0, L_[-1], step)
    x_, z_ = np.interp(u_, L_, p_[:, 0]), np.interp(u_, L_, p_[:, 1])
    xs, zs = gaussian_filter1d(x_, sigma, mode="nearest"), gaussian_filter1d(z_, sigma, mode="nearest")
    xs[0], zs[0], xs[-1], zs[-1] = x_[0], z_[0], x_[-1], z_[-1]
    return np.stack([xs, zs], -1)
streams = []
for _name, _zm in (("okusawa", -394.0), ("miyazawa", 212.0)):
    _c = [st for st in region_streams() if abs(st[0, 1] - _zm) < 70 and st[0, 0] > float(river_x(st[0, 1]))]
    if not _c:
        continue
    _st = max(_c, key=lambda a_: a_[1, 3])
    _hill = [(float(x_), float(z_)) for x_, z_, *_ in _st if x_ > float(road_x(z_)) + W_FLAT + 6.0 and abs(x_) < HALF - 24 and abs(z_) < HALF - 24]
    if len(_hill) < 8:
        continue
    _hp = _smooth_path(_hill)[::-1]                        # upstream -> downstream
    _zc = round(float(_hp[-1, 1]), 2)
    _xr = float(road_x(_zc))
    _x_in, _x_out = _xr + W_FLAT + 1.2, _xr - W_FLAT - 1.2            # culvert under the road
    _hp = np.vstack([_hp[_hp[:, 0] > _x_in + 3.0], [[_x_in, _zc]]])
    _x_levee = (canal_x_(_zc) + 1.5) if (WEIR_Z - 8 < _zc < 375) else (float(levee_path_x(_zc)) + PATH_W / 2 + 0.9)
    _x_riv = float(river_x(_zc) + bed_half(_zc)) + 0.15                # the outfall in the river wall
    _xm = float(np.interp(_zc, [p_[1] for p_ in mid_pts], [p_[0] for p_ in mid_pts]))
    streams.append(dict(name=_name, z=_zc, hill=_hp, x_in=_x_in, x_out=_x_out, x_levee=_x_levee, x_riv=_x_riv,
                        # the larger brook (Miyazawa) passes under the road on a short bridge, the smaller in a box culvert
                        covers=[("bridge" if _name == "miyazawa" else "road", _x_out, _x_in), ("farm", _xm - 2.5, _xm + 2.5), ("levee", _x_riv, _x_levee)]))
    ditch_crossings.append(_zc)

def stream_dist(x, z):
    """Distance from (x, z) to the nearest side stream (brook or lined channel)."""
    best = 1e9
    for st in streams:
        if st["x_riv"] <= x <= st["x_in"]:
            best = min(best, abs(z - st["z"]))
        hp_ = st["hill"]
        d2 = (hp_[:, 0] - x) ** 2 + (hp_[:, 1] - z) ** 2
        best = min(best, float(np.sqrt(d2.min())))
    return best

# The centre: a row of buildings on each side of the main road, fronts 2-3 m behind the ditch.
# (type, z, side, frontage W, depth D, storeys)  -  types other than "house" are shop/public models
MACHI = [
    ("kominkan", 89.0, 1, 14.0, 10.0, 1), ("house", 102.5, 1, None, None, 2), ("post-office", 114.0, 1, 9.0, 8.0, 1),
    ("shop-yorozuya", 126.5, 1, 9.0, 8.5, 2), ("house", 138.0, 1, None, None, 2), ("shop-sakaya", 150.0, 1, 8.0, 8.0, 2),
    ("barber", 161.0, 1, 7.0, 7.5, 2), ("house", 172.5, 1, None, None, 2), ("house", 184.5, 1, None, None, 1),
    ("house", 58.0, -1, None, None, 2), ("house", 70.5, -1, None, None, 1), ("chuzaisho", 83.0, -1, 8.0, 7.5, 1),
    ("house", 95.0, -1, None, None, 2), ("shop-tofu", 106.5, -1, 7.0, 8.0, 2), ("house", 118.0, -1, None, None, 2),
    ("nokyo", 160.0, -1, 12.0, 8.5, 1), ("house", 174.0, -1, None, None, 2), ("house", 186.0, -1, None, None, 1),
    ("house", 196.5, 1, None, None, 2), ("house", 198.0, -1, None, None, 2),
    ("nokyo-soko", 160.0, -1, 18.0, 11.0, 1),        # the JA rice warehouse, behind the office
    ("shinryojo", CLINIC_Z, 1, 15.0, 9.0, 1),        # the clinic, set back behind its forecourt
]
machi_buildings = []
for kind, z, side, W, D, storeys in MACHI:
    dxr, dzr, th = road_dir(z)
    px, pz = dzr, -dxr                                  # unit vector to the east of the road
    if kind == "house":
        kind_h = "kawara" if storeys == 2 else str(rng.choice(["tin", "kawara"]))
        variant = int(rng.choice([1, 3])) if storeys == 2 else int(rng.choice([0, 2]))
        pre = PRESETS[KIND_ASSET[kind_h]][variant]
        W, D = pre["W"], pre["D"]
    setback = DITCH_OFF + 0.45 + (2.6 if kind != "house" else 3.4) + (8.5 + 3.0 if kind == "nokyo-soko" else 0) + (6.5 if kind == "shinryojo" else 0)
    off = setback + D / 2
    x = float(road_x(z)) + side * px * off
    zz = z + side * pz * off
    yaw = facing_road_yaw(x, zz)
    if kind == "house":
        hs = add_house(x, zz, kind_h, yaw, "machi", side, variant=variant, front=setback - DITCH_OFF - 0.3, back=4.0)
    else:
        hs = add_house(x, zz, "shop", yaw, "machi", side, asset=kind, w=W, d=D, storeys=storeys, front=setback - DITCH_OFF - 0.3, back=4.0, variant=0)
    machi_buildings.append(hs)

# Miyashita's meeting hall (shukaijo), where the road to the shrine leaves the village road
_mz = -70.0
_mx = float(road_x(_mz)) + 17.0
if house_ok(_mx, _mz):
    add_house(_mx, _mz, "shop", facing_road_yaw(_mx, _mz), "miyashita", 1, asset="kominkan", w=12.0, d=9.0, storeys=1, front=6.0, back=4.0, variant=0)
# Facilities of the hamlets (placed before the houses so they get their sites):
#  * the branch school (bunko) of the upper valley, between Kaminosawa and Nakazato, set back from
#    the road behind its own level schoolyard
#  * the fire brigade post (shobodan tsumesho) on the old road through Shimojuku
#  * a communal work barn (kyodo sagyosho) of Minamizawa beside the road
def _place_facility(zs, offs, asset, w, d, group, front, back, storeys=1, scale=1.0, gap=34.0):
    for z_ in zs:
        for side_, off_ in offs:
            x_ = float(road_x(z_)) + side_ * off_
            if not house_ok(x_, z_, gap) or at(slope0, x_, z_) > 14:
                continue
            hs_ = add_house(x_, z_, "shop", facing_road_yaw(x_, z_), group, side_, asset=asset, w=w, d=d, storeys=storeys, front=front, back=back, variant=0)
            hs_["scale"] = scale
            return hs_
    return None
_place_facility(np.arange(-340.0, -318.0, 4.0), [(1, 34.0), (1, 40.0), (-1, 32.0)], "bunko", 26.0, 8.5, "nakazato", 22.0, 4.0, gap=40.0)
# the fire brigade post on the old road through Shimojuku, facing it
for _z in np.arange(262.0, 300.0, 5.0):
    _ox, (_dx, _dz) = kyudo_at(_z)
    _x = _ox - 10.5                                  # west side of the old road
    if house_ok(_x, _z, 20.0):
        _hs = add_house(_x, _z, "shop", math.atan2(_ox - _x, 0.0), "shimojuku", 1, asset="shobo-tsumesho", w=6.0, d=5.4, storeys=2, front=3.0, back=3.0, variant=0)
        _hs["oldroad"] = True
        break
_place_facility(np.arange(410.0, 380.0, -6.0), [(-1, 16.0), (1, 17.0)], "naya", 9.5, 7.5, "minamizawa", 6.0, 3.0, scale=1.7, gap=26.0)
for name, cz, half, count, down, kinds in HAMLETS:
    placed, tries = 0, 0
    if name == "shimojuku":
        # the old post road: houses in a close row on both sides, fronts on the road (small front yards)
        while placed < count and tries < 2500:
            tries += 1
            z = rng.uniform(KYUDO_Z[0] + 22.0, KYUDO_Z[1] - 22.0)
            ox_, (dx_, dz_) = kyudo_at(z)
            side = -1 if rng.random() < 0.5 else 1
            nx_, nz_ = dz_ * side, -dx_ * side                 # unit normal to this side of the old road
            off = rng.uniform(10.0, 11.5)
            x, zz = ox_ + nx_ * off, z + nz_ * off
            if not house_ok(x, zz, 13.5) or at(slope0, x, zz) > 22:
                continue
            hs = add_house(x, zz, kinds[placed % len(kinds)], math.atan2(-nx_, -nz_) + rng.normal(0, 0.03), name, side)
            hs["roadside"] = True
            hs["oldroad"] = True
            hs["front"] = max(2.5, off - hs["d"] / 2 - 2.4)
            placed += 1
        continue
    while placed < count and tries < 2500:
        tries += 1
        z = cz + rng.uniform(-half, half)
        side = -1 if rng.random() < down else 1
        # a first row fronting the road, the rest set back on the slope facing south
        roadside = rng.random() < ROADSIDE_SHARE.get(name, 0.45)
        off = rng.uniform(12.5, 15.5) if roadside else (rng.uniform(26, 50) if side > 0 else rng.uniform(26, 32))
        x = float(road_x(z)) + side * off
        if not house_ok(x, z):
            continue
        if at(h, x, z) - (float(floor_base(z)) + 1.25) > 7.5 or at(slope0, x, z) > 24:
            continue
        yaw = facing_road_yaw(x, z) + rng.normal(0, 0.04) if roadside else -0.12 + rng.normal(0, 0.06)
        hs = add_house(x, z, kinds[placed % len(kinds)], yaw, name, side)
        if hs["roadside"]:
            # the yard runs out to the road shoulder, no further
            # (to the edge of the level verge; a yard above the road ends in a stone wall standing on it)
            hs["front"] = max(2.5, abs(x - float(road_x(z))) - hs["d"] / 2 - W_FLAT - 0.3)
        placed += 1

# Kawamuko: a terrace hamlet. As in hillside rice villages the houses do not stand among the
# fields: they line a lane that follows the contour two thirds of the way up the footslope, each on
# its own bench behind a stone wall, the woods at their back and the terraces falling away in
# front. The town road climbs to the lane on a slant from the bridge.
KAWA_DW = 150.0
def kawa_lane_x(z):
    return float(river_base_x(z)) - 14.0 - KAWA_DW - 9.0 * math.sin((z - 150.0) * 0.021)
_bx0 = float(river_x(BRIDGE_Z)) - float(bed_half(BRIDGE_Z)) - WALL_RUN - CAP_W - 0.4
_jz = 224.0                                                   # where the road from the bridge meets the lane
_acc = [(_bx0, BRIDGE_Z), (_bx0 - 14.0, BRIDGE_Z + 3.0)]
for _t in np.linspace(0.12, 1.0, 9):
    _acc.append((_bx0 - 14.0 + (kawa_lane_x(_jz) - (_bx0 - 14.0)) * _t, BRIDGE_Z + 3.0 + (_jz - BRIDGE_Z - 3.0) * (_t ** 0.85)))
kawa_trunk = _acc + [(kawa_lane_x(z_), float(z_)) for z_ in np.arange(_jz + 8.0, 344.0, 8.0)]
kawa_branch = [(kawa_lane_x(z_), float(z_)) for z_ in np.arange(_jz, 138.0, -8.0)]
_z = 148.0
placed = 0
while _z < 338.0:
    uphill = rng.random() < 0.72
    x = kawa_lane_x(_z) - 12.5 if uphill else kawa_lane_x(_z) + 12.0
    if (uphill or abs(_z - _jz) > 16) and house_ok(x, _z, 19.0):
        hs = add_house(x, _z, ["thatch", "tin", "kawara", "thatch", "kawara"][placed % 5], math.pi / 2 - 0.3 + rng.normal(0, 0.06), "kawamuko", -1)
        hs["front"] = 6.0 if uphill else 7.0
        placed += 1
    _z += rng.uniform(19.0, 26.0)
# Farmsteads alone among the paddies, beside the mid-valley farm road, each on a low mound
placed, tries = 0, 0
while placed < 6 and tries < 3000:
    tries += 1
    k = int(rng.integers(4, len(mid_pts) - 4))
    mx, mz = mid_pts[k]
    side = rng.choice([-1.0, 1.0])
    x, z = mx + side * rng.uniform(17, 22), mz + rng.uniform(-3, 3)
    if abs(z - BRIDGE_Z) < 28 or any(abs(z - zc) < 24 for zc in FARM_CROSS):
        continue
    if not house_ok(x, z, 72) or at(mountain0, x, z) > 1.2:
        continue
    add_house(x, z, ["kawara", "thatch", "kawara", "kura-house"][placed % 4], -0.05 + rng.normal(0, 0.06), "sankyo", 0)
    placed += 1

pad_level = {}
for i, hs in enumerate(houses):
    x, z = hs["x"], hs["z"]
    c, s_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    W2, D2 = hs["w"] / 2, hs["d"] / 2
    loc = lambda lx, lz: (x + lx * c + lz * s_, z - lx * s_ + lz * c)
    base = float(floor_base(z))
    ground = float(np.median(h[np.hypot(X - x, Z - z) < 9]))
    if hs["group"] == "sankyo":
        level = ground + 0.7                                   # a low mound above the paddies
    elif hs["group"] == "machi":
        level = base + 1.05 + 0.18                             # a step up from the road
    else:
        local = base + 1.25
        level = max(local, min(ground, local + 4.0))           # cut into the slope where it rises
        if hs["group"] == "kawamuko":
            level = ground + 0.4                               # a bench on the footslope, walled in front
    hs["ground_south"] = at(h, *loc(0, D2 + hs["front"] + 4))
    pad_level[i] = level
    hs["y"] = round(level, 3)
    lx = (X - x) * c - (Z - z) * s_
    lz = (X - x) * s_ + (Z - z) * c
    side_w = 3.0 if hs["group"] == "machi" else 8.0
    dist = np.maximum(np.abs(lx) - (W2 + side_w), np.maximum(-(D2 + hs["back"]) - lz, lz - (D2 + hs["front"])))
    wgt = 1 - smoothstep(0, 3.5 if hs["group"] in ("sankyo", "machi") else 4.5, dist)
    h = h * (1 - wgt) + level * wgt

def road_level(z):
    return float(floor_base(z)) + 1.05

def yard_front(hs, extra=None):
    c, s_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    lz = hs["d"] / 2 + (hs["front"] - 2.0 if extra is None else extra)
    return hs["x"] + lz * s_, hs["z"] + lz * c

# Town road up to Kawamuko from the west end of the bridge (paved, 3.5 m)
kawa = [hs for hs in houses if hs["group"] == "kawamuko"]
bx0 = float(river_x(BRIDGE_Z)) - float(bed_half(BRIDGE_Z)) - WALL_RUN - CAP_W - 0.4
trunk = [(x_, z_, (float(bank_top(BRIDGE_Z)) + 0.1) if k_ == 0 else None) for k_, (x_, z_) in enumerate(kawa_trunk)]
branch_k = [(x_, z_, None) for x_, z_ in kawa_branch]

# Driveways: straight and short, from each yard to the nearest road of any class. Houses in the
# centre and those that front the road open straight onto it.
def nearest_on(pts, x, z):
    best = (1e9, None)
    for (ax_, az_), (bx_, bz_) in zip(pts, pts[1:]):
        vx, vz = bx_ - ax_, bz_ - az_
        t_ = min(max(((x - ax_) * vx + (z - az_) * vz) / (vx * vx + vz * vz), 0), 1)
        qx, qz = ax_ + vx * t_, az_ + vz * t_
        d = math.hypot(x - qx, z - qz)
        if d < best[0]:
            best = (d, (qx, qz))
    return best
for hs in houses:
    if hs["group"] == "machi":
        continue
    fx, fz = yard_front(hs)
    zr = fz
    main_d = abs(fx - float(road_x(zr))) - ROAD_HALF
    if hs.get("oldroad"):
        d_, q_ = nearest_on(kyudo, fx, fz)
        lanes.append([(fx, fz, hs["y"]), (q_[0], q_[1], None)])
        continue
    if hs["roadside"]:
        ex = float(road_x(zr)) + math.copysign(ROAD_HALF + 0.3, fx - float(road_x(zr)))
        lanes.append([(fx, fz, hs["y"]), (ex, zr, road_level(zr))])
        ditch_crossings.append(round(zr, 2))
        continue
    cands = [(main_d, ("main", (float(road_x(zr)) + math.copysign(ROAD_HALF + 0.3, fx - float(road_x(zr))), zr)))]
    for fr in farm_roads:
        d, q = nearest_on(fr, fx, fz)
        cands.append((d - 1.5, ("farm", q)))
    if hs["group"] == "kawamuko":
        d, q = nearest_on([(p[0], p[1]) for p in trunk], fx, fz)
        d2_, q2_ = nearest_on([(p[0], p[1]) for p in branch_k], fx, fz)
        if d2_ < d:
            d, q = d2_, q2_
        cands.append((d - 1.7, ("town", q)))
    d, (cls, (qx, qz)) = min(cands, key=lambda c_: c_[0])
    qy = road_level(qz) if cls == "main" else None
    lanes.append([(fx, fz, hs["y"]), (qx, qz, qy)])
    if cls == "main":
        ditch_crossings.append(round(qz, 2))

lane_d = np.full_like(h, 1e9)
farm_d = np.full_like(h, 1e9)
town_d = np.full_like(h, 1e9)
def grade_line(h, pts, width, dist_arr, raise_=0.0):
    """Grade a polyline [(x, z, y|None)]: y None follows the smoothed ground (+raise_)."""
    ys = [p[2] if p[2] is not None else at(h, p[0], p[1]) + raise_ for p in pts]
    if len(pts) > 2:   # smooth the free points along the line
        ys2 = ys[:]
        for k in range(1, len(pts) - 1):
            if pts[k][2] is None:
                ys2[k] = (ys[k - 1] + 2 * ys[k] + ys[k + 1]) / 4
        ys = ys2
    for (ax_, az_, _), (bx_, bz_, _), ay, by in zip(pts, pts[1:], ys, ys[1:]):
        j0 = max(int((min(ax_, bx_) - 8) / CELL + (N - 1) / 2), 0); j1 = min(int((max(ax_, bx_) + 8) / CELL + (N - 1) / 2) + 2, N)
        i0 = max(int((min(az_, bz_) - 8) / CELL + (N - 1) / 2), 0); i1 = min(int((max(az_, bz_) + 8) / CELL + (N - 1) / 2) + 2, N)
        Xw, Zw = X[i0:i1, j0:j1], Z[i0:i1, j0:j1]
        d, tt = segment_dist(Xw, Zw, ax_, az_, bx_, bz_)
        tgt = ay + (by - ay) * tt
        m = 1 - smoothstep(width / 2 + 0.2, width / 2 + 2.6, d)
        h[i0:i1, j0:j1] = h[i0:i1, j0:j1] * (1 - m) + tgt * m
        dist_arr[i0:i1, j0:j1] = np.minimum(dist_arr[i0:i1, j0:j1], d)
    return h
for fr in farm_roads:
    h = grade_line(h, [(x_, z_, None) for x_, z_ in fr], 3.0, farm_d, raise_=0.25)
h = grade_line(h, trunk, 3.5, town_d)
h = grade_line(h, branch_k, 3.0, town_d)
_ky = [(x_, z_, (road_level(z_) if k_ in (0, len(kyudo) - 1) else None)) for k_, (x_, z_) in enumerate(kyudo)]
h = grade_line(h, _ky, 4.0, town_d, raise_=0.15)
ditch_crossings += [KYUDO_Z[0], KYUDO_Z[1]]
for ln in lanes:
    h = grade_line(h, ln, 2.6, lane_d)
# the main road keeps its level through junctions, yards and driveways: carriageway, shoulders and
# ditches stay flat (a yard above the road ends in a stone wall at the edge of the verge)
h = np.where((Z >= ROAD_Z0 - 0.6) & (Z < HALF - 32) & (road_d < W_FLAT), road_y, h)

# ---- Temple -------------------------------------------------------------------------
_tick('Temple')
# A small Soto Zen temple (Zuiun-ji) on a bench cut into the foot of the eastern hills: the main
# hall faces the valley across a gravel yard, the gate at the front edge, the bell tower to one
# side, the graveyard on the north side; a gravel lane (sando) climbs to it from the road.
_tx = float(road_x(TEMPLE_Z)) + 58.0
TEMPLE = dict(x=_tx, z=TEMPLE_Z, yaw=facing_road_yaw(_tx, TEMPLE_Z), hw=17.0, hd=15.0)
TEMPLE["y"] = round(min(max(at(h, _tx, TEMPLE_Z), road_level(TEMPLE_Z) + 1.6), road_level(TEMPLE_Z) + 4.2), 3)
def temple_local(lx, lz):
    c_, s_ = math.cos(TEMPLE["yaw"]), math.sin(TEMPLE["yaw"])
    return TEMPLE["x"] + lx * c_ + lz * s_, TEMPLE["z"] - lx * s_ + lz * c_
_c, _s = math.cos(TEMPLE["yaw"]), math.sin(TEMPLE["yaw"])
_tlx = (X - TEMPLE["x"]) * _c - (Z - TEMPLE["z"]) * _s
_tlz = (X - TEMPLE["x"]) * _s + (Z - TEMPLE["z"]) * _c
temple_d = np.maximum(np.abs(_tlx) - TEMPLE["hw"], np.abs(_tlz) - TEMPLE["hd"])      # < 0 inside the precinct
_w = 1 - smoothstep(0.0, 5.0, temple_d)
h = h * (1 - _w) + TEMPLE["y"] * _w
_gx, _gz = temple_local(0.0, TEMPLE["hd"] - 0.5)                                       # the gate
_ex = float(road_x(_gz)) + ROAD_HALF + 0.3
_sando = [(_gx, _gz, TEMPLE["y"]), (_ex, _gz, road_level(_gz))]
h = grade_line(h, _sando, 3.0, lane_d)
lanes.append(_sando)
ditch_crossings.append(round(_gz, 2))
# Communal graveyard (kyodo bochi) of the southern hamlets: a small bench cut into the hill foot
# above Minamizawa, the graves in rows looking out over the valley, a path up from the road.
# (It is handled like the temple precinct: fields, houses and trees keep clear of it.)
GRAVES = None
for _gz_ in (398.0, 412.0, 384.0, 426.0, 370.0, 440.0):
    for _off in (44.0, 52.0, 38.0, 60.0):
        _gx_ = float(road_x(_gz_)) + _off
        if any(math.hypot(hs_["x"] - _gx_, hs_["z"] - _gz_) < 28 for hs_ in houses) or at(slope0, _gx_, _gz_) > 26:
            continue
        GRAVES = dict(x=_gx_, z=_gz_, hw=9.0, hd=6.5)
        break
    if GRAVES:
        break
if GRAVES:
    GRAVES["yaw"] = facing_road_yaw(GRAVES["x"], GRAVES["z"])
    GRAVES["y"] = round(min(max(at(h, GRAVES["x"], GRAVES["z"]), road_level(GRAVES["z"]) + 1.5), road_level(GRAVES["z"]) + 7.0), 3)
    _gc, _gs = math.cos(GRAVES["yaw"]), math.sin(GRAVES["yaw"])
    _glx = (X - GRAVES["x"]) * _gc - (Z - GRAVES["z"]) * _gs
    _glz = (X - GRAVES["x"]) * _gs + (Z - GRAVES["z"]) * _gc
    grave_d = np.maximum(np.abs(_glx) - GRAVES["hw"], np.abs(_glz) - GRAVES["hd"])
    _w = 1 - smoothstep(0.0, 4.0, grave_d)
    h = h * (1 - _w) + GRAVES["y"] * _w
    GRAVES["c"], GRAVES["s"] = _gc, _gs
    def grave_local(lx, lz):
        c_, s_ = GRAVES["c"], GRAVES["s"]
        return GRAVES["x"] + lx * c_ + lz * s_, GRAVES["z"] - lx * s_ + lz * c_
    _px, _pz = grave_local(0.0, GRAVES["hd"] - 0.5)
    _gpath = [(_px, _pz, GRAVES["y"]), (float(road_x(_pz)) + ROAD_HALF + 0.3, _pz, road_level(_pz))]
    h = grade_line(h, _gpath, 1.8, lane_d)
    lanes.append(_gpath)
    ditch_crossings.append(round(_pz, 2))
    temple_d = np.minimum(temple_d, grave_d)
h = np.where((Z >= ROAD_Z0 - 0.6) & (Z < HALF - 32) & (road_d < W_FLAT), road_y, h)

# distance to the side streams (brook and lined channel), for fields, houses and trees to keep clear
stream_d = np.full_like(h, 1e9)
def _line_dist(arr, ax_, az_, bx_, bz_, reach=12.0):
    j0 = max(int((min(ax_, bx_) - reach) / CELL + (N - 1) / 2), 0); j1 = min(int((max(ax_, bx_) + reach) / CELL + (N - 1) / 2) + 2, N)
    i0 = max(int((min(az_, bz_) - reach) / CELL + (N - 1) / 2), 0); i1 = min(int((max(az_, bz_) + reach) / CELL + (N - 1) / 2) + 2, N)
    d_, t_ = segment_dist(X[i0:i1, j0:j1], Z[i0:i1, j0:j1], ax_, az_, bx_, bz_)
    arr[i0:i1, j0:j1] = np.minimum(arr[i0:i1, j0:j1], d_)
    return (i0, i1, j0, j1), d_, t_
brook_d = np.full_like(h, 1e9)
for st in streams:
    hp_ = st["hill"]
    for k_ in range(len(hp_) - 1):
        _line_dist(brook_d, hp_[k_, 0], hp_[k_, 1], hp_[k_ + 1, 0], hp_[k_ + 1, 1])
    _line_dist(stream_d, st["x_riv"], st["z"], st["x_in"], st["z"])
stream_d = np.minimum(stream_d, brook_d)

# ---- Irrigation: canals along the high side of the floor, ditches across the paddies ------------
_tick('Irrigation network')
# The floor rises from the river towards the road, and the river runs 1.5 m below it: water taken
# from the river reaches only the low fields beside it (the weir canal below the centre). The
# fields on the high side are fed from the side valleys, as in many hill villages: a small intake
# weir on each brook a little way up its valley lifts water into a concrete canal that comes down
# to the road, passes under it and runs on along the foot of the road embankment, the high edge of
# the paddies. From it the water goes into the fields and down branch ditches beside the farm
# roads, which cross the floor to the river and carry the drainage back to it.
from scipy.ndimage import gaussian_filter1d as _g1d
CANAL2_W, CANAL2_D, CANAL2_TOP = 0.9, 0.5, 0.2
IRR_DITCH_W = 0.6
def _xw(z):                                   # canal line along the west foot of the road embankment
    return float(road_x(z)) - (W_FLAT + 1.8)
canals = []
irr_ditch_z = []
for _name, _dz in (("okusawa", [-368.0, -300.0, -200.0, -130.0, 5.0]), ("miyazawa", [316.0, 428.0, 496.0, 560.0])):
    _zend = max(_dz) - 2.7 + 1.5                                 # the canal ends in its last branch ditch
    _st = next((s_ for s_ in streams if s_["name"] == _name), None)
    if _st is None:
        continue
    _hp = _st["hill"]
    _gy = _g1d(np.array([at(h, x_, z_) for x_, z_ in _hp]), 2.0, mode="nearest")
    _bed = np.minimum.accumulate(_gy - 0.55)
    _zx = _st["z"] + 7.0                                         # just downstream of the brook's culvert
    _xe = float(road_x(_zx)) + W_FLAT + 1.8
    _wx = float(floor_base(_zx)) + 0.8 + 0.06
    _k = None
    for _i in range(len(_hp) - 1, -1, -1):
        _L = math.hypot(_hp[_i, 0] - _xe, _hp[_i, 1] - _zx)
        if _L > 28.0 and _bed[_i] + 0.3 >= _wx + _L / 300.0:
            _k = _i
            break
    if _k is None:
        continue
    _xi, _zi = float(_hp[_k, 0]), float(_hp[_k, 1])
    _pts = []
    _n = max(2, int(math.hypot(_xe - _xi, _zx - _zi) / 2.0))
    for _t in np.linspace(0, 1, _n + 1):
        _pts.append([_xi + (_xe - _xi) * _t, _zi + (_zx - _zi) * _t, float(_bed[_k] + 0.3) + (_wx - float(_bed[_k] + 0.3)) * _t, 0])
    _xw0 = _xw(_zx)
    for _t in np.linspace(0, 1, 7)[1:]:
        _pts.append([_xe + (_xw0 - _xe) * _t, _zx, _wx - 0.02 * _t, 1])            # piped under the road
    for _z in np.arange(_zx + 2.0, _zend + 0.01, 2.0):
        _x = _xw(_z)
        # covered by a slab where a driveway, a farm road, the shrine branch or a town road crosses
        _slab = at(lane_d, _x, _z) < 2.4 or at(farm_d, _x, _z) < 2.6 or at(town_d, _x, _z) < 2.6 or at(bd, _x, _z) < 3.2
        _pts.append([_x, float(_z), float(floor_base(_z)) + 0.8, 2 if _slab else 0])
    _pts = np.array(_pts)
    # along the road the water must stand above the fields it serves: the ground 6-16 m west of the
    # canal (house yards left out), +0.15 m. Every point also carries the needs of those below it, so
    # where the ground rises downstream the canal is raised on a low bank upstream of it.
    _road0 = int(np.argmax(_pts[:, 3] == 1))
    for _i in range(_road0, len(_pts)):
        _x, _z = _pts[_i, 0], _pts[_i, 1]
        if any(math.hypot(hs_["x"] - _x, hs_["z"] - _z) < 30 for hs_ in houses) or at(temple_d, _x - 8, _z) < 14:
            continue
        _g = max(at(h, _x - d_, _z) for d_ in (6.0, 8.0, 10.0, 12.0))
        _pts[_i, 2] = max(_pts[_i, 2], _g + 0.15)
    _pts[:, 2] = np.maximum.accumulate(_pts[::-1, 2])[::-1]
    if _pts[0, 2] > _bed[_k] + 0.3:
        # the intake must lift the brook that high: move it up the valley to where the bed is high enough
        for _i in range(_k, -1, -1):
            if _bed[_i] + 0.3 >= _pts[0, 2] + math.hypot(_hp[_i, 0] - _xi, _hp[_i, 1] - _zi) / 300.0:
                _xi2, _zi2 = float(_hp[_i, 0]), float(_hp[_i, 1])
                _k = _i
                break
        _head = []
        _n2 = max(2, int(math.hypot(_xi - _xi2, _zi - _zi2) / 2.0))
        for _t in np.linspace(0, 1, _n2 + 1)[:-1]:
            _head.append([_xi2 + (_xi - _xi2) * _t, _zi2 + (_zi - _zi2) * _t, float(_bed[_k] + 0.3), 0])
        _xi, _zi = _xi2, _zi2
        _pts = np.vstack([np.array(_head), _pts])
        _pts[:, 2] = np.minimum.accumulate(np.maximum.accumulate(_pts[::-1, 2])[::-1])
    canals.append(dict(name=_name + "-yosui", pts=_pts, intake=(_xi, _zi, float(_bed[_k])), stream=_name))
    irr_ditch_z += _dz
# distance to the canal lines (for the fields to keep clear) and the branch ditches beside the farm roads
irr_d = np.full_like(h, 1e9)
for _c in canals:
    _p = _c["pts"]
    for _i in range(len(_p) - 1):
        _line_dist(irr_d, _p[_i, 0], _p[_i, 1], _p[_i + 1, 0], _p[_i + 1, 1], reach=8.0)
irr_ditches = []
for _zc in irr_ditch_z:
    _zd = _zc - 2.7                                               # on the north side of the farm road
    _c = next(c_ for c_ in canals if c_["pts"][0, 1] - 40 < _zd < c_["pts"][-1, 1] + 5)
    _x0 = _xw(_zd) - CANAL2_W / 2 - 0.16                         # leaves the canal's west wall
    _into_canal = WEIR_Z - 8 < _zc < 375
    _x1 = (canal_x_(_zd) + 0.9) if _into_canal else float(levee_path_x(_zd)) + PATH_W / 2 + 0.6
    _xr = (_x1 - 0.2) if _into_canal else float(river_x(_zd) + bed_half(_zd)) + 0.15
    irr_ditches.append(dict(z=round(_zd, 2), x0=_x0, x1=_x1, xr=_xr, into_canal=_into_canal,
                            water0=float(np.interp(_zd, _c["pts"][:, 1], _c["pts"][:, 2])) - 0.08))
    _line_dist(irr_d, _x0, _zd, _xr, _zd, reach=8.0)

# ---- Paddies ------------------------------------------------------------------
_tick('Paddies')
mountain_factor = _M
slope_ok = mountain_factor < 1.6
house_clear = np.ones_like(h, bool)
for hs in houses:
    house_clear &= np.hypot(X - hs["x"], Z - hs["z"]) > (25 if hs["group"] == "sankyo" else 21)
house_clear &= (lane_d > 3.0) & (farm_d > 3.4) & (town_d > 3.6) & (np.hypot(X - FIRE_TOWER[0], Z - FIRE_TOWER[1]) > 12)
house_clear &= (stream_d > 3.6) & (temple_d > 6.0)
paddy_region = (
    slope_ok & house_clear
    & (rd > RIVER_KEEP)
    & (irr_d > 1.9)
    & ~((np.abs(Z - BRIDGE_Z) < 3.4) & (X > rx) & (X < road + 3))   # farm road to the bridge
    & (road_d > 7.5)
    & (np.abs(X) < HALF - 25) & (Z > -(HALF - 60)) & (Z < HALF - 25)
    & ~((X > road_at_stair - 6) & (X < STAIR_X0 + 4) & (np.abs(Z - STAIR_Z) < 13))
    & (shrine_spur(X, Z) < 3)
)
# Fields are laid out the way an unconsolidated valley is: narrow strips across the floor, one
# behind the other down the valley, each split once or twice across; on any gentle ground above
# the floor - the Kawamuko footslope, the floors of the side valleys (yatsuda), the foot of the
# hills - contour terraces 1.3 m apart. Every boundary is kept as a distance (metres to the
# nearest levee line), so levees, banks and the edge of the rice are smooth curves, not grid steps.
from scipy import ndimage
s_al = Z + 10 * fbm(P4, X, Z, 110, 3)                          # along the valley
t_ac = X - valley_axis(Z) + 9 * fbm(P3, X, Z, 90, 3)           # across it
_gs = np.hypot(*np.gradient(s_al, CELL))
_gt = np.hypot(*np.gradient(t_ac, CELL))
band_edges = [-(HALF + 100.0)]
while band_edges[-1] < HALF + 100:
    band_edges.append(band_edges[-1] + rng.uniform(15, 27))
band_edges = np.array(band_edges)
band = np.clip(np.searchsorted(band_edges, s_al), 1, len(band_edges) - 1)
d_fld = np.minimum(s_al - band_edges[band - 1], band_edges[band] - s_al) / np.maximum(_gs, 0.5)
label = np.full(h.shape, -1, np.int64)
for b in np.unique(band[paddy_region]):
    sel = (band == b) & paddy_region
    slant = rng.uniform(-0.3, 0.3)
    cuts = [-(HALF + 100.0) + rng.uniform(0, 60)]
    while cuts[-1] < HALF + 100:
        cuts.append(cuts[-1] + rng.uniform(42, 88))
    cuts = np.array(cuts)
    tt = t_ac[sel] + (s_al[sel] - band_edges[b]) * slant
    k = np.clip(np.searchsorted(cuts, tt), 1, len(cuts) - 1)
    label[sel] = b * 1000 + k
    d_fld[sel] = np.minimum(d_fld[sel], np.minimum(tt - cuts[k - 1], cuts[k] - tt) / np.maximum(_gt[sel], 0.5))
# Along the river and at the foot of the hills the old, unconsolidated fields remain: small
# irregular plots (cells of jittered seeds ~22 m apart in warped coordinates, so their sides bow and
# kink), where the land consolidation of the middle of the floor never reached. Boundaries stay
# smooth distances: the cell bisectors, and the line where the zone meets the strips.
from scipy.spatial import cKDTree as _KDi
_hill_d = ndimage.distance_transform_edt(_M <= 0.6) * CELL
_zf = np.minimum(rd - (RIVER_KEEP + 34.0 + 12.0 * fbm(P4, X, Z, 140, 2)), _hill_d - (36.0 + 14.0 * fbm(P1, X, Z, 120, 2)))
_irr = paddy_region & (_zf < 0)
_ir = np.random.default_rng(SEED + 52)
_sd = []
for _sz in np.arange(-HALF, HALF, 22.0):
    for _sx in np.arange(-HALF, HALF, 22.0):
        _sd.append((_sx + _ir.uniform(-8, 8), _sz + _ir.uniform(-8, 8)))
_ikd = _KDi(np.array(_sd))
_wx = X + 6.0 * fbm(P2, X, Z, 26, 2)
_wz = Z + 6.0 * fbm(P3, X, Z, 26, 2)
_dd, _ii = _ikd.query(np.stack([_wx[_irr], _wz[_irr]], -1), k=2)
label[_irr] = 300000 + _ii[:, 0]
d_fld[_irr] = np.minimum((_dd[:, 1] - _dd[:, 0]) / 2.0, np.abs(_zf[_irr]))
_strip = paddy_region & ~_irr
d_fld[_strip] = np.minimum(d_fld[_strip], np.abs(_zf[_strip]))
# Terraces (tanada / yatsuda): contour benches on gentle ground above the floor.
TERRACE0 = 700000
rise = h - floor_base(Z)
_ap, _aw = kawamuko_apron(X, Z)
_gyr, _gxr = np.gradient(h, CELL)
_floor_d = ndimage.distance_transform_edt(_M > 0.6) * CELL          # distance from the valley floor
ter_edge = fbm(P5, X, Z, 70, 3)
# (only the wider side valleys are farmed; a narrow sawa is left to the woods)
gentle = ((_aw > 0.5) & (slope0 < 16)) | ((_yatsu(X, Z) > 0.5) & (slope0 < 11)) | ((_floor_d < 34 + 12 * ter_edge) & (slope0 < 8.5))
TER = (gentle & (rise > 0.3) & (rise < 34 + 5 * ter_edge) & house_clear & (label < 0) & (rd > RIVER_KEEP + 2) & (road_d > 9.5)
       & (np.abs(X) < HALF - 25) & (np.abs(Z) < HALF - 25) & (shrine_spur(X, Z) < 3)
       & ~((X > road_at_stair - 6) & (X < STAIR_X0 + 4) & (np.abs(Z - STAIR_Z) < 13)))
rise_n = rise + 0.5 * fbm(P3, X, Z, 28, 2)
_gr = np.hypot(*np.gradient(rise_n, CELL))
# bench heights vary (0.9-1.8 m), as terraces cut by hand to the lie of the ground do
_te = [-2.0]
while _te[-1] < 60:
    _te.append(_te[-1] + rng.uniform(0.9, 1.8))
_te = np.array(_te)
tband = np.clip(np.searchsorted(_te, rise_n), 1, len(_te) - 1)
d_ter = np.minimum(rise_n - _te[tband - 1], _te[tband] - rise_n) / np.maximum(_gr, 0.03)
# cut each bench along the contour: by z where the slope faces east or west, by x where it faces north or south
def _cuts(lo, hi, a, b):
    c = [lo]
    while c[-1] < hi:
        c.append(c[-1] + rng.uniform(a, b))
    return np.array(c)
_cz, _cx = _cuts(-(HALF + 120.0), HALF + 120, 20, 52), _cuts(-(HALF + 120.0), HALF + 120, 20, 52)
# each bench is divided at its own places: the cross levees of neighbouring benches do not line up
_stag = rng.uniform(0, 60, 128)[tband % 128]
_zc, _xc = Z + 5 * fbm(P4, X, Z, 30, 2) + _stag, X + 5 * fbm(P2, X, Z, 30, 2) + _stag
_kz = np.clip(np.searchsorted(_cz, _zc), 1, len(_cz) - 1)
_kx = np.clip(np.searchsorted(_cx, _xc), 1, len(_cx) - 1)
_ew = np.abs(ndimage.gaussian_filter(_gxr, 6)) >= np.abs(ndimage.gaussian_filter(_gyr, 6))
tcut = np.where(_ew, _kz, 500 + _kx)
d_cut = np.where(_ew, np.minimum(_zc - _cz[_kz - 1], _cz[_kz] - _zc), np.minimum(_xc - _cx[_kx - 1], _cx[_kx] - _xc))
# where the two cut families meet (the slope turns), the change of family is a boundary too
_fam = ndimage.distance_transform_edt(_ew) + ndimage.distance_transform_edt(~_ew)
d_cut = np.minimum(d_cut, (_fam - 0.5) * CELL)
label = np.where(TER, TERRACE0 + tband * 1000 + tcut, label)
d_fld = np.where(TER, np.minimum(d_ter, d_cut), d_fld)

def _compact(lab):
    """Field labels -> 1..K (0 = none) and the list of original labels."""
    ids_, inv = np.unique(lab, return_inverse=True)
    inv = inv.reshape(lab.shape)
    if ids_[0] == -1:
        return inv, ids_[1:]
    return inv + 1, ids_
def _drop(lab, bad_mask_per_cell):
    return np.where(bad_mask_per_cell, -1, lab)
# level of each field: the ground it was cut from; cells far above or below it are banks, not field
for _pass in range(2):
    comp, ids_ = _compact(label)
    K = len(ids_)
    lvl = ndimage.median(h, comp, np.arange(1, K + 1)) - 0.22
    lvl_map = np.concatenate([[np.nan], lvl])[comp]
    label = _drop(label, (label >= 0) & (np.abs(h - lvl_map) > (1.4 if _pass == 0 else 1.6)))
    comp, ids_ = _compact(label)
    area_ = np.bincount(comp.ravel(), minlength=len(ids_) + 1)[1:] * CELL * CELL
    small = area_ < np.where(ids_ >= 300000, 150, 300)          # terraces and the old irregular plots may be small
    label = _drop(label, np.concatenate([[False], small])[comp])
comp, ids_ = _compact(label)
K = len(ids_)
lvl = ndimage.median(h, comp, np.arange(1, K + 1)) - 0.22
paddy_level = np.concatenate([[np.nan], lvl])[comp]
is_paddy = label >= 0
# distance to the nearest levee line: inner boundaries (analytic) or the edge of the fields
_d_out = (ndimage.distance_transform_edt(is_paddy) - 0.5) * CELL
d_fld = np.where(is_paddy, np.minimum(d_fld, ndimage.gaussian_filter(_d_out, 0.8)), 0.0)
d_fld = np.maximum(d_fld, 0.0)
# types and the record of every field
_slc = ndimage.find_objects(comp)
_cx_f = ndimage.mean(X, comp, np.arange(1, K + 1))
_cz_f = ndimage.mean(Z, comp, np.arange(1, K + 1))
_area_f = np.bincount(comp.ravel(), minlength=K + 1)[1:] * CELL * CELL
_hx, _hz = np.array([o["x"] for o in houses]), np.array([o["z"] for o in houses])
fields, idx_fields = [], {}
type_of = np.zeros(K + 1, np.int8)
# What each field is used for follows the lie of the land: rice wherever water can be led in (the
# floor, the terraces below a brook or canal); dry fields (hatake) on ground a little higher than the
# fields around it, which drains well and is hard to flood; at the foot of the hills, above the reach
# of the canals, dry fields and small orchards of persimmon and chestnut near the houses, and the
# remote upper benches given up first (fallow, back to susuki).
from scipy.spatial import cKDTree as _KDf
_fkd = _KDf(np.stack([_cx_f, _cz_f], -1))
_rise_f = lvl - floor_base(_cz_f)
_rel_f = np.array([lvl[i_] - float(np.median(lvl[_fkd.query_ball_point((_cx_f[i_], _cz_f[i_]), 70.0)])) for i_ in range(K)])
_forest_edge_f = ndimage.maximum(ndimage.uniform_filter(mountain_factor, 9) > 2.0, comp, np.arange(1, K + 1))
for k_ in range(K):
    fid = int(ids_[k_])
    sy, sx = _slc[k_]
    near_house = float(np.hypot(_hx - _cx_f[k_], _hz - _cz_f[k_]).min())
    r_ = rng.random()
    ftype = "rice"
    if fid >= TERRACE0:
        top = _rise_f[k_] > 22.0                                          # the uppermost benches
        if top and r_ < 0.22 or near_house > 120 and r_ < 0.1:
            ftype = "fallow"                                              # given up first: far up, far from home
        elif near_house < 60 and _rise_f[k_] > 6.0 and r_ < 0.3:
            ftype = "orchard" if r_ < 0.12 else "hatake"                  # above the water, by the houses
        elif r_ < 0.04:
            ftype = "fallow"
    elif _rel_f[k_] > 0.28 and r_ < 0.75:
        ftype = "hatake"                                                  # a low rise among the paddies
    elif near_house < 45 and r_ < 0.14:
        ftype = "hatake"
    elif bool(_forest_edge_f[k_]) and r_ < 0.2:
        ftype = "orchard" if near_house < 80 else "hatake"                # the foot of the hills
    elif r_ < 0.05:
        ftype = "fallow"
    idx_fields[fid] = len(fields)
    fields.append(dict(
        id=f"paddy-{len(fields):03}", label=fid, level=round(float(lvl[k_]), 3),
        bounds=[round(float(axis[sx.start]), 2), round(float(axis[sy.start]), 2), round(float(axis[sx.stop - 1]), 2), round(float(axis[sy.stop - 1]), 2)],
        area=round(float(_area_f[k_]), 1), tint=round(float(rng.uniform(-1, 1)), 3), growth=round(float(rng.uniform(0.85, 1.12)), 3),
        type=ftype, **({"terrace": True} if fid >= TERRACE0 else {})))
    type_of[k_ + 1] = {"rice": 1, "hatake": 2, "fallow": 3, "orchard": 4}[ftype]
field_type = type_of[comp]
# Surface: flat inside; at a boundary the levee stands 0.26 m above the higher of the two fields
# (it holds that field's water) and the bank runs down to the lower one at about 40 degrees.
RICE_EDGE = 0.85                                     # rice starts this far from a levee line
_lv = np.where(is_paddy, paddy_level, -1e9)
_fp = np.hypot(*np.mgrid[-3:4, -3:4]) <= 3.2
crest = ndimage.maximum_filter(_lv, footprint=_fp) + 0.26
h_field = np.maximum(paddy_level, crest - 0.85 * np.maximum(d_fld - 0.3, 0))
h = np.where(is_paddy, h_field, h)
interior = is_paddy & (d_fld >= RICE_EDGE)
is_paddy_f = is_paddy.astype(float)
aze = is_paddy & (d_fld < 0.75)
# Banks: terrain next to fields is cut/filled to a <= 35 degree slope from the levee top.
dist_px, (iy, ix) = ndimage.distance_transform_edt(~is_paddy, return_indices=True)
dist_m = dist_px * CELL
near_lvl = paddy_level[iy, ix] + 0.26
bank_zone = (~is_paddy) & (dist_m < 14) & ~np.isnan(near_lvl)
tan35 = 0.7
h = np.where(bank_zone, np.clip(h, near_lvl - 0.05 - dist_m * tan35, near_lvl + dist_m * tan35), h)

# ---- River channel ----------------------------------------------------------------
_tick('River channel')
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
    run = WALL_RUN * (1 - earth) + np.where(east, earth_slope(Z, True), earth_slope(Z, False)) * np.maximum(top - toe, 0.3) * earth
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
h = np.where(in_track & (track_zd < 2.2), track_y, h)

# Irrigation canal (concrete U-channel, 0.6 m wide) fed by the weir intake, along the
# land side of the east levee, gently graded (1/1000) so it ends up level with the fields.
CANAL_Z0, CANAL_Z1, CANAL_W, CANAL_D = WEIR_Z - 6.0, 372.0, 1.2, 0.42
CULVERT = (BRIDGE_Z - 1.9, BRIDGE_Z + 1.9)   # the farm road crosses on a pipe culvert
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

# ---- Side streams: beds and lined channels ----------------------------------------
_tick('Side streams: beds and lined channels')
# Brook: a stony bed 2.6 m wide sunk into the valley floor, falling steadily (never rising
# downstream). Lined channel: a concrete trough 1.5 m wide whose bed falls from the culvert
# under the road to just above the river's water; the wall tops follow the ground.
for st in streams:
    hp_ = st["hill"]
    gy_ = np.array([at(h, x_, z_) for x_, z_ in hp_])
    gy_ = ndimage.gaussian_filter1d(gy_, 2.0, mode="nearest")
    bed_ = np.minimum.accumulate(gy_ - 0.55)                           # monotone down the valley
    inv_in = min(float(bed_[-1]), road_level(st["z"]) - 1.5)            # culvert invert at the inlet
    bed_[-1] = inv_in
    bed_ = np.minimum.accumulate(bed_)
    st["bed"] = bed_
    for k_ in range(len(hp_) - 1):
        (i0, i1, j0, j1), d_, t_ = _line_dist(stream_d, hp_[k_, 0], hp_[k_, 1], hp_[k_ + 1, 0], hp_[k_ + 1, 1], reach=9.0)
        tgt = bed_[k_] + (bed_[k_ + 1] - bed_[k_]) * t_ + np.maximum(d_ - STREAM_NAT, 0) * 0.85
        keep_road = road_d[i0:i1, j0:j1] < W_FLAT + 0.6
        h[i0:i1, j0:j1] = np.where(keep_road, h[i0:i1, j0:j1], np.minimum(h[i0:i1, j0:j1], tgt))
    # lined channel from the road to the levee
    zc_ = st["z"]
    bed0 = inv_in - 0.12
    bed1 = float(water_level(zc_)) + 0.28
    st["bed0"], st["bed1"] = round(bed0, 3), round(min(bed1, bed0 - 0.3), 3)
    _brg = any(k_ == "bridge" for k_, _a, _b in st["covers"])
    in_x = (X > st["x_levee"]) & (X < (st["x_in"] if _brg else st["x_out"]))
    covered = np.zeros_like(in_x)
    for kind_, cx0, cx1 in st["covers"]:
        if kind_ != "bridge":
            covered |= (X > cx0 - 0.3) & (X < cx1 + 0.3)
    dz_ = np.abs(Z - zc_)
    tx_ = np.clip((st["x_out"] - X) / (st["x_out"] - st["x_riv"]), 0, 1)
    fb = st["bed0"] + (st["bed1"] - st["bed0"]) * tx_
    ground = ndimage.uniform_filter(h, 5)                              # the lie of the land beside the channel
    top_ = ground + 0.06
    open_ = in_x & ~covered
    h = np.where(open_ & (dz_ < STREAM_W / 2), fb - 0.1, h)
    h = np.where(open_ & (dz_ >= STREAM_W / 2) & (dz_ < STREAM_W / 2 + 0.16), top_ - 0.04, h)
    # wall tops along the channel (sampled every 2 m for the mesh)
    xs_ = np.arange(st["x_levee"], st["x_out"] + 0.01, 2.0)
    st["tops"] = [[round(float(x_), 2), round(at(ground, x_, zc_) + 0.06, 3)] for x_ in xs_]

# ---- Irrigation canals and branch ditches: channels ------------------------------
_tick('Irrigation canals and ditches')
# Now that the fields are levelled, set each canal's water against the ground it serves (6-12 m west
# of it, house yards and the temple bench left out) + 0.12 m; every point carries the needs of those
# below it, so the canal stands on a low bank where the ground rises downstream. The intake weir is
# built as high as that requires.
for _c in canals:
    _p = _c["pts"]
    for _i in range(len(_p)):
        _x, _z = _p[_i, 0], _p[_i, 1]
        if _p[_i, 3] != 0 or abs(_x - float(road_x(_z))) > 9.5:
            continue
        if any(math.hypot(hs_["x"] - _x, hs_["z"] - _z) < 30 for hs_ in houses) or at(temple_d, _x - 8, _z) < 14:
            continue
        _p[_i, 2] = max(_p[_i, 2], max(at(h, _x - d_, _z) for d_ in (6.0, 8.0, 10.0, 12.0)) + 0.12)
    _p[:, 2] = np.maximum.accumulate(_p[::-1, 2])[::-1]
    _xi, _zi, _by = _c["intake"]
    _c["intake"] = (_xi, _zi, _by, max(_by + 0.32, float(_p[0, 2]) + 0.02))
for _dt in irr_ditches:
    _c = next(c_ for c_ in canals if c_["pts"][0, 1] - 40 < _dt["z"] < c_["pts"][-1, 1] + 5)
    _dt["water0"] = float(np.interp(_dt["z"], _c["pts"][:, 1], _c["pts"][:, 2])) - 0.08
# Canals: precast concrete U-channel; the ground meets the wall tops on short 1:1.5 fill or 1:1
# cut slopes. Each cell takes the nearest stretch of canal (so overlapping stretches agree).
_cd = np.full_like(h, 1e9)
_cw = np.zeros_like(h)
_scr = np.full_like(h, 1e9)
for _c in canals:
    _p = _c["pts"]
    for _i in range(len(_p) - 1):
        if _p[_i, 3] > 0.5 or _p[_i + 1, 3] > 0.5:
            continue                                      # piped under the road, or under a slab
        (i0, i1, j0, j1), d_, t_ = _line_dist(_scr, _p[_i, 0], _p[_i, 1], _p[_i + 1, 0], _p[_i + 1, 1], reach=7.0)
        closer = d_ < _cd[i0:i1, j0:j1]
        _cd[i0:i1, j0:j1] = np.where(closer, d_, _cd[i0:i1, j0:j1])
        _cw[i0:i1, j0:j1] = np.where(closer, _p[_i, 2] + (_p[_i + 1, 2] - _p[_i, 2]) * t_, _cw[i0:i1, j0:j1])
_ctop = _cw + CANAL2_TOP
_dl = np.maximum(_cd - (CANAL2_W / 2 + 0.2), 0)
_graded = np.clip(h, _ctop - 0.04 - _dl / 1.5, _ctop - 0.04 + _dl * 1.0)
_keep_road = road_d < W_FLAT + 0.3
h = np.where(_keep_road, h, np.where(_cd < CANAL2_W / 2, _cw - CANAL2_D - 0.1,
             np.where(_cd < CANAL2_W / 2 + 0.2, _ctop - 0.04, np.where(_dl < 5.0, _graded, h))))
# Branch ditches: concrete-lined, 0.6 m wide, beside the farm roads; the bed falls from the canal to
# the river (or into the weir canal); slab covers where a road or the levee path crosses.
_ground_i = ndimage.uniform_filter(h, 5)
for _dt in irr_ditches:
    _zd = _dt["z"]
    _rw = float(water_level(_zd)) if not _dt["into_canal"] else float(np.interp(_zd, _cz, _cy))
    _dt["bed0"] = round(_dt["water0"] - 0.3, 3)
    _dt["bed1"] = round(min(_rw + (0.05 if _dt["into_canal"] else 0.25), _dt["bed0"] - 0.25), 3)
    covers_ = []
    if not _dt["into_canal"]:
        covers_.append(("levee", _dt["xr"], _dt["x1"]))
    # the mid-valley farm road and any driveway across the ditch
    _xs = np.arange(_dt["x1"], _dt["x0"], 0.5)
    _cov = np.array([at(farm_d, x_, _zd) < 2.0 or at(lane_d, x_, _zd) < 1.9 for x_ in _xs])
    _k = 0
    while _k < len(_xs):
        if _cov[_k]:
            _k2 = _k
            while _k2 + 1 < len(_xs) and _cov[_k2 + 1]:
                _k2 += 1
            covers_.append(("farm", float(_xs[_k]) - 0.6, float(_xs[_k2]) + 0.6))
            _k = _k2 + 1
        else:
            _k += 1
    _dt["covers"] = covers_
    in_x = (X > _dt["x1"]) & (X < _dt["x0"])
    covered = np.zeros_like(in_x)
    for _kind, cx0, cx1 in covers_:
        covered |= (X > cx0 - 0.3) & (X < cx1 + 0.3)
    dz_ = np.abs(Z - _zd)
    tx_ = np.clip((_dt["x0"] - X) / (_dt["x0"] - _dt["xr"]), 0, 1)
    fb_ = _dt["bed0"] + (_dt["bed1"] - _dt["bed0"]) * tx_
    open_ = in_x & ~covered
    h = np.where(open_ & (dz_ < IRR_DITCH_W / 2), fb_ - 0.1, h)
    h = np.where(open_ & (dz_ >= IRR_DITCH_W / 2) & (dz_ < IRR_DITCH_W / 2 + 0.14), np.maximum(h, _ground_i + 0.02), h)
    _xs = np.arange(_dt["x1"], _dt["x0"] + 0.01, 2.0)
    _dt["tops"] = [[round(float(x_), 2), round(max(at(_ground_i, x_, _zd) + 0.06, float(_dt["bed0"] + (_dt["bed1"] - _dt["bed0"]) * min(max((_dt["x0"] - x_) / (_dt["x0"] - _dt["xr"]), 0), 1)) + 0.3), 3)] for x_ in _xs]

# ---- Encode height -------------------------------------------------------------
_tick('Encode height')
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
_tick('Surface masks')
gy, gx = np.gradient(hq, CELL)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
# woods reach down the footslopes to the edge of the fields (satoyama), not just the mountains
forest_density = np.clip(smoothstep(0.35, 3.5, mountain_factor) + smoothstep(2, 10, shrine_spur(X, Z) - 2), 0, 1)
forest_density = np.clip(forest_density * (0.75 + 0.5 * (fbm(P1, X, Z, 140, 3) * 0.5 + 0.5)), 0, 1)
pre = (X > px0 - 1) & (X < px1) & (Z > pz0) & (Z < pz1)
forest_density = np.where(pre, 0, forest_density)
forest_density = np.where(is_paddy | TER | ((road_d < 6) & (Z > ROAD_Z0 - 1.0)) | (rd < RB + _sec['run'] + _sec['cap'] + 1.0), 0, forest_density)
forest_density = forest_density * smoothstep(1.6, 4.0, stream_d) * smoothstep(-1.0, 5.0, temple_d)
# below the lookout the trees are kept low for the view: that slope is a mown meadow (kusachi),
# not bare forest floor
_ldx, _ldz = X - LOOKOUT[0], Z - LOOKOUT[2]
_ld = np.hypot(_ldx, _ldz)
_laz = np.arctan2(_ldx, -_ldz)
_adiff = lambda a_, b_: np.abs((a_ - b_ + np.pi) % (2 * np.pi) - np.pi)
_cone = ((_ld < 195) & (_adiff(_laz, LOOK_DIR) < math.radians(40))) | ((_ld < 235) & (_adiff(_laz, SUN_AZ) < math.radians(18)))
forest_density = np.where(_cone & (_ld > 12), forest_density * 0.15, forest_density)
# Forest stands. The hills are not one even wood: the lower slopes near the village are mostly sugi
# and hinoki plantations (planted in rows, one age to a stand), with here and there a stand replanted
# a few years ago and a recent clear-cut; the upper slopes and ridges keep natural broadleaf wood
# (konara, oak, cherry, with red pine on the ridges). Stands are cells of jittered seeds ~120 m apart.
from scipy.spatial import cKDTree as _KDs
_srng = np.random.default_rng(SEED + 41)
_seeds = []
for _sz in np.arange(-HALF - 60, HALF + 60, 120.0):
    for _sx in np.arange(-HALF - 60, HALF + 60, 120.0):
        _seeds.append((_sx + _srng.uniform(-45, 45), _sz + _srng.uniform(-45, 45)))
_seeds = np.array(_seeds)
_stand_kd = _KDs(_seeds)
STAND = []
for _k, (_sx, _sz) in enumerate(_seeds):
    _up = at(mountain_factor, _sx, _sz)
    _near = min(abs(_sx - float(road_x(_sz))), abs(_sx - float(river_x(_sz)))) < 320
    _r = _srng.random()
    if _up > 95 or (not _near and _r < 0.45):
        kind_ = "natural"
    elif _r < 0.07 and 8 < _up < 70:
        kind_ = "clearcut"
    elif _r < 0.17 and 6 < _up < 80:
        kind_ = "young"
    else:
        kind_ = "plantation" if _r < 0.8 else "natural"
    STAND.append(dict(kind=kind_, angle=_srng.uniform(0, math.pi), age=_srng.uniform(0.82, 1.18)))
_, _stand_id = _stand_kd.query(np.stack([X.ravel(), Z.ravel()], -1))
_stand_id = _stand_id.reshape(X.shape)
_stand_kind = np.array([{"plantation": 0, "natural": 1, "young": 2, "clearcut": 3}[st_["kind"]] for st_ in STAND])[_stand_id]
# a clear-cut is open ground (grass, brush, stumps) until it is replanted
forest_density = np.where(_stand_kind == 3, forest_density * 0.12, forest_density)
rock = smoothstep(50, 62, slope) * (1 - is_paddy)
# River bed: wet cobbles at and under the water, dry grey gravel on the bars, grass over the high bars.
WLg = water_level(Z)
above = hq - WLg
earth_s = _sec["earth"]
in_bed = (1 - smoothstep(RB + 0.1, RB + 0.5, rd)) * (1 - earth_s) + (1 - smoothstep(RB + 0.3, RB + 1.6, rd)) * earth_s
nb_ = 0.08 * fbm(P2, X, Z, 2.5, 2)
riverbed = in_bed * (1 - smoothstep(0.03, 0.12, above + nb_))
# the brooks of the side valleys run over cobbles
riverbed = np.maximum(riverbed, (1 - smoothstep(STREAM_NAT - 0.3, STREAM_NAT + 0.5, brook_d)) * (road_d > W_FLAT + 0.6))
# grass takes the higher, older parts of the bars in patches (bar vegetation in August)
patch = fbm(P4, X, Z, 7.0, 3)
bar = in_bed * (1 - riverbed) * (1 - smoothstep(0.32, 0.5, above + 0.45 * patch + nb_))
wall_band = (1 - earth_s) * (rd > RB - 0.3) * (rd < RB + _sec["run"] + _sec["cap"] + 0.15)
asphalt = (1 - smoothstep(ROAD_HALF - 0.1, ROAD_HALF + 0.15, road_d)) * (Z > ROAD_Z0 - 0.6) * (1 - smoothstep(HALF - 30, HALF - 10, Z))
# town roads: to the bridge (4 m) and up to Kawamuko (3.5 m), paved without markings
town_paved = ((X > track_x0 - 1.0) & (X < track_x1 + 0.5)) * (1 - smoothstep(1.85, 2.1, track_zd))
# in the centre the shoulders are paved up to the ditch, and the shop fronts beyond it
in_machi = smoothstep(MACHI_Z[0] - 6, MACHI_Z[0], Z) * (1 - smoothstep(MACHI_Z[1], MACHI_Z[1] + 6, Z))
asphalt = np.maximum(asphalt, in_machi * (1 - smoothstep(DITCH_OFF - 0.35, DITCH_OFF - 0.2, road_d)))
asphalt = np.maximum(asphalt, np.maximum(town_paved, 1 - smoothstep(1.6, 1.85, town_d)))
branch = (1 - smoothstep(1.8, 2.3, bd))
dirt = np.clip(branch + (1 - smoothstep(0.8, 1.4, np.abs(Z - STAIR_Z))) * ((X > 92) & (X < STAIR_X0)) * 0, 0, 1)
track = np.zeros_like(h)
# Levee path and the farm road to the bridge: two wheel ruts with grass between them.
def ruts(d):
    return np.maximum(1 - smoothstep(0.16, 0.36, np.abs(d - 0.68)), 0.3 * (1 - smoothstep(0.9, 1.3, d)))
levee_c = RB + _sec["run"] + _sec["cap"] + _sec["path"] / 2
levee_path = (X > rx) * ruts(np.abs(rd - levee_c)) * smoothstep(-(HALF - 40), -(HALF - 60), Z) * (1 - smoothstep(HALF - 20, HALF - 5, Z))
track = np.maximum(track, levee_path)
# farm roads: compacted gravel with wheel ruts
gravel_road = (1 - smoothstep(1.4, 1.75, farm_d)) * (1 - town_paved)
dirt = np.clip(dirt + track * 0.85, 0, 1)
# road shoulders: packed earth and gravel between the asphalt edge and the ditch
shoulder = (1 - smoothstep(ROAD_HALF + 0.1, ROAD_HALF + 0.8, road_d)) * smoothstep(ROAD_HALF - 0.2, ROAD_HALF + 0.1, road_d) * (Z > ROAD_Z0 - 0.6)
dirt = np.maximum(dirt, shoulder * 0.9)
# lanes: worn wheel ruts
dirt = np.maximum(dirt, np.maximum(ruts(lane_d) * 0.9, gravel_road * (0.55 + 0.4 * ruts(farm_d))))
# house plots: packed-earth front yard (niwa) and a kitchen garden on the east side
garden = np.zeros(h.shape, bool)
# in the centre the strip between the ditch and the shop fronts is a concrete apron (forecourts,
# parking for a kei truck or bicycles), lighter than the asphalt of the carriageway
concrete = in_machi * smoothstep(DITCH_OFF - 0.4, DITCH_OFF - 0.3, road_d) * (1 - smoothstep(DITCH_OFF + 2.4, DITCH_OFF + 3.4, road_d))
yard_noise = 0.6 + 0.8 * (fbm(P2, X, Z, 4, 2) * 0.5 + 0.5)
for hs in houses:
    c, s_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    W2, D2 = hs["w"] / 2, hs["d"] / 2
    win = (np.abs(X - hs["x"]) < 30) & (np.abs(Z - hs["z"]) < 30)
    lx = (X - hs["x"]) * c - (Z - hs["z"]) * s_
    lz = (X - hs["x"]) * s_ + (Z - hs["z"]) * c
    bs = hs["barn"]
    yard = np.maximum(np.maximum(-(W2 + (1.5 if hs["group"] == "machi" else 6)) + bs * lx, -bs * lx - (W2 + 1.0)), np.maximum(D2 - 0.3 - lz, lz - (D2 + hs["front"] - 0.5)))
    if hs["group"] == "machi":
        # concrete forecourt in front of shops and houses on the main street
        concrete = np.where(win, np.maximum(concrete, (1 - smoothstep(-0.3, 0.6, yard)) * 0.95), concrete)
    dirt = np.where(win, np.maximum(dirt, (1 - smoothstep(-0.5, 1.2, yard)) * 0.8 * np.clip(yard_noise, 0, 1.2)), dirt)
    dirt = np.where(win, np.maximum(dirt, (1 - smoothstep(4, 11, np.hypot(lx, lz))) * 0.3 * yard_noise), dirt)
    gx = sorted([-bs * (W2 + 1.8), -bs * (W2 + 7.6)])
    # beside the house; a house on the road keeps its vegetable patch out of the front yard
    gz1 = D2 + (1.0 if hs["roadside"] else min(8.5, hs["front"] - 1.0))
    hs["garden"] = [gx[0], gx[1], -D2 + 0.5, gz1]          # local x0, x1, z0, z1
    if hs["group"] == "machi":
        hs["garden"] = None
        continue
    garden |= win & (lx > gx[0]) & (lx < gx[1]) & (lz > -D2 + 0.5) & (lz < gz1)
dirt = np.maximum(dirt, (1 - smoothstep(-1.5, 0.5, temple_d)) * 0.8 * np.clip(yard_noise, 0, 1.2))    # the temple yard: swept earth
gravel = pre * (1 - smoothstep(-3.0, 1.0, edge))  # the whole precinct floor is gravel up to its rim
forest_density = np.maximum(forest_density, pre * smoothstep(-6, 0, edge) * 0.5)
rice = interior & (field_type == 1)
# soft ramps across the levee line (0.5 where the crop starts): the terrain shader's blend and the
# rice mask then follow the smooth distance field instead of the grid
_in = smoothstep(RICE_EDGE - 0.45, RICE_EDGE + 0.45, d_fld) * is_paddy
paddy_mud = _in * (field_type == 1)
furrows = np.maximum(_in * (field_type == 2), garden.astype(np.float64))
forest_floor = forest_density
grass = np.ones_like(h)
rock = rock * (1 - in_bed) * (1 - wall_band)
layers = dict(grass=grass, forest=forest_floor, dirt=dirt, rock=rock, paddy=paddy_mud, riverbed=riverbed, gravel=gravel, asphalt=asphalt, furrows=furrows, bar=bar, concrete=concrete)
order = ["grass", "forest", "dirt", "rock", "paddy", "riverbed", "gravel", "asphalt", "furrows", "bar", "concrete"]
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
# the levees of most fields are mown through the summer (short, sparse grass); a few are left to grow
_mown = ((label * 2654435761) % 10) < 7
grass_density = np.clip(wgt["grass"] * (1 - 0.6 * forest_density) + wgt["forest"] * 0.25
                        + is_paddy * (1 - smoothstep(0.5, 1.2, d_fld)) * np.where(_mown, 0.36, 0.85), 0, 1)
# nothing grows through the revetments, the canal or the wet margin; sparse tufts on the dry gravel
grass_density = grass_density * (1 - wall_band) * (1 - riverbed) * (1 - 0.8 * wgt["bar"]) * ~(in_canal & (cdx < CANAL_W / 2 + 0.3))
grass_density = grass_density * (stream_d > STREAM_W / 2 + 0.3) * (1 - 0.9 * (temple_d < 0))
# road verges: a strip mown short beside the ditch; the cut and fill banks beyond left long
_onroad = Z > ROAD_Z0 - 0.6
grass_density = np.where(_onroad & (road_d > DITCH_OFF + 0.3) & (road_d < DITCH_OFF + 1.9), grass_density * 0.45, grass_density)
grass_density = np.where(_onroad & (road_d > W_FLAT + 0.6) & (road_d < W_FLAT + 7.0) & ~is_paddy, np.maximum(grass_density, 0.9 * wgt["grass"]), grass_density)
pid = np.where(is_paddy, (label * 2654435761 % 251 + 3), 0) % 255
# B: signed distance to the edge of the rice, 0.5 at the edge, +-2 m over the range (rice fields only)
rice_sdf = np.where(is_paddy & (field_type == 1), np.clip(0.5 + (d_fld - RICE_EDGE) / 4.0, 0, 1), 0.0)
aux = np.stack([forest_density, pid / 255.0, rice_sdf, grass_density], -1)
Image.fromarray(np.uint8(np.rint(np.clip(aux, 0, 1) * 255)), "RGBA").save(OUT / "vegetation-mask.png")
# Paddy level map (float -> uint16 heights in same encoding), used for rice canopy.
# (the level runs on two cells beyond each rice field so the canopy sheet stays flat across its
# edge; the distance field in the vegetation mask cuts the rice off, not the grid)
_dpx, (_iy, _ix) = ndimage.distance_transform_edt(~(is_paddy & (field_type == 1)), return_indices=True)
pl = np.where(_dpx < 2.6, paddy_level[_iy, _ix], H_MIN)
Image.fromarray(np.rint((pl - H_MIN) / H_RANGE * 65535).astype(np.uint16)).save(OUT / "paddy-level.png")

# ---- Vegetation placement ---------------------------------------------------------
_tick('Vegetation placement')
rv = np.random.default_rng(SEED + 7)
trees = {k: [] for k in ["sugi", "hinoki", "akamatsu", "broadleaf", "bamboo", "keyaki"]}

def on_approach(x, z, margin=0.0):
    """Village road -> foot torii branch path and the stone forecourt."""
    return road_at_stair - 4 < x < STAIR_X0 + 1 and abs(z - STAIR_Z) < 5.5 + margin

def river_corridor(x, z, extra=0.0):
    """Bed, revetment, cap and levee path of the river, the canal and the farm road to the bridge."""
    u = x - float(river_x(z))
    B = float(bed_half(z))
    reach = B + float(bank_ext(z, u >= 0)) + (PATH_W + 0.8 if u >= 0 else 0.6)
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
    if abs(x - float(road_x(z))) < 5.5 and z > ROAD_Z0 - 2.0:
        return True
    if river_corridor(x, z):
        return True
    if view_blocked(x, z, top):
        return True
    return bool(cell(built_block, x, z))

# cells no tree may stand on: around every building, in the temple precinct, along the streams
built_block = (temple_d < 2.0) | (stream_d < 2.4) | (irr_d < 2.2)
for hs in houses:
    reach = max(hs["w"], hs["d"]) / 2 + 5 + (5 if hs.get("wing") else 0)
    j0 = max(int((hs["x"] - reach) / CELL + (N - 1) / 2), 0); j1 = min(int((hs["x"] + reach) / CELL + (N - 1) / 2) + 2, N)
    i0 = max(int((hs["z"] - reach) / CELL + (N - 1) / 2), 0); i1 = min(int((hs["z"] + reach) / CELL + (N - 1) / 2) + 2, N)
    built_block[i0:i1, j0:j1] |= np.hypot(X[i0:i1, j0:j1] - hs["x"], Z[i0:i1, j0:j1] - hs["z"]) < reach

def view_blocked(x, z, top=None):
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

# General forest via jittered grid + density, stand by stand.
spacing = 5.3
_planted, _cut_stumps, _edge_shrubs = set(), [], []
gridx = np.arange(-(HALF - 4), HALF - 4, spacing)
for gz in np.arange(-(HALF - 4), HALF - 4, spacing):
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
        sid = int(_stand_kd.query((x, z))[1])
        stand = STAND[sid]
        ridge = cell(mountain_factor, x, z) > 150 or sl < 12 and y > 120
        r = rv.random()
        edge_ = fd < 0.45                                   # the margin of the wood
        if stand["kind"] in ("plantation", "young"):
            # planted rows: the tree stands on the stand's own lattice (one age, little jitter)
            ca_, sa_ = math.cos(stand["angle"]), math.sin(stand["angle"])
            u_, v_ = gxv * ca_ + gz * sa_, -gxv * sa_ + gz * ca_
            u_, v_ = round(u_ / spacing) * spacing, round(v_ / spacing) * spacing
            x, z = u_ * ca_ - v_ * sa_ + rv.normal(0, 0.25), u_ * sa_ + v_ * ca_ + rv.normal(0, 0.25)
            if int(_stand_kd.query((x, z))[1]) != sid or (sid, round(u_), round(v_)) in _planted:
                continue
            _planted.add((sid, round(u_), round(v_)))
            if blocked(x, z, top=sample(x, z) + 13.0) or cell(forest_density, x, z) <= 0.05:
                continue
            kind = "sugi" if (r < 0.8 or y > 200) else "hinoki"
            scale = stand["age"] * rv.uniform(0.94, 1.06) * (0.36 if stand["kind"] == "young" else 1.0)
        elif stand["kind"] == "clearcut":
            if r < 0.85:
                _cut_stumps.append((x, z))
                continue
            kind, scale = "broadleaf", rv.uniform(0.3, 0.5)    # a few young trees coming up in the cut
        else:
            # natural wood: clumps and gaps, mixed sizes
            if fbm(P4, np.array(x), np.array(z), 26, 2) + 0.35 * rv.normal() < -0.45:
                continue
            if ridge and r < 0.45:
                kind = "akamatsu"
            else:
                kind = "broadleaf" if r < 0.82 else ("keyaki" if r < 0.86 else ("akamatsu" if r < 0.93 else "hinoki"))
            scale = rv.uniform(0.62, 1.2) * (1.0 if kind != "keyaki" else 0.75)
        if edge_ and stand["kind"] != "plantation":
            scale *= rv.uniform(0.55, 0.8)                     # lower trees and scrub along the edge
            _edge_shrubs.append((x + rv.normal(0, 2.0), z + rv.normal(0, 2.0)))
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
        if blocked(x, z) or cell(is_paddy_f, x, z) > 0.5 or abs(x - float(road_x(z))) < 9:
            continue
        add_tree("bamboo", x, z, rv.uniform(0.75, 1.1), lean=rv.normal(0, 0.05))
# Bamboo at the foot of the hills near the hamlets, where the wood meets the fields and yards
_bg = 0
for _try in range(400):
    if _bg >= 14:
        break
    hs = houses[int(rv.integers(0, len(houses)))]
    cx, cz = hs["x"] + rv.uniform(-90, 90), hs["z"] + rv.uniform(-70, 70)
    _mf, _fd = cell(mountain_factor, cx, cz), cell(forest_density, cx, cz)
    if not (1.0 < _mf < 9.0 and 0.2 < _fd < 0.75) or cell(is_paddy_f, cx, cz) > 0.5 or blocked(cx, cz):
        continue
    _bg += 1
    for i in range(int(rv.integers(50, 110))):
        x = cx + rv.normal(0, 7)
        z = cz + rv.normal(0, 5)
        if blocked(x, z) or cell(is_paddy_f, x, z) > 0.5 or abs(x - float(road_x(z))) < 9:
            continue
        add_tree("bamboo", x, z, rv.uniform(0.75, 1.1), lean=rv.normal(0, 0.05))
# Igune: the windbreak of each farmstead, tall sugi in one or two rows on the north and west
# sides (against the winter north-westerly off the Ou mountains), a keyaki or two among them;
# farmsteads among the paddies are ringed on the east as well. A persimmon by the yard.
def igune_ok(x, z, own):
    if abs(x - float(road_x(z))) < 5.0 or river_corridor(x, z) or on_approach(x, z, 1.0):
        return False
    if abs(z - STAIR_Z) < STAIR_W / 2 + 2 and STAIR_X0 - 26 < x < STAIR_X1 + 2:
        return False
    if math.hypot(x - FIRE_TOWER[0], z - FIRE_TOWER[1]) < 6:
        return False
    for o in houses:
        if o is not own and math.hypot(x - o["x"], z - o["z"]) < max(o["w"], o["d"]) / 2 + 6:
            return False
    return True
for hs in houses:
    c, s_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    W2, D2 = hs["w"] / 2, hs["d"] / 2
    loc = lambda lx, lz: (hs["x"] + lx * c + lz * s_, hs["z"] - lx * s_ + lz * c)
    if hs["group"] == "machi":
        continue
    if hs["roadside"]:
        # houses that front the road have no windbreak: a garden tree or two behind the house
        for k_ in range(int(rv.integers(0, 3))):
            x, z = loc(rv.uniform(-W2, W2), -(D2 + rv.uniform(3, 5)))
            if igune_ok(x, z, hs) and not view_blocked(x, z, sample(x, z) + 9.0):
                add_tree(str(rv.choice(["broadleaf", "broadleaf", "keyaki"])), x, z, rv.uniform(0.4, 0.6))
        continue
    spots = []
    rows = 2 if hs["group"] == "sankyo" or rv.random() < 0.4 else 1
    for r_ in range(rows):
        lx = -(W2 + 9) - r_ * 3
        while lx < W2 + 8:
            spots.append((lx + rv.uniform(-0.6, 0.6), -(D2 + 7.5 + r_ * 3.2) - rv.uniform(0, 1.5)))
            lx += rv.uniform(2.8, 3.8)
        lz = -(D2 + 6)
        while lz < D2 + 6:
            spots.append((-(W2 + 10.5 + r_ * 3.2) - rv.uniform(0, 1.5), lz + rv.uniform(-0.5, 0.5)))
            lz += rv.uniform(3.0, 4.0)
    if hs["group"] == "sankyo":
        lz = -(D2 + 6)
        while lz < D2 + 4:
            spots.append((W2 + 10.5 + rv.uniform(0, 1.5), lz))
            lz += rv.uniform(3.2, 4.4)
    for lx, lz in spots:
        x, z = loc(lx, lz)
        if not igune_ok(x, z, hs):
            continue
        if view_blocked(x, z, sample(x, z) + 24.0):
            # in the lookout's view: a lower windbreak of broadleaf trees under the sight line
            if not view_blocked(x, z, sample(x, z) + 8.0):
                add_tree("broadleaf", x, z, rv.uniform(0.42, 0.52))
            continue
        r_ = rv.random()
        if r_ < 0.76:
            add_tree("sugi", x, z, rv.uniform(0.8, 1.12))
        elif r_ < 0.9:
            add_tree("keyaki", x, z, rv.uniform(0.75, 1.05))
        else:
            add_tree("hinoki", x, z, rv.uniform(0.75, 1.0))
    if rv.random() < 0.65:
        x, z = loc(-hs["barn"] * (W2 + 3.0 + rv.uniform(0, 2)), D2 + 9.5 + rv.uniform(0, 1.5))
        if igune_ok(x, z, hs):
            add_tree("broadleaf", x, z, rv.uniform(0.36, 0.5))        # kaki in the yard
# Riverside trees: a wooded strip along the west bank, a few trees on the east levee,
# willow scrub on the high gravel bars and bamboo flood-defence groves (suigai-bobirin).
def bank_reach(z, east):
    B = float(bed_half(z))
    return B + float(bank_ext(z, east)) + (PATH_W + 0.8 if east else 0.6)
riparian_shrubs = []
for z in np.arange(-(HALF - 60), HALF - 10, 3.0):
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
for z in np.arange(-(HALF - 80), HALF - 20, 3.5):
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
_tick('Ground clutter (near the walkable core only)')
clutter = {k: [] for k in ["fern", "shrub", "weed", "rock_moss", "boulder", "river_stone", "stump", "log", "susuki", "reed", "crop"]}
def add_clutter(kind, x, z, scale, variant=0, sink=0.0):
    # keep the stair treads, landings and the forecourt clear
    reach = {"rock_moss": 1.1, "boulder": 1.4, "log": 2.5, "stump": 0.6}.get(kind, 0.35) * scale
    if on_approach(x, z, reach):
        return
    if STAIR_X0 - 30 < x < STAIR_X1 + 3 and abs(z - STAIR_Z) < STAIR_W / 2 + 0.5 + reach:
        return
    clutter[kind].append([round(x, 2), round(sample(x, z) - sink, 3), round(z, 2), round(scale, 3), round(float(rv.random() * math.tau), 3), int(variant)])

core = lambda x, z: (60 < x < 300 and -120 < z < 40) or (-330 < x < 170 and -540 < z < 700)
for i in range(40000):
    x, z = rv.uniform(-330, 300), rv.uniform(-540, 700)
    if not core(x, z):
        continue
    fd = cell(forest_density, x, z)
    if blocked(x, z) and not (abs(z - STAIR_Z) > STAIR_W / 2 + 0.4 and STAIR_X0 - 2 < x < STAIR_X1):
        continue
    if cell(is_paddy_f, x, z) > 0.5 or abs(x - float(road_x(z))) < W_FLAT:
        continue
    if cell(wgt["concrete"] + wgt["asphalt"] + wgt["dirt"], x, z) > 0.5:      # nothing on paving or bare yards
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
hat_f = hat.astype(float)
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
            if cell(hat_f, x, zr) > 0.5 and cell(hat_f, x + 0.6, zr) > 0.5 and cell(hat_f, x - 0.6, zr) > 0.5:
                clutter["crop"].append([round(x, 2), round(sample(x, zr) + 0.04, 3), round(zr, 2), round(float([0.75, 0.55, 0.95, 0.42][crop] * rv.uniform(0.8, 1.2)), 3), round(float(rv.random() * math.tau), 3), crop])
            x += step_ * rv.uniform(0.85, 1.15)
        zr += FURROW_PITCH

# Kitchen gardens beside the houses: two or three crops in rows on the furrow ridges.
for hs in houses:
    c, s_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    if not hs.get("garden"):
        continue
    gx0_, gx1_, gz0_, gz1_ = hs["garden"]
    corners = [(hs["x"] + lx * c + lz * s_, hs["z"] - lx * s_ + lz * c) for lx in (gx0_, gx1_) for lz in (gz0_, gz1_)]
    zmin, zmax = min(p_[1] for p_ in corners), max(p_[1] for p_ in corners)
    xmin, xmax = min(p_[0] for p_ in corners), max(p_[0] for p_ in corners)
    n0 = math.ceil(zmin / FURROW_PITCH - FURROW_PHASE)
    zr = (n0 + FURROW_PHASE) * FURROW_PITCH
    k_ = 0
    while zr < zmax:
        crop = [1, 3, 2, 3][(k_ // 3 + int(hs["x"])) % 4]
        x = xmin + rv.uniform(0, 0.3)
        while x < xmax:
            lx = (x - hs["x"]) * c - (zr - hs["z"]) * s_
            lz = (x - hs["x"]) * s_ + (zr - hs["z"]) * c
            if gx0_ + 0.3 < lx < gx1_ - 0.3 and gz0_ + 0.3 < lz < gz1_ - 0.3:
                clutter["crop"].append([round(x, 2), round(sample(x, zr) + 0.04, 3), round(zr, 2), round(float([0.75, 0.55, 0.95, 0.42][crop] * rv.uniform(0.8, 1.2)), 3), round(float(rv.random() * math.tau), 3), crop])
            x += [0.55, 0.4, 0.7, 0.3][crop] * rv.uniform(0.85, 1.15)
        zr += FURROW_PITCH
        k_ += 1
# Orchards (persimmon, chestnut): small trees in rows across the field, grass beneath.
for f in fields:
    if f["type"] != "orchard":
        continue
    x0b, z0b, x1b, z1b = f["bounds"]
    fid_cells = (label == int(f["label"]))
    ang = rv.uniform(0, math.pi)
    ca, sa = math.cos(ang), math.sin(ang)
    sp_ = rv.uniform(4.5, 6.0)
    cx_, cz_ = (x0b + x1b) / 2, (z0b + z1b) / 2
    R_ = math.hypot(x1b - x0b, z1b - z0b) / 2 + sp_
    for a_ in np.arange(-R_, R_, sp_):
        for b_ in np.arange(-R_, R_, sp_):
            x = cx_ + a_ * ca - b_ * sa + rv.normal(0, 0.3)
            z = cz_ + a_ * sa + b_ * ca + rv.normal(0, 0.3)
            if at(fid_cells, x, z) > 0.5 and at(d_fld, x, z) > 1.6:
                add_tree("broadleaf", x, z, rv.uniform(0.32, 0.45))
# Fallow fields (terraces and floor) going back to susuki and weeds.
for f in fields:
    if f["type"] != "fallow":
        continue
    x0b, z0b, x1b, z1b = f["bounds"]
    fid_cells = (label == int(f["label"]))
    for k_ in range(int(f["area"] / 9)):
        x, z = rv.uniform(x0b, x1b), rv.uniform(z0b, z1b)
        if at(fid_cells, x, z) > 0.5:
            if rv.random() < 0.55:
                add_clutter("susuki", x, z, rv.uniform(0.8, 1.35))
            else:
                add_clutter("weed", x, z, rv.uniform(0.7, 1.3), int(rv.integers(0, 2)))

# River stones along the water margin and through the riffles, riprap at the outer bends
# and below the drops, reed (tsuruyoshi) patches on the bars, susuki on the earth banks.
for z in np.arange(-(HALF - 60), HALF - 15, 0.8):
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
# Clear-cuts: stumps and brush; the margins of the woods: shrubs
for (x, z) in _cut_stumps:
    if rv.random() < 0.55 and not blocked(x, z):
        add_clutter("stump", x, z, rv.uniform(0.8, 1.2), sink=0.05)
    if rv.random() < 0.6:
        add_clutter("shrub", x + rv.normal(0, 1.5), z + rv.normal(0, 1.5), rv.uniform(0.6, 1.2), int(rv.integers(0, 3)))
    if rv.random() < 0.15:
        add_clutter("log", x + rv.normal(0, 1.0), z + rv.normal(0, 1.0), rv.uniform(0.6, 1.0), int(rv.integers(0, 2)), sink=0.05)
for (x, z) in _edge_shrubs:
    if not blocked(x, z) and cell(is_paddy_f, x, z) < 0.5:
        add_clutter("shrub", x, z, rv.uniform(0.7, 1.3), int(rv.integers(0, 3)))
for (x, z) in riparian_shrubs:
    if not river_corridor(x, z) and cell(is_paddy_f, x, z) < 0.5:
        add_clutter("shrub", x, z, rv.uniform(0.7, 1.3), int(rv.integers(0, 3)))
for info in DROP_INFO:
    d = info["z"]
    apron = 5.0 if info["kind"] == "weir" else 3.2
    for i in range(int(float(bed_half(d)) * 2.4)):
        zz = d + apron + rv.uniform(0.3, 5.5)
        add_clutter("boulder", float(river_x(zz)) + rv.uniform(-1, 1) * (float(bed_half(zz)) - 0.6), zz, rv.uniform(0.4, 0.8), int(rv.integers(0, 2)), sink=0.35)
# Natural reaches: boulders at the foot of the cut banks and across the riffles, driftwood left
# stranded on the point bars by the last flood.
for z in np.arange(-(HALF - 60), HALF - 15, 2.0):
    if float(natural_w(z)) < 0.5:
        continue
    B, c, hw = float(bed_half(z)), float(low_off(z)), float(chan_half(z))
    rxz, ph = float(river_x(z)), math.sin(float(_phase(z)))
    if abs(ph) > 0.45 and rv.random() < 0.55:
        add_clutter("boulder", rxz + math.copysign(B - rv.uniform(0.2, 1.3), c), z + rv.uniform(-1, 1), rv.uniform(0.55, 1.15), int(rv.integers(0, 2)), sink=0.35)
    if abs(ph) < 0.4 and rv.random() < 0.45:
        add_clutter("boulder", rxz + c + rv.uniform(-hw, hw), z + rv.uniform(-1, 1), rv.uniform(0.35, 0.75), int(rv.integers(0, 2)), sink=0.3)
    if abs(ph) > 0.55 and rv.random() < 0.1:
        u = c - math.copysign(hw + rv.uniform(1.2, 5.0), c)
        if abs(u) < B - 1.2:
            add_clutter("log", rxz + u, z + rv.uniform(-1, 1), rv.uniform(0.55, 1.0), int(rv.integers(0, 2)), sink=0.05)
for z in np.arange(-(HALF - 60), HALF - 15, 1.2):
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
_tick('Built objects')
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

# Shop and public building signs (fictional names; drawn at runtime from a subset of Noto Serif JP)
SIGNS = {
    "shop-yorozuya": [("佐藤商店", "board")], "shop-sakaya": [("菅原酒店", "board"), ("たばこ", "tabako")],
    "post-office": [("〒 上沢郵便局", "post")], "chuzaisho": [("上沢駐在所", "plate")],
    "nokyo": [("上沢農協 支所", "board")], "kominkan": [("上沢地区公民館", "wood")],
    "barber": [("理容 阿部", "board")], "shop-tofu": [("高橋豆腐店", "board")],
    "shinryojo": [("上沢診療所", "board")],
}
smoke_n = 0
for i, hs in enumerate(houses):
    asset = hs["asset"]
    W2, D2 = hs["w"] / 2, hs["d"] / 2
    shop = hs["kind"] == "shop"
    machi = hs["group"] == "machi"
    # a thin column of smoke from a few kitchens and bath stoves (and the irori of a thatched house)
    smoke = not shop and hs["group"] != "sankyo" and rng.random() < 0.16 and smoke_n < 8
    smoke_n += int(smoke)
    extra = {}
    if smoke:
        extra["smoke"] = True
    if hs["roadside"]:
        extra["roadside"] = True
    if hs.get("oldroad"):
        extra["oldRoad"] = True
    if shop and asset in SIGNS and machi:
        extra["signs"] = [{"text": t, "style": st} for t, st in SIGNS[asset]]
    if shop and not machi and asset == "kominkan":
        extra["hall"] = "shukaijo"              # a hamlet's meeting hall (the community-hall model, no sign)
    obj(asset, hs["x"], hs["y"], hs["z"], hs["yaw"], hs.get("scale", 1.0), variant=hs["variant"], size=[round(hs["w"], 2), round(hs["d"], 2)],
        group=hs["group"], **extra,
        collider={"type": "box", "halfExtents": [round((W2 + 0.3) / hs.get("scale", 1.0), 3), round(3.0 * hs["storeys"] / hs.get("scale", 1.0), 3), round((D2 + 0.3) / hs.get("scale", 1.0), 3)]},
        **({"wing": {"offset": hs["wing"][:2], "halfExtents": [hs["wing"][2] / 2 + 0.3, 2.6, hs["wing"][3] / 2 + 0.3]}} if hs.get("wing") else {}))
    c, s_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
    def local(lx, lz):
        return hs["x"] + lx * c + lz * s_, hs["z"] - lx * s_ + lz * c
    for k in range(2 if not shop else 1):
        px_, pz_ = local(rng.uniform(-W2, W2), -D2 - 1.6)
        obj(str(rng.choice(["prop-bucket", "prop-barrels", "prop-crate", "prop-basket", "prop-ladder"])), px_, hs["y"], pz_, float(rng.random() * math.tau), 1.0)
    if machi or shop:
        continue
    # barn at the side of the yard away from the road, its open bay facing the yard
    bs = hs["barn"]
    bx, bz = local(bs * (W2 + 5.0), D2 + min(3.2, hs["front"] - 2.5))
    obj("naya", bx, hs["y"], bz, hs["yaw"] - bs * math.pi / 2, rng.uniform(0.85, 1.1), collider={"type": "box", "halfExtents": [2.6, 1.8, 2.1]})
    # farmsteads: a work shed (sagyo-goya) for the tools and the tiller at the back corner on the barn
    # side, so the yard is framed by the house, the barn and the shed
    if hs["group"] in ("kaminosawa", "nakazato", "miyashita", "shimojuku", "minamizawa", "sankyo", "kawamuko") and rng.random() < 0.75:
        sx_, sz_ = local(bs * (W2 + 3.4), -D2 + 1.6)
        obj("naya", sx_, hs["y"], sz_, hs["yaw"] + bs * math.pi / 2, rng.uniform(0.62, 0.72), collider={"type": "box", "halfExtents": [1.8, 1.3, 1.5]})
    # laundry poles (monohoshi) in the sunny front yard, on the side away from the barn
    if hs["front"] > 5.0 and rng.random() < 0.65:
        lx_, lz_ = local(-bs * (W2 - 3.0), D2 + 2.6)
        obj("monohoshi", lx_, hs["y"], lz_, hs["yaw"] + rng.normal(0, 0.05), 1.0, collider={"type": "box", "halfExtents": [1.6, 0.95, 0.12]})
    if (i % 3 == 0 or (hs["group"] == "minamizawa" and i % 3 == 1)) and hs["group"] != "sankyo":
        wx, wz = local(-2.0, D2 + hs["front"] + 0.3)
        obj("block-wall", wx, hs["y"], wz, hs["yaw"], 1.0, length=round(hs["w"] + 8, 2))
    if i % 4 == 1 and hs["front"] > 6:
        tx, tz = local(-bs * (W2 - 1.8), D2 + min(5.5, hs["front"] - 2.5))
        obj("kei-truck", tx, hs["y"], tz, hs["yaw"] + 0.3, 1.0, collider={"type": "box", "halfExtents": [0.75, 0.9, 1.7]})
    px_, pz_ = local(bs * (W2 + 2.4), D2 + min(6.0, hs["front"] - 1.5))
    obj(str(rng.choice(["prop-bucket", "prop-basket", "prop-crate"])), px_, hs["y"], pz_, float(rng.random() * math.tau), 1.0)
    # stone retaining wall where the yard stands above the ground in front of it
    drop_ = hs["y"] - hs["ground_south"]
    if drop_ > 1.1:
        rx_, rz_ = local(0, D2 + hs["front"] + 0.7)
        obj("ishigaki", rx_, hs["y"], rz_, hs["yaw"], 1.0, length=round(hs["w"] + 14, 2), height=round(min(drop_, 4.0), 2))
# The temple: main hall, gate, bell tower, six Jizo, stone lanterns and the graveyard.
_ty, _tyaw = TEMPLE["y"], TEMPLE["yaw"]
def _tobj(asset, lx, lz, yaw=0.0, scale=1.0, **kw):
    x_, z_ = temple_local(lx, lz)
    return obj(asset, x_, _ty, z_, _tyaw + yaw, scale, **kw)
_tobj("tera-hondo", 0.0, -4.5, collider={"type": "box", "halfExtents": [6.6, 3.5, 5.3]}, group="tera")
_tobj("tera-sanmon", 0.0, TEMPLE["hd"] - 1.0, signs=[{"text": "瑞雲寺", "style": "wood"}])
_tobj("tera-shoro", 10.5, 5.0, collider={"type": "box", "halfExtents": [1.5, 2.2, 1.5]})
_tobj("rokujizo", 6.5, TEMPLE["hd"] - 3.2, yaw=-math.pi / 2)
for _sx in (-3.2, 3.2):
    _tobj("toro", _sx, 3.6)
for _i, _lx in enumerate((-15.0, -11.2)):
    for _j in range(5):
        _tobj("haka", _lx, -11.0 + 4.3 * _j + (0.6 if _i else 0.0), yaw=math.pi / 2, variant=(_i * 5 + _j) % 3,
              collider={"type": "box", "halfExtents": [0.5, 0.6, 1.5]})
add_tree("keyaki", *temple_local(11.8, -9.5), 1.05)
if GRAVES:
    # three rows of family graves facing the valley, a sugi or two and a hinoki behind them
    for _r in range(3):
        for _k in range(6):
            if rng.random() < 0.12:
                continue
            _x, _z = grave_local(-6.5 + _k * 2.6 + rng.normal(0, 0.15), -3.6 + _r * 3.1)
            obj("haka", _x, GRAVES["y"], _z, GRAVES["yaw"] + rng.normal(0, 0.03), rng.uniform(0.9, 1.05), variant=int(rng.integers(0, 3)),
                cemetery=True, collider={"type": "box", "halfExtents": [0.5, 0.6, 1.5]})
    for _lx in (-7.5, -1.0, 6.0):
        add_tree("sugi" if _lx != -1.0 else "hinoki", *grave_local(_lx + rng.uniform(-1, 1), -GRAVES["hd"] - 3.0), rng.uniform(0.85, 1.05))
for _lx in np.arange(-17.0, 17.1, 4.8):
    add_tree("sugi", *temple_local(float(_lx) + rng.uniform(-0.8, 0.8), -TEMPLE["hd"] - 3.5 + rng.uniform(-1, 1)), rng.uniform(0.95, 1.2))
for _lz in np.arange(-12.0, 9.0, 5.2):
    add_tree("sugi", *temple_local(-TEMPLE["hw"] - 3.2 + rng.uniform(-0.8, 0.8), float(_lz)), rng.uniform(0.9, 1.15))
# Utility poles along the road, with wires.
poles = []
zp = TUNNEL_Z + 26.0
while zp < HALF - 40:
    x = float(road_x(zp)) - DITCH_OFF - 0.9
    poles.append([round(x, 2), round(sample(x, zp), 3), round(zp, 2)])
    obj("denchu", x, sample(x, zp), zp, math.atan2(float(road_x(zp + 1) - road_x(zp - 1)), 2.0), 1.0,
        collider={"type": "cylinder", "radius": 0.16, "height": 9.0})
    zp += rng.uniform(32, 40)
# The road tunnel at the head of the valley: a concrete portal face of the 1970s with its name
# plaque over the arch (the bore runs on beyond the map; the face blocks the walker at the mouth).
_tz0 = TUNNEL_Z + 0.68                  # front of the face, just south of the last open terrain row
TUNNEL = {"x": round(float(road_x(_tz0)), 3), "y": round(road_level(_tz0), 3), "z": round(_tz0, 3), "slope": round(TUNNEL_SLOPE, 5),
          "halfWidth": 4.45, "height": 7.1, "faceHalfWidth": TUNNEL_FACE, "faceTop": TUNNEL_TOP}
obj("tunnel", TUNNEL["x"], TUNNEL["y"], TUNNEL["z"], 0.0, 1.0, slope=TUNNEL["slope"],
    signs=[{"text": "上沢隧道", "style": "stone"}],
    collider={"type": "box", "halfExtents": [TUNNEL_FACE, TUNNEL_TOP / 2 + 0.4, 0.6]})
# Road mirror / bus stop / jizo at junction.
obj("jizo", float(road_at_stair) + 5.2, sample(road_at_stair + 5.2, STAIR_Z - 5), STAIR_Z - 5.0, FACE_WEST, 1.0)
# the bus stop in the centre, on the west side by the town road junction
_bz = 128.5
obj("bus-stop", float(road_x(_bz)) - DITCH_OFF - 1.0, sample(float(road_x(_bz)) - DITCH_OFF - 1.0, _bz), _bz, math.pi / 2, 1.0)
# fire lookout tower with the village PA horns and its bell, the fire brigade shed beside it,
# and a red pillar post box at the bus stop
obj("hinomi", FIRE_TOWER[0], sample(*FIRE_TOWER), FIRE_TOWER[1], -math.pi / 2, 1.0, collider={"type": "box", "halfExtents": [1.7, 5.5, 1.7]})
obj("shobo-shed", FIRE_TOWER[0] + 0.6, sample(FIRE_TOWER[0] + 0.6, FIRE_TOWER[1] + 6.5), FIRE_TOWER[1] + 6.5, -math.pi / 2, 1.0,
    collider={"type": "box", "halfExtents": [2.4, 1.5, 1.9]})
# red pillar box in front of the post office, a telephone box by the general store
_pz = 110.0
obj("post", float(road_x(_pz)) + DITCH_OFF + 0.9, sample(float(road_x(_pz)) + DITCH_OFF + 0.9, _pz), _pz, -math.pi / 2, 1.0, collider={"type": "cylinder", "radius": 0.25, "height": 1.3})
_tz = 120.6
obj("phone-box", float(road_x(_tz)) + DITCH_OFF + 1.2, sample(float(road_x(_tz)) + DITCH_OFF + 1.2, _tz), _tz, -math.pi / 2, 1.0, collider={"type": "box", "halfExtents": [0.5, 1.2, 0.5]})
# roadside stones (koshin-to, dosojin) at the ends of each hamlet
for name, cz, half, *_ in HAMLETS:
    for zz in (cz - half - 7, cz + half + 7):
        sx = float(road_x(zz)) + DITCH_OFF + 1.1
        obj("sekihi", sx, sample(sx, zz), zz, -math.pi / 2 + rng.normal(0, 0.15), rng.uniform(0.55, 0.75))
# drinks vending machines (lit at dusk): by the bus stop and at the shrine road junction, facing the road
for vx, vz, vv in [(float(road_x(132.0)) + DITCH_OFF + 0.9, 132.0, 0), (float(road_x(133.2)) + DITCH_OFF + 0.9, 133.2, 1), (float(road_x(145.4)) + DITCH_OFF + 0.9, 145.4, 0),
                   (road_at_stair + 5.4, STAIR_Z + 6.5, 1), (float(road_x(-215)) + DITCH_OFF + 1.0, -215.0, 0)]:
    obj("jihanki", vx, sample(vx, vz), vz, -math.pi / 2, 1.0, variant=vv, collider={"type": "box", "halfExtents": [0.55, 0.95, 0.4]})

# Bridge where the farm road crosses the river: a concrete slab across the bed, deck level
# with the levee path, laid along the road (a 9 degree skew to the stream).
BRIDGE_DECK = float(bank_top(BRIDGE_Z)) + 0.12
_sb = float(bed_half(BRIDGE_Z))
BRIDGE_SPAN = round(2 * (_sb + WALL_RUN) + 1.2, 2)
obj("bridge", BRIDGE_X0, BRIDGE_DECK - 0.4, BRIDGE_Z, 0.0, 1.0, span=BRIDGE_SPAN, width=3.2,
    collider={"type": "box", "halfExtents": [BRIDGE_SPAN / 2, 0.2, 1.6]})
# Road cuts: where the road is cut more than 2 m into the hill foot, a low dry-stone wall (about
# 1.1 m) holds the toe of the cut slope at the edge of the shoulder, as road works of the time did;
# the 1:1 slope continues above it. Gaps at driveways, streams and the shrine branch.
_ret = 0
for _side in (1.0, -1.0):
    _run = []
    def _flush():
        global _ret
        if len(_run) >= 4:
            for _a in range(0, len(_run) - 1, 5):
                _seg = _run[_a:_a + 6]
                if len(_seg) < 2:
                    continue
                (_x0, _z0), (_x1, _z1) = _seg[0], _seg[-1]
                _xm, _zm = (_x0 + _x1) / 2, (_z0 + _z1) / 2
                _L = math.hypot(_x1 - _x0, _z1 - _z0)
                obj("ishigaki", _xm, road_level(_zm) + 1.1, _zm, facing_road_yaw(_xm, _zm), 1.0, length=round(_L + 0.4, 2), height=1.1)
                _ret += 1
        _run.clear()
    for _z in np.arange(ROAD_Z0 + 8.0, HALF - 40.0, 2.0):
        _dxr, _dzr, _ = road_dir(_z)
        _nx, _nz = _dzr * _side, -_dxr * _side                    # unit normal towards this side
        _xr = float(road_x(_z))
        _xf, _zf = _xr + _nx * (W_FLAT + 0.05), _z + _nz * (W_FLAT + 0.05)
        _cut = sample(_xr + _nx * 8.0, _z + _nz * 8.0) - road_level(_z)
        _clear = (at(lane_d, _xf, _zf) > 4.0 and at(stream_d, _xf, _zf) > 6.0 and at(irr_d, _xf, _zf) > 3.0 and at(bd, _xf, _zf) > 6.0
                  and at(temple_d, _xf, _zf) > 4.0 and all(math.hypot(hs_["x"] - _xf, hs_["z"] - _zf) > max(hs_["w"], hs_["d"]) / 2 + 6 for hs_ in houses))
        if _cut > 2.0 and _clear:
            _run.append((_xf, _zf))
        else:
            _flush()
    _flush()
print("retaining walls", _ret)
# Water inlets (mizuguchi): each rice field takes its water from the ditch or canal beside it
# through a small concrete box in the levee, shut with a board.
_inl = 0
def _runs_along(pts_, probe):
    """Contiguous runs of rice fields beside a line: yields the middle point of each run."""
    cur, start = None, None
    for i_, (x_, z_) in enumerate(pts_):
        px_, pz_ = probe(x_, z_)
        lab_ = int(at(label, px_, pz_)) if at(field_type, px_, pz_) == 1 else -1
        if lab_ != cur:
            if cur is not None and cur >= 0 and i_ - start >= 4:
                yield pts_[(start + i_) // 2]
            cur, start = lab_, i_
    if cur is not None and cur >= 0 and len(pts_) - start >= 4:
        yield pts_[(start + len(pts_)) // 2]
for _dt in irr_ditches:
    _zd = _dt["z"]
    _xs = [(float(x_), _zd) for x_ in np.arange(_dt["x1"] + 1.0, _dt["x0"] - 1.0, 1.0)]
    for (_x, _z) in _runs_along(_xs, lambda x_, z_: (x_, z_ - 2.4)):
        if any(a_ - 1.0 < _x < b_ + 1.0 for _k_, a_, b_ in _dt["covers"]):
            continue
        _iz = _z - (IRR_DITCH_W / 2 + 0.42)
        obj("mizuguchi", _x, sample(_x, _iz) - 0.12, _iz, math.pi, 1.0)
        _inl += 1
for _c in canals:
    _p = _c["pts"]
    _xs = [(float(q_[0]), float(q_[1])) for q_ in _p if q_[3] == 0 and abs(q_[0] - float(road_x(q_[1]))) < 9.5]
    for (_x, _z) in _runs_along(_xs, lambda x_, z_: (x_ - 3.6, z_)):
        _ix = _x - (CANAL2_W / 2 + 0.5)
        obj("mizuguchi", _ix, sample(_ix, _z) - 0.12, _z, -math.pi / 2, 1.0)
        _inl += 1
print("water inlets", _inl)
# Road bridge where the prefectural road crosses Miyazawa: a short concrete slab with low parapets
for st in streams:
    if any(c_[0] == "bridge" for c_ in st["covers"]):
        _zb = st["z"]
        _, _, _th = road_dir(_zb)
        # a skew bridge: the deck ends run along the brook, the parapets along the road
        _span = (STREAM_W + 2 * 0.16 + 1.6) / math.cos(_th)     # channel, its walls, the bearings
        # (object y = underside of the deck; the deck top is level with the road; the collider reaches
        # past the skewed ends, flush with the road)
        obj("road-bridge", float(road_x(_zb)), road_level(_zb) - 0.5, _zb, _th, 1.0, span=round(_span, 2), width=9.4, skew=round(_th, 4),
            collider={"type": "box", "halfExtents": [4.7, 0.25, _span / 2 + 4.7 * abs(math.tan(_th)) + 0.3]})
# a water-god stone (suijin-hi) under the zelkova at the west bridgehead
obj("sekihi", _bt[0] + 2.0, sample(_bt[0] + 2.0, _bt[1] + 2.2), _bt[1] + 2.2, math.pi / 2 + 0.25, 0.75)

# ---- River / road / canal geometry data ------------------------------------------
_tick('River / road / canal geometry data')
# Water surface rows along the bed centre. Each row is a cross-section along X (the
# sills are laid along X too), spanning the bed; the wetted edge is where the surface
# meets the bed. A drop is written as two "fall" rows (crest, foot of the overfall).
river_pts = []
_marks = list(MARKS)
def _row(z, y, fall=0):
    # riffle: where the low-flow channel crosses over between bars (wide, shallow, broken water)
    rif = (1 - abs(math.sin(float(_phase(z))))) * (1 - float(full_width(z)))
    river_pts.append([round(float(river_x(z)), 3), round(float(y), 3), round(float(z), 3), round(2 * float(bed_half(z)), 3), fall, round(rif, 2)])
for z in np.arange(-HALF, HALF + 0.01, 1.0):
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
for z in np.arange(-HALF, HALF + 0.01, 1.5):
    B = float(bed_half(z))
    xz = float(river_x(z))
    toe = [float(bed_surface(np.array(sg * B), np.array(z), np.array(xz + sg * B))) for sg in (-1.0, 1.0)]
    bed_pts.append([round(xz, 3), round(float(z), 3), round(B, 3), round(float(bank_top(z)), 3), round(toe[0], 3), round(toe[1], 3),
                    round(float(earth_bank(z, False)), 3), round(float(earth_bank(z, True)), 3), int(wall_facing(z, False)), int(wall_facing(z, True))])
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
    "bed": {"points": bed_pts, "format": "[xCentre, z, halfWidth, bankTopY, toeYWest, toeYEast, earthWest, earthEast, facingWest, facingEast]",
            "wallRun": WALL_RUN, "capWidth": CAP_W, "pathWidth": PATH_W,
            "walled": [CHAN_Z0, CHAN_Z1],
            "leveePath": [[round(float(levee_path_x(z_)), 2), round(float(z_), 2)] for z_ in np.arange(-(HALF - 40), HALF - 20, 3.0)],
            "note": "earth=1: natural earth bank (1:0.9 cut bank outside a bend to 1:2.3 inside it); earth=0: masonry revetment 1:0.4 from the toe to the bank top; facing: 0 old mossy dry stone, 1 concrete kenchi blocks, 2 cut granite (kenchi-ishi)"},
    "drops": drops_out,
    "intake": {"z": INTAKE_Z, "side": "east", "sillY": round(float(water_level(INTAKE_Z)) - 0.55, 3), "waterY": round(float(water_level(INTAKE_Z)), 3)},
    "canal": {"points": canal_pts, "format": "[x, waterY, z, width]", "culvert": list(CULVERT), "depth": CANAL_D, "wallTop": 0.22},
    "washSteps": [dict(z=zs, side="east", topY=round(float(bank_top(zs)), 3),
                       toeY=round(float(bed_surface(np.array(float(bed_half(zs))), np.array(zs), np.array(float(river_x(zs) + bed_half(zs))))), 3)) for zs in WASH_STEPS],
    "bridgeZ": BRIDGE_Z, "bridgeDeckY": round(BRIDGE_DECK, 3),
}
road_pts = []
for z in np.arange(ROAD_Z0 + 0.6, HALF - 20, 2.5):
    x = float(road_x(z))
    road_pts.append([round(x, 3), round(sample(x, z), 3), round(float(z), 3)])
branch_pts = []
for k in range(0, 41):
    tt = k / 40
    x = road_at_stair + (98.0 - road_at_stair) * tt
    branch_pts.append([round(x, 3), round(sample(x, STAIR_Z), 3), STAIR_Z])

# Viewpoints stand on a levee (aze) in the open: no tree within reach of the view, away from houses.
from scipy.spatial import cKDTree as _KD
_tree_xz = _KD(np.array([[t_[0], t_[2]] for rows in trees.values() for t_ in rows]))
def open_levee(mask, score):
    """Best levee cell of `mask` by `score`, with no tree within 14 m and no house within 30 m."""
    cand = np.argwhere(mask & aze)
    best = None
    for i, j in cand[::3]:
        x_, z_ = float(axis[j]), float(axis[i])
        if _tree_xz.query((x_, z_))[0] < 14 or any(math.hypot(x_ - o["x"], z_ - o["z"]) < 30 for o in houses):
            continue
        sc = score(i, j, x_, z_)
        if best is None or sc > best[0]:
            best = (sc, x_, z_)
    return best
# tanada: the top of the terraces south of Kawamuko, looking down them to the valley
# tanada: on a levee just below the lane of Kawamuko, looking down the terraces to the river and the village
_lane_x = river_x(Z) - 14.0 - KAWA_DW - 9.0 * np.sin((Z - 150.0) * 0.021)
_tv = open_levee(is_paddy & (label >= TERRACE0) & (Z > 236) & (Z < 300) & (X > _lane_x + 26) & (X < _lane_x + 60),
                 lambda i, j, x_, z_: float(_tree_xz.query((x_, z_))[0]))
tanada_view = (_tv[1], _tv[2]) if _tv else (-300.0, 260.0)
# paddies: out among the rice between the farm road and the main road, the hamlets and the hills beyond
_pv = open_levee(is_paddy & (label < TERRACE0) & (Z > 240) & (Z < 350) & (X > rx + 45) & (X < road - 45),
                 lambda i, j, x_, z_: -abs(z_ - 290.0) * 0.2 + float(_tree_xz.query((x_, z_))[0]))
paddy_view = (_pv[1], _pv[2]) if _pv else (-40.0, 200.0)
# Side streams for the renderer and the stream works: the brook as [x, bedY, z] down the valley,
# the lined channel as its two ends, the covered spans, and the water surface as runs of
# [x, waterY, z, halfWidth] (a run ends at each covered span).
stream_meta = []
for st in streams:
    hp_ = st["hill"]
    zc_ = st["z"]
    brook = [[round(float(x_), 2), round(float(b_), 3), round(float(z_), 2)] for (x_, z_), b_ in zip(hp_, st["bed"])]
    runs = [[[p_[0], round(p_[1] + 0.24, 3), p_[2], 1.15] for p_ in brook]]
    cov = sorted([(c_[1], c_[2]) for c_ in st["covers"]], reverse=True)       # east to west
    xs_ = np.arange(st["x_out"], st["x_riv"] - 0.01, -2.0)
    run = []
    for x_ in xs_:
        if any(a_ - 0.2 < x_ < b_ + 0.2 for a_, b_ in cov):
            if len(run) > 1:
                runs.append(run)
            run = []
            continue
        t_ = (st["x_out"] - x_) / (st["x_out"] - st["x_riv"])
        run.append([round(float(x_), 2), round(st["bed0"] + (st["bed1"] - st["bed0"]) * t_ + 0.2, 3), zc_, STREAM_W / 2 - 0.03])
    if len(run) > 1:
        runs.append(run)
    stream_meta.append({"name": st["name"], "z": zc_, "brook": brook, "width": STREAM_W,
                        "channel": {"x0": round(st["x_out"], 2), "x1": round(st["x_levee"], 2), "xRiver": round(st["x_riv"], 2), "bed0": st["bed0"], "bed1": st["bed1"], "tops": st["tops"]},
                        "covers": [{"kind": k_, "x0": round(a_, 2), "x1": round(b_, 2)} for k_, a_, b_ in st["covers"]],
                        "roadY": round(road_level(zc_), 3), "water": runs})
for _k, _dt in enumerate(irr_ditches):
    cov = sorted([(c_[1], c_[2]) for c_ in _dt["covers"]], reverse=True)
    runs, run = [[]], []                    # (no brook: the first run is empty)
    for x_ in np.arange(_dt["x0"] - 0.3, _dt["xr"] - 0.01, -2.0):
        if any(a_ - 0.2 < x_ < b_ + 0.2 for a_, b_ in cov):
            if len(run) > 1:
                runs.append(run)
            run = []
            continue
        tx_ = min(max((_dt["x0"] - x_) / (_dt["x0"] - _dt["xr"]), 0), 1)
        run.append([round(float(x_), 2), round(_dt["bed0"] + (_dt["bed1"] - _dt["bed0"]) * tx_ + 0.12, 3), _dt["z"], round(IRR_DITCH_W / 2 - 0.02, 3)])
    if len(run) > 1:
        runs.append(run)
    stream_meta.append({"name": f"ditch-{_k}", "kind": "ditch", "z": _dt["z"], "brook": [], "width": IRR_DITCH_W,
                        "channel": {"x0": round(_dt["x0"], 2), "x1": round(_dt["x1"], 2), "xRiver": round(_dt["xr"], 2), "bed0": _dt["bed0"], "bed1": _dt["bed1"], "tops": _dt["tops"]},
                        "covers": [{"kind": k_, "x0": round(a_, 2), "x1": round(b_, 2)} for k_, a_, b_ in _dt["covers"]],
                        "intoCanal": bool(_dt["into_canal"]), "water": runs})
canal_meta = []
for _c in canals:
    _p = _c["pts"]
    _xi, _zi, _by, _crest = _c["intake"]
    _hp = next(s_ for s_ in streams if s_["name"] == _c["stream"])["hill"]
    _j = int(np.argmin(np.hypot(_hp[:, 0] - _xi, _hp[:, 1] - _zi)))
    _a, _b = _hp[max(_j - 2, 0)], _hp[min(_j + 2, len(_hp) - 1)]
    canal_meta.append({"name": _c["name"], "from": _c["stream"], "width": CANAL2_W, "depth": CANAL2_D, "wallTop": CANAL2_TOP,
                       "points": [[round(float(q[0]), 3), round(float(q[2]), 3), round(float(q[1]), 3), CANAL2_W, int(q[3])] for q in _p],
                       "format": "[x, waterY, z, width, cover]", "covers": "0 open, 1 pipe under the prefectural road, 2 slab where a lane or farm road crosses",
                       "intake": {"x": round(_xi, 2), "z": round(_zi, 2), "bedY": round(_by, 3), "crestY": round(_crest, 3),
                                  "dir": [round(float(_b[0] - _a[0]), 3), round(float(_b[1] - _a[1]), 3)]}})

landmarks = {
    "foot": [104.0, FOOT_Y + 1.62, STAIR_Z, 90.0, -2.0],            # x,y,z, yaw(deg), pitch(deg)
    "stairs": [STAIR_X0 + 60.0, float(stair_profile(STAIR_X0 + 60)) + 1.62, STAIR_Z, 90.0, 12.0],
    "shrine": [STAIR_X1 + 9.0, TOP_Y + 1.62, STAIR_Z, 90.0, 0.0],
    "lookout": [LOOKOUT[0], TOP_Y + 1.62, LOOKOUT[2], 225.0, -9.0],
    "village": [float(road_x(36)) - 0.8, sample(road_x(36) - 0.8, 36) + 1.62, 36.0, 12.0, 1.0],
    "tanada": [tanada_view[0], sample(*tanada_view) + 1.62, tanada_view[1], 70.0, -9.0],
    "river": [BRIDGE_X0 + 2.2, BRIDGE_DECK + 1.62, BRIDGE_Z - 0.4, 352.0, -9.0],
    "weir": [float(river_x(106)) - float(bed_half(106)) - WALL_RUN - 0.6, float(bank_top(106)) + 0.25 + 1.62, 106.0, 18.0, -14.0],
    "paddies": [round(paddy_view[0], 2), sample(*paddy_view) + 1.62, round(paddy_view[1], 2), 255.0, -2.0],
}
_vx, _vz = temple_local(0.0, TEMPLE["hd"] + 7.0)
_hx_, _hz_ = temple_local(0.0, -4.5)
landmarks["temple"] = [round(_vx, 2), sample(_vx, _vz) + 1.62, round(_vz, 2), round(math.degrees(math.atan2(_hx_ - _vx, -(_hz_ - _vz))) % 360, 1), 3.0]
_cl = next(hs for hs in houses if hs["asset"] == "shinryojo")
_vx, _vz = float(road_x(CLINIC_Z + 3.0)) - 4.2, CLINIC_Z + 3.0
landmarks["clinic"] = [round(_vx, 2), sample(_vx, _vz) + 1.62, _vz, round(math.degrees(math.atan2(_cl["x"] - _vx, -(_cl["z"] - _vz))) % 360, 1), 2.0]
if streams:
    _st = streams[0]
    _vx, _vz = _st["x_in"] + 9.0, _st["z"] - 3.2
    landmarks["sawa"] = [round(_vx, 2), sample(_vx, _vz) + 1.62, round(_vz, 2), 78.0, -6.0]

meta = {
    "version": 3,
    "seed": SEED,
    "units": "meters",
    "up": "Y",
    "axes": "+X east, +Y up, +Z south (north = -Z). Right-handed (Three.js).",
    "extent": EXTENT,
    "resolution": N,
    "heightEncoding": {"file": "heightmap.r16", "format": "uint16-le", "minHeight": H_MIN, "range": H_RANGE,
                       "row0": f"z={-HALF:.0f}", "column0": f"x={-HALF:.0f}", "formula": "y = raw/65535*range + minHeight"},
    "splat": {"files": ["splat0.png", "splat1.png", "splat2.png"], "layers": order,
              "materials": {"grass": "leafy_grass", "forest": "forest_leaves_02", "dirt": "stony_dirt_path", "rock": "mossy_rock",
                            "paddy": "brown_mud_leaves_01", "riverbed": "river_small_rocks", "gravel": "gravel_floor_02", "asphalt": "asphalt_01", "furrows": "farm_furrows", "bar": "ganges_river_pebbles", "concrete": "asphalt_06"}},
    "vegetationMask": {"file": "vegetation-mask.png", "channels": ["forestDensity", "paddyIdHash", "riceEdgeDistance (0.5 = edge of the rice, +-2 m)", "grassDensity"]},
    "paddyLevel": {"file": "paddy-level.png", "encoding": "same as heightEncoding, uint16 PNG"},
    "environment": {"date": "1994-08-08", "latitude": 38.32, "longitude": 141.02, "timezone": 9, "defaultTime": 18.0,
                    "timeRange": [17.0, 19.0], "sky": "assets/sky/kloppenheim_06_puresky", "notes": "Sun position from a standard solar position algorithm (NOAA approximation)."},
    "landmarks": landmarks,
    "stair": {"axis": "+X", "z": STAIR_Z, "x0": STAIR_X0, "x1": round(STAIR_X1, 3), "footY": FOOT_Y, "topY": TOP_Y,
              "rise": RISE, "tread": TREAD, "steps": STEPS, "flight": FLIGHT, "landing": LANDING, "width": STAIR_W},
    "precinct": PRECINCT,
    "steps": steps,
    "objects": objects,
    "fields": fields,
    "river": river_meta,
    "roads": [{"id": "village-road", "class": "prefectural", "width": ROAD_HALF * 2, "surface": "asphalt", "markings": "centre dashed, edge lines", "points": road_pts},
              {"id": "shrine-branch", "class": "approach", "width": 3.6, "surface": "dirt", "points": branch_pts},
              {"id": "town-bridge", "class": "town", "width": 4.0, "surface": "asphalt",
               "points": [[round(x_, 2), round(sample(x_, BRIDGE_Z), 3), BRIDGE_Z] for x_ in np.linspace(track_x0, track_x1, 30)]},
              {"id": "town-kawamuko", "class": "town", "width": 3.5, "surface": "asphalt",
               "points": [[round(x_, 2), round(sample(x_, z_), 3), round(z_, 2)] for x_, z_, _ in trunk]},
              {"id": "town-kawamuko-north", "class": "town", "width": 3.0, "surface": "asphalt",
               "points": [[round(x_, 2), round(sample(x_, z_), 3), round(z_, 2)] for x_, z_, _ in branch_k]},
              {"id": "kyudo-shimojuku", "class": "town", "old": True, "width": 4.0, "surface": "asphalt",
               "points": [[round(x_, 2), round(sample(x_, z_), 3), round(z_, 2)] for x_, z_ in kyudo]}]
             + [{"id": f"farm-{i:02}", "class": "farm", "width": 3.0, "surface": "gravel",
                 "points": [[round(x_, 2), round(sample(x_, z_), 3), round(z_, 2)] for x_, z_ in fr]} for i, fr in enumerate(farm_roads)]
             + [{"id": f"lane-{i:02}", "class": "driveway", "width": 2.6, "surface": "gravel", "points": [[round(x_, 2), round(sample(x_, z_), 3), round(z_, 2)] for x_, z_, _ in ln]}
                for i, ln in enumerate(lanes)],
    "hamlets": [{"name": n, "z": cz, "halfLength": hl} for n, cz, hl, *_ in HAMLETS] + [{"name": "kawamuko", "z": 243.0, "halfLength": 98.0},
                                                                                      {"name": "machi", "z": sum(MACHI_Z) / 2, "halfLength": (MACHI_Z[1] - MACHI_Z[0]) / 2}],
    "powerLine": {"poles": poles, "wires": 3, "sag": 0.6},
    "tunnel": TUNNEL,
    "temple": {"x": round(TEMPLE["x"], 2), "y": TEMPLE["y"], "z": TEMPLE["z"], "yaw": round(TEMPLE["yaw"], 4), "halfWidth": TEMPLE["hw"], "halfDepth": TEMPLE["hd"]},
    "streams": stream_meta,
    "canals": canal_meta,
    "ditch": {"offset": DITCH_OFF, "width": 0.45, "depth": 0.42, "zRange": [round(ROAD_Z0 + 0.7, 2), HALF - 60], "crossings": sorted(ditch_crossings)},
    "budgets": {"high": {"triangles": 4500000, "drawCalls": 900, "pixelRatio": 1.5},
                "standard": {"triangles": 2800000, "drawCalls": 650, "pixelRatio": 1.0},
                "low": {"triangles": 1200000, "drawCalls": 400, "pixelRatio": 0.8}},
}
(OUT / "scene.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1, default=_np))
(OUT / "vegetation.json").write_text(json.dumps({
    "format": "[x, y, z, scale, yawRadians, variant, lean]", "seed": SEED + 7, "trees": trees}, separators=(",", ":"), default=_np))
(OUT / "clutter.json").write_text(json.dumps({
    "format": "[x, y, z, scale, yawRadians, variant]", "seed": SEED + 7, "items": clutter}, separators=(",", ":"), default=_np))

# ---- Hills around the map and the far ranges -----------------------------------------------
_tick('Hills around the map and the far ranges')
# Outside the playable square the same regional model goes on for 1.6 km on every side (the
# "mid" ring: real valleys and spurs for the ridgelines that close the views), then blends into
# broad ridged ranges out to 7 km for the horizon.
FN, FEXT = 257, 14000.0
def far_field(x, z):
    r_ = np.hypot(x, z)
    ang = np.arctan2(x, -z)
    f = (90 + 330 * ridged(P3, x, z, 2600, 6)) * smoothstep(500, 2600, r_)
    f = f + (120 + 380 * ridged(P4, x * 1.3, z * 1.3, 1800, 5)) * smoothstep(3000, 6500, r_) * (0.7 + 0.3 * np.cos(ang * 3 + 1))
    f = f + 40 * fbm(P5, x, z, 300, 4)
    sector = np.abs(((np.degrees(ang) % 360) - 286.0 + 180) % 360 - 180)
    gap = 1 - smoothstep(9, 20, sector)
    return np.clip(f - np.maximum(f - 0.028 * r_, 0) * gap, 0, 1600)
_edge = np.maximum(np.abs(RX), np.abs(RZ))
_wb = smoothstep(REGION_EXTENT / 2 - 620, REGION_EXTENT / 2 - 40, _edge)
mid = (floor_base(RZ) + REGION["M"]) * (1 - _wb) + far_field(RX, RZ) * _wb
MID_MIN, MID_RANGE = -40.0, 1000.0
Image.fromarray(np.rint(np.clip((mid - MID_MIN) / MID_RANGE, 0, 1) * 65535).astype(np.uint16)).save(OUT / "mid-heightmap.png")
# land cover of the ring: R = wooded hillside, G = open valley floor (fields beyond the map)
_cover = np.stack([smoothstep(0.6, 2.5, REGION["M"]), 1 - smoothstep(0.2, 1.2, REGION["M"]), np.zeros_like(mid)], -1)
Image.fromarray(np.uint8(np.rint(_cover * 255)), "RGB").save(OUT / "mid-cover.png")
fa = np.linspace(-FEXT / 2, FEXT / 2, FN)
FX, FZ = np.meshgrid(fa, fa)
_mid_s = region.sampler(ndimage.gaussian_filter(mid, 3.0), REGION_EXTENT)
_in = (np.abs(FX) <= REGION_EXTENT / 2) & (np.abs(FZ) <= REGION_EXTENT / 2)
far = np.where(_in, _mid_s(np.clip(FX, -REGION_EXTENT / 2, REGION_EXTENT / 2), np.clip(FZ, -REGION_EXTENT / 2, REGION_EXTENT / 2)), far_field(FX, FZ))
far = np.clip(far, 0, 1600)
Image.fromarray(np.rint(far / 1600 * 65535).astype(np.uint16)).save(OUT / "far-heightmap.png")
meta_far = {"file": "far-heightmap.png", "resolution": FN, "extent": FEXT, "minHeight": 0, "range": 1600,
            "mid": {"file": "mid-heightmap.png", "cover": "mid-cover.png", "resolution": REGION_N, "extent": REGION_EXTENT,
                    "minHeight": MID_MIN, "range": MID_RANGE},
            "note": "Far: ranges for the horizon. Mid: the eroded hills for 1.6 km around the map. The map itself is covered by the detailed terrain."}
(OUT / "far-terrain.json").write_text(json.dumps(meta_far, indent=1))

counts = {k: len(v) for k, v in trees.items()}
print(f"terrain {N}x{N}, houses {len(houses)}, fields {len(fields)}, trees {counts}, clutter {{k: len(v) for k,v in clutter.items()}}")
print("clutter", {k: len(v) for k, v in clutter.items()}, "objects", len(objects))
