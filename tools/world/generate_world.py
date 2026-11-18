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
# (2.1 km: the valley runs on south onto the widening floor below the village - Shimohara - and the
# hills on either side leave room for forest roads; the cell stays 1.17 m)
EXTENT = 2100.0
N = 1793
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
_PROBE = [tuple(map(float, p_.split(","))) for p_ in os.environ.get("PROBE", "").split(";") if p_]   # (debugging: "x,z;x,z")
def _tick(label):
    """Progress line with the elapsed time (the generator takes a couple of minutes)."""
    probe = ""
    if _PROBE and isinstance(globals().get("h"), np.ndarray) and globals()["h"].shape == (N, N):
        hh_ = globals()["h"]
        probe = " | " + " ".join(f"{hh_[int(round((z_ / EXTENT + 0.5) * (N - 1))), int(round((x_ / EXTENT + 0.5) * (N - 1)))]:.1f}" for x_, z_ in _PROBE)
    print(f"[{_time.time() - _t0:6.1f}s] {label}{probe}", flush=True)

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
WL_NAT = 1.45             # natural reaches: water this far below the river's own floor
WL_CHAN = 1.25            # walled reach: held higher by the drop structures
# The river has cut below the valley floor the paddies stand on: its own floodplain (the low
# terrace, kasen-dankyu) lies 4.5-6 m lower - deeper in some reaches than others - between terrace
# scarps (dankyu-gai) that follow the outer edge of its meander belt; where the belt is wide, an older
# floodplain is left part way down as a middle terrace with its own lower scarp. Everything of the
# river - bed, banks, walls, weir, levee path, the weir canal and the low fields it waters - is laid out
# on the lowest floor.
def river_drop(z):
    """How far the river's floor lies below the paddy floor (it changes slowly down the valley, never
    so fast that the water would rise downstream)."""
    z = np.asarray(z, dtype=np.float64)
    # (a step a walker reads as a terrace from the fields: about a two-storey house; a cut of 2-3 m read
    # as a grassy bank)
    return 5.3 + 0.6 * np.sin(z * 0.0019 + 0.6) + 0.2 * np.sin(z * 0.0061 + 2.0)


def river_floor(z):
    """The river's own floor (the low terrace) under the paddy floor."""
    return floor_base(z) - river_drop(z)


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
    return river_floor(z) + 0.42


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
    return river_floor(_z_eff(z)) - WL_NAT


for _r in range(len(MARKS) - 1):
    _a, _b = MARKS[_r], MARKS[_r + 1]
    if _b == WEIR_Z:
        # weir pool: level, 0.22 m below the natural water just above its head
        _reach_a.append(float(_wl_nat(_a - 1e-3)) - 0.22)
        _reach_pool.append(True)
    else:
        _m = 0.5 * (_a + _b)
        _reach_a.append(float(river_floor(_m)) - WL_CHAN + REACH_SLOPE * (_m - _a))
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


# The low terrace and its scarps. The toe of the scarp on each side follows the outer edge of the
# meander belt - the envelope of the bed, its bank and the levee path over a bend and a half - plus
# a margin that changes along the valley: narrow where an outer bend has swung against the scarp,
# wide where the river has left a broad floodplain. From the weir down the east floodplain is wide
# enough for the low fields the weir canal waters. The face of the scarp is a 1:1.33 slope of
# terrace gravel (about 37 degrees), wooded in places; the paddy floor stands 2-3 m above the toe.
SCARP_RISE = 0.75
_lt_z = np.arange(-HALF - 120.0, HALF + 120.0, 1.0)
_reach_e = river_x(_lt_z) + bed_half(_lt_z) + bank_ext(_lt_z, True) + PATH_W
_reach_w = river_x(_lt_z) - bed_half(_lt_z) - bank_ext(_lt_z, False) - 1.2
_m_e = 2.0 + 24.0 * (0.5 + 0.5 * np.sin(_lt_z * 0.0089 + 2.3)) ** 1.6
_m_w = 1.5 + 11.0 * (0.5 + 0.5 * np.sin(_lt_z * 0.0117 + 0.4)) ** 1.6
from scipy.ndimage import minimum_filter1d as _minf1_
_toe_e = _gf1(_maxf1(_reach_e, size=141), 16.0) + _m_e
_need_e = canal_x(_lt_z) + 27.0 + 11.0 * np.sin(_lt_z * 0.021 + 0.5)          # room for the low fields
_toe_e = _gf1(_toe_e + np.maximum(_need_e - _toe_e, 0) * _band(_lt_z, WEIR_Z - 6.0, 372.0, 36.0), 6.0)
_toe_w = _gf1(_minf1_(_reach_w, size=141), 16.0) - _m_w
_toe_e_slope = np.gradient(_toe_e)
_toe_w_slope = np.gradient(_toe_w)
# The middle terrace: where the belt between the levee and the scarp is wide, the floodplain proper
# keeps only its inner third; beyond it a bench about a metre higher (an older floodplain) runs to the
# main scarp, here and there along the valley. Its own scarp is lower and gentler to look at.
_base_e = _gf1(_maxf1(_reach_e, size=141), 16.0)
_base_w = _gf1(_minf1_(_reach_w, size=141), 16.0)
_wid_e, _wid_w = _toe_e - _base_e, _base_w - _toe_w
# (the inner toe never comes nearer the levee than 5 m, whatever the smoothing of the envelope did)
_toe2_e = np.maximum(_gf1(_base_e + 3.0 + 0.32 * np.maximum(_wid_e - 3.0, 0), 8.0), _reach_e + 5.0)
_toe2_w = np.minimum(_gf1(_base_w - 2.0 - 0.32 * np.maximum(_wid_w - 2.0, 0), 8.0), _reach_w - 4.0)
_mh_e = (1.8 + 0.35 * np.sin(_lt_z * 0.013)) * smoothstep(12.0, 18.0, _wid_e) * smoothstep(-0.65, -0.25, np.sin(_lt_z * 0.0071 + 1.1))
_mh_w = (1.6 + 0.3 * np.sin(_lt_z * 0.017 + 1.0)) * smoothstep(7.0, 10.0, _wid_w) * smoothstep(-0.65, -0.25, np.sin(_lt_z * 0.0083 + 2.6))
# (and the bench is left only where it has room between the two scarps)
_mh_e = _gf1(_mh_e * smoothstep(6.0, 10.0, _toe_e - _toe2_e - _mh_e / SCARP_RISE), 10.0)
_mh_w = _gf1(_mh_w * smoothstep(6.0, 10.0, _toe2_w - _toe_w - _mh_w / SCARP_RISE), 10.0)


def scarp_parts(x, z):
    """(distance beyond the toe of the main scarp, distance beyond the toe of the middle scarp, height
    of the middle terrace) on the side of the river (x, z) lies; distances <= 0 below the toe."""
    x, z = np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64)
    east = x > river_x(z)
    ne = np.sqrt(1 + np.interp(z, _lt_z, _toe_e_slope) ** 2)
    nw = np.sqrt(1 + np.interp(z, _lt_z, _toe_w_slope) ** 2)
    n1, n2 = 2.2 * fbm(P1, x, z, 48, 2), 1.6 * fbm(P4, x, z, 40, 2)
    b1 = np.where(east, (x - np.interp(z, _lt_z, _toe_e)) / ne, (np.interp(z, _lt_z, _toe_w) - x) / nw) + n1
    b2 = np.where(east, (x - np.interp(z, _lt_z, _toe2_e)) / ne, (np.interp(z, _lt_z, _toe2_w) - x) / nw) + n2
    mh = np.where(east, np.interp(z, _lt_z, _mh_e), np.interp(z, _lt_z, _mh_w))
    return b1, b2, mh


def scarp_beyond(x, z):
    """Horizontal distance (m) beyond the toe of the main terrace scarp; <= 0 below it."""
    return scarp_parts(x, z)[0]


def low_terrace_y(x, z):
    """The floodplain: highest on the natural levee beside the bank, falling 0.35 m towards the back
    of the floodplain under the scarp (where it is wettest)."""
    x, z = np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64)
    away = np.maximum(np.maximum(x - np.interp(z, _lt_z, _reach_e), np.interp(z, _lt_z, _reach_w) - x), 0)
    return bank_top(z) - 0.1 - 0.35 * smoothstep(0.0, 24.0, away) + 0.08 * fbm(P3, x, z, 22, 2)


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

def beyond_inputs(map_h):
    """What tools/world/beyond.py needs to grow the land beyond the map around it: the valley's
    design as tables along z, the regional model of the hills, the map's own heights."""
    zt = np.arange(-9000.0, 9000.5, 4.0)
    return dict(zt=zt, floor=floor_base(zt), axis=valley_axis(zt), half=valley_floor_half(zt), river=river_x(zt),
                drop=river_drop(zt), scarp=np.array(SCARP_RISE), sun=np.array([SUN_ORIGIN[0], SUN_ORIGIN[1], SUN_AZ]),
                seed=np.array(SEED), map_h=np.asarray(map_h, np.float64), map_extent=np.array(EXTENT),
                region_h=floor_base(RZ) + REGION["M"], region_extent=np.array(REGION_EXTENT))

if os.environ.get("BEYOND_INPUTS"):
    # (for working on the land beyond the map alone: the inputs with the map as last generated)
    _enc = json.loads((OUT / "scene.json").read_text())["heightEncoding"]
    _mh = np.fromfile(OUT / "heightmap.r16", dtype="<u2").reshape(N, N) / 65535 * _enc["range"] + _enc["minHeight"]
    np.savez_compressed(os.environ["BEYOND_INPUTS"], **beyond_inputs(_mh))
    print("wrote", os.environ["BEYOND_INPUTS"])
    sys.exit(0)

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
# The river's floodplain cut one terrace step into the floor (and into the hill foot or the Kawamuko
# fan where the meander belt reaches them): level ground between the scarps, then the scarp face up
# to whatever stands beyond. Fields, houses and roads are laid out on top of this.
LT_BEYOND, LT_BEYOND2, LT_MH = scarp_parts(X, Z)
LT_Y = low_terrace_y(X, Z)
_lt_mid = np.clip(LT_BEYOND2 * SCARP_RISE, 0.0, LT_MH)              # up the middle scarp onto its bench
_pre_lt = h
h = np.minimum(h, LT_Y + _lt_mid + np.maximum(LT_BEYOND, 0.0) * SCARP_RISE)
# the faces of the scarps and a strip at their toe and brink: no fields, no yards (they are left to
# grass, scrub and trees); paddies stand back from the brink so their banks do not regrade it
LT_TOP = (_pre_lt - LT_Y - _lt_mid) / SCARP_RISE             # distance of the brink beyond the toe
SCARP_ZONE = (LT_BEYOND > -2.2) & (LT_BEYOND < LT_TOP + 2.4) & (_pre_lt - LT_Y - _lt_mid > 0.6)
SCARP_ZONE |= (LT_MH > 0.3) & (LT_BEYOND2 > -1.8) & (LT_BEYOND2 < LT_MH / SCARP_RISE + 1.8) & (LT_BEYOND < -1.5) & (_pre_lt - LT_Y > LT_MH)
del _pre_lt
# (the spur itself is stamped exactly; the ridge behind it is left to the regional model)
_sp = shrine_spur(X, Z) * (1 - smoothstep(312.0, 345.0, X))
# (only on the spur: away from it this was max(h, 0), which lifted anything below sea level - the
# floodplain of the lowered river at the south end - back up to 0)
h = np.where(_sp > 0.0, np.maximum(h, _sp + 3.5 * fbm(P2, X, Z, 50, 4) * smoothstep(0.0, 25.0, _sp)), h)

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
    # Shimohara: farms on the wider floor downstream, below the village
    ("shimohara", 868.0, 55.0, 9, 0.4, ["kawara", "tin", "kawara", "thatch", "tin"]),
]
# share of a hamlet's houses in the row fronting the road (the rest stand back as farmsteads)
ROADSIDE_SHARE = {"kaminosawa": 0.45, "nakazato": 0.2, "miyashita": 0.45, "shimojuku": 0.85, "minamizawa": 0.5, "shimohara": 0.35}
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
    if at(LT_BEYOND, x, z) < 16.0:                                # the floodplain and its scarp
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

# Legacy farm-road reservations used to reproduce the established house placement.
# The actual gravel roads are laid out by valley_layout after the houses are fixed.
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
    _hp = _smooth_path(_hill, step=2.0, sigma=5.0)[::-1]   # upstream -> downstream, every 2 m
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
# Nishizawa: the largest valley on the west side opens at the north end of Kawamuko. Its brook
# runs down to the river over cobbles (no road to cross on this side); a little way up the valley
# an intake lifts water into the canal that runs along the top of the Kawamuko terraces.
west_brooks = []
_wc = [st for st in region_streams() if st[0, 0] < float(river_base_x(st[0, 1])) and abs(st[0, 1] - 50.0) < 70]
if _wc:
    _st = max(_wc, key=lambda a_: a_[1, 3])
    _hill = [(float(x_), float(z_)) for x_, z_, *_ in _st
             if x_ < float(river_x(z_) - bed_half(z_)) - 4.0 and abs(x_) < HALF - 24 and abs(z_) < HALF - 24]
    if len(_hill) >= 8:
        _hp = _smooth_path(_hill, step=2.0, sigma=5.0)[::-1]   # upstream -> downstream, every 2 m
        west_brooks.append(dict(name="nishizawa", hill=_hp, z=round(float(_hp[-1, 1]), 2)))

def stream_dist(x, z):
    """Distance from (x, z) to the nearest side stream (brook or lined channel)."""
    best = 1e9
    for st in west_brooks:
        d2 = (st["hill"][:, 0] - x) ** 2 + (st["hill"][:, 1] - z) ** 2
        best = min(best, float(np.sqrt(d2.min())))
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
from valley_roads import branch_spans
_branch_spans = branch_spans()
placed, tries = 0, 0
while placed < 6 and tries < 3000:
    tries += 1
    k = int(rng.integers(4, len(mid_pts) - 4))
    mx, mz = mid_pts[k]
    side = rng.choice([-1.0, 1.0])
    x, z = mx + side * rng.uniform(17, 22), mz + rng.uniform(-3, 3)
    if abs(z - BRIDGE_Z) < 28:
        continue
    if any(a_ - 10 < z < b_ + 10 for a_, b_ in _branch_spans):     # (and out of the way of the branch roads)
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

# Keep legacy road reservations above only to preserve the established settlement.
# Actual road geometry is chosen after those houses, before their access lanes.
from valley_roads import layout as valley_layout
farm_roads, valley_entries = valley_layout(
    lambda z: float(levee_path_x(z)), lambda z: float(road_x(z)), canal_x_,
    (WEIR_Z-8,375), ROAD_HALF, houses, mid_pts, min_x=lambda z: float(np.interp(z, _lt_z, _toe_e)) + 30.0)
ditch_crossings = [z for z in ditch_crossings if z not in FARM_CROSS] + valley_entries
# Rebuild stream crossings from the actual road intersections; the legacy
# middle-of-valley estimate would leave an open channel across the new spine.
for st in streams:
    st['covers'] = [c for c in st['covers'] if c[0] != 'farm']
    for fr in farm_roads:
        for (ax,az),(bx,bz) in zip(fr,fr[1:]):
            if abs(bz-az)<1e-8 or not min(az,bz)<=st['z']<max(az,bz): continue
            t=(st['z']-az)/(bz-az); cx=ax+(bx-ax)*t
            if st['x_levee']<cx<st['x_out']:
                half_cover=1.5*math.hypot(bx-ax,bz-az)/abs(bz-az)+.9
                st['covers'].append(('farm',cx-half_cover,cx+half_cover))

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
farm_profiles = []
def grade_line(h, pts, width, dist_arr, raise_=0.0, protect=None):
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
        if protect is not None:
            m = m * protect[i0:i1, j0:j1]
        h[i0:i1, j0:j1] = h[i0:i1, j0:j1] * (1 - m) + tgt * m
        dist_arr[i0:i1, j0:j1] = np.minimum(dist_arr[i0:i1, j0:j1], d)
    return h
