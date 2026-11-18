"""Contour map of the whole terrain: the playable map, the hills around it and the far ranges.

The game draws three height fields, nested:
  * the map itself      heightmap.r16      2.1 km square, 1.17 m cells
  * the hills around it mid-heightmap.png  4.8 km square, 6.25 m cells (1.35 km beyond the map)
  * the far ranges      far-heightmap.png  14 km square, 54.7 m cells
This samples each where the game shows it (the finest one that covers a point), joins them over a
narrow band at the edges, and draws contours over a tint and hillshade. Heights are elevations
(no earth curvature, unlike the far meshes in the game).

  python3 tools/world/contour_map.py [out_dir] [view ...]

views: region (all 14 km, 20 m contours), surroundings (4.8 km, 10 m), map (2.1 km, 5 m).
Default: region and surroundings, written to artifacts/terrain/contours-<view>.webp. Needs matplotlib.
"""
from __future__ import annotations
import io, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager, patheffects
from matplotlib.colors import LinearSegmentedColormap, LightSource, Normalize

ROOT = Path(__file__).resolve().parents[2]
W = ROOT / "public/world"
args = sys.argv[1:]
OUT = Path(args.pop(0)) if args and not args[0] in ("region", "surroundings", "map") else ROOT / "artifacts/terrain"
VIEWS = args or ["region", "surroundings"]

for f in ("/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"):
    if Path(f).exists():
        font_manager.fontManager.addfont(f)
        plt.rcParams["font.family"] = font_manager.FontProperties(fname=f).get_name()
        break

# ---- the three height fields ---------------------------------------------------------------
scene = json.loads((W / "scene.json").read_text())
enc, N, E = scene["heightEncoding"], scene["resolution"], scene["extent"]
H_MAP = np.fromfile(W / enc["file"], dtype="<u2").reshape(N, N) / 65535 * enc["range"] + enc["minHeight"]
fm = json.loads((W / "far-terrain.json").read_text())
mm = fm["mid"]
H_MID = np.asarray(Image.open(W / mm["file"])).astype(float) / 65535 * mm["range"] + mm["minHeight"]
H_FAR = np.asarray(Image.open(W / fm["file"])).astype(float) / 65535 * fm["range"] + fm["minHeight"]
E_MID, E_FAR = mm["extent"], fm["extent"]


def sample(field, extent, x, z, order):
    """Field value at world (x, z); row 0 is the north edge (z = -extent/2), column 0 the west."""
    n = field.shape[0]
    return ndimage.map_coordinates(field, [(z / extent + 0.5) * (n - 1), (x / extent + 0.5) * (n - 1)], order=order, mode="nearest")


def band(x, z, half, width):
    """1 well inside the square of half-size `half`, 0 outside it, linear over `width` inside the edge."""
    return np.clip((half - np.maximum(np.abs(x), np.abs(z))) / width, 0, 1)


def composite(x0, x1, z0, z1, n):
    """Heights on an n x n grid over [x0, x1] x [z0, z1] (row 0 north)."""
    xs, zs = np.linspace(x0, x1, n), np.linspace(z0, z1, n)
    X, Z = np.meshgrid(xs, zs)
    cell = (x1 - x0) / (n - 1)
    h = sample(H_FAR, E_FAR, X, Z, 3)
    w_mid = band(X, Z, E_MID / 2, 40.0)
    if w_mid.any():
        mid = H_MID if cell <= 2 * E_MID / (H_MID.shape[0] - 1) else ndimage.gaussian_filter(H_MID, cell / (E_MID / (H_MID.shape[0] - 1)) / 2.5)
        h = h + (sample(mid, E_MID, X, Z, 1) - h) * w_mid
    w_map = band(X, Z, E / 2, 20.0)
    if w_map.any():
        # anti-alias the detailed map when the grid is coarser than its cells
        src = H_MAP if cell <= 1.5 * E / (N - 1) else ndimage.gaussian_filter(H_MAP, cell / (E / (N - 1)) / 2.5)
        h = h + (sample(src, E, X, Z, 1) - h) * w_map
    return xs, zs, h


# ---- styling ---------------------------------------------------------------------------------
# a quiet hypsometric tint, fixed over 0-850 m so all views agree
TINT = LinearSegmentedColormap.from_list("tint", [
    (0.00, "#e4ecd0"), (0.03, "#d8e6be"), (0.12, "#c9dca8"), (0.25, "#dfdba6"), (0.40, "#e6cf9a"),
    (0.58, "#d9b48a"), (0.76, "#c49a7a"), (0.90, "#b9a194"), (1.00, "#d6d0cc")])
NORM = Normalize(-10, 850)
LINE = "#6e4b2a"
HALO = [patheffects.withStroke(linewidth=2.2, foreground=(1, 1, 1, 0.8))]

