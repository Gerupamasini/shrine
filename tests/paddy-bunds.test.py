import sys, unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/world'))
from paddy_bunds import shape, BUND_HEIGHT, CREST

class BundTests(unittest.TestCase):
    def test_clipped_and_internal_edges_hold_the_higher_field(self):
        labels=np.full((30,40),-1)
        labels[3:27,3:20]=0; labels[3:27,20:36]=1
        labels[3:9,3:9]=-1  # a clipped outer corner absent from analytic strips
        levels=np.where(labels==0,2.,np.where(labels==1,3.,np.nan))
        distance,height,boundary=shape(labels,levels,np.full(labels.shape,20.),1.17)
        self.assertTrue(np.all(height[boundary]>=levels[boundary]+BUND_HEIGHT-1e-8))
        self.assertGreaterEqual(height[15,19],3.+BUND_HEIGHT-1e-8)
        self.assertAlmostEqual(height[15,10],2.)
        self.assertAlmostEqual(height[15,28],3.)
        # (edges no line explains are measured to a smoothed line: the clipped corner's cells lie on its crest)
        self.assertLessEqual(distance[9,8],CREST)

if __name__=='__main__': unittest.main()
