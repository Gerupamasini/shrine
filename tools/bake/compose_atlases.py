"""Compose baked CC0 foliage cards into per-species atlases (albedo RGBA + normal).

Atlas layout: 4x4 cells. Each cell's card origin convention is written to
public/assets/foliage/atlases.json (pivot in cell UV, growth direction +U).
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT / ".cache/cards"
OUT = ROOT / "public/assets/foliage"
CELL = 512
rng = np.random.default_rng(808)


def load(name):
    a = Image.open(CARDS / f"{name}-albedo.png").convert("RGBA")
    n = Image.open(CARDS / f"{name}-normal.png").convert("RGBA")
    if a.width != CELL:
        a = a.resize((CELL, CELL), Image.Resampling.LANCZOS)
        n = n.resize((CELL, CELL), Image.Resampling.LANCZOS)
    n.putalpha(a.getchannel("A"))
    return a, n


def rotate_normal(n: Image.Image, deg: float) -> Image.Image:
    """Rotate a tangent-space normal map image and its vectors together."""
    r = n.rotate(deg, resample=Image.Resampling.BICUBIC, expand=False)
    arr = np.asarray(r).astype(np.float32)
    v = arr[..., :3] / 127.5 - 1
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x, y = v[..., 0] * c - v[..., 1] * s, v[..., 0] * s + v[..., 1] * c
    v = np.stack([x, y, v[..., 2]], -1)
    arr[..., :3] = (v + 1) * 127.5
    return Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "RGBA")


def grade(a: Image.Image, mul, lift=0.0, sat=1.0):
    arr = np.asarray(a).astype(np.float32) / 255
    rgb = arr[..., :3]
    g = rgb.mean(-1, keepdims=True)
    rgb = g + (rgb - g) * sat
    rgb = np.clip(rgb * np.array(mul) + lift, 0, 1)
    arr[..., :3] = rgb
    return Image.fromarray(np.uint8(arr * 255), "RGBA")


def paste(dst_a, dst_n, a, n, x, y, scale, deg, shade=1.0):
    size = int(CELL * scale)
    a2 = a.resize((size, size), Image.Resampling.LANCZOS).rotate(deg, resample=Image.Resampling.BICUBIC)
    n2 = rotate_normal(n.resize((size, size), Image.Resampling.LANCZOS), deg)
    if shade != 1.0:
        a2 = grade(a2, (shade, shade, shade))
    ox, oy = int(x - size / 2), int(y - size / 2)
    dst_a.alpha_composite(a2, (ox, oy))
    dst_n.alpha_composite(n2, (ox, oy))


def blob_mask(seed, sx=1.0, sy=1.0, cx=0.5, cy=0.5):
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:CELL, 0:CELL] / CELL
    ang = np.arctan2(yy - cy, xx - cx)
    rad = np.hypot((xx - cx) / sx, (yy - cy) / sy)
    edge = 0.42 + sum(r.uniform(0.02, 0.06) * np.sin(ang * k + r.uniform(0, 6.28)) for k in range(2, 7))
    return np.clip((edge + 0.04 - rad) * 60, 0, 1)


def cluster(sources, count, seed, spread=(0.30, 0.18), scale=(0.55, 0.9), direction=0.0, mul=(1, 1, 1), sat=1.0, flat=False):
    r = np.random.default_rng(seed)
    A = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    Nn = Image.new("RGBA", (CELL, CELL), (128, 128, 255, 0))
    for i in range(count):
        a, n = sources[int(r.integers(0, len(sources)))]
        t = i / max(1, count - 1)
        # back-to-front: early sprays are deeper inside the clump and darker
        shade = 0.62 + 0.38 * t
        if flat:
            deg = direction + r.uniform(-55, 55)
            x = CELL * (0.32 + r.uniform(-0.05, 0.18))
            y = CELL * (0.5 + r.uniform(-0.12, 0.12))
        else:
            deg = direction + r.uniform(-40, 40)
            x = CELL * (0.5 + r.normal(0, spread[0] / 2))
            y = CELL * (0.5 + r.normal(0, spread[1] / 2))
        paste(A, Nn, a, n, x, y, r.uniform(*scale), deg, shade)
    A = grade(A, mul, sat=sat)
    return A, Nn


def atlas(cells, name):
    A = Image.new("RGBA", (CELL * 4, CELL * 4), (0, 0, 0, 0))
    Nn = Image.new("RGBA", (CELL * 4, CELL * 4), (128, 128, 255, 255))
    for i, (a, n) in enumerate(cells[:16]):
        A.paste(a, ((i % 4) * CELL, (i // 4) * CELL))
        n2 = n.copy()
        n2.putalpha(255)
        Nn.paste(n2, ((i % 4) * CELL, (i // 4) * CELL))
    # Dilate colour into transparent texels so mip-maps don't fringe dark/purple.
    arr = np.asarray(A).astype(np.float32)
    alpha = arr[..., 3:4] / 255
    col = arr[..., :3] * alpha
    acc, wsum = col.copy(), alpha.copy()
    for k in [2, 4, 8, 16, 32]:
        acc = np.asarray(Image.fromarray(np.uint8(np.clip(acc / np.maximum(wsum, 1e-3), 0, 255))).filter(ImageFilter.BoxBlur(k))).astype(np.float32) * 0 + acc
        b = Image.fromarray(np.uint8(np.clip(col / np.maximum(wsum, 1e-3) * (wsum > 0.01), 0, 255)))
    fill = np.asarray(Image.fromarray(np.uint8(np.clip(col / np.maximum(alpha, 1e-3), 0, 255))).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    wb = np.asarray(Image.fromarray(np.uint8(alpha[..., 0] * 255)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[..., None] / 255
    fill = fill / np.maximum(wb, 1e-3) * (wb > 0.002)
    rgb = np.where(alpha > 0.5, arr[..., :3], np.clip(fill, 0, 255))
    out = np.concatenate([rgb, arr[..., 3:4]], -1)
    Image.fromarray(np.uint8(np.clip(out, 0, 255)), "RGBA").save(OUT / f"{name}-albedo.png", optimize=True)
    Nn.convert("RGB").save(OUT / f"{name}-normal.png", optimize=True)


def ragged_outline(path: Path, seed=7):
    """Break the smooth envelope of the broadleaf cluster cells (blob_mask) into single leaves.

    The leaves are cut out one by one, but every cluster is clipped by a smooth rounded envelope,
    and at a distance that clean curve is what reads: crowns look like piles of big rounded leaf
    blobs. Leaf-sized bites are taken out of a band along the envelope, more of them towards the
    edge, so the outline becomes a ragged fringe of single leaves and small sprays."""
    from scipy import ndimage as nd
    im = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32)
    a = im[..., 3] / 255
    inside = a > 0.5
    env = nd.binary_fill_holes(nd.binary_closing(inside, structure=np.ones((3, 3)), iterations=6))
    depth = nd.distance_transform_edt(env)
    r = np.random.default_rng(seed)

    def noise(scale):
        n = r.standard_normal((im.shape[0] // scale + 3, im.shape[1] // scale + 3))
        n = nd.zoom(n, scale, order=3)[: im.shape[0], : im.shape[1]]
        return (n - n.mean()) / n.std()

    band = np.clip(26 + 14 * noise(56), 8, 52)   # px in the 2048 atlas (512 per cell)
    t = np.clip(1 - depth / band, 0, 1)          # 1 on the envelope, 0 past the band
    bites = 0.75 * noise(9) + 0.25 * noise(4)    # leaf- and spray-sized holes
    keep = inside & (bites > t * 2.1 - 1.2)
    soft = nd.gaussian_filter(keep.astype(np.float32), 0.5)
    im[..., 3] = np.clip(np.minimum(soft, a) * 255, 0, 255)
    Image.fromarray(np.uint8(im), "RGBA").save(path, optimize=True)
    print("ragged outline", path.name, f"kept {keep.sum() / inside.sum():.2f} of the leaf texels")


def main():
    fir = [load(f"fir-spray-{b}{k}") for b in range(3) for k in range(3)]
    pine = [load(f"pine-spray-{b}{k}") for b in range(3) for k in range(3)]
    # --- needle atlas: sugi clumps (dense, deep green), hinoki fans, sapling views
    sugi_mul, hinoki_mul = (0.62, 0.78, 0.52), (0.58, 0.80, 0.50)
    cells = []
    for i in range(8):
        a, n = cluster(fir, 46 + i % 3 * 6, 100 + i, spread=(0.30, 0.22), scale=(0.34, 0.62), direction=rng.uniform(-15, 15), mul=sugi_mul, sat=0.9)
        m = blob_mask(200 + i, 1.0, 0.86)
        a.putalpha(Image.fromarray(np.uint8(np.asarray(a.getchannel("A")) * m)))
        cells.append((a, n))
    for i in range(4):
        a, n = cluster(fir, 30, 300 + i, scale=(0.4, 0.7), mul=hinoki_mul, sat=0.95, flat=True)
        cells.append((a, n))
    for nm, mul in [("fir-side", sugi_mul), ("fir-rosette", sugi_mul), ("fir-side", hinoki_mul), ("fir-rosette", (0.7, 0.85, 0.55))]:
        a, n = load(nm)
        cells.append((grade(a, mul), n))
    atlas(cells, "needle")
    # --- pine atlas: akamatsu tufts (brighter, yellow-green, long needles)
    cells = []
    for i in range(12):
        a, n = cluster(pine, 22 + i % 4 * 3, 400 + i, spread=(0.26, 0.2), scale=(0.42, 0.75), mul=(0.85, 0.95, 0.68), sat=1.0)
        cells.append((a, n))
    for nm in ["pine-side", "pine-rosette", "pine-side", "pine-rosette"]:
        a, n = load(nm)
        cells.append((grade(a, (0.85, 0.95, 0.68)), n))
    atlas(cells, "pine")
    # --- leaf atlas: broadleaf clusters with organic edges
    leaf = [load(f"leaf-cluster-{k}") for k in range(6)]
    cells = []
    for i in range(16):
        a, n = leaf[i % 6]
        deg = rng.uniform(0, 360)
        a2 = a.rotate(deg, resample=Image.Resampling.BICUBIC)
        n2 = rotate_normal(n, deg)
        m = blob_mask(500 + i, 0.95 + rng.uniform(-0.1, 0.1), 0.85 + rng.uniform(-0.1, 0.1))
        a2.putalpha(Image.fromarray(np.uint8(np.asarray(a2.getchannel("A")) * m)))
        mul = [(0.82, 0.92, 0.62), (0.75, 0.9, 0.55), (0.9, 0.95, 0.6), (0.7, 0.85, 0.55)][i % 4]
        cells.append((grade(a2, mul, sat=0.92), n2))
    atlas(cells, "leaf")
    ragged_outline(OUT / "leaf-albedo.png")
    meta = {
        "cellsPerRow": 4,
        "needle": {"sugi": list(range(0, 8)), "hinoki": list(range(8, 12)), "sapling": [12, 13, 14, 15], "pivot": "cell centre (sugi), left-centre (hinoki fans)"},
        "pine": {"tuft": list(range(0, 12)), "sapling": [12, 13, 14, 15], "pivot": "cell centre"},
        "leaf": {"cluster": list(range(16)), "pivot": "cell centre"},
        "source": "Baked from Poly Haven CC0 models fir_sapling, pine_sapling_small, tree_small_02 (tools/bake/bake-cards.mjs)",
    }
    (OUT / "atlases.json").write_text(json.dumps(meta, indent=1))
    print("atlases written")


if __name__ == "__main__":
    import sys
    if "--ragged-leaf-only" in sys.argv:
        # for a leaf atlas composed before ragged_outline() was part of main(); run once only
        ragged_outline(OUT / "leaf-albedo.png")
    else:
        main()