VIEW = {
    #               half-size (m), grid, contour, index, shade exaggeration, peak window (m), peaks
    "region":       (7000.0, 2200, 20, 100, 1.4, 900, 14),
    "surroundings": (2400.0, 2400, 10, 50, 1.2, 380, 16),
    "map":          (1050.0, 1793, 5, 25, 1.0, 200, 10),
}
TITLE = {
    "region": "全域の等高線図（14 km 四方・主曲線 20 m・計曲線 100 m）",
    "surroundings": "地図とその周りの山の等高線図（4.8 km 四方・主曲線 10 m・計曲線 50 m）",
    "map": "地図内の等高線図（2.1 km 四方・主曲線 5 m・計曲線 25 m）",
}


def peaks(h, xs, zs, window_m, count, inside=None):
    """The highest local maxima, at least window_m apart: (x, z, height)."""
    cell = xs[1] - xs[0]
    k = max(3, int(window_m / cell) | 1)
    mx = ndimage.maximum_filter(h, size=k, mode="nearest")
    jj, ii = np.nonzero((h == mx) & (h > np.percentile(h, 60)))
    # not on the frame: a maximum there is usually just the slope running out of the view
    m = int(k // 2)
    keep = (ii > m) & (ii < len(xs) - 1 - m) & (jj > m) & (jj < len(zs) - 1 - m)
    cand = sorted(((h[j, i], xs[i], zs[j]) for i, j in zip(ii[keep], jj[keep])), reverse=True)
    out = []
    for y, x, z in cand:
        if inside is not None and not inside(x, z):
            continue
        if all(np.hypot(x - a, z - b) > window_m for a, b, _ in out):
            out.append((x, z, y))
        if len(out) >= count:
            break
    return out


def polyline(points, ix=0, iz=2):
    p = np.asarray([[q[ix], q[iz]] for q in points], float)
    return p[:, 0] / 1000, -p[:, 1] / 1000          # km, north up


def draw(view):
    half, n, step, index, ve, pwin, npk = VIEW[view]
    xs, zs, h = composite(-half, half, -half, half, n)
    km = half / 1000
    ext = (-km, km, -km, km)                           # x east, y north (= -z)
    cell = xs[1] - xs[0]

    fig = plt.figure(figsize=(12.6, 13.4), dpi=200)
    ax = fig.add_axes([0.06, 0.07, 0.88, 0.85])
    ls = LightSource(azdeg=315, altdeg=42)
    rgb = ls.shade(h, cmap=TINT, norm=NORM, vert_exag=ve, dx=cell, dy=cell, blend_mode="soft")
    ax.imshow(rgb, extent=ext, origin="upper", interpolation="bilinear")

    X, Y = np.meshgrid(xs / 1000, -zs / 1000)
    lo, hi = np.floor(h.min() / step) * step, np.ceil(h.max() / step) * step
    levels = np.arange(lo, hi + step, step)
    minor = [l for l in levels if l % index]
    major = [l for l in levels if not l % index]
    ax.contour(X, Y, h, levels=minor, colors=LINE, linewidths=0.28, alpha=0.75)
    cs = ax.contour(X, Y, h, levels=major, colors=LINE, linewidths=0.85)
    lab = ax.clabel(cs, fmt="%d", fontsize=6.2, inline=True, inline_spacing=2, colors=LINE)
    for t in lab:
        t.set_path_effects(HALO)

    # what the game draws at each distance
    def square(s, **kw):
        s /= 1000
        ax.plot([-s, s, s, -s, -s], [-s, -s, s, s, -s], **kw)
    square(E / 2, color="#c0392b", lw=1.6, zorder=5)
    if E_MID / 2 < half:
        square(E_MID / 2, color="#2c3e50", lw=1.0, ls=(0, (6, 4)), zorder=5)

    # river and the prefectural road (inside the map) for orientation
    rx, ry = polyline(scene["river"]["points"])
    ax.plot(rx, ry, color="#2f6fb0", lw=1.4 if view != "region" else 0.9, zorder=4, solid_capstyle="round")
    for r in scene["roads"]:
        if r["class"] == "prefectural" or (view == "map" and r["class"] in ("town", "farm", "forest")):
            px, py = polyline(r["points"])
            ax.plot(px, py, color="#3b3b3b" if r["class"] == "prefectural" else "#7a7a7a",
                    lw=1.0 if r["class"] == "prefectural" else 0.5, zorder=4)
    for s in scene.get("streams", []):
        if len(s.get("brook", [])) > 1:
            px, py = polyline(s["brook"])
            ax.plot(px, py, color="#2f6fb0", lw=0.7, zorder=4)

    def label(x, z, text, size=8, color="#222", weight="normal", **kw):
        t = ax.text(x / 1000, -z / 1000, text, fontsize=size, color=color, weight=weight, zorder=7, **kw)
        t.set_path_effects(HALO)

    # spot heights: the summits of the view (on the map, the shrine too)
    for x, z, y in peaks(h, xs, zs, pwin, npk):
        ax.plot(x / 1000, -z / 1000, marker="^", ms=4.2, color="#5b3a1e", zorder=6)
        label(x, z, f" {y:.0f}", size=6.8, color="#5b3a1e", va="center")

    lm = scene["landmarks"]
    sx, sy = lm["shrine"][0], lm["shrine"][2]
    ax.plot(sx / 1000, -sy / 1000, marker="s", ms=4 if view != "region" else 3, color="#c0392b", zorder=6)
    if view != "region":
        label(sx, sy, "  熊野神社", size=8, color="#c0392b", va="center")
        mapj = json.loads((W / "map.json").read_text())
        for l in mapj["labels"]:
            if l["kind"] in ("hamlet", "district"):
                label(l["x"], l["z"], l["text"], size=9 if l["kind"] == "district" else 7.5, ha="center", va="center")
        label(-205 if view == "map" else -250, -760, "上沢川", size=7.5, color="#2f6fb0", rotation=90, ha="center")
        t = scene["tunnel"]
        label(t["x"], t["z"] - 25, "上沢隧道", size=6.5, color="#3b3b3b", ha="center")
    else:
        label(E / 2 + 60, -E / 2 - 60, "地図（歩ける範囲）2.1 km", size=8, color="#c0392b", va="bottom")
        label(E_MID / 2 + 60, -E_MID / 2 - 60, "周りの山（同じ浸食モデル）4.8 km", size=8, color="#2c3e50", va="bottom")
        label(-half + 250, -half + 300, "遠景の山並み（14 km）", size=9, color="#2c3e50", va="top")
        # the saddle the evening sun shines through (WNW, 286 deg)
        az = np.radians(286.0)
        for r in (3500.0,):
            label(r * np.sin(az), -r * np.cos(az), "夕日の鞍部 →", size=8, color="#8e44ad", ha="center", va="center", rotation=-16)
    if view == "surroundings":
        label(E / 2 - 40, -E / 2 + 40, "地図の範囲 2.1 km", size=7.5, color="#c0392b", ha="right", va="top")

    ax.set_xlim(-km, km)
    ax.set_ylim(-km, km)
    ax.set_xlabel("東西（km、+東）", fontsize=9)
    ax.set_ylabel("南北（km、+北）", fontsize=9)
    ax.tick_params(labelsize=8)
    ax.set_aspect("equal")
    ax.grid(color="#000", alpha=0.08, lw=0.5)
    fig.text(0.06, 0.955, TITLE[view], fontsize=13)
    key = {"region": "赤枠＝地図、破線＝周りの山（その外は遠景の山並み）、青＝上沢川と沢、黒＝県道",
           "surroundings": "赤枠＝地図、外枠＝周りの山の端、青＝上沢川と沢、黒＝県道",
           "map": "青＝上沢川と沢、黒＝県道、灰＝町道・農道・林道"}[view]
    fig.text(0.06, 0.935, f"標高 {h.min():.0f}〜{h.max():.0f} m　原点は地図の中心（石段の西の谷底）。" + key,
             fontsize=8.5, color="#444")

    # scale bar and north arrow
    bar = {"region": 2.0, "surroundings": 1.0, "map": 0.5}[view]
    sax = fig.add_axes([0.06, 0.022, 0.88 * bar / (2 * km), 0.02])
    sax.set_xlim(0, bar)
    sax.set_ylim(0, 1)
    sax.axis("off")
    sax.plot([0, bar], [0.25, 0.25], color="#222", lw=2.4, solid_capstyle="butt")
    for k in np.arange(0, bar + 1e-6, bar / 4):
        sax.plot([k, k], [0.1, 0.4], color="#222", lw=0.8)
    sax.text(bar / 2, 0.55, f"{bar:g} km", fontsize=8, ha="center", va="bottom")
    nx, ny = km - 0.07 * km, km - 0.12 * km
    ax.annotate("", xy=(nx, ny + 0.08 * km), xytext=(nx, ny), arrowprops=dict(arrowstyle="-|>", color="#222", lw=1.4), zorder=8)
    ax.text(nx, ny + 0.09 * km, "N", fontsize=11, ha="center", va="bottom", zorder=8)

    # colour key
    cax = fig.add_axes([0.62, 0.03, 0.32, 0.012])
    sm = plt.cm.ScalarMappable(norm=NORM, cmap=TINT)
    cb = fig.colorbar(sm, cax=cax, orientation="horizontal")
    cb.set_ticks([0, 100, 200, 400, 600, 800])
    cb.ax.tick_params(labelsize=7)
    fig.text(0.61, 0.036, "標高（m）", fontsize=8, ha="right", va="center")

    OUT.mkdir(parents=True, exist_ok=True)
    # lossy WebP at a high quality: a fifth of the PNG's size, and the lines stay clean
    path = OUT / f"contours-{view}.webp"
    buf = io.BytesIO()
    fig.savefig(buf, dpi=200, format="png")
    plt.close(fig)
    Image.open(buf).convert("RGB").save(path, quality=90, method=6)
    print("wrote", path.relative_to(ROOT) if path.is_relative_to(ROOT) else path, f"({h.min():.1f}..{h.max():.1f} m)")


for v in VIEWS:
    draw(v)
