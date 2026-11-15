"""Closed earth bunds around the final, connected parcel boundaries."""
import numpy as np
from scipy import ndimage

BUND_HEIGHT = .34
RICE_EDGE = 1.65


def shape(labels, levels, analytic_distance, cell):
    cultivated=labels>=0
    boundary=np.zeros_like(cultivated)
    # Include clipping cuts and parcel-to-parcel edges, not only the original
    # analytic contour strips. Boundary samples form the crown of the bund.
    padded=np.pad(labels,1,constant_values=-1)
    for dj,di in ((-1,0),(1,0),(0,-1),(0,1)):
        boundary |= cultivated & (labels!=padded[1+dj:1+dj+labels.shape[0],1+di:1+di+labels.shape[1]])
    distance=ndimage.distance_transform_edt(~boundary)*cell
    distance=np.where(cultivated,np.minimum(analytic_distance,distance),0.)
    lv=np.where(cultivated,levels,-1e9)
    footprint=np.hypot(*np.mgrid[-3:4,-3:4])<=3.2
    crest=ndimage.maximum_filter(lv,footprint=footprint)+BUND_HEIGHT
    # A broad crown survives grid sampling; the inner face meets the level bed.
    height=np.maximum(levels,crest-.85*np.maximum(distance-.4,0))
    return distance,height,boundary
