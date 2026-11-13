"""Clean-room surface construction, in metres. Blender source + glTF output.
Each design has independent wheel stations, overhangs and coachwork sections.
Blender X=width, Y=-forward, Z=up; glTF export returns X/Y-up/+Z-forward.
"""
import bpy, math, json, os, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from trucks import build_truck
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
DESIGNS=json.loads((Path(__file__).parent/'designs.json').read_text())
OUT=ROOT/'public/assets/models/architecture'
PALETTE=json.loads((Path(__file__).parent/'palette.json').read_text())

def P(p): return (p[0],-p[2],p[1])
def mat(name): return bpy.data.materials[name]
def material_init():
 for name,d in PALETTE.items():
  m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');h=d['color'].lstrip('#');rgb=[int(h[i:i+2],16)/255 for i in (0,2,4)];rgb=[((x+.055)/1.055)**2.4 if x>.04045 else x/12.92 for x in rgb]
  n.inputs['Base Color'].default_value=(*rgb,1);n.inputs['Roughness'].default_value=d['roughness'];n.inputs['Metallic'].default_value=d.get('metalness',0)
  if d.get('coat'):n.inputs['Coat Weight'].default_value=d['coat'];n.inputs['Coat Roughness'].default_value=.14
  if 'opacity' in d:n.inputs['Alpha'].default_value=d['opacity'];m.surface_render_method='DITHERED';m.use_transparency_overlap=False
  detail=d.get('detail') or ('paint' if name in [x['paint'] for x in DESIGNS] else None)
  if detail:
   tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/f'public/assets/textures/vehicles/{detail}-normal.png'),check_existing=True);tex.image.colorspace_settings.name='Non-Color';tex.extension='REPEAT'
   normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.12 if detail=='paint' else .22;m.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],n.inputs['Normal'])

def finish(o,name,ma,bevel=0):
 o.name=name;o.data.materials.append(mat(ma))
 if bevel:
  mod=o.modifiers.new('rolled edges','BEVEL');mod.width=bevel;mod.segments=3
  mod=o.modifiers.new('panel normals','WEIGHTED_NORMAL');mod.keep_sharp=True;mod.weight=40
 return o

def box(name,ma,size,at,bevel=.01):
 bpy.ops.mesh.primitive_cube_add(size=1,location=P(at));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,ma,bevel)

def mesh(name,ma,verts,faces,smooth=False,bevel=0):
 me=bpy.data.meshes.new(name);me.from_pydata([P(p) for p in verts],[],faces);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o)
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)
 # Planar projection in metres. Painted panels do not need a unique atlas for micro-normal detail.
 uv=me.uv_layers.new(name='UVMap')
 for poly in me.polygons:
  poly.use_smooth=smooth
  n=poly.normal;axis=max(range(3),key=lambda a:abs(n[a]));axes=[a for a in range(3) if a!=axis]
  for li in poly.loop_indices:
   co=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(co[axes[0]],co[axes[1]])
 return finish(o,name,ma,bevel)

def surface(name,ma,fn,nu=24,nv=12):
 vs=[fn(i/nu,j/nv) for j in range(nv+1) for i in range(nu+1)];faces=[]
 for j in range(nv):
  for i in range(nu):
   a=j*(nu+1)+i;faces.append((a,a+1,a+nu+2,a+nu+1))
 return mesh(name,ma,vs,faces,True)

def tube(name,ma,pts,r=.004):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=2;cu.bevel_depth=r;cu.bevel_resolution=2;sp=cu.splines.new('POLY');sp.points.add(len(pts)-1)
 for p,co in zip(sp.points,pts):p.co=(*P(co),1)
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.data.materials.append(mat(ma));return o

def cyl(name,ma,r,depth,at,axis='x',vertices=48):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=P(at));o=bpy.context.object
 if axis=='x':o.rotation_euler[1]=math.pi/2
 elif axis=='front':o.rotation_euler[0]=math.pi/2
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 return finish(o,name,ma,.002)

def lerp(a,b,t):return a+(b-a)*t