def grade_limited(h, pts, raise_=0.0, grade=0.1, step=2.0):
    """A road's vertical alignment over the ground: [(x, z, y|None)] -> dense [(x, z, y)]. Free
    points follow the smoothed ground (+raise_); the grade never exceeds `grade`, so where a road
    meets the terrace scarp it takes it on a ramp, half cut into the brink, half on fill below."""
    from scipy.ndimage import gaussian_filter1d
    dense, fixed = [], []
    for (ax_, az_, ay_), (bx_, bz_, by_) in zip(pts, pts[1:]):
        n_ = max(1, int(math.ceil(math.hypot(bx_ - ax_, bz_ - az_) / step)))
        for k_ in range(n_):
            t_ = k_ / n_
            dense.append((ax_ + (bx_ - ax_) * t_, az_ + (bz_ - az_) * t_))
            fixed.append(ay_ if k_ == 0 else None)
    dense.append(tuple(pts[-1][:2]))
    fixed.append(pts[-1][2])
    P_ = np.array(dense)
    L_ = np.hypot(*np.diff(P_, axis=0).T)
    ys = gaussian_filter1d(np.array([at(h, x_, z_) for x_, z_ in dense]) + raise_, 1.5, mode="nearest")
    fx = np.array([f_ is not None for f_ in fixed])
    ys[fx] = [f_ for f_ in fixed if f_ is not None]
    fw, bw = ys.copy(), ys.copy()
    for k_ in range(1, len(ys)):
        if not fx[k_]:
            fw[k_] = np.clip(fw[k_], fw[k_ - 1] - grade * L_[k_ - 1], fw[k_ - 1] + grade * L_[k_ - 1])
    for k_ in range(len(ys) - 2, -1, -1):
        if not fx[k_]:
            bw[k_] = np.clip(bw[k_], bw[k_ + 1] - grade * L_[k_], bw[k_ + 1] + grade * L_[k_])
    ys = 0.5 * (fw + bw)
    for _ in range(12):
        for k_ in range(1, len(ys)):
            if not fx[k_]:
                ys[k_] = np.clip(ys[k_], ys[k_ - 1] - grade * L_[k_ - 1], ys[k_ - 1] + grade * L_[k_ - 1])
        for k_ in range(len(ys) - 2, -1, -1):
            if not fx[k_]:
                ys[k_] = np.clip(ys[k_], ys[k_ + 1] - grade * L_[k_], ys[k_ + 1] + grade * L_[k_])
    return [(float(x_), float(z_), float(y_)) for (x_, z_), y_ in zip(dense, ys)]
def grade_bench(h, prof, width, dist_arr, cut=1.0, fill=1.5):
    """Grade a road bench along a profile with proper side slopes (1:1 cut, 1:1.5 fill) rather than a
    fixed-width blend, which left a sheer step where the road is cut into the terrace scarp. Each cell
    takes the nearest stretch of road (graded one stretch after another, every stretch also pulled the
    cells behind it towards its own level, and a sloping road sank and rippled)."""
    P_ = np.array(prof)
    r_ = width / 2 + 7.0
    j0 = max(int((P_[:, 0].min() - r_) / CELL + (N - 1) / 2), 0); j1 = min(int((P_[:, 0].max() + r_) / CELL + (N - 1) / 2) + 2, N)
    i0 = max(int((P_[:, 1].min() - r_) / CELL + (N - 1) / 2), 0); i1 = min(int((P_[:, 1].max() + r_) / CELL + (N - 1) / 2) + 2, N)
    bd = np.full((i1 - i0, j1 - j0), np.inf)
    bt = np.zeros_like(bd)
    for (ax_, az_, ay), (bx_, bz_, by) in zip(prof, prof[1:]):
        a0 = max(int((min(ax_, bx_) - r_) / CELL + (N - 1) / 2), j0); a1 = min(int((max(ax_, bx_) + r_) / CELL + (N - 1) / 2) + 2, j1)
        c0 = max(int((min(az_, bz_) - r_) / CELL + (N - 1) / 2), i0); c1 = min(int((max(az_, bz_) + r_) / CELL + (N - 1) / 2) + 2, i1)
        if a1 <= a0 or c1 <= c0:
            continue
        d, tt = segment_dist(X[c0:c1, a0:a1], Z[c0:c1, a0:a1], ax_, az_, bx_, bz_)
        win = np.s_[c0 - i0:c1 - i0, a0 - j0:a1 - j0]
        closer = d < bd[win]
        bd[win] = np.where(closer, d, bd[win])
        bt[win] = np.where(closer, ay + (by - ay) * tt, bt[win])
    sl = np.s_[i0:i1, j0:j1]
    near = bd < r_
    # the shoulder blends over 1.8 m (a sub-cell slope left a staircase along a diagonal road),
    # the side slopes start from the middle of it
    m_ = 1 - smoothstep(width / 2 + 0.1, width / 2 + 1.9, bd)
    o_ = np.maximum(bd - width / 2 - 1.0, 0.0)
    hh = h[sl]
    h[sl] = np.where(near, bt * m_ + np.clip(hh, bt - o_ / fill, bt + o_ * cut) * (1 - m_), hh)
    dist_arr[sl] = np.minimum(dist_arr[sl], bd)
    return h
for k_, fr in enumerate(farm_roads):
    # a branch meets the village road at its level and the through lane at the lane's own level, so
    # a ramp down to the floodplain never pulls the junction down with it
    _pts = [(x_, z_, None) for x_, z_ in fr]
    for e_ in (0, len(_pts) - 1):
        x_, z_, _ = _pts[e_]
        if abs(x_ - float(road_x(z_))) < ROAD_HALF + 1.0:
            _pts[e_] = (x_, z_, road_level(z_))
        elif abs(x_ - float(levee_path_x(z_))) < PATH_W:
            # (it ends on the levee path, at the path's own level: the river's bank, cut later, would
            # otherwise leave the end of the ramp standing over the path)
            _pts[e_] = (x_, z_, float(bank_top(z_)))
        elif farm_profiles:
            _sp = farm_profiles[0]
            _j = int(np.argmin([math.hypot(q_[0] - x_, q_[1] - z_) for q_ in _sp]))
            if math.hypot(_sp[_j][0] - x_, _sp[_j][1] - z_) < 1.5:
                # a short level landing at the lane before the branch drops away to the floodplain
                _dir = 1 if e_ == 0 else -1
                _k, _run = e_, 0.0
                while 0 <= _k < len(_pts) and _run <= 4.5:
                    _pts[_k] = (_pts[_k][0], _pts[_k][1], _sp[_j][2])
                    _k2 = _k + _dir
                    if 0 <= _k2 < len(_pts):
                        _run += math.hypot(_pts[_k2][0] - _pts[_k][0], _pts[_k2][1] - _pts[_k][1])
                    _k = _k2
    _prof = grade_limited(h, _pts, raise_=0.25)
    farm_profiles.append(_prof)
    h = grade_bench(h, _prof, 3.0, farm_d)
# the through lane once more over its junctions: each branch was graded after it and its side slopes
# could nick the lane where they meet (the branches end at the lane's own level, so they still meet)
h = grade_bench(h, farm_profiles[0], 3.0, farm_d)
trunk = grade_limited(h, trunk, raise_=0.0, grade=0.09)
h = grade_bench(h, trunk, 3.5, town_d)
branch_k = grade_limited(h, branch_k, raise_=0.0, grade=0.09)
h = grade_bench(h, branch_k, 3.0, town_d)
_ky = [(x_, z_, (road_level(z_) if k_ in (0, len(kyudo) - 1) else None)) for k_, (x_, z_) in enumerate(kyudo)]
h = grade_line(h, _ky, 4.0, town_d, raise_=0.15)
ditch_crossings += [KYUDO_Z[0], KYUDO_Z[1]]
# (a driveway meets a road at the road's level and leaves its carriageway alone: blended over it, the
# end of a driveway flattened a short stretch of a sloping road into a step)
_roads_bed = smoothstep(1.6, 2.6, np.minimum(town_d, farm_d))
for ln in lanes:
    h = grade_line(h, ln, 2.6, lane_d, protect=_roads_bed)
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
for st in west_brooks:
    hp_ = st["hill"]
    for k_ in range(len(hp_) - 1):
        _line_dist(brook_d, hp_[k_, 0], hp_[k_, 1], hp_[k_ + 1, 0], hp_[k_ + 1, 1])
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
    # the canal leaves the brook at its intake and keeps to the bank beside it (a straight line to the
    # road ran down the brook's own bed, and the canal's bank then buried the stream)
    _sgn = 1.0 if _zx > _zi else -1.0
    _l0 = 0.0
    for _q in range(1, len(_pts)):
        _l0 += math.hypot(_pts[_q][0] - _pts[_q - 1][0], _pts[_q][1] - _pts[_q - 1][1])
        _dd = np.hypot(_hp[:, 0] - _pts[_q][0], _hp[:, 1] - _pts[_q][1])
        _j = int(np.argmin(_dd))
        _want = min(4.2, 1.0 + 0.4 * _l0)
        if _dd[_j] < _want and 0 < _j < len(_hp) - 1:
            _tx, _tz = _hp[_j + 1, 0] - _hp[_j - 1, 0], _hp[_j + 1, 1] - _hp[_j - 1, 1]
            _tl = math.hypot(_tx, _tz) or 1.0
            _nx, _nz = -_tz / _tl, _tx / _tl
            if _nz * _sgn < 0:
                _nx, _nz = -_nx, -_nz
            _pts[_q][0], _pts[_q][1] = float(_hp[_j, 0] + _nx * _want), float(_hp[_j, 1] + _nz * _want)
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
    _c = next(c_ for c_ in canals if not c_.get("contour") and c_["pts"][0, 1] - 40 < _zd < c_["pts"][-1, 1] + 5)
    _x0 = _xw(_zd) - CANAL2_W / 2 - 0.16                         # leaves the canal's west wall
    _into_canal = WEIR_Z - 8 < _zc < 375
    _x1 = (canal_x_(_zd) + 0.9) if _into_canal else float(levee_path_x(_zd)) + PATH_W / 2 + 0.6
    _xr = (_x1 - 0.2) if _into_canal else float(river_x(_zd) + bed_half(_zd)) + 0.15
    irr_ditches.append(dict(z=round(_zd, 2), x0=_x0, x1=_x1, xr=_xr, into_canal=_into_canal,
                            water0=float(np.interp(_zd, _c["pts"][:, 1], _c["pts"][:, 2])) - 0.08))
    _line_dist(irr_d, _x0, _zd, _xr, _zd, reach=8.0)

# Rural access is laid out BEFORE fields, so the parcels end at the shoulders.
# Roads avoid the brook corridors; loops return to a different existing junction.
from rural import route as rural_route, connected_fields
_tick('Rural access roads')
_rural_block = (stream_d < 9.0) | (irr_d < 3.0) | (temple_d < 12) | (shrine_spur(X, Z) > 2.0)
_rural_block |= (rd < RIVER_KEEP + 3) | (np.abs(X) > HALF - 35) | (np.abs(Z) > HALF - 45)
for _hs in houses:
    _rural_block |= np.hypot(X - _hs['x'], Z - _hs['z']) < 23
