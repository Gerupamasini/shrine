"""Valley-floor access: a through lane with staggered, terminating branches."""
import numpy as np
from scipy.interpolate import PchipInterpolator


def layout(levee_x, main_x, canal_x, canal_range, road_half, houses, legacy):
    # Broad changes follow the widening basins and the mouths of side valleys.
    # These are land-use reaches, not periodic noise applied to every road.
    z = np.arange(-470., 690.1, 3.)
    controls = [(-470,.28),(-365,.34),(-230,.61),(-80,.32),
                (85,.40),(220,.62),(360,.35),(505,.57),(690,.30)]
    fraction = PchipInterpolator(*np.array(controls).T)(z)
    west, east = np.array([levee_x(t) for t in z]), np.array([main_x(t) for t in z])
    x = west + (east-west)*fraction
    # Existing farmsteads retain their old access corridor; do not move houses
    # to make the new road pattern fit. Blend before reaching their yards.
    old = np.array(legacy)
    weight = np.zeros_like(z)
    for hs in houses:
        if hs['group'] == 'sankyo':
            t = np.clip((np.abs(z-hs['z'])-22)/35,0,1)
            weight = np.maximum(weight,1-t*t*(3-2*t))
    x = x*(1-weight) + np.interp(z,old[:,1],old[:,0])*weight
    spine = list(zip(x,z))
    sx = lambda zz: float(np.interp(zz,z,x))
    roads = [spine]
    # Miyazawa enters south of the road bridge: an off-ramp beside the
    # bridge parapet / open channel would trap vehicles on the channel wall.
    main_entries = [-368.,-200.,5.,238.,428.,560.,676.]
    joins = [-344.,-171.,-18.,272.,403.,531.,650.]

    def branch(a,b):
        # Horizontal endpoint tangents meet longitudinal lanes in a clear T.
        # Offset ends remove through four-way intersections without sharp kinks.
        a,b=np.array(a),np.array(b)
        dx=b[0]-a[0]
        c=a+np.array([dx*.38,0]); d=b-np.array([dx*.38,0])
        t=np.linspace(0,1,max(12,int(np.linalg.norm(b-a)/2)))[:,None]
        return [tuple(p) for p in (1-t)**3*a+3*(1-t)**2*t*c+3*(1-t)*t*t*d+t**3*b]

    for start,end in zip(main_entries,joins):
        roads.append(branch((main_x(start)-road_half-.4,start),(sx(end),end)))
    # Only selected field groups need a vehicle connection to the levee.
    # Other groups are served from the spine: no repeated road across the valley.
    for start,end in [(-278.,-312.),(-100.,-63.),(305.,338.),(465.,493.),(620.,660.)]:
        wx=canal_x(end)+1.2 if canal_range[0]<end<canal_range[1] else levee_x(end)
        roads.append(branch((sx(start),start),(wx,end)))
    return roads, main_entries
