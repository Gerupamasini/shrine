"""Conservative gravity-fed field connections; never invent an uphill water supply."""
import numpy as np
from scipy.spatial import cKDTree
from scipy import ndimage


def connect(fields, comp, axis, sources, road_distance):
    boundaries = []
    for k, field in enumerate(fields, 1):
        mask = comp == k
        ii, jj = np.where(mask & ~ndimage.binary_erosion(mask))
        boundaries.append(np.c_[axis[jj], axis[ii]])
    trees = [cKDTree(p) for p in boundaries]
    links, supplied = [], set()
    # Sources are actual generated brook/canal water surfaces, (id, x, y, z).
    def connection(points, tree, target, max_distance):
        dist, index = tree.query(points[:, [0, 2]])
        valid = np.where((dist <= max_distance) & (points[:, 1] >= target['level']+.08))[0]
        if not len(valid): return None
        i = valid[np.argmin(dist[valid])]
        end = tree.data[index[i]]
        return points[i].tolist(), [float(end[0]), target['level']+.04, float(end[1])]
    for k, f in enumerate(fields):
        if f['type'] != 'rice': continue
        best = None
        for name, points in sources:
            link = connection(np.asarray(points), trees[k], f, 14.)
            if link and (best is None or np.linalg.norm(np.subtract(link[0],link[1])) < best[0]):
                best = (np.linalg.norm(np.subtract(link[0],link[1])), name, link)
        if best:
            links.append(dict(source=best[1], target=f['id'], points=best[2], kind='supply'))
            supplied.add(k)
    # Short boundary-to-boundary connections represent traditional tagoshi.
    for k in sorted(range(len(fields)), key=lambda k: -fields[k]['level']):
        if k not in supplied: continue
        f = fields[k]
        for j, lower in enumerate(fields):
            if j in supplied or lower['type'] != 'rice' or not .08 <= f['level']-lower['level'] <= 2.2: continue
            p = boundaries[k]
            points = np.c_[p[:,0], np.full(len(p), f['level']+.04), p[:,1]]
            link = connection(points, trees[j], lower, 5.)
            if link:
                links.append(dict(source=f['id'], target=lower['id'], points=link, kind='tagoshi'))
                supplied.add(j)
    # Tailwater leaves a parcel only where a lower real watercourse is nearby.
    for k, f in enumerate(fields):
        if k not in supplied: continue
        best = None
        for name, points in sources:
            pts = np.asarray(points)
            dist, index = trees[k].query(pts[:, [0,2]])
            valid = np.where((dist < 18) & (pts[:,1] < f['level']-.08))[0]
            if len(valid):
                i = valid[np.argmin(dist[valid])]
                if best is None or dist[i] < best[0]:
                    edge = trees[k].data[index[i]]
                    best = (dist[i], name, [[float(edge[0]), f['level']+.02, float(edge[1])], pts[i].tolist()])
        if best: links.append(dict(source=f['id'],target=best[1],points=best[2],kind='drain'))
    for link in links:
        a,b = np.array(link['points'])
        samples = np.linspace(a,b,max(3,int(np.linalg.norm(a-b)*2)))
        link['covered'] = any(road_distance(float(p[0]),float(p[2]))<2.2 for p in samples)
    return dict(sources=[name for name,points in sources], links=links, supplied=[fields[k]['id'] for k in sorted(supplied)],
                unresolved=[f['id'] for k,f in enumerate(fields) if f['type']=='rice' and k not in supplied])
