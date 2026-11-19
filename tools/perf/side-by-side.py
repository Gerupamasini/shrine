"""Before | after pairs:  python3 tools/perf/side-by-side.py <before-dir> <after-dir> <out-dir> [scale]"""
import sys, os
from PIL import Image, ImageDraw
a, b, out = sys.argv[1:4]
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
os.makedirs(out, exist_ok=True)
for name in sorted(os.listdir(a)):
    if not name.endswith(".png") or not os.path.exists(os.path.join(b, name)):
        continue
    A, B = Image.open(os.path.join(a, name)).convert("RGB"), Image.open(os.path.join(b, name)).convert("RGB")
    w, h = int(A.width * scale), int(A.height * scale)
    im = Image.new("RGB", (w * 2 + 6, h), (255, 255, 255))
    im.paste(A.resize((w, h), Image.LANCZOS), (0, 0))
    im.paste(B.resize((w, h), Image.LANCZOS), (w + 6, 0))
    d = ImageDraw.Draw(im)
    for x, t in ((8, "before"), (w + 14, "after")):
        d.rectangle([x - 4, 4, x + 52, 20], fill=(0, 0, 0))
        d.text((x, 6), t, fill=(255, 255, 255))
    im.save(os.path.join(out, name.replace(".png", ".jpg")), quality=88)
    print(name)