_rural_open = ((road_d < 4.0) & (Z > ROAD_Z0)) | (town_d < 2.0)
_rural_block &= ~_rural_open
rural_roads = []
def rural_leg(name, cls, a, b, avoid=None, east_of=None, max_grade=.22):
    global h
    blocked_route = _rural_block.copy()
    if east_of is not None:
        blocked_route |= X < east_of
    if avoid:
        corridor = np.full_like(h, 1e9)
        for road_ in rural_roads:
            if road_['id'] in avoid:
                for p, q in zip(road_['pts'], road_['pts'][1:]):
                    _line_dist(corridor, *p, *q, reach=16)
        blocked_route |= (corridor < 13) & (np.hypot(X-a[0], Z-a[1]) > 18) & (np.hypot(X-b[0], Z-b[1]) > 18)
    pts = rural_route(h, blocked_route, a, b, CELL, HALF, open_=_rural_open, max_grade=max_grade)
    # (the lattice can overshoot a junction and come back to it: a node beside the tip where the
    # path doubles back by more than 120 degrees is dropped, so the road runs straight in; a
    # switchback further out is kept)
    pts = [tuple(p_) for p_ in pts]
    for _end in (0, 1):
        seq = pts if _end else pts[::-1]
        for _ in range(3):
            if len(seq) < 3:
                break
            t_, m_, o_ = (np.array(v_) for v_ in seq[-1:-4:-1])
            u_, w_ = t_ - m_, m_ - o_
            if np.hypot(*u_) < 7.0 and np.dot(u_, w_) < -0.5 * np.hypot(*u_) * np.hypot(*w_):
                seq = seq[:-2] + [seq[-1]]
            else:
                break
        pts = seq if _end else seq[::-1]
    # Sample tie-ins at <=2 m: a long routing edge can cross the whole road
    # shoulder between vertices, otherwise its sloping profile gets cut off by
    # the existing flat carriageway and leaves a step at the edge.
    dense = []
    for p, q in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.dist(p, q)/2.0))
        dense.extend(tuple(v) for v in np.linspace(p, q, n, endpoint=False))
    pts = dense + [pts[-1]]
    from scipy.ndimage import gaussian_filter1d
    lengths = np.hypot(*np.diff(np.array(pts), axis=0).T)
    chainage = np.r_[0., np.cumsum(lengths)]
    ground = np.array([at(h, x, z) for x, z in pts])
    ground_raw = ground.copy()
    uniform = np.arange(0., chainage[-1]+2., 2.)
    ys = np.interp(chainage, uniform, gaussian_filter1d(np.interp(uniform, chainage, ground), 3., mode='nearest'))
    on_main = np.array([at(road_d, x, z) < W_FLAT+.2 for x, z in pts])
    ground[on_main] = np.array([road_level(z) for x, z in pts])[on_main]
    _td = np.array([at(town_d, x, z) for x, z in pts])
    fixed = on_main | (_td < .8)
    # (a point on a paved road's shoulder can stand on its cut or fill: where two pinned points are too
    # far apart in height to ramp between, the one further from the carriageway is left to the grade
    # envelope, until every pinned pair can be joined)
    for _pass in range(len(pts)):
        changed = False
        for k in range(1, len(pts)):
            if fixed[k] and fixed[k - 1] and abs(ground[k] - ground[k - 1]) > .16 * lengths[k - 1]:
                j = k if _td[k] > _td[k - 1] else k - 1
                if on_main[j] or j in (0, len(pts) - 1):
                    j = k - 1 if j == k else k
                if not on_main[j] and j not in (0, len(pts) - 1):
                    fixed[j] = False
                    changed = True
        if not changed:
            break
    # Shared rural junctions get a short level turnout. Separate vertical
    # alignments must agree where their shoulders overlap at the fork.
    for end, distances in [(0, chainage), (-1, chainage[-1]-chainage)]:
        px, pz = pts[end]
        if at(road_d, px, pz) > W_FLAT+4 and at(town_d, px, pz) > 4:
            level = ground[end]
            for prior in rural_roads:
                for qx, qz, qy in [prior['profile'][0], prior['profile'][-1]]:
                    if math.hypot(px-qx, pz-qz) < .01:
                        level = qy
            turnout = distances <= 20
            fixed |= turnout
            ground[turnout] = level
    fixed[0] = fixed[-1] = True
    ys[fixed] = ground[fixed]
    # Existing paved roads are fixed tie-ins too: smoothing must not lift a new
    # lane where it briefly shares the main road or crosses Shimojuku's old road.
    # A short vertex spacing at a rounded hairpin must not concentrate the climb.
    # Project the vertical alignment onto a 16% grade envelope with fixed tie-ins.
    def _envelope():
        for _ in range(30):
            ys[fixed] = ground[fixed]
            for k in range(1, len(ys)):
                if not fixed[k]:
                    ys[k] = np.clip(ys[k], ys[k-1]-.16*lengths[k-1], ys[k-1]+.16*lengths[k-1])
            ys[fixed] = ground[fixed]
            for k in range(len(ys)-2, -1, -1):
                if not fixed[k]:
                    ys[k] = np.clip(ys[k], ys[k+1]-.16*lengths[k], ys[k+1]+.16*lengths[k])
    _envelope()
    # (a level pad pinned at a junction may meet ground rising faster than the envelope can climb:
    # where the profile still steps, the pinned point beside the step is released, back to the end)
    for _round in range(60):
        bad = [k for k in range(1, len(ys)) if abs(ys[k] - ys[k-1]) > .17 * lengths[k-1]]
        if not bad:
            break
        k = bad[0]
        cand = [j for j in (k - 1, k) if fixed[j] and not on_main[j] and j not in (0, len(ys) - 1)]
        if not cand:
            break
        for j in cand:
            fixed[j] = False
        _envelope()
    # (a forest road the profile cannot keep near the ground - a fill or cut over 10 m - is not built)
    if max_grade < .2 and np.abs(ys - ground_raw).max() > 10.0:
        raise ValueError(f'{name}: the road would stand {np.abs(ys - ground_raw).max():.1f} m off the ground')
    profile = [(x, z, float(y)) for (x, z), y in zip(pts, ys)]
    rural_roads.append(dict(id=name, kind=cls, pts=pts, profile=profile))
    # A terrain-aware route can share the main road briefly before branching.
    # Cover the gutter where it actually crosses, not just at the nominal start.
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        for side in (-1, 1):
            da = ax-float(road_x(az))-side*DITCH_OFF
            db = bx-float(road_x(bz))-side*DITCH_OFF
            if da*db <= 0 and abs(da-db) > 1e-6:
                ditch_crossings.append(round(az+(bz-az)*da/(da-db), 2))
    h = grade_line(h, profile, 3.6, farm_d)
    if cls == 'forest':
        # One modest passing place per forest leg, on its middle bench.
        mid = len(profile)//2
        bay = profile[max(0,mid-4):mid+5]
        h = grade_line(h, bay, 5.8, farm_d)
        for (ax,az,ay),(bx,bz,by) in zip(bay,bay[1:]):
            temp = np.full_like(h,1e9)
            sl_,dd,_ = _line_dist(temp,ax,az,bx,bz,reach=6)
            i0,i1,j0,j1=sl_
            farm_d[i0:i1,j0:j1]=np.minimum(farm_d[i0:i1,j0:j1],dd-1.1)
        rural_roads[-1]['passingPlace'] = list(bay[len(bay)//2])
    return pts
# East: farm tracks climb beside the cultivated valley floors, joined by one forest road.
_e0 = (float(road_x(310)), 310.)
_e1, _e2 = (410., 250.), (300., 560.)
_e3 = (float(road_x(550)), 550.)
rural_leg('miyazawa-farm', 'farm', _e0, _e1)
rural_leg('east-forest', 'forest', _e1, _e2, avoid=['miyazawa-farm'], east_of=220)
rural_leg('minamizawa-farm', 'farm', _e2, _e3)
# North: a smaller forest circuit above the Okusawa fields, on the same bank of the brook.
_n0, _n1 = (float(road_x(-350)), -350.), (320., -400.)
_n2 = (float(road_x(-270)), -270.)
rural_leg('okusawa-farm', 'farm', _n0, _n1)
rural_leg('north-forest', 'forest', _n1, _n2, avoid=['okusawa-farm'])
# Kawamuko: the lower field edge connects both ends of the hamlet lane.
_w0, _w3 = tuple(branch_k[-1][:2]), tuple(branch_k[0][:2])
_w1, _w2 = (-275., 100.), (-260., 300.)
rural_leg('kawamuko-north-farm', 'farm', _w0, _w1)
rural_leg('kawamuko-contour-farm', 'farm', _w1, _w2)
rural_leg('kawamuko-south-farm', 'farm', _w2, _w3)
# Replace endpoint cusps by one continuous cubic turn shared by both legs.
# Trim back far enough for the separated road corridors to admit a truck turn.
for ia,ib in [(0,1),(1,2),(3,4),(5,6),(6,7)]:
    ra,rb=rural_roads[ia],rural_roads[ib]
    pa,pb=np.array(ra['profile']),np.array(rb['profile']) # x,z,y
    da=np.r_[0,np.cumsum(np.linalg.norm(np.diff(pa[:,:2],axis=0),axis=1))]
    db=np.r_[0,np.cumsum(np.linalg.norm(np.diff(pb[:,:2],axis=0),axis=1))]
    ka=max(1,int(np.searchsorted(da,da[-1]-32)))
    kb=min(len(pb)-2,int(np.searchsorted(db,32)))
    a,b=pa[ka],pb[kb]
    ua=a-pa[ka-1]; ub=pb[kb+1]-b
    ua=ua/np.linalg.norm(ua[:2]);ub=ub/np.linalg.norm(ub[:2])
    reach=max(7.,np.linalg.norm(b[:2]-a[:2])*.67)
    c,d=a+ua*reach,b-ub*reach
    curve=np.array([(1-t)**3*a+3*(1-t)**2*t*c+3*(1-t)*t*t*d+t**3*b for t in np.linspace(0,1,33)])
    # Never bend a road into the brook, a house or the precinct.
    if any(at(_rural_block.astype(float),x,z)>.1 for x,z,y in curve):
        raise ValueError('Unsafe shared rural turn '+ra['id'])
    for rr,pp in [(ra,np.vstack([pa[:ka],curve[:17]])),(rb,np.vstack([curve[16:],pb[kb+1:]]))]:
        rr['profile']=[tuple(v) for v in pp]
        rr['pts']=[tuple(v[:2]) for v in pp]
        h=grade_line(h,rr['profile'],4.2,farm_d)
# Reconcile the vertical alignment across the shared turns. Independent
# 20 m level end pads cease to be adequate once a turn trims 32 m from each leg.
for group in [(0,1,2),(3,4),(5,6,7)]:
    lengths0=[len(rural_roads[i]['profile']) for i in group]
    pp=np.array([p for i in group for p in rural_roads[i]['profile']])
    ds=np.linalg.norm(np.diff(pp[:,:2],axis=0),axis=1)
    yy=pp[:,2].copy()
    fixed=np.array([at(road_d,x,z)<W_FLAT+.2 or at(town_d,x,z)<.8 for x,z,y in pp])
    fixed[0]=fixed[-1]=True
    anchors=yy.copy()
    for _ in range(40):
        yy[fixed]=anchors[fixed]
        for k in range(1,len(yy)):
            if not fixed[k]: yy[k]=np.clip(yy[k],yy[k-1]-.16*ds[k-1],yy[k-1]+.16*ds[k-1])
        yy[fixed]=anchors[fixed]
        for k in range(len(yy)-2,-1,-1):
            if not fixed[k]: yy[k]=np.clip(yy[k],yy[k+1]-.16*ds[k],yy[k+1]+.16*ds[k])
    pp[:,2]=yy
    offset=0
    for i,count in zip(group,lengths0):
        rr=rural_roads[i]
        rr['profile']=[tuple(v) for v in pp[offset:offset+count]]
        h=grade_line(h,rr['profile'],4.2,farm_d)
        offset+=count
# Forest roads (rindo) over the hills on both sides, from the ends of the farm and forest roads: a
# ridge road from the Okusawa side round to Miyazawa, one up the northern hills, one from Minamizawa
# over the south-eastern hills down to the road at Shimohara, and a loop through the western hills
# behind Kawamuko with spurs north and south to log landings. Each leg is routed like the others (a
# grade-limited path that keeps out of the brooks and yards); one that finds no way is left out.
_rindo = []
def forest_leg(name, a, b, avoid=()):
    try:
        # (routed no steeper than 13% between lattice points, under the 16% the profile allows: a
        # route that climbed faster left its profile hanging over the valley it ran along, built up
        # on a fill tens of metres high)
        rural_leg(name, 'forest', a, b, avoid=list(avoid), max_grade=.13)
        _rindo.append(name)
    except ValueError as e_:
        print("forest road left out:", name, e_)
_ne, _nw = tuple(rural_roads[3]['profile'][-1][:2]), tuple(rural_roads[6]['profile'][0][:2])
_e1p, _e2p = tuple(rural_roads[0]['profile'][-1][:2]), tuple(rural_roads[1]['profile'][-1][:2])
_kw2 = tuple(rural_roads[7]['profile'][0][:2])
_r990, _r505 = (float(road_x(990.0)), 990.0), (float(road_x(-505.0)), -505.0)
forest_leg('higashi-ridge-forest', _ne, (750.0, -50.0), avoid=['north-forest', 'okusawa-farm'])
forest_leg('kitayama-forest', _r505, (300.0, -600.0), avoid=['higashi-ridge-forest'])
forest_leg('kitayama-forest-2', (300.0, -600.0), (400.0, -750.0), avoid=['kitayama-forest', 'higashi-ridge-forest'])
forest_leg('minami-forest', _r990, (450.0, 1000.0))
forest_leg('minami-forest-2', (450.0, 1000.0), (650.0, 950.0), avoid=['minami-forest'])
forest_leg('nishi-forest', _nw, (-600.0, 0.0), avoid=['kawamuko-contour-farm', 'kawamuko-north-farm'])
forest_leg('nishi-forest-2', (-600.0, 0.0), (-700.0, 330.0), avoid=['nishi-forest'])
forest_leg('nishi-forest-3', (-700.0, 330.0), _kw2, avoid=['nishi-forest-2', 'kawamuko-south-farm', 'kawamuko-contour-farm'])
forest_leg('nishi-oku-forest', (-600.0, 0.0), (-850.0, -60.0), avoid=['nishi-forest', 'nishi-forest-2'])
forest_leg('nishi-minami-forest', (-700.0, 330.0), (-650.0, 750.0), avoid=['nishi-forest-2', 'nishi-forest-3'])
print("forest roads", len(_rindo), round(sum(np.hypot(*np.diff(np.array(r_['pts']), axis=0).T).sum() for r_ in rural_roads if r_['id'] in _rindo)), "m")
# Keep the prefectural road and its gutters level at the new junctions.
for _p in (_e0, _e3, _n0, _n2, _r990, _r505):
    ditch_crossings.append(round(_p[1], 2))
h = np.where((Z >= ROAD_Z0 - .6) & (Z < HALF - 32) & (road_d < W_FLAT), road_y, h)

# ---- Paddies ------------------------------------------------------------------
_tick('Paddies')
mountain_factor = _M
slope_ok = mountain_factor < 1.6
house_clear = np.ones_like(h, bool)
for hs in houses:
    house_clear &= np.hypot(X - hs["x"], Z - hs["z"]) > (25 if hs["group"] == "sankyo" else 21)
house_clear &= (lane_d > 3.0) & (farm_d > 3.4) & (town_d > 3.6) & (np.hypot(X - FIRE_TOWER[0], Z - FIRE_TOWER[1]) > 12)
house_clear &= (stream_d > 3.6) & (temple_d > 6.0) & (brook_d > 4.6)     # (the brooks run in rocky gullies about 2.2 m out from their line)
paddy_region = (
    slope_ok & house_clear
    & (rd > RIVER_KEEP)
    & (irr_d > 1.9)
    & ~((np.abs(Z - BRIDGE_Z) < 3.4) & (X > rx) & (X < road + 3))   # farm road to the bridge
    & (road_d > 7.5)
    & (np.abs(X) < HALF - 25) & (Z > -(HALF - 60)) & (Z < HALF - 25)
    & ~((X > road_at_stair - 6) & (X < STAIR_X0 + 4) & (np.abs(Z - STAIR_Z) < 13))
    & (shrine_spur(X, Z) < 3)
    & ~SCARP_ZONE
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
# Every field line is kept as a family: per cell the distance (m) to the line on either side and the
# unit direction across it, so the levees and terrace risers can be shaped from the true lines rather
# than the 1.17 m grid (whose staircase showed along every diagonal bank).
def _unit(field):
    gz_, gx_ = np.gradient(field, CELL)
    l_ = np.maximum(np.hypot(gx_, gz_), 1e-6)
    return (gx_ / l_).astype(np.float32), (gz_ / l_).astype(np.float32), l_
_FAM = {}
_ux, _uz, _l = _unit(s_al)
_FAM["band"] = dict(cat=0, lo=((s_al - band_edges[band - 1]) / np.maximum(_l, 0.5)).astype(np.float32),
                    hi=((band_edges[band] - s_al) / np.maximum(_l, 0.5)).astype(np.float32), ux=_ux, uz=_uz)
_cut_lo = np.full(h.shape, np.inf, np.float32); _cut_hi = np.full(h.shape, np.inf, np.float32)
_cut_ux = np.zeros(h.shape, np.float32); _cut_uz = np.zeros(h.shape, np.float32)
_gta_z, _gta_x = np.gradient(t_ac, CELL)
_gsa_z, _gsa_x = np.gradient(s_al, CELL)
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
    _gx_, _gz_ = _gta_x[sel] + slant * _gsa_x[sel], _gta_z[sel] + slant * _gsa_z[sel]
    _gl_ = np.maximum(np.hypot(_gx_, _gz_), 0.5)
    _cut_lo[sel], _cut_hi[sel] = (tt - cuts[k - 1]) / _gl_, (cuts[k] - tt) / _gl_
    _cut_ux[sel], _cut_uz[sel] = _gx_ / _gl_, _gz_ / _gl_
_FAM["cut"] = dict(cat=0, lo=_cut_lo, hi=_cut_hi, ux=_cut_ux, uz=_cut_uz)
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
_ux, _uz, _l = _unit(_zf)
_zfd = (np.abs(_zf) / np.maximum(_l, 0.5)).astype(np.float32)
_FAM["zone"] = dict(cat=(0, 1), lo=np.where(_zf > 0, _zfd, np.inf).astype(np.float32), hi=np.where(_zf <= 0, _zfd, np.inf).astype(np.float32), ux=_ux, uz=_uz)
_sdp = np.array(_sd)
_vd = np.full(h.shape, np.inf, np.float32); _vux = np.zeros(h.shape, np.float32); _vuz = np.zeros(h.shape, np.float32)
_vv = _sdp[_ii[:, 1]] - _sdp[_ii[:, 0]]
_vl = np.maximum(np.hypot(_vv[:, 0], _vv[:, 1]), 1e-6)
_vd[_irr] = (_dd[:, 1] - _dd[:, 0]) / 2.0
_vux[_irr], _vuz[_irr] = _vv[:, 0] / _vl, _vv[:, 1] / _vl
_FAM["plot"] = dict(cat=1, lo=np.full(h.shape, np.inf, np.float32), hi=_vd, ux=_vux, uz=_vuz)
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
TER = (gentle & ~SCARP_ZONE & (rise > 0.3) & (rise < 34 + 5 * ter_edge) & house_clear & (label < 0) & (rd > RIVER_KEEP + 2) & (road_d > 9.5)
       & (np.abs(X) < HALF - 25) & (np.abs(Z) < HALF - 25) & (shrine_spur(X, Z) < 3)
       & ~((X > road_at_stair - 6) & (X < STAIR_X0 + 4) & (np.abs(Z - STAIR_Z) < 13)))
# Absolute elevations make horizontal water surfaces; smooth only sub-field relief.
# Relative height above a falling valley made benches wander across true contours.
rise_n = ndimage.gaussian_filter(h, 2.0)
# Keep cultivated land near access, rather than clearing every gentle pocket in the woods.
_access = ndimage.distance_transform_edt((farm_d > 3.5) & (town_d > 3.6) & (road_d > 6)) * CELL
TER &= (_access < 85) & (irr_d > 2.5)
TER = ndimage.binary_opening(TER, iterations=2)
_gr = np.hypot(*np.gradient(rise_n, CELL))
# bench heights vary (0.9-1.8 m), as terraces cut by hand to the lie of the ground do
_te = [-2.0]
while _te[-1] < 100:
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
# Use one transverse family per hillside instead of switching at every local
# slope-direction change (which created artificial seams and triangular shards).
# The main valley and Kawamuko face east/west; subsidiary valleys follow the same
# broadly east/west fall, so staggered cross-bunds run across z along each bench.
tcut = _kz
d_cut = np.minimum(_zc - _cz[_kz - 1], _cz[_kz] - _zc)
label = np.where(TER, TERRACE0 + tband * 1000 + tcut, label)
d_fld = np.where(TER, np.minimum(d_ter, d_cut), d_fld)
_ux, _uz, _l = _unit(rise_n)
_FAM["contour"] = dict(cat=2, lo=((rise_n - _te[tband - 1]) / np.maximum(_l, 0.03)).astype(np.float32),
                       hi=((_te[tband] - rise_n) / np.maximum(_l, 0.03)).astype(np.float32), ux=_ux, uz=_uz)
_ux, _uz, _l = _unit(_zc)
_FAM["bench-cut"] = dict(cat=2, lo=((_zc - _cz[_kz - 1]) / np.maximum(_l, 0.3)).astype(np.float32),
                         hi=((_cz[_kz] - _zc) / np.maximum(_l, 0.3)).astype(np.float32), ux=_ux, uz=_uz)

label = connected_fields(label, TERRACE0)

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
label = connected_fields(label, TERRACE0)
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
# Use the final parcel boundaries, including clipped outer edges and split plots.
from paddy_bunds import shape as shape_bunds, BUND_HEIGHT, RICE_EDGE
np.savez_compressed(ROOT / '.cache' / 'bund-input.npz',label=label,level=paddy_level,distance=d_fld)
_cat = np.where(label >= TERRACE0, 2, np.where(label >= 300000, 1, 0))
_fams = []
for _f in _FAM.values():
    _cats = _f["cat"] if isinstance(_f["cat"], tuple) else (_f["cat"],)
    _fams.append(dict(mask=np.isin(_cat, _cats) & (label >= 0), lo=_f["lo"], hi=_f["hi"], ux=_f["ux"], uz=_f["uz"]))
d_fld, h_field, bund_boundary = shape_bunds(label, paddy_level, d_fld, CELL, _fams)
del _FAM, _fams
h = np.where(is_paddy, h_field, h)
interior = is_paddy & (d_fld >= RICE_EDGE)
is_paddy_f = is_paddy.astype(float)
aze = is_paddy & (d_fld < 0.75)
# Banks: terrain next to fields is cut/filled to a <= 35 degree slope from the levee top.
dist_px, (iy, ix) = ndimage.distance_transform_edt(~is_paddy, return_indices=True)
# (smoothed: the grid distance put a staircase along the toe and the brink of every diagonal bank)
dist_m = np.maximum(ndimage.gaussian_filter(dist_px * CELL, 1.5) - 0.3, 0.0)
near_lvl = paddy_level[iy, ix] + BUND_HEIGHT
bank_zone = (~is_paddy) & (dist_m < 14) & ~np.isnan(near_lvl) & (farm_d > 3.0) & (town_d > 3.6) & (lane_d > 3.0)
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
# From the bridge it crosses the floodplain a little above it, climbs the terrace scarp on a ramp
# (at most 1 in 12, cut into the brink and built out below it) and runs on to the village road.
track_prof = grade_limited(h, [(track_x0, BRIDGE_Z, float(bank_top(BRIDGE_Z))), (track_x1, BRIDGE_Z, float(floor_base(BRIDGE_Z)) + 1.05)],
                           raise_=0.3, grade=0.08, step=1.0)
track_y = np.interp(X, [p_[0] for p_ in track_prof], [p_[2] for p_ in track_prof])
track_zd = np.abs(Z - BRIDGE_Z)
in_track = (X > track_x0 - 2.0) & (X < track_x1 + 1.0)
_o = np.maximum(track_zd - 2.2, 0.0)
h = np.where(in_track & (track_zd < 9.0), np.clip(h, track_y - _o / 1.5, track_y + _o * 1.0), h)
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
# The brooks are mountain streams: a narrow bed of cobbles cut into the floor of the side valley,
# deeper and between steep, rocky banks where the valley steepens, and stepped - level runs between
# lips of boulders that drop into plunge pools (step-pool) rather than a chute of even slope. Each
# east brook has a concrete check dam (shoka-entei) in its wooded reach, a 2 m drop over a notched
# crest. The lined channel across the paddies is a concrete trough (1.5 m) whose bed follows the
# floor and takes the terrace scarp in concrete drops (rakusako); a covered box carries it through
# the river bank to an outfall just above the water. The ground closes over the trough at its wall
# tops and the terrain shader opens it (channels.png), as for the canals.
from streams import stepped_profile, random_drops, equal_drops, water_rows
_brng = np.random.default_rng(SEED + 61)
STREAM_LINED_DEPTH = 0.95
def _chainage(pts_):
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(np.asarray(pts_)[:, :2], axis=0).T))])
def _brook_bed(st, end_cap, dam_window=None, floor_from=None):
    """Stepped bed of a brook down its hill path; returns the bed at each path point. floor_from =
    (first index, level): from that point on the bed stays at the level or above (the run to an outlet
    in the river wall, over ground that is sunk out of sight under the wall)."""
    hp_ = st["hill"]
    s_ = _chainage(hp_)
    gy_ = ndimage.gaussian_filter1d(np.array([at(h, x_, z_) for x_, z_ in hp_]), 1.5, mode="nearest")
    sl_ = np.abs(np.gradient(ndimage.gaussian_filter1d(gy_, 4.0, mode="nearest"), s_))
    st["steep"] = smoothstep(0.015, 0.07, sl_)
    tgt = np.minimum.accumulate(gy_ - (0.6 + 0.8 * st["steep"]))
    tgt[-1] = min(tgt[-1], end_cap)
    tgt = np.minimum.accumulate(tgt)
    if floor_from is not None:
        # (the bed levels off at the floor from where it would first have gone below it)
        lv_ = float(floor_from[1])
        tgt = np.maximum(tgt, np.where(np.arange(len(tgt)) >= max(int(np.argmax(tgt < lv_)) if (tgt < lv_).any() else len(tgt), 1), lv_, -1e9))
    dams = []
    if dam_window is not None:
        # the check dam stands where the wooded valley is steepest, the bed below it scoured 2 m deeper
        lo_, hi_ = s_[-1] - dam_window[1], s_[-1] - dam_window[0]
        cand = np.nonzero((s_ > lo_) & (s_ < hi_))[0]
        if len(cand):
            k_ = int(cand[np.argmax(sl_[cand])])
            H_ = float(_brng.uniform(1.9, 2.4))
            tgt = np.where(s_ > s_[k_], np.minimum(tgt, tgt[k_] - H_), tgt)
            dams.append((float(s_[k_]), H_))
    # step-pool: boulder lips, a little higher where the valley is steepest
    parts, drops = [], []
    cuts_ = [0] + [int(np.searchsorted(s_, d_[0], side="right")) for d_ in dams] + [len(s_)]
    for a_, b_ in zip(cuts_, cuts_[1:]):
        if b_ - a_ < 2:
            continue
        bs_, by_, dr_ = stepped_profile(s_[a_:b_], tgt[a_:b_], random_drops(_brng, 0.3, 0.95), gentle=0.022, min_total=0.25)
        parts.append((bs_, by_)); drops += [(p_, u_, d_, "step") for p_, u_, d_ in dr_]
    bs_ = np.concatenate([p_[0] for p_ in parts]); by_ = np.concatenate([p_[1] for p_ in parts])
    for sd_, H_ in dams:
        k_ = int(np.searchsorted(bs_, sd_, side="right"))
        u_ = float(by_[k_ - 1]); d_ = float(by_[min(k_, len(by_) - 1)])
        drops.append((sd_ + 0.01, u_, d_, "dam"))
    order_ = np.argsort(bs_, kind="stable")
    bs_, by_ = bs_[order_], np.minimum.accumulate(by_[order_])
    # the last fall (into the river, or down to the culvert) is the stream's own: a lip at the mouth
    st["s"], st["bs"], st["by"] = s_, bs_, by_
    st["drops"] = sorted(drops)
    return np.interp(s_, bs_, by_)
