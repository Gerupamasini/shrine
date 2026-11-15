"""Closed earth bunds and terrace risers around the final, connected parcel boundaries.

The parcels are labelled on the 1.17 m terrain grid, but most of their edges come from smooth lines
(the bands and cuts of the consolidated strips, the cells of the old irregular plots, the contour
benches of the terraces and their cross levees). Shaping the levees from the grid labels put a
staircase along every diagonal bank and terrace riser. Here each family of lines brings, per cell,
the distance to its line on either side and the direction across it: the levee crest and the riser
are shaped from those distances (so they interpolate smoothly between grid points), the field across
each line is looked up a little beyond it, and only edges no line explains (cells dropped from a
field, the outer edge of a cultivated area) fall back to a smoothed grid distance.

Profile across a boundary (from the higher field down): its levee crest (+BUND_HEIGHT over the higher
level, RISE wide), then the riser at RISER_SLOPE down to the lower field. A boundary between fields
of about the same level is a plain levee on both sides.
"""
import numpy as np
from scipy import ndimage

BUND_HEIGHT = .34
RICE_EDGE = 1.65
CREST = .4               # half width of the levee crest
RISER_SLOPE = .85        # rise per metre of a levee side or a terrace riser (about 40 degrees)
_ACROSS = 1.3            # look this far past a line for the field on the other side


def shape(labels, levels, analytic_distance, cell, families=()):
    cultivated = labels >= 0
    ny, nx = labels.shape
    lv = np.where(cultivated, levels, np.nan)
    # grid boundary cells (4-neighbour label change) and the highest different field beside each
    boundary = np.zeros_like(cultivated)
    padded = np.pad(labels, 1, constant_values=-1)
    plv = np.pad(lv, 1, constant_values=np.nan)
    nb_level = np.full(labels.shape, np.nan)
    for dj, di in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nl = padded[1 + dj:1 + dj + ny, 1 + di:1 + di + nx]
        nv = plv[1 + dj:1 + dj + ny, 1 + di:1 + di + nx]
        diff = cultivated & (labels != nl)
        boundary |= diff
        nb_level = np.where(diff & (nl >= 0), np.fmax(nb_level, nv), nb_level)
    ii, jj = np.mgrid[0:ny, 0:nx]
    analytic = np.full(labels.shape, np.inf, np.float32)
    risers = []                                   # (distance to the line, level of the field across it)
    for fam in families:
        m = fam["mask"] & cultivated
        for d_, sgn in ((fam["lo"], -1.0), (fam["hi"], 1.0)):
            dd = np.where(m, d_, np.inf).astype(np.float32)
            near = m & (dd < 6.0)
            analytic = np.minimum(analytic, dd)
            if not near.any():
                continue
            reach = (dd[near] + _ACROSS) / cell
            qi = np.clip(np.rint(ii[near] + sgn * fam["uz"][near] * reach).astype(int), 0, ny - 1)
            qj = np.clip(np.rint(jj[near] + sgn * fam["ux"][near] * reach).astype(int), 0, nx - 1)
            across = np.full(labels.shape, np.nan)
            ok = (labels[qi, qj] >= 0) & (labels[qi, qj] != labels[near])
            across[near] = np.where(ok, lv[qi, qj], np.nan)
            risers.append((dd, across))
    # grid edges no line explains: smoothed distance, and the field across the nearest of them
    unexplained = boundary & (analytic > 1.25)
    pd, (pi, pj) = ndimage.distance_transform_edt(~unexplained, return_indices=True)
    # (smoothed over a cell and a half, so a staircase of grid steps becomes a rounded line; the
    # offset keeps the crest on the boundary cells)
    pd = np.maximum(ndimage.gaussian_filter(pd * cell, 1.5) - 0.45, 0.0)
    risers.append((pd, nb_level[pi, pj]))
    distance = np.where(cultivated, np.minimum(analytic, pd), 0.0)
    if analytic_distance is not None and not len(families):
        distance = np.where(cultivated, np.minimum(analytic_distance, distance), 0.0)
    own = np.where(cultivated, levels, -1e9)
    height = np.maximum(own, own + BUND_HEIGHT - RISER_SLOPE * np.maximum(distance - CREST, 0))
    # where the rice may start: the levee, or the toe of a riser coming down from a higher field
    rice_d = distance.copy()
    for dd, across in risers:
        up = cultivated & np.isfinite(across) & (across > own + .02)
        if not up.any():
            continue
        r = np.where(up, across + BUND_HEIGHT - RISER_SLOPE * np.maximum(dd - CREST, 0), -1e9)
        height = np.maximum(height, r)
        rice_d = np.where(up, np.minimum(rice_d, dd - (across - own) / RISER_SLOPE), rice_d)
    rice_d = np.where(cultivated, np.maximum(rice_d, 0.0), 0.0)
    height = np.where(cultivated, height, levels)
    return rice_d, height, boundary
