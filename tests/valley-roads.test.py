import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/world'))
from valley_roads import layout

class ValleyRoadTests(unittest.TestCase):
    def test_branches_end_at_staggered_t_junctions(self):
        roads,entries=layout(lambda z:-100,lambda z:100,lambda z:-90,(100,375),3,[],[(-10,-470),(-10,692)])
        spine=np.array(roads[0])
        joins=[]
        for r in roads[1:]:
            hits=[p for p in (r[0],r[-1]) if abs(p[0]-np.interp(p[1],spine[:,1],spine[:,0]))<1e-6]
            self.assertEqual(len(hits),1,'each branch terminates on the spine')
            joins.append(hits[0][1])
            self.assertGreater(abs(r[0][1]-r[-1][1]),20)
        self.assertGreater(min(np.diff(sorted(joins))),20,'no aligned four-way crossings')
        self.assertLess(len(entries),10,'not a crossing road at every former field row')

if __name__=='__main__': unittest.main()