def _carve_brook(st, keep=None):
    global h
    hp_, s_, bed_ = st["hill"], st["s"], st["bed"]
    for k_ in range(len(hp_) - 1):
        (i0, i1, j0, j1), d_, t_ = _line_dist(stream_d, hp_[k_, 0], hp_[k_, 1], hp_[k_ + 1, 0], hp_[k_ + 1, 1], reach=10.0)
        stp = 0.5 * (st["steep"][k_] + st["steep"][k_ + 1])
        half_ = 1.35 - 0.45 * stp                                   # a narrow bed where it is steep
        bank_ = 0.8 + 0.25 * stp                                    # rocky banks, steepest where it is steep
        # the bed under each cell by its chainage on the stepped profile, so a step is as sharp as the
        # grid allows (interpolated between path points, every lip was a 2 m ramp)
        bcell = np.interp(s_[k_] + (s_[k_ + 1] - s_[k_]) * t_, st["bs"], st["by"])
        tgt = bcell + np.maximum(d_ - half_, 0) * bank_
        cur = h[i0:i1, j0:j1]
        new_ = np.minimum(cur, tgt)
        if keep is not None:
            new_ = np.where(keep[i0:i1, j0:j1], cur, new_)
        h[i0:i1, j0:j1] = new_
    # plunge pools below the drops
    for p_, u_, d_, kind_ in st["drops"]:
        if kind_ == "dam":
            continue                                                # (a concrete apron below it)
        fall_ = u_ - d_
        sc_ = p_ + 0.5 + 0.35 * fall_
        cx_, cz_ = float(np.interp(sc_, s_, hp_[:, 0])), float(np.interp(sc_, s_, hp_[:, 1]))
        R_ = 1.0 + 0.45 * min(fall_, 2.4)
        dp_ = 0.22 + 0.3 * min(fall_, 1.6)
        i0 = max(int((cz_ - R_ - 1) / CELL + (N - 1) / 2), 0); i1 = min(int((cz_ + R_ + 1) / CELL + (N - 1) / 2) + 2, N)
        j0 = max(int((cx_ - R_ - 1) / CELL + (N - 1) / 2), 0); j1 = min(int((cx_ + R_ + 1) / CELL + (N - 1) / 2) + 2, N)
        r_ = np.hypot(X[i0:i1, j0:j1] - cx_, Z[i0:i1, j0:j1] - cz_) / R_
        pool_ = d_ - dp_ * np.clip(1 - r_ * r_, 0, 1)
        sel_ = r_ < 1
        if keep is not None:
            sel_ &= ~keep[i0:i1, j0:j1]
        h[i0:i1, j0:j1] = np.where(sel_, np.minimum(h[i0:i1, j0:j1], pool_), h[i0:i1, j0:j1])
CHUTE = (0.9, 0.5)          # a fall of 0.9 m or more is taken on one chute at 1 in 2 (about 27 degrees)
def _lined_profile(x_start, x_end, z_, bed_start, depth, step_max, ground_):
    """Bed of a lined channel or ditch running west along z = z_ from x_start to x_end: small falls
    in concrete drops, a big one (the terrace scarp) on an inclined chute (kyuryuko)."""
    xs_ = np.arange(x_start, x_end - 0.01, -1.0)
    if len(xs_) < 3:
        xs_ = np.array([x_start, (x_start + x_end) / 2, x_end])
    s_ = x_start - xs_
    tgt = np.array([at(ground_, x_, z_) for x_ in xs_]) - depth
    tgt[0] = min(tgt[0], bed_start)
    ch_ = []
    bs_, by_, dr_ = stepped_profile(s_, tgt, equal_drops(step_max), gentle=0.012, min_total=0.2, chute=CHUTE, chutes=ch_)
    return bs_, by_, dr_, ch_
def _river_outlet(z_, bed_end):
    """Where a channel crossing the floodplain westward reaches the river's east bank: through a box
    under the levee path to an outlet in the wall (a fall into the river), or, at an earth bank, down a
    concrete chute on the bank to the water. Returns (x where the covered box ends, outlet record)."""
    rx_, B_ = float(river_x(z_)), float(bed_half(z_))
    wl_ = float(water_level(z_))
    if earth_bank(z_, True) < 0.5:
        xf_ = rx_ + B_ + WALL_RUN - 0.05                               # the face of the wall at its top
        return xf_, dict(kind="wall", x=round(xf_, 3), z=z_, bed=round(bed_end, 3), river=round(wl_, 3), dir=[-1.0, 0.0])
    top_ = float(bank_top(z_))
    xt_ = rx_ + B_ + float(earth_slope(z_, True)) * max(top_ - (wl_ + 0.1), 0.3) + 0.2
    # (below the bank the bed is mostly a gravel bar standing well above the water: the chute runs on
    # across it, cut into it, to the water's edge)
    xw_ = rx_ + 1.0
    for x_ in np.arange(rx_ + B_ + 0.25, rx_, -0.25):
        i_, j_ = (z_ / EXTENT + 0.5) * (N - 1), (x_ / EXTENT + 0.5) * (N - 1)
        i0_, j0_ = int(i_), int(j_)
        fi_, fj_ = i_ - i0_, j_ - j0_
        g_ = (h[i0_, j0_] * (1 - fi_) + h[i0_ + 1, j0_] * fi_) * (1 - fj_) + (h[i0_, j0_ + 1] * (1 - fi_) + h[i0_ + 1, j0_ + 1] * fi_) * fj_
        if g_ <= wl_ + 0.08:
            xw_ = float(x_)
            break
    return xt_, dict(kind="chute", x=round(xt_, 3), z=z_, bed=round(bed_end, 3), xFoot=round(min(xw_ + 0.3, rx_ + B_ + 0.25), 3), river=round(wl_, 3),
                     topY=round(top_, 3), dir=[-1.0, 0.0])
def _chute_tops(o_, hw_):
    """The wall tops of a chute down the bank and across the bar: a little proud of the ground beside it
    (and at least 0.3 m over its floor), every metre or so."""
    if not o_ or o_["kind"] != "chute":
        return o_
    n_ = max(2, int((o_["x"] - o_["xFoot"]) / 1.0) + 1)
    tops_ = []
    for x_ in np.linspace(o_["x"], o_["xFoot"], n_):
        fl_ = o_["bed"] + (o_["river"] + 0.05 - o_["bed"]) * (o_["x"] - x_) / max(o_["x"] - o_["xFoot"], 1e-6)
        g_ = max(sample(x_, o_["z"] + dz_) for dz_ in (-hw_ - 0.2, 0.0, hw_ + 0.2))
        tops_.append([round(float(x_), 3), round(max(g_ + 0.06, fl_ + 0.3), 3)])
    return {**o_, "tops": tops_}
_ground_s = ndimage.uniform_filter(h, 5)                              # the lie of the land beside the channels
def _dam_floor(st):
    """Below a check dam: a level apron between side walls, the banks held back behind them."""
    global h
    hp_, s_ = st["hill"], st["s"]
    for p_, u_, d_, kind_ in st["drops"]:
        if kind_ != "dam":
            continue
        x_, z_ = float(np.interp(p_, s_, hp_[:, 0])), float(np.interp(p_, s_, hp_[:, 1]))
        x2_, z2_ = float(np.interp(p_ + 2.0, s_, hp_[:, 0])), float(np.interp(p_ + 2.0, s_, hp_[:, 1]))
        l_ = math.hypot(x2_ - x_, z2_ - z_) or 1.0
        fx_, fz_ = (x2_ - x_) / l_, (z2_ - z_) / l_
        i0 = max(int((z_ - 14) / CELL + (N - 1) / 2), 0); i1 = min(int((z_ + 14) / CELL + (N - 1) / 2) + 2, N)
        j0 = max(int((x_ - 14) / CELL + (N - 1) / 2), 0); j1 = min(int((x_ + 14) / CELL + (N - 1) / 2) + 2, N)
        du = (X[i0:i1, j0:j1] - x_) * fx_ + (Z[i0:i1, j0:j1] - z_) * fz_
        dv = np.abs(-(X[i0:i1, j0:j1] - x_) * fz_ + (Z[i0:i1, j0:j1] - z_) * fx_)
        wall_top = d_ + min(1.4, u_ + 0.7 - d_)
        floor_ = (du > 0.0) & (du < 4.9) & (dv < 2.9)
        behind = (du > 0.0) & (du < 4.9) & (dv >= 2.9) & (dv < 9.0)
        hh = h[i0:i1, j0:j1]
        hh = np.where(floor_, d_ - 0.05, hh)
        hh = np.where(behind, np.minimum(hh, wall_top + np.maximum(dv - 3.2, 0.0) * 0.9), hh)
        h[i0:i1, j0:j1] = hh
for st in streams:
    st["bed"] = _brook_bed(st, road_level(st["z"]) - 1.5, dam_window=(110.0, 330.0))
    inv_in = float(st["bed"][-1])                                     # culvert invert at the inlet
    _carve_brook(st, keep=(road_d < W_FLAT + 0.6) | is_paddy)
    _dam_floor(st)
    # lined channel from the road to the river: stepped over the floor and the scarp, then the box
    # through the bank falls to an outfall just above the river's water
    zc_ = st["z"]
    bed0 = inv_in - 0.12
    bs_, by_, dr_, ch_ = _lined_profile(st["x_out"], st["x_levee"], zc_, bed0, STREAM_LINED_DEPTH, 0.75, _ground_s)
    # (over the floodplain it runs shallower, so it still stands well above the river where it ends)
    by_ = np.maximum(by_, float(water_level(zc_)) + 0.5)
    ch_ = [(p0_, max(u0_, by_[-1]), p1_, max(d1_, by_[-1])) for p0_, u0_, p1_, d1_ in ch_ if max(u0_, by_[-1]) - max(d1_, by_[-1]) > 0.2]
    dr_ = [(p_, u_, max(d_, by_[-1])) for p_, u_, d_ in dr_ if u_ - max(d_, by_[-1]) > 0.05]
    # under the levee path in a box, then out through the river wall or down a chute on the bank
    _xo, st["chan_outlet"] = _river_outlet(zc_, float(by_[-1]) - 0.02)
    bed1 = float(water_level(zc_)) + 0.05 if st["chan_outlet"]["kind"] == "chute" else float(by_[-1]) - 0.02
    st["covers"] = [c_ for c_ in st["covers"] if c_[0] != "levee"] + [("levee", _xo, st["x_levee"])]
    st["profile"] = [[round(float(st["x_out"] - a_), 3), round(float(b_), 3)] for a_, b_ in zip(bs_, by_)] + [[round(_xo, 3), round(float(by_[-1]) - 0.02, 3)]]
    if st["chan_outlet"]["kind"] == "chute":
        st["profile"].append([st["chan_outlet"]["xFoot"], round(bed1, 3)])
    st["chan_drops"] = [[round(float(st["x_out"] - p_), 3), round(u_, 3), round(d_, 3)] for p_, u_, d_ in dr_]
    st["chan_chutes"] = [[round(float(st["x_out"] - p0_), 3), round(u0_, 3), round(float(st["x_out"] - p1_), 3), round(d1_, 3)] for p0_, u0_, p1_, d1_ in ch_]
    st["bed0"], st["bed1"] = round(bed0, 3), round(bed1, 3)
    covered = np.zeros_like(h, bool)
    for kind_, cx0, cx1 in st["covers"]:
        covered |= (X > cx0 - 0.3) & (X < cx1 + 0.3)
    dz_ = np.abs(Z - zc_)
    # the ground closes over the trough at its wall tops (the shader opens it); a covered stretch is
    # graded over the slab
    band_ = (X > st["x_levee"] - 0.3) & (X < st["x_out"] + 0.3) & (dz_ < STREAM_W / 2 + 0.16 + 0.45)
    _tops_ = _ground_s + 0.06
    h = np.where(band_ & ~(road_d < W_FLAT + 0.6), _tops_ - 0.04, h)
    xs_ = np.arange(st["x_levee"], st["x_out"] + 0.01, 2.0)
    st["tops"] = [[round(float(x_), 2), round(at(_ground_s, x_, zc_) + 0.06, 3)] for x_ in xs_]
