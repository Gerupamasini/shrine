"""Checks on the land beyond the map as delivered (public/world/far-terrain.json and its rasters)."""
import json
import sys
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
W = ROOT / "public/world"
sys.path.insert(0, str(ROOT / "tools/world"))
import region  # noqa: E402

scene = json.loads((W / "scene.json").read_text())
enc, N, E = scene["heightEncoding"], scene["resolution"], scene["extent"]
MAP = np.fromfile(W / enc["file"], dtype="<u2").reshape(N, N) / 65535 * enc["range"] + enc["minHeight"]
meta = json.loads((W / "far-terrain.json").read_text())
mm = meta["mid"]
FAR_RAW = np.asarray(Image.open(W / meta["file"]))
MID_RAW = np.asarray(Image.open(W / mm["file"]))
FAR = FAR_RAW.astype(float) / 65535 * meta["range"] + meta["minHeight"]
MID = MID_RAW.astype(float) / 65535 * mm["range"] + mm["minHeight"]


def sample(field, extent, x, z):
    n = field.shape[0]
    return ndimage.map_coordinates(field, [(np.asarray(z) / extent + 0.5) * (n - 1), (np.asarray(x) / extent + 0.5) * (n - 1)],
                                   order=1, mode="nearest")


class BeyondTests(unittest.TestCase):
    def test_rasters_match_their_description_and_are_not_clipped(self):
        self.assertEqual(FAR.shape, (meta["resolution"],) * 2)
        self.assertEqual(MID.shape, (mm["resolution"],) * 2)
        self.assertEqual((meta["resolution"] - 1) % meta.get("meshStride", 1), 0, "the mesh stride divides the sheet")
        for raw in (FAR_RAW, MID_RAW):
            self.assertGreater(raw.min(), 0)
            self.assertLess(raw.max(), 65535)

    def test_the_square_around_the_map_meets_the_map(self):
        t = np.linspace(-E / 2 + 20, E / 2 - 20, 300)
        h = E / 2 + 4.0                               # just outside the map's edge
        for x, z in ((t, np.full_like(t, -h)), (t, np.full_like(t, h)), (np.full_like(t, -h), t), (np.full_like(t, h), t)):
            d = sample(MID, mm["extent"], x, z) - sample(MAP, E, np.clip(x, -E / 2, E / 2), np.clip(z, -E / 2, E / 2))
            self.assertLess(np.abs(d).mean(), 2.0)
            self.assertLess(np.abs(d).max(), 14.0)

    def test_the_far_sheet_meets_the_square_around_the_map(self):
        t = np.linspace(-mm["extent"] / 2 + 40, mm["extent"] / 2 - 40, 400)
        h = mm["extent"] / 2 - 60.0
        for x, z in ((t, np.full_like(t, -h)), (t, np.full_like(t, h)), (np.full_like(t, -h), t), (np.full_like(t, h), t)):
            d = sample(MID, mm["extent"], x, z) - sample(FAR, meta["extent"], x, z)
            self.assertLess(np.abs(d).mean(), 4.0, "no step where the far mesh takes over")

    def test_the_river_runs_on_to_the_edge_of_the_sheet(self):
        # the lowest ground across the valley, every 200 m south of the map: falling all the way to the
        # sheet's edge, with no wall across the valley (the old ranges stood 250 m high across it)
        zs = np.arange(E / 2 + 100, meta["extent"] / 2 - 50, 200.0)
        xs = np.linspace(-900, 600, 301)
        low = np.array([sample(FAR, meta["extent"], xs, np.full_like(xs, z)).min() for z in zs])
        self.assertLess(np.max(np.diff(low)), 3.0)
        self.assertLess(low[-1], low[0] - 15.0)
        # and north of the map up to the fork, rising gently
        zn = np.arange(-E / 2 - 100, -2300.0, -200.0)
        lown = np.array([sample(FAR, meta["extent"], xs, np.full_like(xs, z)).min() for z in zn])
        self.assertLess(lown.max(), 120.0)

    def test_the_land_drains_to_the_river(self):
        # steepest descent over the sheet (pits filled): most of it reaches the river's valley in the map
        # or below it, not the edges of the sheet
        f = FAR[::2, ::2]
        n = f.shape[0]
        cell = meta["extent"] / (n - 1)
        out = np.zeros(f.shape, bool)
        out[0, :] = out[-1, :] = out[:, 0] = out[:, -1] = True
        hf = region.fill_depressions(f, out)
        rec, _ = region._receivers(hf, out, cell)
        area = region._accumulate(rec, np.full(f.size, cell * cell)).reshape(f.shape)
        river_out = area[-1, :].max()                 # where the river leaves the sheet, south
        self.assertGreater(river_out / (meta["extent"] ** 2), 0.5, "over half the sheet drains to the river")

    def test_the_high_ground_stands_north_west_and_south_west(self):
        a = np.linspace(-meta["extent"] / 2, meta["extent"] / 2, FAR.shape[0])
        X, Z = np.meshgrid(a, a)
        nw = FAR[(X < 0) & (Z < -3000)].max()
        sw = FAR[(X < -2500) & (Z > 3000)].max()
        rest = FAR[(X > 0) | (np.abs(Z) < 3000)].max()
        self.assertGreater(nw, 760)
        self.assertGreater(sw, 720)
        self.assertLess(rest, min(nw, sw))


if __name__ == "__main__":
    unittest.main()
