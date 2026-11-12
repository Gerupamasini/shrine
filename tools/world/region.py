"""Regional landform model: fluvial erosion of a starting surface (numpy only).

The hills of the map are not noise. A starting surface (broad ridges from noise, the valley
floor, seeded side valleys) is worn down the way real hills are: every cell drains to its lowest
neighbour, the drained area of each cell is accumulated, and the stream-power law lowers channels
in proportion to (area^m * slope) while soil creep (diffusion) rounds the ridges. The result has
what noise cannot give: side valleys (sawa) that branch uphill, spurs between them, concave
stream profiles and convex ridge crests.

Everything is vectorised: flow accumulation and the implicit erosion step are solved with pointer
doubling along the drainage tree (O(log n) passes of gathers / bincounts), so a 769 x 769 grid
runs a step in a fraction of a second.  Results are cached in .cache/ by a hash of the inputs.
"""
from __future__ import annotations
import hashlib, heapq, time
from pathlib import Path
import numpy as np
from scipy import ndimage

_NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def fill_depressions(h: np.ndarray, outlet: np.ndarray, eps: float = 0.004) -> np.ndarray:
    """Priority-flood with a small gradient: every cell gets a downhill path to an outlet cell.
    The edge of the grid is a wall (nothing drains off the map except through outlet cells)."""
    n0, n1 = h.shape
    w = n1 + 2
    flat = np.full((n0 + 2) * w, np.inf)
    flat.reshape(n0 + 2, w)[1:-1, 1:-1] = h
    cl = np.ones((n0 + 2, w), bool)
    cl[1:-1, 1:-1] = outlet
    seeds = np.flatnonzero(cl.reshape(n0 + 2, w)[1:-1, 1:-1].ravel())
    cl[1:-1, 1:-1] |= False
    cl = cl.ravel()
    inner = (np.arange(n0)[:, None] + 1) * w + (np.arange(n1)[None, :] + 1)
    seed_idx = inner.ravel()[seeds]
    heap = [(float(flat[i]), int(i)) for i in seed_idx]
    heapq.heapify(heap)
    offs = [dj * w + di for dj, di in _NB]
    push, pop = heapq.heappush, heapq.heappop
    while heap:
        hc, c = pop(heap)
        for o in offs:
            nb = c + o
            if cl[nb]:
                continue
            cl[nb] = True
            v = flat[nb]
            if v <= hc:
                v = hc + eps
                flat[nb] = v
            push(heap, (v, nb))
    return flat.reshape(n0 + 2, w)[1:-1, 1:-1].copy()


def _receivers(h: np.ndarray, root: np.ndarray, cell: float):
    """Steepest-descent receiver of every cell (index into the flattened grid) and the distance to it."""
    n0, n1 = h.shape
    idx = np.arange(h.size).reshape(h.shape)
    hp = np.pad(h, 1, mode="edge")
    ip = np.pad(idx, 1, mode="edge")
    best = np.zeros(h.shape)
    rec = idx.copy()
    dist = np.full(h.shape, cell)
    for dj, di in _NB:
        d = cell * float(np.hypot(dj, di))
        s = (h - hp[1 + dj:1 + dj + n0, 1 + di:1 + di + n1]) / d
        better = s > best
        best = np.where(better, s, best)
        rec = np.where(better, ip[1 + dj:1 + dj + n0, 1 + di:1 + di + n1], rec)
        dist = np.where(better, d, dist)
    rec = np.where(root, idx, rec)
    return rec.ravel(), dist.ravel()


def _accumulate(rec: np.ndarray, weight: np.ndarray) -> np.ndarray:
    """Sum of `weight` over every cell draining through each cell (pointer doubling on the tree)."""
    n = rec.size
    g = rec.copy()
    g[g == np.arange(n)] = n                 # roots hand their flow to a dummy node
    g = np.append(g, n)
    s = np.append(weight.astype(np.float64), 0.0)
    for _ in range(40):
        add = np.bincount(g, weights=s, minlength=n + 1)
        add[n] = 0.0
        s = s + add
        g = g[g]
        if (g[:n] == n).all():
            break
    return s[:n]