# Nishizawa: the same mountain brook down its valley to the river, which it reaches over a last lip of
# rock on the floodplain bank, falling into the river just above its water.
for st in west_brooks:
    _zm = float(st["hill"][-1, 1])
    _wl = float(water_level(_zm))
    if earth_bank(_zm, False) < 0.5:
        # the river's west bank is walled here: the brook runs on to the wall and leaves through a box
        # outlet in it, falling to the river (an otoshikomi)
        _rx, _B = float(river_x(_zm)), float(bed_half(_zm))
        _xf = _rx - _B - WALL_RUN + 0.05                               # the face of the wall, at its top
        _ext = [(x_, _zm) for x_ in np.arange(float(st["hill"][-1, 0]) + 2.0, _xf - 0.5, 2.0)] + [(_xf, _zm)]
        _k0 = len(st["hill"])
        st["hill"] = np.vstack([st["hill"], np.array(_ext)])
        st["bed"] = _brook_bed(st, float(bank_top(_zm)) - 0.6, dam_window=(90.0, 300.0), floor_from=(_k0, float(bank_top(_zm)) - 0.6))
        st["outlet"] = dict(x=_xf, z=_zm, bed=float(st["bed"][-1]), river=_wl, dir=(1.0, 0.0))
    else:
        st["bed"] = _brook_bed(st, _wl + 0.15, dam_window=(90.0, 300.0))
    _carve_brook(st, keep=is_paddy)
    _dam_floor(st)

# The Kawamuko canal: from an intake on Nishizawa it runs south along the top of the terraces, a
# little above the highest bench of each stretch, falling gently with the valley; every bench below
# it then takes its water from the bench above (tagoshi). Built after the fields are levelled.
_kz_rows = []
_terr = is_paddy & (label >= TERRACE0) & (X < rx - 10.0) & (_aw > 0.5)       # the Kawamuko apron only
for _z in np.arange(-HALF + 30.0, HALF - 30.0, 2.0):
    _i = int(round((_z / EXTENT + 0.5) * (N - 1)))
    _cols = np.nonzero(_terr[_i])[0]
    if len(_cols) < 3:
        continue
    _kz_rows.append((_z, float(axis[_cols.min()]), float(np.nanmax(paddy_level[_i, _cols]))))
if west_brooks and len(_kz_rows) > 40:
    from scipy.ndimage import minimum_filter1d as _minf1, maximum_filter1d as _maxf1b
    _kr = np.array(_kz_rows)
    _zs = np.arange(_kr[0, 0], _kr[-1, 0] + 0.01, 2.0)
    _xt = np.interp(_zs, _kr[:, 0], _kr[:, 1])
    _lt = np.interp(_zs, _kr[:, 0], _kr[:, 2])
    _xc = _g1d(_minf1(_xt, 9), 3.0) - 3.0                              # just above the top benches
    _wq = _maxf1b(_lt, 9) + 0.3
    _wc = np.maximum.accumulate(_wq[::-1])[::-1]                       # never rises downstream (south)
    # keep clear of the Kawamuko houses: pass above (west of) their yards
    for _k in range(len(_zs)):
        for hs_ in houses:
            if hs_["group"] == "kawamuko" and abs(hs_["z"] - _zs[_k]) < hs_["d"] / 2 + 8 and _xc[_k] > hs_["x"] - hs_["w"] / 2 - 9:
                _xc[_k] = min(_xc[_k], hs_["x"] - hs_["w"] / 2 - 9)
    _xc = _g1d(_xc, 2.0)

    def _contour_route(x0_, z0_, w0_, tx_, tz_, w1_, pen_, step=2):
        import heapq
        hs_g = ndimage.gaussian_filter(h, 2.0)
        m_ = 110.0
        x1_, z1_ = float(tx_[0]), float(tz_[0])
        j0_ = max(0, int((min(x0_, *tx_) - m_) / CELL + (N - 1) / 2))
        j1_ = min(N - 1, int((max(x0_, *tx_) + m_) / CELL + (N - 1) / 2))
        i0_ = max(0, int((min(z0_, *tz_) - m_) / CELL + (N - 1) / 2))
        i1_ = min(N - 1, int((max(z0_, *tz_) + m_) / CELL + (N - 1) / 2))
        I_ = np.arange(i0_, i1_ + 1, step)
        J_ = np.arange(j0_, j1_ + 1, step)
        gx, gz = axis[J_][None, :], axis[I_][:, None]
        d0_ = np.hypot(gx - x0_, gz - z0_)
        d1_ = np.hypot(gx - x1_, gz - z1_)
        wt_ = w0_ + (w1_ - w0_) * d0_ / np.maximum(d0_ + d1_, 1e-6)
        dev_ = hs_g[np.ix_(I_, J_)] - (wt_ + 0.25)                   # >0: cut, <0: the channel on a bank
        c_ = 1.0 + 40.0 * np.minimum(-dev_, 3.0).clip(0) ** 2 + 4.0 * np.clip(dev_ - 0.4, 0, 4.0) ** 2
        c_ += np.where((brook_d[np.ix_(I_, J_)] < 7.0) & (d0_ > 14.0), 60.0, 0.0)
        for hs_ in houses:
            c_ += np.where(np.hypot(gx - hs_["x"], gz - hs_["z"]) < max(hs_["w"], hs_["d"]) / 2 + 6, 80.0, 0.0)
        a0 = (int(np.argmin(np.abs(axis[I_] - z0_))), int(np.argmin(np.abs(axis[J_] - x0_))))
        tgt = {}
        for t_, (x_, z_) in enumerate(zip(tx_, tz_)):
            tgt.setdefault((int(np.argmin(np.abs(axis[I_] - z_))), int(np.argmin(np.abs(axis[J_] - x_)))), t_)
        best, a1 = np.inf, None
        dist = np.full(c_.shape, np.inf)
        prev = -np.ones(c_.shape + (2,), dtype=np.int32)
        dist[a0] = 0.0
        q = [(0.0, a0)]
        nb = [(di, dj, math.hypot(di, dj)) for di in (-1, 0, 1) for dj in (-1, 0, 1) if di or dj]
        while q:
            d_, (a, b) = heapq.heappop(q)
            if d_ > dist[a, b]:
                continue
            if d_ >= best:
                break
            if (a, b) in tgt and d_ + pen_[tgt[(a, b)]] < best:
                best, a1 = d_ + pen_[tgt[(a, b)]], (a, b)
            for di, dj, ln in nb:
                a2, b2 = a + di, b + dj
                if 0 <= a2 < c_.shape[0] and 0 <= b2 < c_.shape[1]:
                    nd = d_ + ln * 0.5 * (c_[a, b] + c_[a2, b2])
                    if nd < dist[a2, b2]:
                        dist[a2, b2] = nd
                        prev[a2, b2] = (a, b)
                        heapq.heappush(q, (nd, (a2, b2)))
        path, cur = [], a1
        while cur != a0 and cur[0] >= 0:
            path.append((float(axis[J_[cur[1]]]), float(axis[I_[cur[0]]])))
            cur = tuple(int(v_) for v_ in prev[cur])
        t1 = tgt[a1]
        path = [(float(tx_[t1]), float(tz_[t1]))] + path[1:] + [(x0_, z0_)]
        return _smooth_path(path[::-1], step=2.0, sigma=2.0), t1

    _brk = west_brooks[0]
    _hp, _bed = _brk["hill"], _brk["bed"]
    _k = None
    for _i in range(len(_hp) - 1, -1, -1):
        _L = math.hypot(_hp[_i, 0] - _xc[0], _hp[_i, 1] - _zs[0])
        if _L > 20.0 and _bed[_i] + 0.3 >= _wc[0] + _L / 300.0:
            _k = _i
            break
    if _k is not None:
        _xi, _zi = float(_hp[_k, 0]), float(_hp[_k, 1])
        _w0 = float(_bed[_k]) + 0.3
        _rpts = [p_ for r_ in rural_roads for p_ in r_["pts"]]
        _rkd = _KDi(np.array(_rpts)) if _rpts else None
        def _crossing(x_, z_):
            near_road = _rkd is not None and _rkd.query((x_, z_))[0] < 2.8
            return near_road or at(town_d, x_, z_) < 2.6 or at(lane_d, x_, z_) < 2.4 or at(farm_d, x_, z_) < 2.6
        # The head reach from the intake to the top of the terraces follows the hillside: the cheapest
        # path on a 2.3 m grid where the ground stands a little above the falling water, so the
        # channel sits in a shallow cut and winds in and out of the gullies (a straight line would
        # cross them on a bank). Fill costs more than cut; the brook and houses are kept clear of.
        # It joins the terrace stretch where it meets it rather than run on to the northern tip and
        # double back beside itself (what it skips is charged at a little over half the channel
        # saved); a diversion box there splits off a short branch north along the tip benches.
        _arc = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(_xc), np.diff(_zs)))])
        _nt = int(np.searchsorted(_arc, 160.0))
        _hd, _j = _contour_route(_xi, _zi, _w0, _xc[:_nt], _zs[:_nt], float(_wc[0]), 0.6 * _arc[:_nt])
        _sl = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(_hd[:, 0]), np.diff(_hd[:, 1])))])
        _wb = np.maximum.accumulate(_wq[:_j + 1])                     # the branch, falling north to the tip
        _wj = min(max(float(_wc[_j]), float(_wb[-1])), _w0)
        _pts = []
        for (_x, _z), _s in zip(_hd[:-1], _sl[:-1]):
            _pts.append([float(_x), float(_z), _w0 + (_wj - _w0) * _s / _sl[-1], 2 if _crossing(_x, _z) else 0])
        print("kawamuko head reach", round(float(_sl[-1])), "m, joins the terraces", round(float(_arc[_j])), "m below their tip")
        for _x, _z, _w in zip(_xc[_j:], _zs[_j:], _wc[_j:]):
            _pts.append([float(_x), float(_z), float(_w), 2 if _crossing(_x, _z) else 0])
        _pts = np.array(_pts)
        _pts[:, 2] = np.minimum(_pts[:, 2], _w0)
        _pts[:, 2] = np.minimum.accumulate(_pts[:, 2])
        canals.append(dict(name="kawamuko-yosui", pts=_pts, intake=(_xi, _zi, float(_bed[_k])), stream="nishizawa", contour=True))
        if _j >= 4:
            # it leaves the diversion box at the canal's level and falls with the benches it serves
            # (never below what they need), steeply where the tip of the terraces drops away
            _sb = _arc[_j] - _arc[_j::-1]
            _bp = np.array([[float(_xc[i_]), float(_zs[i_]), min(max(float(_wb[i_]), _wj - 0.1 * float(s_)), _wj), 2 if _crossing(_xc[i_], _zs[i_]) else 0]
                            for i_, s_ in zip(range(_j, -1, -1), _sb)])
            _bp[:, 2] = np.minimum.accumulate(_bp[:, 2])
            canals.append(dict(name="kawamuko-yosui-kita", pts=_bp, branch_of="kawamuko-yosui", stream="nishizawa", contour=True))
        print("kawamuko canal", len(_pts), "points, z", round(_zs[0]), "-", round(_zs[-1]), "intake bed", round(float(_bed[_k]), 2), "top water", round(float(_wc[0]), 2))
for _c in canals:
    if _c.get("contour"):
        for _i in range(len(_c["pts"]) - 1):
            _line_dist(irr_d, _c["pts"][_i, 0], _c["pts"][_i, 1], _c["pts"][_i + 1, 0], _c["pts"][_i + 1, 1], reach=8.0)
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
    if "intake" in _c:
        _xi, _zi, _by = _c["intake"]
        # (on the brook's stepped bed as it was finally cut)
        _bst = next((s_ for s_ in streams + west_brooks if s_["name"] == _c["stream"]), None)
        if _bst is not None:
            _by = float(_bst["bed"][int(np.argmin(np.hypot(_bst["hill"][:, 0] - _xi, _bst["hill"][:, 1] - _zi)))])
        _c["intake"] = (_xi, _zi, _by, max(_by + 0.32, float(_p[0, 2]) + 0.02))
for _dt in irr_ditches:
    _c = next(c_ for c_ in canals if not c_.get("contour") and c_["pts"][0, 1] - 40 < _dt["z"] < c_["pts"][-1, 1] + 5)
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
# below the canal the ground falls away on 1:1.5 fill (the U-channel may stand a little proud);
# above it a level berm 2.2 m out, then a 1:1 cut, so no ground stands over the wall tops where
# the terrain shader opens the channel
_graded = np.clip(h, _ctop - 0.04 - _dl / 1.5, _ctop - 0.04 + np.maximum(_cd - 2.2, 0) * 1.0)
_keep_road = (road_d < W_FLAT + 0.3) | (brook_d < 1.4)              # (and never fill a brook's bed)
# The channel is narrower than a terrain cell: carved into the heightfield it left a sawtooth of dips
# beside the walls wherever the canal runs across the grid. So the ground closes over it at the wall
# tops and the terrain shader opens the channel from a finer distance map (channels.png).
h = np.where(_keep_road, h, np.where(_cd < CANAL2_W / 2 + 0.2, _ctop - 0.04, np.where(_cd < 7.2, _graded, h)))
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
    # the bed keeps 0.42 m under the floor, stepping down the terrace scarp in small concrete drops;
    # into the weir canal it ends above the canal's water, to the river the covered box through the
    # bank falls to the outfall
    bs_, by_, dr_, ch_ = _lined_profile(_dt["x0"], _dt["x1"], _zd, _dt["bed0"], 0.42, 0.6, _ground_i)
    if _dt["into_canal"]:
        by_ = np.maximum(by_, _rw + 0.05)
        _dt["bed1"] = round(min(_rw + 0.05, float(by_[-1])), 3)
        _dt["profile"] = [[round(float(_dt["x0"] - a_), 3), round(float(b_), 3)] for a_, b_ in zip(bs_, by_)] + [[round(_dt["xr"], 3), _dt["bed1"]]]
        _dt["outlet"] = None
    else:
        by_ = np.maximum(by_, float(water_level(_zd)) + 0.45)
        _xo, _dt["outlet"] = _river_outlet(_zd, float(by_[-1]) - 0.02)
        _dt["covers"] = [c_ for c_ in _dt["covers"] if c_[0] != "levee"] + [("levee", _xo, _dt["x1"])]
        _dt["bed1"] = round(float(water_level(_zd)) + 0.05 if _dt["outlet"]["kind"] == "chute" else float(by_[-1]) - 0.02, 3)
        _dt["profile"] = [[round(float(_dt["x0"] - a_), 3), round(float(b_), 3)] for a_, b_ in zip(bs_, by_)] + [[round(_xo, 3), round(float(by_[-1]) - 0.02, 3)]]
        if _dt["outlet"]["kind"] == "chute":
            _dt["profile"].append([_dt["outlet"]["xFoot"], _dt["bed1"]])
    _dt["drops"] = [[round(float(_dt["x0"] - p_), 3), round(u_, 3), round(max(d_, by_[-1]), 3)] for p_, u_, d_ in dr_ if u_ - max(d_, by_[-1]) > 0.05]
    _dt["chutes"] = [[round(float(_dt["x0"] - p0_), 3), round(max(u0_, by_[-1]), 3), round(float(_dt["x0"] - p1_), 3), round(max(d1_, by_[-1]), 3)]
                     for p0_, u0_, p1_, d1_ in ch_ if max(u0_, by_[-1]) - max(d1_, by_[-1]) > 0.2]
    dz_ = np.abs(Z - _zd)
    # the ground closes over the ditch at its wall tops (the terrain shader opens it from channels.png):
    # carved into the 1.17 m grid it was a ragged trench, one row wide or none
    band_ = (X > _dt["x1"] - 0.2) & (X < _dt["x0"] + 0.2) & (dz_ < IRR_DITCH_W / 2 + 0.12 + 0.4) & ~(road_d < W_FLAT + 0.3)
    h = np.where(band_, _ground_i + 0.02, h)
    _xs = np.arange(_dt["x1"], _dt["x0"] + 0.01, 2.0)
    _dt["tops"] = [[round(float(x_), 2), round(at(_ground_i, x_, _zd) + 0.06, 3)] for x_ in _xs]

# Connect real water sources to parcel edges, including short field-to-field drops.
from irrigation import connect as connect_irrigation
_water_sources = [(c['name'], [[float(x),float(y),float(z)] for x,z,y,cover in c['pts']]) for c in canals]
for st in streams + west_brooks:
    _water_sources.append((st['name'], [[float(x),float(y+.12),float(z)] for (x,z),y in zip(st['hill'],st['bed'])]))
_water_sources.append(('weir-canal', [p[:3] for p in canal_pts]))
for ki,dt in enumerate(irr_ditches):
    pp=[[float(x_), float(b_)+.12, dt['z']] for x_, b_ in dt['profile'][::2]]
    _water_sources.append(('ditch-'+str(ki),pp))
irrigation = connect_irrigation(fields, comp, axis, _water_sources,
    lambda x,z: min(at(farm_d,x,z), at(town_d,x,z), at(lane_d,x,z), at(road_d,x,z)))
