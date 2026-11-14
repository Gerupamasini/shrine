"""Terrain-aware rural lanes. All coordinates are metres, (x, z)."""
import heapq
import math
import numpy as np
from scipy import ndimage


def route(height, blocked, start, end, cell, half):
    """A* on a ~6 m lattice, penalising earthworks and steep longitudinal grades.

    Test intermediate cells too: diagonal edges must not cut across a stream or yard.
    Endpoints remain exact so roads meet the existing network without gaps.
    """
    stride = 5
    hh = height[::stride, ::stride]
    bb = ndimage.maximum_filter(blocked, 3)[::stride, ::stride]
    size = hh.shape[0]
    step = cell * stride
    def ij(p):
        return tuple(np.rint([(p[1] + half) / step, (p[0] + half) / step]).astype(int))
    a, b = ij(start), ij(end)
    bb = bb.copy()
    # A connector may start on a village street's shoulder.
    bb[a] = bb[b] = False
    slope = np.hypot(*np.gradient(ndimage.gaussian_filter(hh, 1), step))
    moves = [(di, dj, math.hypot(di, dj)*step) for di in range(-2, 3) for dj in range(-2, 3)
             if (di or dj) and math.gcd(abs(di), abs(dj)) == 1]
    queue = [(0., a)]
    costs, parent = {a: 0.}, {}
    visited = set()
    while queue:
        _, u = heapq.heappop(queue)
        if u in visited:
            continue
        visited.add(u)
        if u == b:
            break
        for di, dj, length in moves:
            v = (u[0]+di, u[1]+dj)
            if not (2 <= v[0] < size-2 and 2 <= v[1] < size-2) or bb[v]:
                continue
            grade = abs(hh[v]-hh[u])/length
            if grade > .22:
                continue
            ii = np.rint(np.linspace(u[0]*stride, v[0]*stride, math.ceil(length/cell)*2+1)).astype(int)
            jj = np.rint(np.linspace(u[1]*stride, v[1]*stride, math.ceil(length/cell)*2+1)).astype(int)
            if blocked[ii, jj].any():
                continue
            cost = costs[u] + length*(1 + 24*grade*grade + 1.5*slope[v]**2)
            if cost < costs.get(v, float('inf')):
                costs[v], parent[v] = cost, u
                heuristic = math.hypot(v[0]-b[0], v[1]-b[1])*step
                heapq.heappush(queue, (cost+heuristic, v))
    if b not in parent:
        raise ValueError(f'No rural route from {start} to {end}')
    nodes = [b]
    while nodes[-1] != a:
        nodes.append(parent[nodes[-1]])
    pts = np.array([(j*step-half, i*step-half) for i,j in nodes[::-1]])
    pts = np.vstack([start, pts, end])
    # Round locally, never discard all smoothing because one constrained bend
    # touches a yard. Repeated corner cutting leaves straight farm alignments intact.
    def clear(poly):
        for p, q in zip(poly, poly[1:]):
            samples = np.linspace(p, q, max(2, math.ceil(np.linalg.norm(q-p)/cell)*2+1))
            ci = np.clip(np.rint((samples[:,1]+half)/cell).astype(int), 0, height.shape[0]-1)
            cj = np.clip(np.rint((samples[:,0]+half)/cell).astype(int), 0, height.shape[1]-1)
            if blocked[ci,cj].any():
                return False
        return True
    for _ in range(3):
        rounded = [pts[0]]
        for i in range(1, len(pts)-1):
            p, v, q = pts[i-1:i+2]
            before, after = .25*p+.75*v, .75*v+.25*q
            if clear([rounded[-1], before, after, q]):
                rounded.extend([before, after])
            else:
                rounded.append(v)
        rounded.append(pts[-1])
        pts = np.array(rounded)
    # Smooth over physical distance rather than vertex count: the search can
    # alternate lattice headings every few metres on a contour. Those zigzags
    # are walkable but too tight for a 1.855 m wheelbase truck.
    distance = np.r_[0., np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    samples = np.linspace(0., distance[-1], max(2, int(distance[-1]/2)+1))
    pts = np.c_[np.interp(samples,distance,pts[:,0]),np.interp(samples,distance,pts[:,1])]
    for _ in range(2):
        candidate = ndimage.gaussian_filter1d(pts,4.,axis=0,mode='nearest')
        candidate[0],candidate[-1]=start,end
        for i in range(1,len(pts)-1):
            if clear([pts[i-1],candidate[i],pts[i+1]]):
                pts[i]=candidate[i]
    return [tuple(p) for k,p in enumerate(pts) if k == 0 or np.linalg.norm(p-pts[k-1]) > .1]


def connected_fields(labels, terrace0):
    """Split disjoint parcels before measuring their area or choosing a water level."""
    result = np.full_like(labels, -1)
    # Label each value locally, avoiding a full-world scan for every parcel.
    ids, inverse = np.unique(labels, return_inverse=True)
    compact = inverse.reshape(labels.shape) + 1
    boxes = ndimage.find_objects(compact)
    serial = {0: 0, 300000: 300000, terrace0: terrace0}
    for idx, fid in enumerate(ids):
        if fid < 0:
            continue
        box = boxes[idx]
        pieces, count = ndimage.label(labels[box] == fid)
        for k in range(1, count+1):
            mask = pieces == k
            # A parcel must have room for a cultivated interior, not just a thin sliver.
            if ndimage.distance_transform_edt(np.pad(mask, 1)).max() < 2.5:
                continue
            category = terrace0 if fid >= terrace0 else 300000 if fid >= 300000 else 0
            result[box][mask] = serial[category]
            serial[category] += 1
    return result
