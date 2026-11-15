"""Long profiles of the side streams and ditches: gentle reaches and drops.

A channel follows the ground at its depth while the ground falls gently. Where it falls faster - a
side valley steepening, the brink of the river terrace, the bank of the river - the fall is taken in
drops, not on a sloping chute: natural steps of boulders over plunge pools in a mountain brook,
concrete drop structures (rakusako) in a lined channel or a field ditch.

Each drop is placed where the target bed (ground minus depth) has fallen to the level of the reach
below the previous drop, so the reach between two drops is level and never stands above its target:
the channel is cut deepest just below a drop (the pool) and shallowest at the lip of the next one.
"""
import math
import numpy as np


def stepped_profile(s, target, heights, gentle=0.02, min_total=0.15, merge=4.0):
    """s: chainage (m), increasing downstream; target: wanted bed level per sample.
    heights(total) -> the drops (m, top first) that take the fall of a steep stretch. Returns (bs, by, drops): the bed as breakpoints (chainage, level) - vertical at
    each drop - and drops as [(chainage, top, bottom), ...]."""
    s = np.asarray(s, dtype=np.float64)
    t = np.minimum.accumulate(np.asarray(target, dtype=np.float64))
    n = len(s)
    steep = np.zeros(n, bool)
    steep[1:] = (t[:-1] - t[1:]) > gentle * np.maximum(np.diff(s), 1e-6)
    sections = []
    i = 1
    while i < n:
        if not steep[i]:
            i += 1
            continue
        a, b = i - 1, i
        while b + 1 < n and steep[b + 1]:
            b += 1
        if sections and s[a] - s[sections[-1][1]] < merge:
            sections[-1] = (sections[-1][0], b)
        else:
            sections.append((a, b))
        i = b + 1
    bed = t.copy()
    drops = []
    for a, b in sections:
        total = t[a] - t[b]
        if total < min_total:
            continue
        ss, tt = s[a:b + 1], t[a:b + 1]
        up, pos = t[a], s[a]
        for hgt in heights(total):
            if up - t[b] <= 1e-4:
                break
            hgt = min(hgt, up - t[b])
            if up - t[b] - hgt < 0.12:          # no sliver of a last step
                hgt = up - t[b]
            down = up - hgt
            drops.append((float(pos), float(up), float(down)))
            # the reach below runs level until the target has come down to it
            nxt = float(np.interp(-down, -tt, ss)) if down > t[b] else float(s[b])
            nxt = max(nxt, pos + 0.6)
            m = (s > pos) & (s <= nxt + 1e-9)
            bed[m] = down
            up, pos = down, nxt
        bed[(s > pos) & (s <= s[b])] = t[b]
    # breakpoints: the samples, with a vertical face at every drop
    bs, by = list(s), list(bed)
    for p, u, d in drops:
        k = int(np.searchsorted(bs, p))
        bs[k:k] = [p - 0.02, p + 0.02]
        by[k:k] = [u, d]
    order = np.argsort(np.array(bs), kind="stable")
    bs, by = np.array(bs)[order], np.array(by)[order]
    by = np.minimum.accumulate(by)
    return bs, by, drops


def equal_drops(step):
    """Drops of one height (no higher than `step`) through each steep stretch: built structures."""
    def heights(total):
        k = max(1, math.ceil(total / step - 1e-6))
        return [total / k] * k
    return heights


def random_drops(rng, lo, hi):
    """Irregular natural steps: boulder lips of lo..hi m."""
    def heights(total):
        out = []
        while sum(out) < total:
            out.append(float(rng.uniform(lo, hi)))
        return out
    return heights


def water_rows(bs, by, drops, at, depth, half, foam_len=3.0, pool_half=None, with_s=False):
    """Water surface rows along a stepped channel: [x, y, z, halfWidth, fall, foam] every breakpoint,
    level over each reach, with the overfall of every drop as a crest row and a foot row.
    at(s) -> (x, z); half: a width or half(s). with_s: also return each row's chainage."""
    rows = []
    for k in range(len(bs)):
        s_ = float(bs[k])
        if any(abs(s_ - p) < 0.05 for p, _, _ in drops):
            continue
        foam = 0.0
        for p, u, d in drops:
            if 0 < s_ - p < foam_len * (1 + (u - d)):
                foam = max(foam, math.exp(-(s_ - p) / (1.2 + u - d)) * min(1.0, 0.35 + (u - d)))
        x, z = at(s_)
        hw = half(s_) if callable(half) else half
        w = hw if pool_half is None else hw + (pool_half - hw) * foam
        rows.append((s_, [x, by[k] + depth, z, w, 0, foam]))
    for p, u, d in drops:
        hw = half(p) if callable(half) else half
        x0, z0 = at(p - 0.03)
        x1, z1 = at(p + 0.12 + 0.15 * (u - d))
        rows.append((p - 0.03, [x0, u + depth, z0, hw, 0, 0.0]))
        rows.append((p - 0.01, [x0, u + depth * 0.7, z0, hw, 1, 0.0]))
        rows.append((p + 0.11 + 0.15 * (u - d), [x1, d + depth, z1, hw, 1, 1.0]))
    rows.sort(key=lambda r: r[0])
    out = [[round(float(v), 3) if i < 4 else (int(v) if i == 4 else round(float(v), 2)) for i, v in enumerate(r)] for _, r in rows]
    return (out, [r[0] for r in rows]) if with_s else out