def _implicit_incision(h: np.ndarray, rec: np.ndarray, c: np.ndarray, keep: np.ndarray | None = None) -> np.ndarray:
    """Implicit stream-power step h_i' = (h_i + c_i h'_rec) / (1 + c_i), exact along the drainage tree.
    Cells in `keep` hold their height (they are the local base level of whatever drains through them)."""
    n = rec.size
    root = rec == np.arange(n)
    if keep is not None:
        root = root | keep
    p = np.where(root, h, h / (1 + c))
    q = np.where(root, 0.0, c / (1 + c))
    g = rec.copy()
    for _ in range(40):
        p = p + q * p[g]
        q = q * q[g]
        g = g[g]
        if not q.any():
            break
    return p


def erode(h0: np.ndarray, fixed: np.ndarray, cell: float, *, hard: np.ndarray | None = None,
          uplift: np.ndarray | float = 0.0, steps: int = 200,
          k: np.ndarray | float = 0.2, m: float = 0.45, creep: float = 2.2, talus: float = 0.75, log=print):
    """Evolve `h0` (metres) under uplift, stream incision and soil creep.

    `fixed` cells keep their height and swallow the water (valley floor, neighbouring valleys at
    the edge: the base level everything drains to). `hard` cells keep their height too but pass
    the water on (surfaces designed by hand: streams cross or skirt them). Each step raises the free cells by `uplift`
    (metres; an array shapes the relief: high where the ranges should stand, low on footslopes),
    lowers every cell towards its receiver by the stream-power law (k * area^m * slope, solved
    implicitly so large steps are stable), spreads the soil by a Gaussian of `creep` cells (linear
    diffusion: convex ridges, the spacing of the hollows) and lets slopes steeper than `talus` fail.
    Run long enough, incision balances uplift and the relief is set by uplift / k.
    Returns (height, drained_area_m2).
    """
    t0 = time.time()
    root = fixed.copy()
    h = fill_depressions(h0, root)
    held = root if hard is None else (root | hard)
    hold = h.copy()
    up = np.where(held, 0.0, uplift)
    keep = None if hard is None else hard.ravel()
    kk = (k if np.isscalar(k) else np.asarray(k).ravel())
    cell_area = np.full(h.size, cell * cell)
    area = cell_area.reshape(h.shape)
    for it in range(steps):
        h = h + up
        rec, dist = _receivers(h, root, cell)
        area = _accumulate(rec, cell_area).reshape(h.shape)
        c = kk * area.ravel() ** m / dist
        h = _implicit_incision(h.ravel(), rec, c, keep).reshape(h.shape)
        if creep > 0:
            h = np.where(held, h, ndimage.gaussian_filter(h, creep, mode="nearest"))
        # over-steep slopes fail down to the talus angle (a relaxation, not a cut: no benches)
        lo = ndimage.minimum_filter(h, size=3, mode="nearest")
        excess = np.maximum(h - lo - talus * cell * 1.2, 0)
        h = np.where(held, hold, h - 0.4 * excess)
        if it % 40 == 39:
            log(f"  region: step {it + 1}/{steps}  {time.time() - t0:.1f}s  max {h.max():.0f} m")
    # make sure nothing ponds after the creep
    h = fill_depressions(h, root, eps=0.002)
    rec, dist = _receivers(h, root, cell)
    area = _accumulate(rec, cell_area).reshape(h.shape)
    return h, area