def build(d):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 if d['kind']=='pickup':
  build_truck(d,globals());save(d);return
 w,L,H,R,tw=d['w'],d['l'],d['h'],d['r'],d['tire'];F=L/2;back=-F;paint=d['paint'];kind=d['kind'];truck=kind=='pickup';cab=truck or kind=='van';belt=d['belt'];cr,cf,rr,rf=d['cabin'];axles=[d['frontAxle']-d['wheelbase'],d['frontAxle']]
 def section(z):
  ss=d['sections']
  for a,b in zip(ss,ss[1:]):
   if a[0]<=z<=b[0]:
    t=(z-a[0])/(b[0]-a[0]);return lerp(a[1],b[1],t),lerp(a[2],b[2],t)
  return ss[0][1:] if z<ss[0][0] else ss[-1][1:]
 # Closed coachwork. Wide shoulder, curved doors, tapered nose and tucked rocker.
 zs=sorted(set([back if not truck else cr,F]+[a[0] for a in d['sections'] if not truck or a[0]>=cr]+[lerp(cr if truck else back,F,i/64) for i in range(65)]))
 verts=[]
 for z in zs:
  hw,top=section(z);sill=.235 if not cab else .36
  ring=[(-hw*.86,sill),(-hw*.98,sill+.09),(-hw,top-.19),(-hw*.985,top-.055),(-hw*.91,top),(-hw*.55,top+.015),(0,top+.024),(hw*.55,top+.015),(hw*.91,top),(hw*.985,top-.055),(hw,top-.19),(hw*.98,sill+.09),(hw*.86,sill)]
  verts.extend((x,y,z) for x,y in ring)
 n=13;faces=[]
 for i in range(len(zs)-1):
  for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
 faces.extend([tuple(range(n-1,-1,-1)),tuple((len(zs)-1)*n+j for j in range(n))])
 body=mesh('formed steel body',paint,verts,faces,True)
 for z in axles:
  if truck and z<cr:continue
  cutter=cyl('wheel opening tool','vehicle_steel',R+.045,w+.5,(0,R,z))
  bpy.context.view_layer.objects.active=body;mod=body.modifiers.new('true wheel opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
 # Hollow the cabin down to the floor: the belt-line body must not fill the interior.
 cavity=box('cabin cavity tool','vehicle_steel',(w*.79,H,(cf-cr)-.17),(0,(.56 if cab else .33)+H/2,(cf+cr)/2),0)
 bpy.context.view_layer.objects.active=body;mod=body.modifiers.new('hollow passenger compartment','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cavity;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cavity,do_unlink=True)
 bevel=body.modifiers.new('stamped edges','BEVEL');bevel.width=.012;bevel.segments=3;bevel.limit_method='ANGLE'
 normal=body.modifiers.new('weighted body normals','WEIGHTED_NORMAL');normal.keep_sharp=True
 # Wheel-arch lips and inner wells; front axle and rear axle are not symmetric about the body.
 for z in axles:
  if truck and z<cr:continue
  for sign in [-1,1]:
   pts=[]
   for i in range(65):
    a=i*math.pi/64;zz=z+math.cos(a)*(R+.046);y=R+math.sin(a)*(R+.046);hw,_=section(zz);pts.append((sign*(hw+.002),y,zz))
   tube('pressed arch lip',paint,pts,.009)
 # Exact cabin window envelope, bounded by metal A/B/C pillars. Lower belt connects to body.
 rw=w*(.405 if not cab else .425);bw=w*.455;ry=H-(.22 if kind=='van' else .13 if truck else .085)
 def side(sign,u,v):return (sign*(lerp(bw,rw,v)+.007*math.sin(v*math.pi)),lerp(belt+.018,ry,v),lerp(lerp(cr,cf,u),lerp(rr,rf,u),v))
 def screen(front,u,v):return (lerp(-bw,bw,u)*(1-.10*v),lerp(belt+.018,ry,v),lerp(cf if front else cr,rf if front else rr,v)+(1 if front else -1)*.025*math.sin(u*math.pi)*math.sin(v*math.pi))
 def glazing(name,fn,ul,ur,vl,vr):
  surface(name,'vehicle_glass',lambda u,v:fn(lerp(ul,ur,u),lerp(vl,vr,v)))
  pts=[fn(lerp(ul,ur,i/20),vl) for i in range(21)]+[fn(ur,lerp(vl,vr,i/10)) for i in range(1,11)]+[fn(lerp(ur,ul,i/20),vr) for i in range(1,21)]+[fn(ul,lerp(vr,vl,i/10)) for i in range(1,11)]
  tube(name+' gasket','vehicle_glass_edge',pts,.007)
 def framed(name,fn,ul,ur,vl,vr,leftmat=None,rightmat=None):
  glazing(name,fn,ul,ur,vl,vr)
  for ma,u0,u1,v0,v1 in [(leftmat or paint,0,ul,0,1),(rightmat or paint,ur,1,0,1),(paint,ul,ur,0,vl),(paint,ul,ur,vr,1)]:surface(name+' metal frame',ma,lambda u,v:fn(lerp(u0,u1,u),lerp(v0,v1,v)),12,6)
 framed('windshield',lambda u,v:screen(True,u,v),.045,.955,.07,.96)
 framed('backlight',lambda u,v:screen(False,u,v),.055,.945,.08,.95)
 for sign in [-1,1]:
  fn=lambda u,v:side(sign,u,v)
  if kind=='sedan':
   # S130 hardtop photos show ONE rear door pane, not a separate triangular quarter light.
   # The centre black meeting stile follows the door seam; the wide painted rear edge is the C-pillar.
   # The rear edge is NOT parallel to the rear screen: the C-pillar widens
   # substantially toward the belt, as visible in the S130 hardtop photographs.
   rear_edge=lambda v:.5*lerp(.40,.24,v)
   rearfn=lambda u,v:fn(lerp(rear_edge(v),.491,u),v)
   glazing('rear door glazing',rearfn,0,1,.07,.95)
   surface('broad painted C pillar',paint,lambda u,v:fn(rear_edge(v)*u,v),20,16)
   for low,high in [(0,.07),(.95,1)]:surface('rear door window edging',paint,lambda u,v:rearfn(u,lerp(low,high,v)),20,4)
   surface('rear window meeting stile','vehicle_glass_edge',lambda u,v:fn(lerp(.491,.50,u),v),4,16)
   framed('front door glazing',lambda u,v:fn(lerp(.50,1,u),v),.018,.945,.07,.95,leftmat='vehicle_glass_edge')
  else:
   cuts=[0,.43,1] if kind=='hatch' else [0,.30,.57,1]
   for a,b in zip(cuts,cuts[1:]):
    framed('side glazing',lambda u,v:fn(lerp(a,b,u),v),.055,.945,.11,.95)
  tube('belt molding','vehicle_chrome' if kind=='sedan' else 'vehicle_trim',[fn(i/32,0) for i in range(33)],.009)
 # Roof closed against all four window headers, with a 2cm crown. No floating frame rails.
 surface('roof crown',paint,lambda u,v:(lerp(-rw,rw,u),H-.02+.02*math.sin(u*math.pi)-.025*abs(2*v-1)**8,lerp(rr,rf,v)),40,32)
 for sign in [-1,1]:surface('roof side return',paint,lambda u,v:(sign*rw,lerp(ry,H-.02-.025*abs(2*u-1)**8,v),lerp(rr,rf,u)),32,6)
 for front in [False,True]:surface('roof header',paint,lambda u,v:tuple(lerp(a,b,v) for a,b in zip(screen(front,u,1),(lerp(-rw,rw,u),H-.045+.02*math.sin(u*math.pi),rf if front else rr))),32,6)
 # Seats sit below the belt; restrained interior dimensions keep the cabin from looking toy-like.
 fy=.63 if cab else .39;sz=cf-(.48 if cab else .66)
 box('interior floor','vehicle_dash',(w*.8,.07,cf-cr),(0,fy,(cf+cr)/2),.02)
 box('dashboard','vehicle_dash',(w*.83,.14,.32),(0,belt-.11,cf-.12),.04)
 for sign in [-1,1]:
  x=sign*w*.23
  box('cloth cushion','vehicle_seat',(.40,.12,.43),(x,fy+.12,sz),.055)
  backrest=box('cloth backrest','vehicle_seat',(.39,.43,.12),(x,fy+.36,sz-.19),.045);backrest.rotation_euler[0]=-.10
  for dx in [-.14,.14]:box('seat bolster','vehicle_seat',(.065,.34,.16),(x+dx,fy+.35,sz-.16),.028)
  for dx in [-.06,.06]:tube('headrest post','vehicle_steel',[(x+dx,fy+.55,sz-.21),(x+dx,fy+.64,sz-.21)],.007)
  box('headrest','vehicle_seat',(.22,.12,.085),(x,fy+.66,sz-.21),.03)
  box('door trim','vehicle_dash',(.04,.27,cf-cr-.08),(sign*w*.425,belt-.20,(cf+cr)/2),.02)
 if not truck:box('rear bench','vehicle_seat',(w*.73,.16,.42),(0,fy+.13,cr+.33),.045);box('rear seat back','vehicle_seat',(w*.73,.32,.13),(0,fy+.35,cr+.15),.035)
 sx=w*.23;sy=belt-.025;zz=cf-.39
 tube('steering rim','vehicle_trim',[(sx+.16*math.cos(i*2*math.pi/64),sy+.16*math.sin(i*2*math.pi/64),zz-.03*math.sin(i*2*math.pi/64)) for i in range(65)],.013)
 box('steering hub','vehicle_trim',(.18,.065,.045),(sx,sy,zz),.015)
 box('instrument hood','vehicle_dash',(.35,.09,.12),(sx,belt-.04,cf-.21),.025)
 for x in [sx-.08,sx+.07]:cyl('instrument dial','vehicle_glass_edge',.037,.008,(x,belt-.055,cf-.276),'front',32)
 # Fine exterior seams fitted to the actual section width, separate from the silhouette.
 for sign in [-1,1]:
  doors=[cr+.03] if truck else [cr+.12,lerp(cr,cf,.43)] if kind=='hatch' else [-.90,lerp(cr,cf,.50),cf-.07] if kind=='sedan' else [cr+.10,lerp(cr,cf,.57),cf-.07]
  for z in doors:
   hw,top=section(z);bottom=.33
   for az in axles:
    if abs(z-az)<R+.05:bottom=max(bottom,R+math.sqrt(max(0,(R+.05)**2-(z-az)**2)))
   tube('door shut line','vehicle_glass_edge',[(sign*hw,y,z) for y in [bottom,lerp(bottom,top,.5),top-.03]],.0022)
  for z in ([cr+.18] if truck else [-.72,lerp(cr,cf,.66)] if kind=='sedan' else [lerp(cr,cf,.36),lerp(cr,cf,.66)] if kind!='hatch' else [lerp(cr,cf,.46)]):
   hw,top=section(z);box('handle recess','vehicle_trim',(.009,.038,.145),(sign*(hw+.002),top-.10,z),.008);box('door handle','vehicle_chrome' if kind=='sedan' else paint,(.02,.014,.115),(sign*(hw+.012),top-.10,z),.005)
  # Bump strips subtly follow the body instead of making a black girdle.
  strip=[]
  for i in range(65):
   z=lerp(cr if truck else back,F,i/64);hw,top=section(z);strip.append((sign*(hw+.001),min(.58,top-.22),z))
  tube('rub strip','vehicle_trim',strip,.008)
  mx=sign*(w/2+.065);mz=cf-.12;my=belt+.08
  tube('mirror stem','vehicle_trim',[(sign*bw,my,mz+.03),(mx,my,mz)],.016)
  box('mirror housing',paint,(.13,.105,.18),(mx,my,mz),.035);box('mirror glass','vehicle_chrome',(.10,.075,.008),(mx,my,mz-.091),.018)
 for x in [-w*.23,w*.22]:tube('wiper arm','vehicle_trim',[(x,belt+.03,cf+.015),(x+.18,belt+.105,cf-.045)],.004);tube('wiper blade','vehicle_trim',[(x+.07,belt+.11,cf-.05),(x+.32,belt+.12,cf-.05)],.006)
 # Wheels: non-symmetric stations, correct tire widths, silver steel wheels vs sedan alloys.
 for az in axles:
  cyl('axle','vehicle_steel',.045,w*.8,(0,R,az))
  for sign in [-1,1]:
   x=sign*(w/2-tw*.55)
   profile=[(-.5,.62),(-.52,.76),(-.45,.92),(-.32,.989),(0,1),(.32,.989),(.45,.92),(.52,.76),(.5,.62)]
   verts=[]
   for dx,rad in profile:
    for i in range(64):
     a=i*math.pi/32;verts.append((x+dx*tw,R+math.sin(a)*R*rad,az+math.cos(a)*R*rad))
   faces=[]
   for j in range(len(profile)-1):
    for i in range(64):a=j*64+i;b=j*64+(i+1)%64;faces.append((a,b,b+64,a+64))
   mesh('tire casing','vehicle_rubber',verts,faces,True)
   outer=x+sign*tw*.51;cyl('rim barrel','vehicle_steel',R*.62,.04,(outer-sign*.02,R,az))
   for rad in [.59,.63]:tube('rim bead','vehicle_alloy',[(outer,R+math.sin(i*math.pi/32)*R*rad,az+math.cos(i*math.pi/32)*R*rad) for i in range(65)],.007)
   count=12 if kind=='sedan' else 8
   for i in range(count):
    a=i*2*math.pi/count
    surface('wheel spoke','vehicle_alloy',lambda u,v:(outer+sign*.015*math.sin(v*math.pi),R+math.sin(a+lerp(.10,2*math.pi/count-.10,u))*lerp(R*.21,R*.57,v),az+math.cos(a+lerp(.10,2*math.pi/count-.10,u))*lerp(R*.21,R*.57,v)),4,6)
   cyl('wheel center','vehicle_alloy',R*.23,.04,(outer,R,az))
   for i in range(5):a=i*2*math.pi/5;cyl('lug nut','vehicle_chrome',.009,.012,(outer+sign*.025,R+math.sin(a)*R*.16,az+math.cos(a)*R*.16),vertices=6)
   # Grooves sit in the tread, not as oversized teeth protruding from it.
   for dx in [-.035,0,.035]:tube('tire groove','vehicle_trim',[(x+dx,R+math.sin(i*math.pi/48)*(R-.001),az+math.cos(i*math.pi/48)*(R-.001)) for i in range(97)],.0016)
   if cab:box('mud flap','vehicle_rubber',(tw,.15,.015),(x,R*.65,az-R-.045),.004)
 # Fascias follow each model's nose height; grille and lamps share one band, above the bumper.
 frontTop=section(F)[1];lampY=frontTop-.095 if not cab else frontTop-.13
 for sign in [-1,1]:
  lw=.37 if kind=='sedan' else .235 if d['kei'] else .30;lx=sign*w*.32
  box('lamp gasket','vehicle_glass_edge',(lw+.015,.145,.04),(lx,lampY,F+.006),.012)
  box('headlamp reflector','vehicle_headlamp',(lw,.125,.035),(lx,lampY,F+.025),.018)
  for j in range(2 if kind=='sedan' else 1):cyl('halogen reflector','vehicle_chrome',.045,.012,(lx+(j-.5)*.14 if kind=='sedan' else lx,lampY,F+.047),'front',32)
  box('fluted headlamp cover','vehicle_lens',(lw,.125,.008),(lx,lampY,F+.045),.01)
  for j in range(15):box('lens flute','vehicle_headlamp',(.001,.115,.002),(lx-lw*.46+j*lw*.92/14,lampY,F+.052),0)
  box('front indicator','vehicle_amber',(.065,.12,.035),(sign*w*.443,lampY,F-.007),.014)
  box('rear combination lamp','vehicle_tail',(.30,.13,.04),(sign*w*.32,.79 if not truck else .63,back-.009),.013)
  box('rear indicator','vehicle_amber',(.07,.115,.041),(sign*w*.40,.79 if not truck else .63,back-.012),.008)
  box('reverse lamp','vehicle_reverse',(.05,.115,.042),(sign*w*.25,.79 if not truck else .63,back-.013),.008)
 gw=.54 if kind=='sedan' else w*.30
 box('grille recess','vehicle_glass_edge',(gw,.14,.035),(0,lampY,F+.006),.012)
 for j in range(14 if kind=='sedan' else 6):
  if kind=='sedan':box('grille chrome', 'vehicle_chrome',(.006,.12,.01),(-gw*.46+j*gw*.92/13,lampY,F+.029),.002)
  else:box('grille bar','vehicle_steel',(gw*.92,.009,.012),(0,lampY-.05+j*.02,F+.029),.002)
 for end in [-1,1]:
  z=end*F;by=.43 if not cab else .47
  box('bumper', 'vehicle_lower' if kind=='sedan' else 'vehicle_trim',(w*.96,.15,.17),(0,by,z-end*.025),.045)
  if kind=='sedan':box('bumper chrome','vehicle_chrome',(w*.945,.018,.15),(0,by+.065,z-end*.02),.006)
  box('registration plate','vehicle_plate_yellow' if d['kei'] else 'vehicle_plate_white',(.33,.165,.009),(0,by+.03,z+end*.065),.004)
  # True vector lettering avoids simulated blocks. Fictional number, period layout.
  cu=bpy.data.curves.new('plate number','FONT');cu.body='91-23';cu.align_x='CENTER';cu.size=.062;cu.extrude=.0003
  o=bpy.data.objects.new('embossed registration',cu);bpy.context.collection.objects.link(o);o.location=P((0,by-.002,z+end*.072));o.rotation_euler=(math.pi/2,0,0 if end>0 else math.pi);cu.materials.append(mat('vehicle_plate_ink'))
  for x in [-.135,.135]:cyl('plate screw','vehicle_steel',.003,.003,(x,by+.09,z+end*.071),'front',8)
 # Purpose-built truck flatbed, distinct from the passenger car body.
 if truck:
  e=cr-.03;bl=e-back;floor=.70 if d['kei'] else .79
  box('chassis','vehicle_steel',(w*.65,.13,L*.90),(0,.39,-.03),.018)
  box('load deck','vehicle_bed',(w*.96,.055,bl),(0,floor,(e+back)/2),.01)
  for x in [i*.11 for i in range(-int(w*4),int(w*4)+1)]:box('bed rib',paint,(.025,.012,bl-.05),(x,floor+.033,(e+back)/2),.004)
  for sign in [-1,1]:
   box('folded dropside',paint,(.035,.29,bl),(sign*(w/2-.03),floor+.17,(e+back)/2),.009)
   tube('rolled bed rail',paint,[(sign*(w/2-.03),floor+.32,back),(sign*(w/2-.03),floor+.32,e)],.015)
   for zz in [back+.18+i*.44 for i in range(int(bl/.44))]:box('bed reinforcement',paint,(.018,.23,.03),(sign*(w/2-.008),floor+.17,zz),.006);cyl('hinge','vehicle_steel',.018,.075,(sign*(w/2-.005),floor+.025,zz),'front',16)
  box('tailgate',paint,(w-.04,.29,.035),(0,floor+.17,back+.02),.009);box('headboard',paint,(w-.06,.39,.04),(0,floor+.22,e),.009)
  tube('cab guard','vehicle_steel',[(-w*.34,floor+.36,e),(-w*.34,H-.10,e),(w*.34,H-.10,e),(w*.34,floor+.36,e)],.018)
 save(d)

def save(d):
 # Apply transforms/modifiers, merge by material at export to keep draw calls manageable.
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.convert(target='MESH');bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 bpy.ops.file.pack_all()
 bpy.context.preferences.filepaths.save_version=0
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tools/vehicles/source'/f'{d["id"]}.blend'),compress=True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{d["id"]}.glb'),export_format='GLB',export_yup=True,export_apply=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
 print('BUILT',d['id'],flush=True)

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials):bpy.data.materials.remove(m)
material_init()
selected=os.environ.get('VEHICLE_IDS','').split(',')
for d in DESIGNS:
 if selected==[''] or d['id'] in selected:build(d)