print('irrigation supplied',len(irrigation['supplied']),'unresolved',len(irrigation['unresolved']))
bund_openings = np.zeros_like(is_paddy)
for link in irrigation['links']:
    if link['covered']: continue
    (ax,ay,az),(bx,by,bz) = link['points']
    _tmp = np.full_like(h, 1e9)
    (i0,i1,j0,j1),dd,tt = _line_dist(_tmp,ax,az,bx,bz,reach=2)
    sl = np.s_[i0:i1,j0:j1]
    bund_openings[sl] |= dd < 1.2
    bed = ay+(by-ay)*tt-.18
    weight = 1-smoothstep(.3,.9,dd)
    h[sl] = h[sl]*(1-weight)+np.minimum(h[sl],bed)*weight

# Restore rural road benches after field banks and water works. Nearest-segment
# grading avoids ridges at bends where sequential overlapping blends disagreed.
_rdist = np.full_like(h, 1e9)
_rlevel = h.copy()
_forest_road_dist = np.full_like(h, 1e9)
for _r in rural_roads:
    for (ax, az, ay), (bx, bz, by) in zip(_r['profile'], _r['profile'][1:]):
        (i0, i1, j0, j1), dd, tt = _line_dist(farm_d, ax, az, bx, bz, reach=24.)
        sl = np.s_[i0:i1, j0:j1]
        closer = dd < _rdist[sl]
        _rlevel[sl] = np.where(closer, ay+(by-ay)*tt, _rlevel[sl])
        _rdist[sl] = np.minimum(_rdist[sl], dd)
        if _r['kind'] == 'forest':
            _forest_road_dist[sl] = np.minimum(_forest_road_dist[sl],dd)
# Broad forest earthworks, not a fixed-width blend that produces a sheer trench.
# Preserve cultivated horizontal surfaces and existing stream/road works.
_fs = np.maximum(_rdist-2.5,0)
_fgrade = np.clip(h,_rlevel-.5*_fs,_rlevel+.67*_fs)
_fmask = (_forest_road_dist<24) & ~is_paddy & (stream_d>5) & (road_d>W_FLAT+1) & (town_d>5) & (temple_d>12)
h = np.where(_fmask,_fgrade,h)
_rw = 1-smoothstep(2.0, 4.5, _rdist)
h = h*(1-_rw)+_rlevel*_rw
h = np.where((Z >= ROAD_Z0-.6) & (Z < HALF-32) & (road_d < W_FLAT), road_y, h)

# Late river-bank / road-shoulder grading must not cut through a closed field
# rim. Parcel masks already exclude carriageways and main channels. Preserve
# only the explicit inlet/outlet cuts from the water graph.
h = np.where(is_paddy & ~bund_openings, np.maximum(h,h_field),h)

# ---- Encode height -------------------------------------------------------------
_tick('Encode height')
h = np.clip(h, H_MIN, H_MIN + H_RANGE)
raw = np.rint((h - H_MIN) / H_RANGE * 65535).astype("<u2")
raw.tofile(OUT / "heightmap.r16")
Image.fromarray(raw.astype(np.uint16)).save(OUT / "heightmap.png")
hq = raw.astype(np.float64) / 65535 * H_RANGE + H_MIN
# Inspect the delivered, quantized terrain, not just the intermediate bund model.
# Water inlets/outlets are deliberate gaps and are checked separately by irrigation.
_bund_check = bund_boundary & ~bund_openings
_freeboard = hq[_bund_check] - paddy_level[_bund_check]
_bund_report = dict(samples=int(_bund_check.sum()), openings=int((bund_boundary & bund_openings).sum()),
    minimumFreeboard=round(float(_freeboard.min()),4), belowBed=int((_freeboard<-.01).sum()),
    below20cm=int((_freeboard<.20).sum()), crownHeight=BUND_HEIGHT, riceSetback=RICE_EDGE)
(ROOT / '.cache' / 'paddy-bunds.json').write_text(json.dumps(_bund_report,indent=2))
assert _bund_report['belowBed'] == 0, _bund_report

def sample(x, z):
    fx = (x / EXTENT + 0.5) * (N - 1)
    fz = (z / EXTENT + 0.5) * (N - 1)
    ix, iz = int(min(max(fx, 0), N - 2)), int(min(max(fz, 0), N - 2))
    a, b = fx - ix, fz - iz
    return float((hq[iz, ix] * (1 - a) + hq[iz, ix + 1] * a) * (1 - b) + (hq[iz + 1, ix] * (1 - a) + hq[iz + 1, ix + 1] * a) * b)

# Cache route profiles for diagnosing a failed grade check before the scene export.
(ROOT / '.cache' / 'rural-profiles.json').write_text(json.dumps(rural_roads))
# Fail before expensive vegetation generation if encoded road benches have a step.
for _r in rural_roads:
    _max_grade, _at = 0., None
    for (ax, az), (bx, bz) in zip(_r['pts'], _r['pts'][1:]):
        length = math.hypot(bx-ax, bz-az)
        samples = max(1, math.ceil(length))
        heights = [sample(ax+(bx-ax)*t, az+(bz-az)*t) for t in np.linspace(0, 1, samples+1)]
        _g = max(abs(b-a) for a,b in zip(heights, heights[1:]))/(length/samples)
        if _g > _max_grade:
            _max_grade, _at = _g, (round(ax, 1), round(az, 1))
    _tick(f"Rural grade {_r['id']}: {_max_grade:.3f}")
    if _max_grade >= .35:
        np.save(ROOT / '.cache' / 'hq-failed.npy', hq)
        raise ValueError(f"Unwalkable rural road {_r['id']}: grade {_max_grade:.3f} at {_at}")

# ---- Surface masks ---------------------------------------------------------------
_tick('Surface masks')
gy, gx = np.gradient(hq, CELL)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
# woods reach down the footslopes to the edge of the fields (satoyama), not just the mountains
forest_density = np.clip(smoothstep(0.35, 3.5, mountain_factor) + smoothstep(2, 10, shrine_spur(X, Z) - 2), 0, 1)
forest_density = np.clip(forest_density * (0.75 + 0.5 * (fbm(P1, X, Z, 140, 3) * 0.5 + 0.5)), 0, 1)
pre = (X > px0 - 1) & (X < px1) & (Z > pz0) & (Z < pz1)
forest_density = np.where(pre, 0, forest_density)
forest_density = np.where(is_paddy | ((road_d < 6) & (Z > ROAD_Z0 - 1.0)) | (rd < RB + _sec['run'] + _sec['cap'] + 1.0), 0, forest_density)
forest_density = forest_density * smoothstep(2.5, 5.0, farm_d) * smoothstep(1.6, 4.0, stream_d) * smoothstep(-1.0, 5.0, temple_d)
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
riverbed = np.maximum(riverbed, (1 - smoothstep(0.85, 1.7, brook_d)) * (road_d > W_FLAT + 0.6))
# the brooks cut down to rock: the steep banks of their channels are bare, mossy stone
rock = np.maximum(rock, (1 - smoothstep(2.6, 4.2, brook_d)) * smoothstep(24.0, 40.0, slope) * (road_d > W_FLAT + 0.6))
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
grass_density = grass_density * (stream_d > STREAM_W / 2 + 0.3) * (1 - 0.9 * (temple_d < 0)) * (_cd > CANAL2_W / 2 + 0.35)
# (nor in the outlet chutes down the river bank and across the bar)
_in_chute = np.zeros_like(is_paddy)
for _o, _hw in [(st_["chan_outlet"], STREAM_W / 2) for st_ in streams] + [(dt_["outlet"], IRR_DITCH_W / 2) for dt_ in irr_ditches]:
    if _o and _o["kind"] == "chute":
        _in_chute |= (X > _o["xFoot"] - 0.6) & (X < _o["x"] + 0.4) & (np.abs(Z - _o["z"]) < _hw + 0.45)
grass_density = grass_density * ~_in_chute
# road verges: a strip mown short beside the ditch; the cut and fill banks beyond left long
_onroad = Z > ROAD_Z0 - 0.6
grass_density = np.where(_onroad & (road_d > DITCH_OFF + 0.3) & (road_d < DITCH_OFF + 1.9), grass_density * 0.45, grass_density)
grass_density = np.where(_onroad & (road_d > W_FLAT + 0.6) & (road_d < W_FLAT + 7.0) & ~is_paddy, np.maximum(grass_density, 0.9 * wgt["grass"]), grass_density)
pid = np.where(is_paddy, (label * 2654435761 % 251 + 3), 0) % 255
# B: signed distance to the edge of the rice, 0.5 at the edge, +-2 m over the range (rice fields only)
rice_sdf = np.where(is_paddy & (field_type == 1), np.clip(0.5 + (d_fld - RICE_EDGE) / 4.0, 0, 1), 0.0)
aux = np.stack([forest_density, pid / 255.0, rice_sdf, grass_density], -1)
Image.fromarray(np.uint8(np.rint(np.clip(aux, 0, 1) * 255)), "RGBA").save(OUT / "vegetation-mask.png")
# Openings of the brook-fed canals in the ground: distance (m) from each 0.5 m texel centre to the
# nearest open stretch of canal, 0-2 m in 0-255. The ends stop short of the intake and the end wall;
# the inside of each diversion box is open too.
CHAN_RES, CHAN_RANGE = 4096, 2.0     # (0.51 m texels; 4096 is the largest texture every GPU takes)
_chd = np.full((CHAN_RES, CHAN_RES), CHAN_RANGE, np.float32)
_tc = -EXTENT / 2 + (np.arange(CHAN_RES) + 0.5) * EXTENT / CHAN_RES
def _chan_seg(ax_, az_, bx_, bz_, trim0=0.0, trim1=0.0, scale=1.0):
    L_ = math.hypot(bx_ - ax_, bz_ - az_)
    if L_ < 1e-6 or trim0 + trim1 >= L_:
        return
    ux_, uz_ = (bx_ - ax_) / L_, (bz_ - az_) / L_
    ax_, az_, bx_, bz_ = ax_ + ux_ * trim0, az_ + uz_ * trim0, bx_ - ux_ * trim1, bz_ - uz_ * trim1
    r_ = CHAN_RANGE + 0.5
    j0_ = max(int((min(ax_, bx_) - r_ + EXTENT / 2) / EXTENT * CHAN_RES), 0); j1_ = min(int((max(ax_, bx_) + r_ + EXTENT / 2) / EXTENT * CHAN_RES) + 1, CHAN_RES)
    i0_ = max(int((min(az_, bz_) - r_ + EXTENT / 2) / EXTENT * CHAN_RES), 0); i1_ = min(int((max(az_, bz_) + r_ + EXTENT / 2) / EXTENT * CHAN_RES) + 1, CHAN_RES)
    gx_, gz_ = _tc[None, j0_:j1_], _tc[i0_:i1_, None]
    t_ = np.clip(((gx_ - ax_) * (bx_ - ax_) + (gz_ - az_) * (bz_ - az_)) / max((bx_ - ax_) ** 2 + (bz_ - az_) ** 2, 1e-9), 0, 1)
    d_ = np.hypot(gx_ - (ax_ + t_ * (bx_ - ax_)), gz_ - (az_ + t_ * (bz_ - az_))) * scale
    _chd[i0_:i1_, j0_:j1_] = np.minimum(_chd[i0_:i1_, j0_:j1_], d_)
for _c in canals:
    _p = _c["pts"]
    _n = len(_p)
    for _i in range(_n - 1):
        if _p[_i, 3] > 0.5 or _p[_i + 1, 3] > 0.5:
            continue
        _chan_seg(_p[_i, 0], _p[_i, 1], _p[_i + 1, 0], _p[_i + 1, 1],
                  0.6 if (_i == 0 and "intake" in _c) else 0.0, CANAL2_W / 2 + 0.1 if _i == _n - 2 else 0.0)
    if "branch_of" in _c:                                          # the diversion box: 1.8 m square inside its walls
        _gx, _gz = _p[1, 0] - _p[0, 0], _p[1, 1] - _p[0, 1]
        _gl = math.hypot(_gx, _gz) or 1.0
        _gx, _gz = _gx / _gl, _gz / _gl
        _r = (CANAL2_W + 0.9) / 2 - 0.07
        _i0 = int((_p[0, 1] - 2 + EXTENT / 2) / EXTENT * CHAN_RES); _j0 = int((_p[0, 0] - 2 + EXTENT / 2) / EXTENT * CHAN_RES)
        _sx, _sz = _tc[None, _j0:_j0 + 9] - _p[0, 0], _tc[_i0:_i0 + 9, None] - _p[0, 1]
        _in = (np.abs(_sx * _gx + _sz * _gz) < _r) & (np.abs(-_sx * _gz + _sz * _gx) < _r)
        _chd[_i0:_i0 + 9, _j0:_j0 + 9] = np.where(_in, 0.0, _chd[_i0:_i0 + 9, _j0:_j0 + 9])
# the lined channels of the brooks and the field ditches open the same way; their distances are
# scaled so the one threshold opens each to its own inner width
_open = CANAL2_W / 2 + 0.02
def _open_run(x_from, x_to, z_, covers_, half_):
    """Open the stretches of a channel along z = z_ between x_to < x_from, outside its covers."""
    cuts_ = sorted([(a_ - 0.05, b_ + 0.05) for _k, a_, b_ in covers_])
    a_ = x_to
    for c0_, c1_ in cuts_ + [(x_from, x_from)]:
        lo_, hi_ = max(a_, x_to), min(c0_, x_from)
        if hi_ - lo_ > 0.2:
            _chan_seg(hi_, z_, lo_, z_, 0.12, 0.12, scale=_open / (half_ + 0.02))
        a_ = max(a_, c1_)
for st in streams:
    _open_run(st["x_out"], st["x_levee"], st["z"], st["covers"], STREAM_W / 2)
for _dt in irr_ditches:
    _open_run(_dt["x0"], _dt["x1"], _dt["z"], _dt["covers"], IRR_DITCH_W / 2)
# the chutes down the river bank at the outlets
for _o, _hw in [(st_["chan_outlet"], STREAM_W / 2) for st_ in streams] + [(dt_["outlet"], IRR_DITCH_W / 2) for dt_ in irr_ditches]:
    if _o and _o["kind"] == "chute":
        _chan_seg(_o["x"], _o["z"], _o["xFoot"], _o["z"], 0.1, 0.0, scale=_open / (_hw + 0.02))
Image.fromarray(np.uint8(np.rint(np.clip(_chd / CHAN_RANGE, 0, 1) * 255)), "L").save(OUT / "channels.png", optimize=True)
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
_chute_block = ndimage.binary_dilation(_in_chute, iterations=1)
built_block = (farm_d < 3.8) | (temple_d < 2.0) | (stream_d < 2.4) | (irr_d < 2.2) | _chute_block
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
# The terrace scarps: a broken strip of wood down the face - konara and other broadleaves, a zelkova
# or a sugi here and there, bamboo in clumps - with grass and scrub in the gaps, as the faces of
# river terraces are left where nothing can be farmed.
_face = SCARP_ZONE & (slope > 12.0) & ~is_paddy
_fi, _fj = np.nonzero(_face[::3, ::3])
for _i, _j in zip(_fi * 3, _fj * 3):
    x, z = float(axis[_j]) + rv.uniform(-1.6, 1.6), float(axis[_i]) + rv.uniform(-1.6, 1.6)
    clump = float(fbm(P2, np.array(x), np.array(z), 30.0, 2))
    if clump < -0.12 or rv.random() > 0.55 or not cell(_face, x, z) or blocked(x, z, top=sample(x, z) + 11.0):
        continue
    r_ = rv.random()
    if clump > 0.35 and r_ < 0.5:
        for k_ in range(int(rv.integers(4, 10))):
            bx_, bz_ = x + rv.normal(0, 2.2), z + rv.normal(0, 2.2)
            if cell(_face, bx_, bz_) and not blocked(bx_, bz_):
                add_tree("bamboo", bx_, bz_, rv.uniform(0.7, 1.0), lean=abs(rv.normal(0.05, 0.04)))
    elif r_ < 0.78:
        add_tree("broadleaf", x, z, rv.uniform(0.45, 0.95), lean=abs(rv.normal(0.03, 0.03)))
    elif r_ < 0.88:
        add_tree("keyaki", x, z, rv.uniform(0.6, 0.95))
    elif r_ < 0.94:
        add_tree("sugi", x, z, rv.uniform(0.6, 0.9))
    else:
        riparian_shrubs.append((x, z))
# an old zelkova at the west bridgehead
_bt = (BRIDGE_X0 - bank_reach(BRIDGE_Z, False) - 3.2, BRIDGE_Z - 5.5)
add_tree("keyaki", _bt[0], _bt[1], 1.15)

# House windbreaks and individually placed trees are added after the forest
# mask pass. Apply road clearance to EVERY group, including these exceptions.
_removed_road_trees=0
for kind,rows in trees.items():
    kept=[row for row in rows if at(_rdist,row[0],row[2])>3.8 and at(farm_d,row[0],row[2])>3.3]
    _removed_road_trees+=len(rows)-len(kept)
    trees[kind]=kept
