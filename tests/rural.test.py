"""Regression checks for field topology and stream-safe routing."""
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/world'))
from rural import connected_fields, route

class RuralTests(unittest.TestCase):
    def test_disjoint_parcels_get_separate_water_levels(self):
        labels = np.full((30, 40), -1)
        labels[2:12, 2:12] = 700123
        labels[16:26, 25:35] = 700123
        result = connected_fields(labels, 700000)
        self.assertNotEqual(result[5,5], result[20,30])
        self.assertGreaterEqual(result[5,5], 700000)
        self.assertGreaterEqual(result[20,30], 700000)

    def test_slivers_do_not_count_as_cultivable_fields(self):
        labels = np.full((30, 40), -1)
        labels[2:4, 2:35] = 700123
        labels[10:25, 10:25] = 23
        result = connected_fields(labels, 700000)
        self.assertTrue((result[2:4] == -1).all())
        self.assertTrue(0 <= result[15,15] < 700000)

    def test_route_goes_around_a_stream_exclusion(self):
        h = np.zeros((101,101))
        blocked = np.zeros_like(h, dtype=bool)
        blocked[30:75,48:53] = True
        p = route(h, blocked, (-30,0), (30,0), 1, 50)
        self.assertEqual(p[0], (-30,0))
        self.assertEqual(p[-1], (30,0))
        for a,b in zip(p,p[1:]):
            for t in np.linspace(0,1,40):
                x,z=np.array(a)*(1-t)+np.array(b)*t
                self.assertFalse(blocked[round(z+50),round(x+50)])

if __name__ == '__main__':
    unittest.main()
