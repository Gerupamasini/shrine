"""Download every external source listed in tools/assets/sources.json into .cache/.

Poly Haven files come from the public API (api.polyhaven.com) at the resolution
stated in sources.json. Author names are read from the API so the credit list
is generated, not typed by hand. Nothing here is executed from downloaded data.

Usage: python3 tools/assets/fetch.py [--only textures|models|foliage|hdri|audio]
"""
from __future__ import annotations
import hashlib, json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
SOURCES = json.loads((ROOT / "tools/assets/sources.json").read_text())
UA = "shrine-asset-pipeline/2.0 (one-off licence-checked asset fetch)"


def curl(url: str, out: Path | None = None) -> bytes:
    for attempt in range(5):
        cmd = ["curl", "-sSL", "--fail", "--max-time", "600", "-A", UA, url]
        if out:
            out.parent.mkdir(parents=True, exist_ok=True)
            cmd += ["-o", str(out)]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode == 0:
            return r.stdout
        time.sleep(2 ** attempt)
    raise RuntimeError(f"download failed {url}: {r.stderr.decode()[:200]}")


def api(path: str):
    return json.loads(curl("https://api.polyhaven.com/" + path))


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def fetch_file(url: str, out: Path, record: list, **meta):
    if not out.exists():
        curl(url, out)
    record.append(dict(url=url, file=str(out.relative_to(ROOT)), sha256=sha(out), **meta))


def poly_info(asset_id: str):
    info = api("info/" + asset_id)
    return {"name": info.get("name"), "authors": sorted(info.get("authors", {}).keys()),
            "page": f"https://polyhaven.com/a/{asset_id}"}


def textures(record):
    for t in SOURCES["polyhaven"]["textures"]:
        files = api("files/" + t["id"])
        meta = poly_info(t["id"])
        res = t["res"]
        want = {"Diffuse": "diff", "nor_gl": "nor_gl", "arm": "arm", "Rough": "rough", "AO": "ao", "Displacement": "disp"}
        for key, short in want.items():
            if key not in files or res not in files[key]:
                continue
            fmt = "jpg" if "jpg" in files[key][res] else "png"
            entry = files[key][res][fmt]
            out = CACHE / "polyhaven/textures" / t["id"] / f"{short}_{res}.{fmt}"
            fetch_file(entry["url"], out, record, asset=t["id"], kind="texture", map=short, **meta)
        print("texture", t["id"], flush=True)


def gltf(asset_id: str, res: str, folder: str, record):
    files = api("files/" + asset_id)
    meta = poly_info(asset_id)
    g = files["gltf"][res]["gltf"]
    base = CACHE / "polyhaven" / folder / asset_id
    fetch_file(g["url"], base / Path(g["url"]).name, record, asset=asset_id, kind="model", **meta)
    for rel, inc in g.get("include", {}).items():
        fetch_file(inc["url"], base / rel, record, asset=asset_id, kind="model-include", **meta)
    print(folder, asset_id, flush=True)


def models(record):
    for m in SOURCES["polyhaven"]["models"]:
        gltf(m["id"], "1k", "models", record)


def foliage(record):
    for m in SOURCES["polyhaven"]["foliageSources"]:
        gltf(m["id"], "1k", "foliage", record)


def hdri(record):
    for h in SOURCES["polyhaven"]["hdri"]:
        files = api("files/" + h["id"])
        meta = poly_info(h["id"])
        for res in [h["res"], "1k"]:
            e = files["hdri"][res]["hdr"]
            fetch_file(e["url"], CACHE / "polyhaven/hdri" / f"{h['id']}_{res}.hdr", record,
                       asset=h["id"], kind="hdri", **meta)
        print("hdri", h["id"], flush=True)


def audio(record):
    for a in SOURCES["commons"]["audio"]:
        name = a["title"].split(":", 1)[1].replace(" ", "_")
        fetch_file(a["url"], CACHE / "commons" / name, record, kind="audio",
                   author=a["author"], licence=a["licence"], page=a["page"])
        time.sleep(3)
        print("audio", name, flush=True)


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    manifest_path = CACHE / "fetch-manifest.json"
    record: list = []
    for name, fn in [("hdri", hdri), ("textures", textures), ("models", models), ("foliage", foliage), ("audio", audio)]:
        if only in (None, name):
            fn(record)
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    merged = {r["file"]: r for r in old + record}
    manifest_path.write_text(json.dumps(list(merged.values()), indent=1, ensure_ascii=False))
    print("records", len(merged))
