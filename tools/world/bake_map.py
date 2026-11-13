"""Bake the village map (minimap and full map) from the generated world.

Draws a topographic sheet in the manner of a 1:25,000 Japanese survey map of the period: brown
contours (10 m, every 50 m bold), blue water, land-use tints with their symbols (rice paddy, field,
conifer / broadleaf / bamboo woods), roads by class (the prefectural road with a yellow fill, town
roads, farm roads, driveways, the tunnel dashed), buildings as dark footprints (concrete ones grey)
and point symbols (shrine, post office, police box). Text is not baked: map.json lists the names and
their positions, and src/ui/map.ts letters them at screen resolution.

Reads public/world/{scene.json, heightmap.r16, splat*.png, vegetation-mask.png, vegetation.json} and
public/assets/models/architecture/index.json (run after generate_world.py and build.mjs).
Writes public/world/map.webp and public/world/map.json.
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
W_ = ROOT / "public/world"
scene = json.loads((W_ / "scene.json").read_text())
index = json.loads((ROOT / "public/assets/models/architecture/index.json").read_text())["assets"]
veg = json.loads((W_ / "vegetation.json").read_text())

EXT = scene["extent"]
NG = scene["resolution"]
CELL = EXT / (NG - 1)
R = 2560                     # map pixels
S = R / EXT                  # px per metre
SS = 2                       # supersampling of the vector layer
enc = scene["heightEncoding"]
H = np.fromfile(W_ / "heightmap.r16", dtype="<u2").reshape(NG, NG).astype(np.float64) / 65535 * enc["range"] + enc["minHeight"]

# pixel centres -> heightmap grid coordinates
g = (np.arange(R) + 0.5) / S / CELL
GZ, GX = np.meshgrid(g, g, indexing="ij")
X = (np.arange(R) + 0.5) / S - EXT / 2
Z = X.copy()
XX, ZZ = np.meshgrid(X, Z)


def resample(a, order=1):
    return ndimage.map_coordinates(a, [GZ, GX], order=order, mode="nearest")


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


h = resample(H, 3)
splat = [np.asarray(Image.open(W_ / f"splat{i}.png")).astype(np.float64) / 255 for i in range(3)]
vm = np.asarray(Image.open(W_ / "vegetation-mask.png")).astype(np.float64) / 255
layers = scene["splat"]["layers"]
lw = {}
for i, name in enumerate(layers):
    lw[name] = resample(splat[i // 4][..., i % 4])
forest = resample(vm[..., 0])
rice = resample(vm[..., 2]) > 0.5
paddy_any = resample((vm[..., 1] > 0).astype(np.float64)) > 0.5

# ---- water mask (river surface rows: [x, waterY, z, widthX, ...])
rp = np.array(scene["river"]["points"])
order_ = np.argsort(rp[:, 2])
rp = rp[order_]
rxc = np.interp(Z, rp[:, 2], rp[:, 0])
rw = np.interp(Z, rp[:, 2], rp[:, 3])
ry = np.interp(Z, rp[:, 2], rp[:, 1])
water_d = (rw[:, None] / 2) - np.abs(XX - rxc[:, None])      # >0 inside the bed, metres
# only the wetted channel is water: the gravel bars beside it are land, as on a survey sheet
water = (water_d > 0) & (h < ry[:, None] - 0.01)
water = ndimage.binary_opening(water, iterations=1) | ((water_d > 0) & (h < ry[:, None] - 0.3))

# ---- colours (linear blend in sRGB is fine for flat tints)
def rgb(hexs):
    hexs = hexs.lstrip("#")
    return np.array([int(hexs[i:i + 2], 16) for i in (0, 2, 4)], np.float64) / 255

img = np.ones((R, R, 3)) * rgb("#f3eedd")
# faint paper grain
rng = np.random.default_rng(1994)
grain = ndimage.gaussian_filter(rng.normal(0, 1, (R // 4, R // 4)), 1.2)
grain = np.kron(grain, np.ones((4, 4)))[:R, :R]
img *= (1 + 0.012 * grain)[..., None]


def tint(mask, col, k=1.0):
    global img
    m = np.clip(mask, 0, 1)[..., None] * k
    img = img * (1 - m) + rgb(col) * m


tint(smoothstep(0.25, 0.6, forest), "#dfe6cb", 0.85)
tint(paddy_any.astype(float), "#eaedcf", 0.9)
tint(lw.get("furrows", 0) > 0.45, "#efe4c9", 0.9)
tint(np.clip(lw.get("riverbed", 0) + lw.get("bar", 0), 0, 1), "#e6e3d8", 0.8)
tint(lw.get("gravel", 0), "#ebe5d4", 0.7)
tint(water.astype(float), "#b9d9ec", 1.0)

# ---- hillshade (light from the north-west), stronger on the hills than on the valley floor
gy, gx = np.gradient(h, 1 / S)
az, alt = math.radians(315), math.radians(42)
lx, lz_, ly = math.sin(az) * math.cos(alt), -math.cos(az) * math.cos(alt), math.sin(alt)
nrm = np.sqrt(gx * gx + gy * gy + 1)
shade = (-gx * lx - gy * lz_ + ly) / nrm
shade = np.clip(shade / ly, 0.0, 1.4)
hs = 1 - 0.23 * (1 - np.clip(shade, 0, 1)) + 0.06 * np.clip(shade - 1, 0, 0.4)
hs = np.where(water, 1.0, hs)
img *= hs[..., None]

# ---- contours: anti-aliased by distance to the iso-level in pixels
grad_px = np.maximum(np.hypot(gx, gy) / S, 0.004)          # metres of height per pixel
def contour(step, half_w, col, alpha):
    global img
    f = h / step
    dist_m = np.abs(f - np.round(f)) * step
    dpx = dist_m / grad_px
    a = np.clip(half_w + 0.5 - dpx, 0, 1) * alpha
    a = np.where(water | (np.hypot(gx, gy) < 0.02), 0, a)     # nothing on water or dead-flat paddies
    img = img * (1 - a[..., None]) + rgb(col) * a[..., None]

contour(10.0, 0.45, "#b8865a", 0.75)
contour(50.0, 0.9, "#9c6a40", 0.9)

base = Image.fromarray(np.uint8(np.clip(img, 0, 1) * 255), "RGB")

# ---- vector layer
V = Image.new("RGBA", (R * SS, R * SS), (0, 0, 0, 0))
dr = ImageDraw.Draw(V)
K = S * SS
def P(x, z):
    return ((x + EXT / 2) * K, (z + EXT / 2) * K)
def px(m):            # metres -> vector px
    return max(1, int(round(m * K)))

# symbols on a staggered grid (rice, fields, woods)
sym_paddy = (110, 140, 90, 255)
sym_wood = (106, 128, 86, 255)
def grid_points(step):
    pts = []
    for j, y in enumerate(np.arange(step / 2, R, step)):
        off = (step / 2) if j % 2 else 0
        for x in np.arange(step / 4 + off, R, step):
            pts.append((x, y))
    return pts
def at(arr, x, y):
    i, j = int(y), int(x)
    if 0 <= i < R and 0 <= j < R:
        return arr[i, j]
    return 0
road_pts = np.array(scene["roads"][0]["points"])
house_xy = np.array([o["position"][::2] for o in scene["objects"] if not o["asset"].startswith("prop")]) if scene["objects"] else np.zeros((0, 2))
bld_tree = cKDTree(house_xy)
for (x, y) in grid_points(20):
    if all(at(rice, x + dx, y + dy) for dx, dy in ((0, 0), (-5, -5), (5, 5), (-5, 5), (5, -5))):
        cx, cy = x * SS, y * SS
        for dx in (-2.4, 2.4):
            dr.line([(cx + dx * SS / 2, cy - 7), (cx + dx * SS / 2, cy + 7)], fill=sym_paddy, width=2)
furrow = lw.get("furrows", np.zeros((R, R)))
for (x, y) in grid_points(16):
    if at(furrow, x, y) > 0.5 and at(furrow, x + 4, y + 4) > 0.5 and at(furrow, x - 4, y - 4) > 0.5:
        cx, cy = x * SS, y * SS
        dr.line([(cx - 6, cy - 6), (cx, cy + 6), (cx + 6, cy - 6)], fill=(150, 120, 80, 255), width=2)
kinds = []
pts = []
for sp, rows in veg["trees"].items():
    for r_ in rows:
        pts.append((r_[0], r_[2]))
        kinds.append(sp)
ttree = cKDTree(np.array(pts))
CONIFER = {"sugi", "hinoki", "akamatsu"}
for (x, y) in grid_points(32):
    if at(forest, x, y) < 0.45 or at(water, x, y):
        continue
    wx, wz = x / S - EXT / 2, y / S - EXT / 2
    d, k = ttree.query((wx, wz))
    if d > 9:
        continue
    if bld_tree.query((wx, wz))[0] < 9:
        continue
    sp = kinds[k]
    cx, cy = x * SS, y * SS
    if sp in CONIFER:          # 針葉樹林: an upward chevron on a stem
        dr.line([(cx - 6, cy + 3), (cx, cy - 7), (cx + 6, cy + 3)], fill=sym_wood, width=2)
        dr.line([(cx, cy - 6), (cx, cy + 7)], fill=sym_wood, width=2)
    elif sp == "bamboo":       # 竹林: a little crossed stalk
        dr.line([(cx, cy - 7), (cx, cy + 7)], fill=sym_wood, width=2)
        dr.line([(cx - 6, cy - 2), (cx + 6, cy - 2)], fill=sym_wood, width=2)
        dr.line([(cx - 4, cy + 4), (cx + 4, cy + 4)], fill=sym_wood, width=2)
    else:                      # 広葉樹林: a circle with a short tail
        dr.ellipse([cx - 5, cy - 7, cx + 5, cy + 3], outline=sym_wood, width=2)
        dr.line([(cx + 2, cy + 2), (cx + 5, cy + 7)], fill=sym_wood, width=2)

# river edges, revetments, levee path, canal
blue = (70, 125, 175, 255)
# the water's edge
edge_px = water & ~ndimage.binary_erosion(water)
eyy, exx = np.nonzero(edge_px)
for yy_, xx_ in zip(eyy, exx):
    dr.point((int(xx_), int(yy_)), fill=blue)
bed = scene["river"]["bed"]
bp = np.array(bed["points"])
# revetments (walls) only where the bank is built up; natural earth banks are left to the hillshade
for side, ei in ((-1, 6), (1, 7)):
    run = []
    for p in bp:
        if p[ei] < 0.5:
            run.append(P(p[0] + side * (p[2] + bed["wallRun"]), p[1]))
        elif run:
            if len(run) > 1:
                dr.line(run, fill=(110, 108, 100, 255), width=3)
            run = []
    if len(run) > 1:
        dr.line(run, fill=(110, 108, 100, 255), width=3)
levee = [P(x_, z_) for x_, z_ in bed.get("leveePath", [])]
for a in range(0, len(levee) - 4, 8):         # dashed footpath on the levee
    dr.line(levee[a:a + 5], fill=(90, 80, 70, 255), width=2)
canal = scene["river"]["canal"]["points"]
dr.line([P(p[0], p[2]) for p in canal], fill=blue, width=max(3, px(1.2)))

# canals fed from the side brooks (not where they run in a pipe under the road)
for c_ in scene.get("canals", []):
    run_ = []
    for q_ in c_["points"]:
        if q_[4] == 1:
            if len(run_) > 1:
                dr.line(run_, fill=blue, width=max(3, px(1.2)))
            run_ = []
        else:
            run_.append(P(q_[0], q_[2]))
    if len(run_) > 1:
        dr.line(run_, fill=blue, width=max(3, px(1.2)))

# side streams: the brook and the lined channel
for st in scene.get("streams", []):
    for run in st["water"]:
        dr.line([P(p[0], p[2]) for p in run], fill=blue, width=3)

# roads: casings first, fills second, so junctions read cleanly
CLS = {
    "prefectural": dict(fill=(246, 214, 138, 255), case=(80, 62, 46, 255), w=6.0, cw=2),
    "town": dict(fill=(253, 251, 244, 255), case=(80, 62, 46, 255), w=4.0, cw=2),
    "approach": dict(fill=(253, 251, 244, 255), case=(110, 95, 80, 255), w=3.6, cw=2),
    "farm": dict(fill=(253, 251, 244, 255), case=(125, 110, 92, 255), w=3.0, cw=2),
}
roads = scene["roads"]
def poly(r):
    return [P(p[0], p[2]) for p in r["points"]]
for r in roads:
    c = CLS.get(r["class"])
    if c:
        w = max(px(r.get("width", c["w"])), 6) + 2 * c["cw"] * SS // 2
        dr.line(poly(r), fill=c["case"], width=w, joint="curve")
for r in roads:
    if r["class"] == "driveway":
        dr.line(poly(r), fill=(125, 110, 92, 255), width=3)
for r in roads:
    c = CLS.get(r["class"])
    if c:
        w = max(px(r.get("width", c["w"])), 6)
        dr.line(poly(r), fill=c["fill"], width=w, joint="curve")
# the tunnel: dashed casings on through the hill to the map edge, with the portal brackets
tu = scene.get("tunnel")
if tu:
    hw = 3.0 + 0.5
    z = tu["z"]
    seg = []
    while z > -EXT / 2:
        z2 = max(z - 6.0, -EXT / 2)
        for side in (-1, 1):
            xa = tu["x"] + tu["slope"] * (z - tu["z"]) + side * hw
            xb = tu["x"] + tu["slope"] * (z2 - tu["z"]) + side * hw
            if int((tu["z"] - z) / 6.0) % 2 == 0:
                dr.line([P(xa, z), P(xb, z2)], fill=(80, 62, 46, 255), width=2)
        z = z2
    for side in (-1, 1):
        x0 = tu["x"] + side * (hw + 0.2)
        dr.line([P(x0, tu["z"] - 1.5), P(x0, tu["z"]), P(x0 + side * 3.0, tu["z"] + 1.6)], fill=(60, 50, 40, 255), width=4)
# the shrine stair (ishidan): a ladder
st = scene["stair"]
for side in (-1, 1):
    dr.line([P(st["x0"], st["z"] + side * st["width"] / 2), P(st["x1"], st["z"] + side * st["width"] / 2)], fill=(80, 62, 46, 255), width=2)
for x in np.arange(st["x0"], st["x1"], 2.6):
    dr.line([P(x, st["z"] - st["width"] / 2), P(x, st["z"] + st["width"] / 2)], fill=(80, 62, 46, 255), width=2)
# bridge: parapet lines with flared ends over the water
bz = scene["river"]["bridgeZ"]
bo = next((o for o in scene["objects"] if o["asset"] == "bridge"), None)
if bo:
    half = (bo.get("span", 12)) / 2
    for side in (-1, 1):
        zz = bz + side * (bo.get("width", 3.2) / 2 + 0.6)
        x0, x1 = bo["position"][0] - half, bo["position"][0] + half
        dr.line([P(x0 - 1.2, zz + side * 1.2), P(x0, zz), P(x1, zz), P(x1 + 1.2, zz + side * 1.2)], fill=(40, 36, 32, 255), width=3)

# precinct outline
pr = scene["precinct"]
dr.rectangle([P(pr["x0"], pr["z0"]), P(pr["x1"], pr["z1"])], outline=(120, 110, 95, 255), width=2)

# buildings
SKIP = ("prop-", "torii", "toro", "komainu", "sekihi", "jizo", "denchu", "jihanki", "post", "phone-box", "block-wall", "ishigaki",
        "kei-truck", "fence-lookout", "saisen", "ema", "shimenawa-tree", "bench", "bridge", "hinomi", "monohoshi", "tunnel", "road-ditch", "bus-stop",
        "haka", "rokujizo", "tera-sanmon", "tera-shoro")
CONCRETE = {"post-office", "chuzaisho", "nokyo", "nokyo-soko", "shobo-shed", "shinryojo"}
bnum = {}
for o in scene["objects"]:
    a = o["asset"]
    if a.startswith(SKIP) and a != "post-office":
        continue
    if a == "post":
        continue
    bnum[a] = bnum.get(a, -1) + 1
    key = f"{a}_{o.get('variant', 0)}" if a.startswith("minka-") else f"naya_{bnum[a] % 2}" if a == "naya" else a
    info = index.get(key)
    if not info:
        continue
    (x0, _, z0), (x1, _, z1) = info["min"], info["max"]
    sc = o["scale"][0]
    yaw = o["rotation"][1]
    c, s_ = math.cos(yaw), math.sin(yaw)
    inset = 0.4 if a.startswith("minka-") else 0.1      # draw the walls, not the eaves
    corners = []
    for lx, lz in ((x0 + inset, z0 + inset), (x1 - inset, z0 + inset), (x1 - inset, z1 - inset), (x0 + inset, z1 - inset)):
        lx, lz = lx * sc, lz * sc
        corners.append(P(o["position"][0] + lx * c + lz * s_, o["position"][2] - lx * s_ + lz * c))
    if a in CONCRETE:
        dr.polygon(corners, fill=(128, 122, 116, 255), outline=(40, 36, 32, 255), width=3)
    else:
        dr.polygon(corners, fill=(56, 50, 44, 255), outline=(40, 36, 32, 255), width=2)

# point symbols, set beside the building on the side away from the main road
def road_x(z):
    return float(np.interp(z, road_pts[:, 2], road_pts[:, 0]))
def beside(o, dist=13.0):
    x, z = o["position"][0], o["position"][2]
    sgn = 1 if x >= road_x(z) else -1
    return x + sgn * dist, z
ink = (35, 30, 26, 255)
def sym_post(x, z):
    cx, cy = P(x, z)
    r = 13
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ink, width=3)
    dr.line([(cx - 7, cy - 6), (cx + 7, cy - 6)], fill=ink, width=3)
    dr.line([(cx - 7, cy - 1), (cx + 7, cy - 1)], fill=ink, width=3)
    dr.line([(cx, cy - 1), (cx, cy + 8)], fill=ink, width=3)
def sym_police(x, z):
    cx, cy = P(x, z)
    dr.line([(cx - 9, cy - 9), (cx + 9, cy + 9)], fill=ink, width=4)
    dr.line([(cx - 9, cy + 9), (cx + 9, cy - 9)], fill=ink, width=4)
def sym_shrine(x, z):
    cx, cy = P(x, z)
    dr.line([(cx - 15, cy - 11), (cx + 15, cy - 11)], fill=ink, width=4)
    dr.line([(cx - 11, cy - 4), (cx + 11, cy - 4)], fill=ink, width=3)
    for dx in (-7, 7):
        dr.line([(cx + dx, cy - 11), (cx + dx, cy + 12)], fill=ink, width=4)
def sym_temple(x, z):
    # manji, the survey-map symbol of a temple
    cx, cy = P(x, z)
    r = 11
    dr.line([(cx - r, cy), (cx + r, cy)], fill=ink, width=3)
    dr.line([(cx, cy - r), (cx, cy + r)], fill=ink, width=3)
    dr.line([(cx, cy - r), (cx + r, cy - r)], fill=ink, width=3)
    dr.line([(cx + r, cy), (cx + r, cy + r)], fill=ink, width=3)
    dr.line([(cx, cy + r), (cx - r, cy + r)], fill=ink, width=3)
    dr.line([(cx - r, cy), (cx - r, cy - r)], fill=ink, width=3)
def sym_tower(x, z):
    cx, cy = P(x, z)
    dr.line([(cx - 8, cy + 10), (cx, cy - 12), (cx + 8, cy + 10)], fill=ink, width=3)
    dr.line([(cx - 4, cy), (cx + 4, cy)], fill=ink, width=3)

labels = []
spots = []
for o in scene["objects"]:
    a = o["asset"]
    if a == "post-office":
        x, z = beside(o); sym_post(x, z); labels.append({"text": "郵便局", "x": x, "z": z + 9, "kind": "facility"})
    elif a == "chuzaisho":
        x, z = beside(o); sym_police(x, z); labels.append({"text": "駐在所", "x": x, "z": z + 9, "kind": "facility"})
    elif a == "nokyo":
        x, z = beside(o, 16); labels.append({"text": "農協", "x": x, "z": z, "kind": "facility"})
    elif a == "kominkan":
        x, z = beside(o, 15); labels.append({"text": "集会所" if o.get("hall") else "公民館", "x": x, "z": z, "kind": "facility"})
    elif a == "haiden":
        x, z = o["position"][0] + 4, o["position"][2] + 22
        sym_shrine(x, z); labels.append({"text": "熊野神社", "x": x, "z": z + 10, "kind": "facility"})
    elif a == "tera-hondo":
        x, z = o["position"][0] + 16, o["position"][2] + 4
        sym_temple(x, z); labels.append({"text": "瑞雲寺", "x": x + 2, "z": z + 10, "kind": "facility"})
    elif a == "shinryojo":
        x, z = beside(o, 17); labels.append({"text": "診療所", "x": x, "z": z, "kind": "facility"})
    elif a == "hinomi":
        x, z = o["position"][0] + 8, o["position"][2]
        sym_tower(x, z); labels.append({"text": "火の見櫓", "x": x + 2, "z": z + 9, "kind": "facility"})

# spot heights on the summits inside the sheet
mx = ndimage.maximum_filter(h, size=int(140 * S))
cand = np.argwhere((h == mx) & (h > 60))
cand = [(h[i, j], i, j) for i, j in cand if 40 < i < R - 40 and 40 < j < R - 40]
cand.sort(reverse=True)
for hv, i, j in cand:
    x, z = X[j], Z[i]
    if all(math.hypot(x - sx, z - sz) > 180 for _, sx, sz in spots):
        spots.append((hv, x, z))
    if len(spots) >= 7:
        break
for hv, x, z in spots:
    cx, cy = P(x, z)
    dr.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=ink)
    labels.append({"text": f"{hv:.0f}", "x": float(x) + 5, "z": float(z), "kind": "height"})
pre_y = scene["precinct"]["y"]
labels.append({"text": f"{pre_y:.0f}", "x": (pr["x0"] + pr["x1"]) / 2 + 12, "z": pr["z1"] - 6, "kind": "height"})

vec = V.resize((R, R), Image.Resampling.LANCZOS)
out = base.convert("RGBA")
out.alpha_composite(vec)
out = out.convert("RGB")
out.save(W_ / "map.webp", quality=88, method=6)

# ---- names
NAMES = {"kaminosawa": "奥沢", "nakazato": "中里", "miyashita": "宮下", "shimojuku": "下宿", "minamizawa": "南沢", "kawamuko": "川向"}
_machi = next((hm for hm in scene.get("hamlets", []) if hm["name"] == "machi"), None)
groups = {}
for o in scene["objects"]:
    gname = o.get("group")
    if gname:
        groups.setdefault(gname, []).append(o["position"])
for gname, ps in groups.items():
    ps = np.array(ps)
    cx, cz = float(ps[:, 0].mean()), float(ps[:, 2].mean())
    if gname == "machi":
        cz = _machi["z"] if _machi else cz
        labels.append({"text": "上沢", "x": road_x(cz) + 52, "z": cz - 12, "kind": "district"})
    elif gname in NAMES:
        side = -1 if gname == "kawamuko" or cx < road_x(cz) - 10 else 1
        lx = (ps[:, 0].min() - 22) if side < 0 else (ps[:, 0].max() + 22)
        labels.append({"text": NAMES[gname], "x": float(lx), "z": cz, "kind": "hamlet"})
# the river (written down along it, as on a survey sheet), the road shields, the tunnel
for zr in (-300.0, 480.0):
    xr = float(np.interp(zr, rp[:, 2], rp[:, 0]))
    labels.append({"text": "上沢川", "x": xr - 16, "z": zr, "kind": "water", "vertical": True})
for zr in (-330.0, 600.0):
    labels.append({"text": "27", "x": road_x(zr) + 12, "z": zr, "kind": "route"})
if tu:
    labels.append({"text": "上沢隧道", "x": tu["x"] + 20, "z": tu["z"] - 14, "kind": "facility"})
labels.append({"text": "用水路", "x": float(canal[len(canal) // 2][0]) + 9, "z": float(canal[len(canal) // 2][2]), "kind": "water", "vertical": True})

meta = {
    "_doc": "Map sheet for the minimap and the full map: the image covers the playable square (extent), north up; labels are lettered at runtime.",
    "image": "map.webp", "size": R, "extent": EXT,
    "title": "上沢地区", "date": "平成六年八月",
    "labels": [{**l, "x": round(float(l["x"]), 1), "z": round(float(l["z"]), 1)} for l in labels],
}
(W_ / "map.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
print("map", R, "px,", len(labels), "labels,", (W_ / "map.webp").stat().st_size // 1024, "KB")
