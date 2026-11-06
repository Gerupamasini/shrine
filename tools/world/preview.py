"""Top-down preview of the generated world (hillshade + surface + objects)."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
W = ROOT / "public/world"
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs/map-preview.png"
crop = [float(v) for v in sys.argv[2].split(",")] if len(sys.argv) > 2 else None  # x0,z0,x1,z1
meta = json.loads((W / "scene.json").read_text())
N, E = meta["resolution"], meta["extent"]
enc = meta["heightEncoding"]
h = np.fromfile(W / "heightmap.r16", dtype="<u2").reshape(N, N) / 65535 * enc["range"] + enc["minHeight"]
gy, gx = np.gradient(h, E / (N - 1))
light = np.array([-0.6, 0.55, -0.55]); light /= np.linalg.norm(light)
nrm = np.stack([-gx, np.ones_like(h), -gy], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
shade = np.clip(nrm @ light, 0, 1) * 0.75 + 0.25
s0 = np.asarray(Image.open(W / "splat0.png")).astype(float) / 255
s1 = np.asarray(Image.open(W / "splat1.png")).astype(float) / 255
cols = [(110, 140, 70), (60, 80, 45), (150, 125, 90), (120, 120, 115), (95, 130, 50), (90, 120, 150), (200, 200, 190), (70, 70, 72)]
rgb = np.zeros(h.shape + (3,))
for i in range(4):
    rgb += s0[..., i:i + 1] * np.array(cols[i])
    rgb += s1[..., i:i + 1] * np.array(cols[4 + i])
rgb *= shade[..., None]
contour = (np.floor(h / 10) != np.floor(np.roll(h, 1, 0) / 10)) | (np.floor(h / 10) != np.floor(np.roll(h, 1, 1) / 10))
rgb[contour] *= 0.75
img = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)))
d = ImageDraw.Draw(img)
px = lambda x, z: ((x / E + 0.5) * (N - 1), (z / E + 0.5) * (N - 1))
veg = json.loads((W / "vegetation.json").read_text())["trees"]
tc = {"sugi": (20, 50, 25), "hinoki": (40, 70, 30), "akamatsu": (120, 70, 40), "broadleaf": (70, 110, 40), "bamboo": (150, 190, 60), "keyaki": (90, 130, 50)}
for k, arr in veg.items():
    for t in arr:
        x, y = px(t[0], t[2]); r = 1.2 * t[3]
        d.ellipse((x - r, y - r, x + r, y + r), fill=tc[k])
for o in meta["objects"]:
    x, y = px(o["position"][0], o["position"][2])
    r = 4 if o["asset"].startswith("minka") else 2
    d.rectangle((x - r, y - r, x + r, y + r), fill=(230, 60, 40) if o["asset"].startswith("minka") else (240, 220, 40))
for name, l in meta["landmarks"].items():
    x, y = px(l[0], l[2]); d.text((x + 4, y - 4), name, fill=(255, 255, 255))
if crop:
    a = px(crop[0], crop[1]); b = px(crop[2], crop[3])
    img = img.crop((int(a[0]), int(a[1]), int(b[0]), int(b[1]))).resize((1024, int(1024 * (b[1] - a[1]) / (b[0] - a[0]))), Image.NEAREST)
img.save(out)
print("wrote", out)
