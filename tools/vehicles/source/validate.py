"""Validate authored geometry, including the mistakes reported in the review."""
import bpy,json
from pathlib import Path
root=Path(__file__).resolve().parents[3]
designs=json.loads((Path(__file__).parent/'designs.json').read_text())
for name in ['kei-truck','light-truck','crown-sedan']:
 bpy.ops.wm.open_mainfile(filepath=str(Path(__file__).parent/(name+'.blend')))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 if name=='crown-sedan':
  rear=[o for o in meshes if o.name.startswith('rear door glazing') and any(m and m.name=='vehicle_glass' for m in o.data.materials)]
  front=[o for o in meshes if o.name.startswith('front door glazing') and any(m and m.name=='vehicle_glass' for m in o.data.materials)]
  assert len(rear)==2 and len(front)==2,'S130 must have one front and one rear pane on each side'
  assert not any(o.name.startswith('side glazing') for o in meshes),'old three-part glazing must not survive'
  for pane in rear:
   points=[pane.matrix_world@v.co for v in pane.data.vertices]
   assert min(-v.y for v in points)>-.95,'rear door glass must leave a broad C-pillar at the belt'
  print('PASS S130: one continuous rear door pane per side; no invented quarter light',flush=True)
 else:
  d=next(d for d in designs if d['id']==name)
  tires=[o for o in meshes if o.name.startswith('wheel_' if name=='kei-truck' else 'commercial tire')]
  assert len(tires)==(4 if name=='kei-truck' else 6)
  stations=[]
  for tire in tires:
   coords=[tire.matrix_world@v.co for v in tire.data.vertices]
   forward=-(min(v.y for v in coords)+max(v.y for v in coords))/2
   stations.append(forward)
  assert abs(max(stations)-min(stations)-d['wheelbase'])<.001
  assert abs(max(stations)-d['frontAxle'])<.001
  assert not any(o.name=='formed steel body' for o in meshes),'truck must not reuse passenger body'
  for part in ['rear roof return','rear cab window stamped surround']:
   obj=next(o for o in meshes if o.name==part)
   assert sum(p.normal.y*p.area for p in obj.data.polygons)>0,part+' must face rearward, not disappear from behind'
  print('PASS',name,'independent cab/chassis, tires',len(tires),'wheelbase',round(max(stations)-min(stations),3),flush=True)
