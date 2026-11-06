"""Convert cached Poly Haven texture sets into the runtime layout.

public/assets/textures/<id>/albedo.jpg   sRGB base colour
public/assets/textures/<id>/normal.jpg   tangent-space normal, OpenGL (+Y) convention
public/assets/textures/<id>/arm.jpg      R = ambient occlusion, G = roughness, B = metalness (glTF ORM)

Also writes derived textures (vermilion paint) and the sky backdrop.
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache/polyhaven"
OUT = ROOT / "public/assets/textures"
SRC = json.loads((ROOT / "tools/assets/sources.json").read_text())


def load(p: Path, size: int, mode="RGB"):
    im = Image.open(p).convert(mode)
    if im.width != size:
        im = im.resize((size, size), Image.Resampling.LANCZOS)
    return im


def process():
    OUT.mkdir(parents=True, exist_ok=True)
    for t in SRC["polyhaven"]["textures"]:
        d = CACHE / "textures" / t["id"]
        res, size = t["res"], t["out"]
        o = OUT / t["id"]
        o.mkdir(exist_ok=True)
        find = lambda k: next(iter(sorted(d.glob(f"{k}_{res}.*"))), None)
        load(find("diff"), size).save(o / "albedo.jpg", quality=90, optimize=True, progressive=True)
        load(find("nor_gl"), size).save(o / "normal.jpg", quality=92, optimize=True)
        arm = find("arm")
        if arm:
            a = load(arm, size)
        else:
            rough = load(find("rough"), size, "L")
            ao = load(find("ao"), size, "L") if find("ao") else Image.new("L", (size, size), 255)
            a = Image.merge("RGB", (ao, rough, Image.new("L", (size, size), 0)))
        a.save(o / "arm.jpg", quality=90, optimize=True)
        print("tex", t["id"], size)
    vermilion()


def vermilion():
    """Weathered shu-nuri (vermilion) paint: hinoki grain under a painted layer.

    Paint mask = luminance of Poly Haven's peeling paint albedo (paint is light,
    bare wood dark). Colour is a measured-looking vermilion, not a pure red."""
    paint = np.asarray(Image.open(OUT / "wood_peeling_paint_weathered/albedo.jpg").convert("L")).astype(float) / 255
    wood = np.asarray(Image.open(OUT / "hinoki_planks/albedo.jpg").convert("RGB").resize((1024, 1024))).astype(float) / 255
    mask = np.clip((paint - 0.32) * 3.2, 0, 1)
    mask = np.clip(mask * 0.85 + 0.25, 0, 1)
    base = np.array([0.66, 0.17, 0.07])
    var = (np.asarray(Image.open(OUT / "hinoki_planks/albedo.jpg").convert("L").resize((1024, 1024))).astype(float) / 255 - 0.5)
    col = base[None, None, :] * (0.88 + var[..., None] * 0.35)
    grime = 0.82 + 0.18 * paint[..., None]
    out = (col * mask[..., None] + wood * 0.55 * (1 - mask[..., None])) * grime
    o = OUT / "vermilion_paint"
    o.mkdir(exist_ok=True)
    Image.fromarray(np.uint8(np.clip(out, 0, 1) ** 1 * 255)).save(o / "albedo.jpg", quality=90)
    Image.open(OUT / "hinoki_planks/normal.jpg").save(o / "normal.jpg", quality=92)
    arm = np.asarray(Image.open(OUT / "hinoki_planks/arm.jpg").convert("RGB").resize((1024, 1024))).astype(float)
    arm[..., 1] = arm[..., 1] * (1 - mask) + (150 + 40 * (1 - paint)) * mask
    Image.fromarray(np.uint8(np.clip(arm, 0, 255))).save(o / "arm.jpg", quality=90)
    print("tex vermilion_paint (derived)")


def read_hdr(path: Path) -> np.ndarray:
    """Minimal Radiance RGBE reader (new-style RLE)."""
    data = path.read_bytes()
    i = data.index(b"\n\n") + 2
    j = data.index(b"\n", i)
    dims = data[i:j].split()
    h, w = int(dims[1]), int(dims[3])
    pos = j + 1
    out = np.zeros((h, w, 4), np.uint8)
    buf = np.frombuffer(data, np.uint8)
    for y in range(h):
        pos += 4  # scanline header 2 2 hi lo
        for c in range(4):
            x = 0
            while x < w:
                n = int(buf[pos]); pos += 1
                if n > 128:
                    n -= 128
                    out[y, x:x + n, c] = buf[pos]; pos += 1
                else:
                    out[y, x:x + n, c] = buf[pos:pos + n]; pos += n
                x += n
    e = out[..., 3].astype(np.float64)
    scale = np.where(e > 0, np.ldexp(1.0, (e - 136).astype(np.int32)), 0)
    return out[..., :3].astype(np.float64) * scale[..., None]


def sky():
    """Upper-hemisphere LDR backdrop + the original 1k HDR for image based light.

    The backdrop stores L * k encoded with a soft shoulder; the runtime multiplies
    by 1/k after decoding. The sun disc itself is clipped and redrawn analytically
    so it can move with the time of day."""
    hid = SRC["polyhaven"]["hdri"][0]["id"]
    o = ROOT / "public/assets/sky"
    o.mkdir(parents=True, exist_ok=True)
    hdr = read_hdr(CACHE / "hdri" / f"{hid}_4k.hdr")
    h, w, _ = hdr.shape
    upper = hdr[: h // 2 + h // 16]  # down to ~11 degrees below the horizon
    lum = upper @ np.array([0.2126, 0.7152, 0.0722])
    sky_level = float(np.percentile(lum, 97.0))
    k = 0.78 / sky_level
    v = upper * k
    v = v / (1 + np.maximum(v - 0.85, 0) * 1.6)  # soft shoulder above 0.85
    srgb = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(np.clip(v, 0, None), 1 / 2.4) - 0.055)
    img = Image.fromarray(np.uint8(np.clip(srgb, 0, 1) * 255))
    img = img.resize((4096, img.height * 4096 // w), Image.Resampling.LANCZOS)
    img.save(o / "backdrop.jpg", quality=88, optimize=True, progressive=True)
    # Sun direction in the source image for the runtime alignment.
    yy, xx = np.unravel_index(np.argmax(lum), lum.shape)
    az = (xx + 0.5) / w * 360.0
    el = 90.0 - (yy + 0.5) / h * 180.0
    import shutil
    shutil.copy(CACHE / "hdri" / f"{hid}_1k.hdr", o / "environment_1k.hdr")
    meta = {"id": hid, "source": f"https://polyhaven.com/a/{hid}", "licence": "CC0 1.0",
            "backdrop": {"file": "backdrop.jpg", "scale": 1 / k, "coverage": [90, -11.25], "encoding": "sRGB, soft shoulder above 0.85"},
            "sourceSunPixelAzimuthDeg": round(az, 2), "sourceSunElevationDeg": round(el, 2),
            "environment": "environment_1k.hdr"}
    (o / "sky.json").write_text(json.dumps(meta, indent=1))
    print("sky", meta)


if __name__ == "__main__":
    import sys
    if "--sky" in sys.argv:
        sky()
    else:
        process()
        sky()
