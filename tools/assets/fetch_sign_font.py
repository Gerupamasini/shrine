"""Fetch the glyphs the shop signs use from Noto Serif JP Bold (SIL Open Font License 1.1).

Reads every sign text in public/world/scene.json and asks the Google Fonts CSS API for a subset
holding exactly those characters, then saves the TrueType file to public/assets/fonts/. Run after
tools/world/generate_world.py whenever a sign text changes.
"""
from __future__ import annotations
import json, re, subprocess, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = json.loads((ROOT / "tools/assets/sources.json").read_text())["googleFonts"][0]
scene = json.loads((ROOT / "public/world/scene.json").read_text())
chars = sorted({c for o in scene["objects"] for s in o.get("signs", []) for c in s["text"] if not c.isspace()} | set("0123456789"))
url = f"https://fonts.googleapis.com/css2?family={SRC['family'].replace(' ', '+')}:wght@{SRC['weight']}&text=" + urllib.parse.quote("".join(chars))
css = subprocess.run(["curl", "-sS", "--fail", "--max-time", "60", url], capture_output=True, text=True, check=True).stdout
font_url = re.search(r"src:\s*url\(([^)]+)\)", css).group(1)
out = ROOT / SRC["out"]
out.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(["curl", "-sS", "--fail", "--max-time", "120", "-o", str(out), font_url], check=True)
# the licence (with the Noto Serif JP copyright notice) is kept in public/assets/fonts/OFL.txt
print("font", out.relative_to(ROOT), out.stat().st_size, "bytes,", len(chars), "glyphs:", "".join(chars))
