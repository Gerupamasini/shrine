import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/world'))
from irrigation import connect
class Gravity(unittest.TestCase):
 def test_no_uphill_supply(self):
  fields=[dict(id='upper',level=10,type='rice'),dict(id='lower',level=1,type='rice')]
  comp=np.zeros((20,20),int);comp[2:5,2:5]=1;comp[10:14,10:14]=2
  g=connect(fields,comp,np.arange(20),[('brook',[[0,2,0]])],lambda x,z:99)
  self.assertIn('upper',g['unresolved']);self.assertNotIn('upper',g['supplied'])
if __name__=='__main__':unittest.main()