def valley_floors(h: np.ndarray, area: np.ndarray, fixed: np.ndarray, cell: float, *, a_min: float = 3.0e4,
                  width_k: float = 0.045, width_max: float = 34.0, cross: float = 0.035, a_field: float = 0.0):
    """Side valleys get a floor: streams that drain more than a_min m2 have planed their sides back
    to a half width ~ width_k * sqrt(area), leaving a gently dished bottom (the yatsu / sawa floor).
    Returns (height, 0..1 mask of the floors of the valleys that drain more than a_field m2).
    """
    chan = (area > a_min) & ~fixed
    if not chan.any():
        return h, np.zeros(h.shape)
    dist_px, (jy, ix) = ndimage.distance_transform_edt(~chan, return_indices=True)
    d = dist_px * cell
    hc = h[jy, ix]
    w = np.minimum(width_k * np.sqrt(area[jy, ix]), width_max)
    floor = hc + cross * d                      # dished towards the stream
    side = floor + (d - w) * 0.9                # beyond the floor: at most a ~42 degree toe slope
    out = np.where(d < w, np.minimum(h, floor), np.minimum(h, np.maximum(side, floor)))
    out = np.where(fixed, h, out)
    # a pass of smoothing over the edited band so the toe is not a crease
    sm = ndimage.gaussian_filter(out, 0.8, mode="nearest")
    band = (d < w + 3 * cell) & ~fixed
    zone = np.clip((w + cell - d) / (2 * cell), 0, 1) * ~fixed * (ndimage.maximum_filter(area, 5)[jy, ix] > a_field)
    return np.where(band, sm, out), zone


def cached(key_arrays, params: dict, cache_dir: Path, compute, log=print):
    """Run compute() -> dict of arrays, cached on disk by a hash of the inputs and parameters."""
    hsh = hashlib.sha256()
    for a in key_arrays:
        hsh.update(np.ascontiguousarray(a).tobytes())
    hsh.update(repr(sorted(params.items())).encode())
    hsh.update(Path(__file__).read_bytes())
    f = cache_dir / f"region-{hsh.hexdigest()[:16]}.npz"
    if f.exists():
        log(f"  region: cached {f.name}")
        with np.load(f) as z:
            return {k: z[k] for k in z.files}
    out = compute()
    cache_dir.mkdir(parents=True, exist_ok=True)
    for old in cache_dir.glob("region-*.npz"):
        old.unlink()
    np.savez_compressed(f, **out)
    return out


def sampler(field: np.ndarray, extent: float):
    """Bicubic sampler of a square field centred on the origin: f(x, z) for arrays of world coords."""
    n = field.shape[0]
    pre = ndimage.spline_filter(field, order=3, mode="nearest")
    def f(x, z):
        x = np.asarray(x, dtype=np.float64)
        z = np.asarray(z, dtype=np.float64)
        gx = (x / extent + 0.5) * (n - 1)
        gz = (z / extent + 0.5) * (n - 1)
        return ndimage.map_coordinates(pre, [gz, gx], order=3, mode="nearest", prefilter=False)
    return f


def channel_paths(h: np.ndarray, area: np.ndarray, outlet: np.ndarray, cell: float, *, a_mouth: float = 6.0e4,
                  a_head: float = 6.0e3, limit: int = 16):
    """Trunk streams of the side valleys: from every cell that drains more than a_mouth m2 straight
    into an outlet cell, walk upstream along the largest contributor until the drained area falls
    below a_head. Returns a list of arrays [[col, row, height, area], ...] from the mouth upstream,
    largest catchment first."""
    rec, _ = _receivers(h, outlet, cell)
    n = h.size
    a = area.ravel()
    order = np.argsort(a, kind="stable")
    best = np.full(n, -1, np.int64)
    donors = order[rec[order] != order]
    best[rec[donors]] = donors                       # ascending area: the largest donor is written last
    out_flat = outlet.ravel()
    mouths = np.flatnonzero((a > a_mouth) & ~out_flat & out_flat[rec])
    mouths = mouths[np.argsort(-a[mouths])][:limit]
    n1 = h.shape[1]
    hf = h.ravel()
    paths = []
    for c in mouths:
        cells = [int(rec[c]), int(c)]
        cur = int(c)
        while best[cur] >= 0 and a[best[cur]] > a_head:
            cur = int(best[cur])
            cells.append(cur)
        cells = np.array(cells)
        paths.append(np.stack([cells % n1, cells // n1, hf[cells], a[cells]], -1).astype(np.float64))
    return paths