print('road clearance removed trees',_removed_road_trees)

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
    if at(_chute_block, x, z):                                       # (the outlet chutes across the bars)
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
# The brooks: boulders make the lip of every step (the water slips between and over them), more lie
# in the bed and against the banks where the stream is steep, riprap below each check dam and at the
# mouth; moss-grown rocks on the banks in the woods.
def _boulder(x, y, z, sc):
    clutter["boulder"].append([round(x, 2), round(y, 3), round(z, 2), round(sc, 3), round(float(rv.random() * math.tau), 3), int(rv.integers(0, 2))])
for st in streams + west_brooks:
    hp_, s_ = st["hill"], st["s"]
    def _at_s(q):
        x_, z_ = float(np.interp(q, s_, hp_[:, 0])), float(np.interp(q, s_, hp_[:, 1]))
        x2_, z2_ = float(np.interp(q + 1.0, s_, hp_[:, 0])), float(np.interp(q + 1.0, s_, hp_[:, 1]))
        l_ = math.hypot(x2_ - x_, z2_ - z_) or 1.0
        return x_, z_, (x2_ - x_) / l_, (z2_ - z_) / l_
    for p_, u_, d_, k_ in st["drops"]:
        fall_ = u_ - d_
        if k_ == "dam":
            for i in range(int(rv.integers(7, 12))):
                x_, z_, tx_, tz_ = _at_s(p_ + rv.uniform(1.5, 5.5))
                off = rv.uniform(-2.2, 2.2)
                _boulder(x_ - tz_ * off, d_ - 0.15, z_ + tx_ * off, rv.uniform(0.35, 0.7))
            continue
        x_, z_, tx_, tz_ = _at_s(p_ - 0.2)
        n_ = int(rv.integers(2, 5))
        for i in range(n_):
            off = (i - (n_ - 1) / 2) * rv.uniform(0.7, 1.0) + rv.normal(0, 0.15)
            sc = rv.uniform(0.3, 0.55) * (0.85 + 0.35 * min(fall_, 1.0))
            _boulder(x_ - tz_ * off, u_ + 0.24 - 0.62 * sc, z_ + tx_ * off, sc)
        # a big one beside the pool now and then
        if rv.random() < 0.35:
            x_, z_, tx_, tz_ = _at_s(p_ + 1.0 + rv.uniform(0, 1.5))
            off = rv.choice([-1, 1]) * rv.uniform(1.1, 1.8)
            _boulder(x_ - tz_ * off, float(sample(x_ - tz_ * off, z_ + tx_ * off)) - 0.25, z_ + tx_ * off, rv.uniform(0.6, 1.1))
    for q in np.arange(2.0, s_[-1] - 2.0, 1.6):
        stp = float(np.interp(q, s_, st["steep"]))
        if rv.random() > 0.18 + 0.4 * stp:
            continue
        x_, z_, tx_, tz_ = _at_s(q)
        if abs(x_ - float(road_x(z_))) < W_FLAT + 2.0:
            continue
        r_ = rv.random()
        if r_ < 0.45:
            off = rv.normal(0, 0.55)                                      # in the bed
            _boulder(x_ - tz_ * off, float(sample(x_ - tz_ * off, z_ + tx_ * off)) - 0.12, z_ + tx_ * off, rv.uniform(0.2, 0.45) * (0.8 + 0.6 * stp))
        elif r_ < 0.85:
            off = rv.choice([-1, 1]) * rv.uniform(1.0, 2.4)               # against the bank
            _boulder(x_ - tz_ * off, float(sample(x_ - tz_ * off, z_ + tx_ * off)) - 0.3, z_ + tx_ * off, rv.uniform(0.4, 0.95) * (0.7 + 0.5 * stp))
        else:
            off = rv.choice([-1, 1]) * rv.uniform(2.2, 3.6)               # moss on the bank above (fields from 4.6 m)
            add_clutter("rock_moss", x_ - tz_ * off, z_ + tx_ * off, rv.uniform(0.4, 1.0), int(rv.integers(0, 2)), sink=0.15)
    # riprap where the stream leaves its valley: at the mouth into the river, at the culvert inlet
    # (below the outlet in the river wall, in the river bed at the foot of the fall)
    x_, z_, tx_, tz_ = _at_s(s_[-1] - 1.0)
    if st.get("outlet"):
        o_ = st["outlet"]
        x_, z_, tx_, tz_ = o_["x"] + 2.6, o_["z"], 1.0, 0.0
    for i in range(int(rv.integers(5, 9))):
        off, al = rv.uniform(-1.8, 1.8), rv.uniform(-3.0, 1.0)
        _boulder(x_ + tx_ * al - tz_ * off, float(sample(x_ + tx_ * al - tz_ * off, z_ + tz_ * al + tx_ * off)) - 0.2, z_ + tz_ * al + tx_ * off, rv.uniform(0.3, 0.6))
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
_vrng = np.random.default_rng(SEED + 41)
_vdesigns = json.loads((ROOT / "tools/vehicles/source/designs.json").read_text())
VEHICLE_LEN = {d_["id"]: float(d_["l"]) for d_ in _vdesigns}
VEHICLE_W = {d_["id"]: float(d_["w"]) for d_ in _vdesigns}
_vneed = ["crown-sedan", "light-truck", "utility-wagon", "kei-hatch"]
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
    if hs["group"] in ("kaminosawa", "nakazato", "miyashita", "shimojuku", "minamizawa", "shimohara", "sankyo", "kawamuko") and rng.random() < 0.75:
        sx_, sz_ = local(bs * (W2 + 3.4), -D2 + 1.6)
        obj("naya", sx_, hs["y"], sz_, hs["yaw"] + bs * math.pi / 2, rng.uniform(0.62, 0.72), collider={"type": "box", "halfExtents": [1.8, 1.3, 1.5]})
    # laundry poles (monohoshi) in the sunny front yard, on the side away from the barn
    pole = hs["front"] > 5.0 and rng.random() < 0.65
    if pole:
        lx_, lz_ = local(-bs * (W2 - 3.0), D2 + 2.6)
        obj("monohoshi", lx_, hs["y"], lz_, hs["yaw"] + rng.normal(0, 0.05), 1.0, collider={"type": "box", "halfExtents": [1.6, 0.95, 0.12]})
    if (i % 3 == 0 or (hs["group"] == "minamizawa" and i % 3 == 1)) and hs["group"] != "sankyo":
        wx, wz = local(-2.0, D2 + hs["front"] + 0.3)
        obj("block-wall", wx, hs["y"], wz, hs["yaw"], 1.0, length=round(hs["w"] + 8, 2))
    # The family's cars in the front yard, facing out to the road: most farms keep a kei truck, many also a
    # small car; a bigger farm a light truck, a few a saloon or a wagon. (Drawn from their own random
    # stream, so the rest of the layout does not move.)
    if hs["front"] > 6.0 and _vrng.random() < 0.62:
        first = str(_vrng.choice(["kei-truck", "kei-truck", "kei-truck", "kei-truck", "light-truck", "kei-hatch", "utility-wagon", "crown-sedan"]))
        # (every model is parked somewhere: the first yards deep enough take the ones not yet drawn)
        if _vneed and hs["front"] > 0.8 + 0.96 * VEHICLE_LEN[_vneed[0]] + 1.2 and _vrng.random() < 0.5:
            first = _vneed[0]
        if first in _vneed:
            _vneed.remove(first)
        for k_, model in enumerate([first] + ([str(_vrng.choice(["kei-hatch", "kei-hatch", "utility-wagon", "crown-sedan", "kei-truck"]))]
                                             if hs["front"] > 7.0 and not pole and hs["w"] > 9.0 and _vrng.random() < 0.5 else [])):
            L_ = VEHICLE_LEN[model]
            tx, tz = local(-bs * (W2 - 1.8 - 3.2 * k_), D2 + hs["front"] - 0.8 - 0.48 * L_)
            obj(model, tx, hs["y"], tz, hs["yaw"] + 0.3 * (1 - 2 * k_ * 0.5) + _vrng.normal(0, 0.05), 1.0,
                collider={"type": "box", "halfExtents": [round(VEHICLE_W[model] / 2, 3), 0.9, round(L_ / 2, 3)]})
    px_, pz_ = local(bs * (W2 + 2.4), D2 + min(6.0, hs["front"] - 1.5))
    obj(str(rng.choice(["prop-bucket", "prop-basket", "prop-crate"])), px_, hs["y"], pz_, float(rng.random() * math.tau), 1.0)
    # stone retaining wall where the yard stands above the ground in front of it
    drop_ = hs["y"] - hs["ground_south"]
    if drop_ > 1.1:
        rx_, rz_ = local(0, D2 + hs["front"] + 0.7)
        obj("ishigaki", rx_, hs["y"], rz_, hs["yaw"], 1.0, length=round(hs["w"] + 14, 2), height=round(min(drop_, 4.0), 2))
# Cars at the public buildings: the doctor's saloon and a visitor's car at the clinic, a light truck
# and kei trucks at the co-op, a small car at the post office and the halls. Each takes the first
# spot from a short list that is level, off the road and the fields, and clear of anything built.
def _spot_free(x_, z_, yaw_, model_):
    L_, W_ = VEHICLE_LEN[model_], VEHICLE_W[model_]
    if at(road_d, x_, z_) < W_FLAT + 0.6 or at(is_paddy_f, x_, z_) > 0.5 or at(slope0, x_, z_) > 8:
        return False
    for o_ in objects:
        ox_, _, oz_ = o_["position"]
        he_ = (o_.get("collider") or {}).get("halfExtents") or [0.6, 0, 0.6]
        if math.hypot(ox_ - x_, oz_ - z_) < max(he_[0], he_[2]) * o_["scale"][0] + L_ / 2 + 0.4:
            return False
    for h_ in houses:
        c_, s2_ = math.cos(h_["yaw"]), math.sin(h_["yaw"])
        lx_, lz_ = (x_ - h_["x"]) * c_ - (z_ - h_["z"]) * s2_, (x_ - h_["x"]) * s2_ + (z_ - h_["z"]) * c_
        if abs(lx_) < h_["w"] / 2 + L_ / 2 + 0.3 and abs(lz_) < h_["d"] / 2 + L_ / 2 + 0.3:
            return False
    return True
_public_cars = {"shinryojo": ["crown-sedan", "kei-hatch"], "nokyo": ["light-truck", "kei-truck"], "nokyo-soko": ["kei-truck"],
                "post-office": ["kei-hatch"], "kominkan": ["utility-wagon"]}
_pc = 0
for hs in houses:
    for model_ in _public_cars.get(hs["asset"], []):
        c_, s2_ = math.cos(hs["yaw"]), math.sin(hs["yaw"])
        W2_, D2_ = hs["w"] / 2, hs["d"] / 2
        for lx_, lz_, turn_ in [(-W2_ + 2.0, D2_ + 3.2, math.pi / 2), (W2_ - 2.0, D2_ + 3.2, math.pi / 2), (0.0, D2_ + 3.2, math.pi / 2),
                                (-W2_ - 2.6, 0.0, 0.0), (W2_ + 2.6, 0.0, 0.0), (-W2_ - 2.6, -D2_ + 2.4, 0.0), (W2_ + 2.6, -D2_ + 2.4, 0.0)]:
            x_, z_ = hs["x"] + lx_ * c_ + lz_ * s2_, hs["z"] - lx_ * s2_ + lz_ * c_
            yaw_ = hs["yaw"] + turn_ + _vrng.normal(0, 0.04)
            if _spot_free(x_, z_, yaw_, model_):
                obj(model_, x_, float(sample(x_, z_)), z_, yaw_, 1.0,
                    collider={"type": "box", "halfExtents": [round(VEHICLE_W[model_] / 2, 3), 0.9, round(VEHICLE_LEN[model_] / 2, 3)]})
                _pc += 1
                break
print("cars at public buildings", _pc, "| cars in all", sum(1 for o_ in objects if o_["asset"] in VEHICLE_LEN))
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
        _clear = (at(farm_d, _xf, _zf) > 4.0 and at(lane_d, _xf, _zf) > 4.0 and at(stream_d, _xf, _zf) > 6.0 and at(irr_d, _xf, _zf) > 3.0 and at(bd, _xf, _zf) > 6.0
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
_intakes = {}
for _c in canals:
    if "intake" in _c:
        _intakes.setdefault(_c["stream"], []).append(_c["intake"])
def _brook_water(st):
    """Water down a brook: level runs between its steps, the overfall of every step and of the check
    dam, the pool behind a canal's intake weir and the fall over it."""
    hp_, s_ = st["hill"], st["s"]
    at_ = lambda q: (float(np.interp(q, s_, hp_[:, 0])), float(np.interp(q, s_, hp_[:, 1])))
    half_ = lambda q: 0.95 - 0.3 * float(np.interp(q, s_, st["steep"]))
    rows, rs = water_rows(st["bs"], st["by"], [(p_, u_, d_) for p_, u_, d_, _k in st["drops"]], at_, 0.2, half_, pool_half=1.25, with_s=True)
    for _xi, _zi, _by, _crest in _intakes.get(st["name"], []):
        si = float(s_[int(np.argmin(np.hypot(hp_[:, 0] - _xi, hp_[:, 1] - _zi)))])
        pond = _crest + 0.04
        keep = []
        for r_, q in zip(rows, rs):
            if si - 0.06 < q < si + 0.5:
                continue
            if q < si and r_[1] < pond:
                r_ = r_[:1] + [round(pond, 3)] + r_[2:4] + [0, 0.0]
            keep.append((q, r_))
        x0_, z0_ = at_(si - 0.03); x1_, z1_ = at_(si + 0.45)
        below = float(np.interp(si + 0.45, st["bs"], st["by"])) + 0.2
        keep += [(si - 0.03, [round(x0_, 3), round(pond, 3), round(z0_, 3), round(half_(si), 3), 0, 0.0]),
                 (si - 0.01, [round(x0_, 3), round(pond - 0.03, 3), round(z0_, 3), round(half_(si), 3), 1, 0.0]),
                 (si + 0.45, [round(x1_, 3), round(below, 3), round(z1_, 3), round(half_(si), 3), 1, 1.0])]
        keep.sort(key=lambda t_: t_[0])
        rows, rs = [r_ for _q, r_ in keep], [q for q, _r in keep]
    if st.get("outlet"):
        o_ = st["outlet"]
        top_ = rows[-1][1]
        # out of the mouth of the box, over its lip, and down into the river
        rows += [[round(o_["x"] + 0.36, 3), round(top_, 3), round(o_["z"], 3), 0.6, 0, 0.0],
                 [round(o_["x"] + 0.7, 3), round(top_ - 0.03, 3), round(o_["z"], 3), 0.6, 1, 0.0],
                 [round(o_["x"] + 1.05, 3), round(o_["river"], 3), round(o_["z"], 3), 0.75, 1, 1.0],
                 [round(o_["x"] + 2.3, 3), round(o_["river"], 3), round(o_["z"] + 0.3, 3), 1.2, 0, 0.8]]
    # (water never rises downstream)
    for k_ in range(1, len(rows)):
        if rows[k_][1] > rows[k_ - 1][1]:
            rows[k_][1] = rows[k_ - 1][1]
    return rows
def _dams(st):
    """Check dams on a brook: position, flow direction, crest and apron levels, and how far the wall
    runs into each bank (to where the ground stands above its wings)."""
    out = []
    hp_, s_ = st["hill"], st["s"]
    for p_, u_, d_, k_ in st["drops"]:
        if k_ != "dam":
            continue
        x_, z_ = float(np.interp(p_, s_, hp_[:, 0])), float(np.interp(p_, s_, hp_[:, 1]))
        x2_, z2_ = float(np.interp(p_ + 2.0, s_, hp_[:, 0])), float(np.interp(p_ + 2.0, s_, hp_[:, 1]))
        l_ = math.hypot(x2_ - x_, z2_ - z_) or 1.0
        fx_, fz_ = (x2_ - x_) / l_, (z2_ - z_) / l_
        nx_, nz_ = -fz_, fx_
        ext = []
        for sg in (-1.0, 1.0):
            v_ = 1.8
            while v_ < 12.0 and sample(x_ + sg * nx_ * v_, z_ + sg * nz_ * v_) < u_ + 0.9:
                v_ += 0.5
            ext.append(round(v_ + 0.8, 2))
        out.append({"x": round(x_, 2), "z": round(z_, 2), "dir": [round(fx_, 4), round(fz_, 4)], "crest": round(u_, 3), "bed": round(d_, 3), "left": ext[0], "right": ext[1]})
    return out
def _channel_water(profile, drops_, chutes_, z_, half_, depth_, covers_, x_end, outlet=None):
    """Water down a lined channel or ditch (x falling westward), split into runs at its covers, and
    the water leaving it at the river: out of the wall and down into the river, or down the chute on
    the bank."""
    op_ = [p_ for p_ in profile if p_[0] >= x_end - 1e-6]
    xs_ = np.array([p_[0] for p_ in op_]); ys_ = np.array([p_[1] for p_ in op_])
    bs_ = xs_[0] - xs_
    dr_ = [(xs_[0] - p_, u_, d_) for p_, u_, d_ in drops_]
    chs_ = [(xs_[0] - x0_, u_, xs_[0] - x1_, d_) for x0_, u_, x1_, d_ in chutes_]
    rows = water_rows(bs_, ys_, dr_, lambda q: (float(xs_[0] - q), z_), depth_, half_, foam_len=1.0, chutes=chs_)
    runs, run = [], []
    for r_ in rows:
        if r_[0] < x_end - 0.01 or any(a_ - 0.2 < r_[0] < b_ + 0.2 for _k, a_, b_ in covers_):
            if len(run) > 1:
                runs.append(run)
            run = []
            continue
        run.append(r_)
    if len(run) > 1:
        runs.append(run)
    if outlet:
        o_, w_ = outlet, round(half_, 3)
        top_ = o_["bed"] + depth_
        if o_["kind"] == "wall":
            runs.append([[round(o_["x"] - 0.36, 3), round(top_, 3), z_, w_, 0, 0.0], [round(o_["x"] - 0.7, 3), round(top_ - 0.03, 3), z_, w_, 1, 0.0],
                         [round(o_["x"] - 1.05, 3), o_["river"], z_, w_ + 0.15, 1, 1.0], [round(o_["x"] - 2.3, 3), o_["river"], round(z_ + 0.3, 3), w_ + 0.5, 0, 0.8]])
        else:
            n_ = max(3, int((o_["x"] - o_["xFoot"]) / 0.7))
            sl_ = (o_["bed"] - o_["river"]) / max(o_["x"] - o_["xFoot"], 1e-3)      # (steep down the bank, gentle across a bar)
            f0_, f1_ = min(0.35, 0.15 + sl_), min(0.75, 0.25 + 1.6 * sl_)
            ch_run = []
            for k_ in range(n_ + 1):
                t_ = k_ / n_
                x_ = o_["x"] + (o_["xFoot"] - o_["x"]) * t_
                y_ = (o_["bed"] + depth_ * 0.45) * (1 - t_) + (o_["river"] + 0.03) * t_
                ch_run.append([round(x_, 3), round(y_, 3), z_, w_, 0, round(f0_ + (f1_ - f0_) * t_, 2)])
            ch_run += [[round(o_["xFoot"] - 0.8, 3), o_["river"], z_, w_ + 0.3, 0, round(f1_, 2)], [round(o_["xFoot"] - 2.2, 3), o_["river"], round(z_ + 0.3, 3), w_ + 0.6, 0, round(f1_ * 0.6, 2)]]
            runs.append(ch_run)
    return runs
for st in streams:
    hp_ = st["hill"]
    zc_ = st["z"]
    brook = [[round(float(x_), 2), round(float(b_), 3), round(float(z_), 2)] for (x_, z_), b_ in zip(hp_, st["bed"])]
    runs = [_brook_water(st)] + _channel_water(st["profile"], st["chan_drops"], st["chan_chutes"], zc_, STREAM_W / 2 - 0.03, 0.2, st["covers"], st["x_levee"], st["chan_outlet"])
    stream_meta.append({"name": st["name"], "z": zc_, "brook": brook, "width": STREAM_W,
                        "drops": [[*map(lambda v_: round(float(v_), 3), (np.interp(p_, st["s"], hp_[:, 0]), np.interp(p_, st["s"], hp_[:, 1]), u_, d_)), k_]
                                  for p_, u_, d_, k_ in st["drops"]],
                        "channel": {"x0": round(st["x_out"], 2), "x1": round(st["x_levee"], 2), "xRiver": round(st["x_riv"], 2), "bed0": st["bed0"], "bed1": st["bed1"], "tops": st["tops"],
                                    "profile": st["profile"], "drops": st["chan_drops"], "chutes": st["chan_chutes"], "outlet": _chute_tops(st["chan_outlet"], STREAM_W / 2)},
                        "covers": [{"kind": k_, "x0": round(a_, 2), "x1": round(b_, 2)} for k_, a_, b_ in st["covers"]],
                        "dams": _dams(st), "roadY": round(road_level(zc_), 3), "water": runs})
for _k, _dt in enumerate(irr_ditches):
    runs = [[]] + _channel_water(_dt["profile"], _dt["drops"], _dt["chutes"], _dt["z"], round(IRR_DITCH_W / 2 - 0.02, 3), 0.12, _dt["covers"], _dt["x1"], _dt["outlet"])
    stream_meta.append({"name": f"ditch-{_k}", "kind": "ditch", "z": _dt["z"], "brook": [], "width": IRR_DITCH_W,
                        "channel": {"x0": round(_dt["x0"], 2), "x1": round(_dt["x1"], 2), "xRiver": round(_dt["xr"], 2), "bed0": _dt["bed0"], "bed1": _dt["bed1"], "tops": _dt["tops"],
                                    "profile": _dt["profile"], "drops": _dt["drops"], "chutes": _dt["chutes"], "outlet": _chute_tops(_dt["outlet"], IRR_DITCH_W / 2)},
                        "covers": [{"kind": k_, "x0": round(a_, 2), "x1": round(b_, 2)} for k_, a_, b_ in _dt["covers"]],
                        "intoCanal": bool(_dt["into_canal"]), "water": runs})
for st in west_brooks:
    hp_ = st["hill"]
    brook = [[round(float(x_), 2), round(float(b_), 3), round(float(z_), 2)] for (x_, z_), b_ in zip(hp_, st["bed"])]
    stream_meta.append({"name": st["name"], "kind": "brook", "z": st["z"], "brook": brook, "width": STREAM_NAT * 2,
                        "drops": [[*map(lambda v_: round(float(v_), 3), (np.interp(p_, st["s"], hp_[:, 0]), np.interp(p_, st["s"], hp_[:, 1]), u_, d_)), k_]
                                  for p_, u_, d_, k_ in st["drops"]],
                        "dams": _dams(st), "water": [_brook_water(st)],
                        **({"outlet": {k_: (round(v_, 3) if isinstance(v_, float) else v_) for k_, v_ in st["outlet"].items()}} if st.get("outlet") else {})})
canal_meta = []
for _c in canals:
    _p = _c["pts"]
    _meta = {"name": _c["name"], "from": _c["stream"], "width": CANAL2_W, "depth": CANAL2_D, "wallTop": CANAL2_TOP,
             **({"contour": True} if _c.get("contour") else {}),
             "points": [[round(float(q[0]), 3), round(float(q[2]), 3), round(float(q[1]), 3), CANAL2_W, int(q[3])] for q in _p],
             "format": "[x, waterY, z, width, cover]", "covers": "0 open, 1 pipe under the prefectural road, 2 slab where a lane or farm road crosses"}
    if "intake" in _c:
        _xi, _zi, _by, _crest = _c["intake"]
        _hp = next(s_ for s_ in streams + west_brooks if s_["name"] == _c["stream"])["hill"]
        _j = int(np.argmin(np.hypot(_hp[:, 0] - _xi, _hp[:, 1] - _zi)))
        _a, _b = _hp[max(_j - 2, 0)], _hp[min(_j + 2, len(_hp) - 1)]
        _meta["intake"] = {"x": round(_xi, 2), "z": round(_zi, 2), "bedY": round(_by, 3), "crestY": round(_crest, 3),
                           "dir": [round(float(_b[0] - _a[0]), 3), round(float(_b[1] - _a[1]), 3)]}
    else:
        _meta["branchOf"] = _c["branch_of"]                         # split off another canal at a diversion box
    canal_meta.append(_meta)

# The terrace scarps for the map (a cliff-of-earth line, ticks towards the floodplain): the line
# half way up each face, where the face stands at least 1.2 m.
def _scarp_lines():
    out = []
    # (rise_len: the run of the face to look across; max_h: a bigger rise than this is the hillside, not
    # a terrace scarp)
    for side, toe, level, rise_len, min_h, max_h in ((1.0, _toe_e, "main", 8.5, 2.0, 10.0), (-1.0, _toe_w, "main", 8.5, 2.0, 10.0),
                                                     (1.0, _toe2_e, "middle", 3.5, 0.55, 4.0), (-1.0, _toe2_w, "middle", 3.5, 0.55, 4.0)):
        mh_ = _mh_e if side > 0 else _mh_w
        cur = []
        def _flush():
            if len(cur) > 3:
                out.append({"side": "east" if side > 0 else "west", "level": level, "points": list(cur)})
            cur.clear()
        for z_ in np.arange(-HALF + 20.0, HALF - 20.0, 3.0):
            t_ = float(np.interp(z_, _lt_z, toe))
            if (level == "middle" and float(np.interp(z_, _lt_z, mh_)) < 0.5) or abs(t_) > HALF - 20:
                _flush()
                continue
            low_ = float(np.mean([sample(t_ - side * d_, z_) for d_ in (1.5, 2.5, 3.5)]))
            xs_ = t_ + side * np.arange(-4.0, rise_len + 3.0, 0.5)
            ys_ = np.array([sample(x_, z_) for x_ in xs_])
            top_ = float(ys_[-5:].max())
            mid_ = np.nonzero(ys_ > low_ + 0.5 * (top_ - low_))[0]
            if min_h < top_ - low_ < max_h and len(mid_):
                cur.append([round(float(xs_[mid_[0]]), 2), round(float(z_), 2)])
            else:
                _flush()
        _flush()
    return out
SCARPS = _scarp_lines()
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

# A water link is a little channel cut along a straight line from its source to the field. Where its
# source lies down in a brook's gully, the line crosses open air above the gully floor before it meets
# the bank: drawn there it was a plank hanging over the stream. The drawn channel starts and ends
# where the line is in the ground (the water reaches it through the bank).
for _lk in irrigation["links"]:
    if _lk.get("covered"):
        continue
    (_ax, _ay, _az), (_bx, _by, _bz) = _lk["points"]
    _L = math.hypot(_bx - _ax, _bz - _az)
    _ts = np.linspace(0.0, 1.0, max(3, int(_L * 4)))
    # (in its cut: the bed under the line, and the ground a metre to either side above the water,
    # so the strip lies between two banks and never hangs over a slope)
    _nx, _nz = -(_bz - _az) / max(_L, 1e-6), (_bx - _ax) / max(_L, 1e-6)
    _in = [sample(_ax + (_bx - _ax) * t_, _az + (_bz - _az) * t_) >= _ay + (_by - _ay) * t_ - 0.22
           and min(sample(_ax + (_bx - _ax) * t_ + sd_ * _nx, _az + (_bz - _az) * t_ + sd_ * _nz) for sd_ in (-1.0, 1.0)) >= _ay + (_by - _ay) * t_ - 0.03
           for t_ in _ts]
    # the longest stretch that lies in its cut; what crosses open air is not drawn
    _best, _run0 = (0, -1), None
    for _k, _v in enumerate(_in + [False]):
        if _v and _run0 is None:
            _run0 = _k
        elif not _v and _run0 is not None:
            if _k - 1 - _run0 > _best[1] - _best[0]:
                _best = (_run0, _k - 1)
            _run0 = None
    _ta, _tb = (_ts[_best[0]], _ts[_best[1]]) if _best[1] >= 0 else (0.0, 0.0)
    if (_tb - _ta) * _L < 1.0:
        _lk["covered"] = True                                   # (a pipe: nothing to draw)
        continue
    _lk["points"] = [[round(_ax + (_bx - _ax) * t_, 3), round(_ay + (_by - _ay) * t_, 3), round(_az + (_bz - _az) * t_, 3)] for t_ in (_ta, _tb)]
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
    "channelMask": {"file": "channels.png", "range": CHAN_RANGE, "openBelow": round(CANAL2_W / 2 + 0.02, 3),
                    "encoding": "distance (m) from each texel centre to the nearest open stretch of a brook-fed canal = value/255*range; row 0 is the north edge, texel extent/4096; the ground is drawn open where the distance is below openBelow (the heightfield closes over the channel at the wall tops)"},
    "environment": {"date": "1994-08-08", "latitude": 38.32, "longitude": 141.02, "timezone": 9, "defaultTime": 18.0,
                    "timeRange": [17.0, 19.0], "sky": "assets/sky/kloppenheim_06_puresky", "notes": "Sun position from a standard solar position algorithm (NOAA approximation)."},
    "landmarks": landmarks,
    "stair": {"axis": "+X", "z": STAIR_Z, "x0": STAIR_X0, "x1": round(STAIR_X1, 3), "footY": FOOT_Y, "topY": TOP_Y,
              "rise": RISE, "tread": TREAD, "steps": STEPS, "flight": FLIGHT, "landing": LANDING, "width": STAIR_W},
    "precinct": PRECINCT,
    "steps": steps,
    "objects": objects,
    "fields": fields,
    "irrigation": irrigation,
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
                for i, ln in enumerate(lanes)]
             + [{"id": r["id"], "class": r["kind"], "width": 3.6, "surface": "gravel", "access": "vehicle",
                 "passingPlace": ([r["passingPlace"][0], r["passingPlace"][2], r["passingPlace"][1]] if r.get("passingPlace") else None),
                 "points": [[round(x, 2), round(sample(x, z), 3), round(z, 2)] for x, z in r["pts"]]} for r in rural_roads],
    "ruralLoops": [
        {"id": "east", "roads": ["miyazawa-farm", "east-forest", "minamizawa-farm"], "returnVia": "village-road"},
        {"id": "north", "roads": ["okusawa-farm", "north-forest"], "returnVia": "village-road"},
        {"id": "kawamuko", "roads": ["kawamuko-north-farm", "kawamuko-contour-farm", "kawamuko-south-farm"], "returnVia": "town-kawamuko-north"}],
    "hamlets": [{"name": n, "z": cz, "halfLength": hl} for n, cz, hl, *_ in HAMLETS] + [{"name": "kawamuko", "z": 243.0, "halfLength": 98.0},
                                                                                      {"name": "machi", "z": sum(MACHI_Z) / 2, "halfLength": (MACHI_Z[1] - MACHI_Z[0]) / 2}],
    "powerLine": {"poles": poles, "wires": 3, "sag": 0.6},
    "tunnel": TUNNEL,
    "temple": {"x": round(TEMPLE["x"], 2), "y": TEMPLE["y"], "z": TEMPLE["z"], "yaw": round(TEMPLE["yaw"], 4), "halfWidth": TEMPLE["hw"], "halfDepth": TEMPLE["hd"]},
    "terrace": {"drop": [round(float(river_drop(_lt_z).min()), 2), round(float(river_drop(_lt_z).max()), 2)], "scarps": SCARPS,
                "note": "the river's floodplain (low terrace) lies 2.2-3.3 m below the paddy floor (drop: range); in places a middle terrace stands between them. scarps: the line half way up each terrace scarp, x/z, level main|middle, ticks towards the river"},
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

# ---- The land beyond the map -----------------------------------------------------------------
_tick('The land beyond the map')
# The whole catchment of the river, 14 km square, grown around the map by the same erosion as its
# hills (tools/world/beyond.py): the river's valley runs on north to where it forks and south down a
# winding gorge, tributaries come in from both sides, the high ground stands to the north-west and
# south-west. "mid" is the 4.8 km square around the map at 6.25 m, "far" the 14 km sheet at 18 m.
import beyond  # noqa: E402
_bw = beyond.build(beyond_inputs(hq), ROOT / ".cache", log=print)
MID_MIN, MID_RANGE = -40.0, 1000.0
Image.fromarray(np.rint(np.clip((_bw["mid"] - MID_MIN) / MID_RANGE, 0, 1) * 65535).astype(np.uint16)).save(OUT / "mid-heightmap.png")
# land cover of the square: R = wooded hillside, G = open valley floor (fields beyond the map)
Image.fromarray(np.uint8(np.rint(_bw["cover"] * 255)), "RGB").save(OUT / "mid-cover.png")
Image.fromarray(np.rint(np.clip((_bw["far"] - beyond.FAR_MIN) / beyond.FAR_RANGE, 0, 1) * 65535).astype(np.uint16)).save(OUT / "far-heightmap.png")
meta_far = {"file": "far-heightmap.png", "resolution": beyond.FAR_N, "extent": beyond.FAR_EXTENT,
            "minHeight": beyond.FAR_MIN, "range": beyond.FAR_RANGE, "meshStride": 2,
            "mid": {"file": "mid-heightmap.png", "cover": "mid-cover.png", "resolution": beyond.MID_N, "extent": beyond.MID_EXTENT,
                    "minHeight": MID_MIN, "range": MID_RANGE},
            "note": "The river's whole catchment around the map, grown by stream-power erosion (tools/world/beyond.py). "
                    "Far: the 14 km sheet (the mesh takes every meshStride-th sample). Mid: the 4.8 km square around the map. "
                    "The map itself is covered by the detailed terrain."}
(OUT / "far-terrain.json").write_text(json.dumps(meta_far, indent=1))

counts = {k: len(v) for k, v in trees.items()}
print(f"terrain {N}x{N}, houses {len(houses)}, fields {len(fields)}, trees {counts}, clutter {{k: len(v) for k,v in clutter.items()}}")
print("clutter", {k: len(v) for k, v in clutter.items()}, "objects", len(objects))
