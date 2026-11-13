"""Reference-led cab-over trucks. No passenger-car coachwork or shared greenhouse.
Carry: Suzuki Digital Library 1991 photo/spec 103.pdf.
Elf: fourth-generation 1984–86 NHR54/Elf150 photograph, separate twin-headlamp fascia.
"""
import math
import bpy
import bmesh
from mathutils import Matrix

def build_truck(d,g):
 box,mesh,surface,tube,cyl,P=[g[n] for n in ['box','mesh','surface','tube','cyl','P']]
 w,L,H,R,tw=d['w'],d['l'],d['h'],d['r'],d['tire'];F=L/2;rear=-F;kei=d['kei'];paint=d['paint'];wb=d['wheelbase'];fa=d['frontAxle'];ra=fa-wb
 # Reference-specific stations: cab bulkhead / scuttle / windshield top. A cab is not a scaled sedan.
 cb=.32 if kei else .65
 belt=1.055 if kei else 1.285
 top=H-(.065 if kei else .095)
 wf=F-.16 if kei else F-.11
 wt=F-.58 if kei else F-.53
 wr=cb+.095
 half=w/2
 def mix(a,b,t):return a+(b-a)*t
 def smooth(t):return t*t*(3-2*t)
 def assembly(name,before,pivot):
  parts=set(bpy.context.scene.objects)-before
  bpy.ops.object.select_all(action='DESELECT')
  for part in parts:part.select_set(True)
  bpy.context.view_layer.objects.active=next(iter(parts))
  bpy.ops.object.convert(target='MESH');bpy.ops.object.join()
  obj=bpy.context.object;transform=Matrix.Translation(P(pivot))
  obj.data.transform(transform.inverted()@obj.matrix_world);obj.matrix_world=transform;obj.name=name
  return obj
 def face_outward(obj,direction):
  # Open panels need a known outside: Blender's volume heuristic can orient
  # the cab back toward the origin, making it invisible when viewed from behind.
  dot=sum(sum(p.normal[k]*direction[k] for k in range(3))*p.area for p in obj.data.polygons)
  if dot<0:
   bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free();obj.data.update()
  return obj
 # Cab lower sheet metal has a broad, convex face with strongly rolled corners.
 # Each ring follows a rounded rectangle in plan, tapering only at floor and scuttle.
 levels=[(.24 if kei else .28,F-.055,cb,half-.045),(.36 if kei else .43,F-.015,cb,half-.006),(.66 if kei else .86,F-.025,cb,half),(.91 if kei else 1.16,F-.055,cb,half-.008),(belt,wf,cb,half-.018)]
 verts=[];N=48
 for y,zf,zb,hw in levels:
  # Plan shape with flat sides and rounded front corners.
  rad=.105 if kei else .13
  outline=[]
  for cx,cz,start in [(hw-rad,zf-rad,0),(-hw+rad,zf-rad,90),(-hw+rad,zb+rad,180),(hw-rad,zb+rad,270)]:
   for j in range(12):
    a=math.radians(start+j*90/11);outline.append((cx+rad*math.cos(a),y,cz+rad*math.sin(a)))
  # Angle order starts on right side: front-right -> front-left -> rear-left -> rear-right.
  verts.extend(outline)
 faces=[tuple(range(N-1,-1,-1)),tuple((len(levels)-1)*N+i for i in range(N))]
 for j in range(len(levels)-1):
  for i in range(N):a=j*N+i;b=j*N+(i+1)%N;faces.append((a,b,b+N,a+N))
 cab=mesh('cab pressed lower shell',paint,verts,faces,True)
 # Actual wheel opening and interior cavity, not tires laid onto a box.
 def cut(obj,cutter,name):
  bpy.context.view_layer.objects.active=obj;mod=obj.modifiers.new(name,'BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
 cut(cab,cyl('front arch cutter','vehicle_steel',R+.038,w+.5,(0,R,fa)),'wheel arch')
 cut(cab,box('inner cab tool','vehicle_steel',(w-.16,H,wf-cb-.13),(0,H/2+(.53 if kei else .66),(wf+cb)/2),0),'cab floor opening')
 bevel=cab.modifiers.new('sheet metal edge radii','BEVEL');bevel.width=.012;bevel.segments=3
 # Front glass has a convex face; side windows have rounded corners and their own aperture.
 roofw=half-.055
 def front(u,v):
  hw=mix(half-.018,roofw,v)
  x=mix(-hw,hw,u)
  return (x,mix(belt,top,v),mix(wf,wt,v)+.030*math.sin(u*math.pi)*math.sin(v*math.pi))
 def side(sign,u,v):
  return (sign*(mix(half-.018,roofw,v)+.008*math.sin(v*math.pi)),mix(belt,top,v),mix(mix(cb,wf,u),mix(wr,wt,u),v))
 def rounded_path(poly,r=.08,steps=7):
  out=[]
  for i,b in enumerate(poly):
   a=poly[i-1];c=poly[(i+1)%len(poly)];p=(mix(b[0],a[0],r),mix(b[1],a[1],r));q=(mix(b[0],c[0],r),mix(b[1],c[1],r))
   for k in range(steps+1):
    t=k/steps;out.append(((1-t)**2*p[0]+2*t*(1-t)*b[0]+t*t*q[0],(1-t)**2*p[1]+2*t*(1-t)*b[1]+t*t*q[1]))
  return out
 def aperture(name,fn,poly,corner=.12,outward=None):
  path=rounded_path(poly,corner);n=len(path)
  # Curved glass triangulated from the aperture centre.
  center=(sum(p[0] for p in path)/n,sum(p[1] for p in path)/n)
  vs=[fn(*center)]+[fn(*p) for p in path];glass=mesh(name+' glass','vehicle_carry_glass' if kei else 'vehicle_glass',vs,[(0,i+1,(i+1)%n+1) for i in range(n)],True)
  if outward:face_outward(glass,outward)
  tube(name+' rubber surround','vehicle_glass_edge',[fn(*p) for p in path+[path[0]]],.010 if kei else .013)
  # Fill sheet metal from aperture to outer perimeter by projecting each ray to the enclosing unit square.
  outer=[]
  for u,v in path:
   du,dv=u-center[0],v-center[1];limits=[]
   if du:limits.append(((1 if du>0 else 0)-center[0])/du)
   if dv:limits.append(((1 if dv>0 else 0)-center[1])/dv)
   scale=min(limits);outer.append((center[0]+du*scale,center[1]+dv*scale))
  vs=[fn(*p) for p in path]+[fn(*p) for p in outer]
  faces=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  # A ray fan does not necessarily hit the four outer corners. Close those
  # triangles so adjacent windshield/door/roof panels meet without pinholes.
  for i,a in enumerate(outer):
   j=(i+1)%n;b=outer[j]
   for u,v in [(0,0),(1,0),(1,1),(0,1)]:
    if (abs(a[0]-u)<1e-6 and abs(b[1]-v)<1e-6) or (abs(b[0]-u)<1e-6 and abs(a[1]-v)<1e-6):
     if abs(a[0]-b[0])>1e-6 and abs(a[1]-b[1])>1e-6:
      k=len(vs);vs.append(fn(u,v));faces.append((i+n,j+n,k))
  surround=mesh(name+' stamped surround',paint,vs,faces,True)
  if outward:face_outward(surround,outward)
 aperture('windshield',front,[(.04,.075),(.96,.075),(.94,.95),(.06,.95)],.16)
 for sign in [-1,1]:
  fn=lambda u,v:side(sign,u,v)
  aperture('door window',fn,[(.11,.115),(.89,.095),(.87,.92),(.12,.92)],.18 if kei else .10)
  # Rolled roof gutter and rear seam, correctly behind the side glass.
  tube('roof rain gutter',paint,[fn(i/32,1) for i in range(33)],.010)
  tube('door rear edge','vehicle_glass_edge',[(sign*(half+.001),.30 if kei else .36,cb+.035),(sign*(half+.002),belt-.04,cb+.035),fn(.035,1)],.0025)
 # Front-to-back roof crown: thin rolled edge, no slab suspended above the windows.
 surface('cab roof dome',paint,lambda u,v:(mix(-roofw,roofw,u),top+(H-top)*math.sin(math.pi*u)**.35-.018*math.sin(math.pi*v),mix(wr,wt,v)),40,24)
 surface('front roof return',paint,lambda u,v:tuple(mix(a,b,v) for a,b in zip(front(u,1),(mix(-roofw,roofw,u),top+(H-top)*math.sin(math.pi*u)**.35,wt))),32,6)
 face_outward(surface('rear roof return',paint,lambda u,v:(mix(-roofw,roofw,u),top+(H-top)*math.sin(math.pi*u)**.35*v,wr),32,6),(0,1,0))
 # A solid cab back includes one modest rear window, rather than an all-glass back wall.
 def back(u,v):return (mix(-roofw,roofw,u),mix(.60,top,v),mix(cb,wr,v))
 aperture('rear cab window',back,[(.18,.53),(.82,.53),(.82,.86),(.18,.86)],.1,(0,1,0))
 # Door stampings and front-arch return. Carry has horizontal pressed ribs; Elf has a cab entry step.
 for sign in [-1,1]:
  for y in ([.53,.88] if kei else [.60,.96]):
   pts=[(sign*(half+.001),y,z) for z in [cb+.06,cb+.20,wf-.15]]
   if y>R*2+.045:tube('door pressed character line',paint,pts,.008)
  hz=cb+.19;hy=.94 if kei else 1.04
  box('black pull handle','vehicle_trim',(.022,.047,.16),(sign*(half+.006),hy,hz),.014)
  cyl('door lock','vehicle_chrome',.009,.009,(sign*(half+.018),hy-.065,hz),'x',12)
  # Arched fender lip hugs the tire, with a downturned rear edge.
  pts=[(sign*(half+.004),R+math.sin(i*math.pi/56)*(R+.040),fa+math.cos(i*math.pi/56)*(R+.040)) for i in range(57)]
  tube('arch stamping',paint,pts,.012)
  if not kei:
   box('cab entry step','vehicle_trim',(.20,.035,.33),(sign*(half-.05),.42,fa-.38),.012)
   for z in [fa-.50,fa-.43,fa-.36,fa-.29]:box('anti slip step bar','vehicle_steel',(.18,.008,.015),(sign*(half-.05),.444,z),.002)
  # Mirrors differ: compact door-mounted Carry, tall arm-mounted Elf.
  if kei:
   x=sign*(half+.055);z=wf-.13;y=belt+.08
   tube('mirror stalk','vehicle_trim',[(sign*(half-.015),y-.04,z+.03),(x,y,z)],.018)
   box('compact mirror','vehicle_trim',(.13,.15,.09),(x,y+.05,z),.032)
   box('mirror lens','vehicle_chrome',(.105,.125,.006),(x,y+.05,z-.047),.018)
  else:
   x=sign*(half+.19);z=wf+.05;y=1.37
   tube('mirror frame','vehicle_steel',[(sign*(half-.025),1.00,z-.10),(x,1.13,z),(x,1.52,z)],.017)
   box('vertical commercial mirror','vehicle_trim',(.17,.29,.075),(x,y+.07,z),.032)
   box('mirror lens','vehicle_chrome',(.145,.26,.005),(x,y+.07,z-.04),.02)
 # Dashboard and two right-hand-drive seats, entirely inside the cab shell.
 floor=.55 if kei else .68;sz=cb+.39;seatw=.42 if kei else .48
 box('floor','vehicle_dash',(w-.20,.08,wf-cb-.12),(0,floor,(wf+cb)/2),.02)
 box('dashboard','vehicle_dash',(w-.18,.16,.27),(0,belt-.12,wf-.15),.045)
 for sign in [-1,1]:
  x=sign*w*.23
  box('seat cushion','vehicle_seat',(seatw,.12,.43),(x,floor+.12,sz),.045)
  box('seatback','vehicle_seat',(seatw,.40,.12),(x,floor+.35,sz-.20),.045)
  box('headrest','vehicle_seat',(.22,.13,.085),(x,floor+.59,sz-.21),.025)
  for j in range(-3,4):tube('cloth seam','vehicle_trim',[(x+j*.045,floor+.18,sz-.1),(x+j*.045,floor+.18,sz+.17)],.0017)
 # GLB faces +Z: physical right is -X when viewed from the driver's seat.
 sx=-w*.23 if kei else w*.23;sy=belt-.06;sz=wf-.38
 steering_parts=set(bpy.context.scene.objects)
 tube('steering wheel','vehicle_trim',[(sx+.16*math.cos(i*math.pi/32),sy+.16*math.sin(i*math.pi/32),sz-.045*math.sin(i*math.pi/32)) for i in range(65)],.014)
 box('steering centre','vehicle_trim',(.18,.065,.04),(sx,sy,sz),.015)
 tube('lower steering spoke','vehicle_trim',[(sx,sy-.12,sz+.034),(sx,sy-.025,sz+.007)],.018)
 if kei:
  assembly('steering_wheel',steering_parts,(sx,sy,sz))
  box('instrument binnacle','vehicle_dash',(.38,.15,.13),(sx,1.02,wf-.20),.028)
  for x in [sx-.085,sx+.07]:
   cyl('recessed instrument','vehicle_glass_edge',.052,.012,(x,1.035,wf-.272),'front',40)
   for j in range(9):
    a=math.pi*.18+j*math.pi*.08
    tube('gauge tick','vehicle_dial',[(x+.038*math.cos(a),1.035+.038*math.sin(a),wf-.280),(x+.045*math.cos(a),1.035+.045*math.sin(a),wf-.280)],.0017)
   tube('speedometer needle','vehicle_dial',[(x,1.035,wf-.282),(x-.025,1.055,wf-.282)],.002)
  box('radio face','vehicle_trim',(.20,.068,.018),(-.05,.98,wf-.29),.009)
  box('radio scale','vehicle_glass_edge',(.11,.025,.004),(-.05,.99,wf-.301),.003)
  for x in [-.13,.03]:cyl('radio knob','vehicle_trim',.012,.014,(x,.972,wf-.309),'front',20)
  for x in [.40,.12,-.56]:
   box('dashboard vent','vehicle_glass_edge',(.15,.048,.02),(x,1.06,wf-.26),.007)
   for y in [1.045,1.057,1.069]:box('vent louver','vehicle_dash',(.135,.004,.008),(x,y,wf-.275),.002)
  box('glovebox seam','vehicle_trim',(.33,.005,.004),(.40,.92,wf-.287),0)
  for sign in [-1,1]:
   box('inner door card','vehicle_dash',(.035,.28,.65),(sign*(half-.075),.87,cb+.43),.015)
   box('interior pull','vehicle_trim',(.055,.035,.19),(sign*(half-.10),.92,cb+.40),.012)
 for x in [-w*.25,w*.23]:
  tube('wiper arm','vehicle_trim',[(x,belt+.02,wf+.02),(x+.10,belt+.07,wf-.015),(x+.21,belt+.09,wf-.035)],.005)
  tube('wiper blade','vehicle_trim',[(x+.04,belt+.09,wf-.035),(x+.31,belt+.10,wf-.04)],.007)
 # Independent ladder chassis, axles and under-bed components. Rear duals only on the light truck.
 for sign in [-1,1]:box('chassis rail','vehicle_steel',(.075,.16,L-.20),(sign*.28,.38,-.02),.008)
 for z in [rear+.2,ra,cb-.10,fa]:box('frame crossmember','vehicle_steel',(.64,.10,.07),(0,.40,z),.008)
 def wheel(x,z,sign,dual=False):
  wheel_parts=set(bpy.context.scene.objects)
  outer=x+sign*tw*.51
  profile=[(-.50,.59),(-.51,.72),(-.46,.88),(-.32,.98),(0,1),(.32,.98),(.46,.88),(.51,.72),(.50,.59)]
  vs=[]
  for dx,rad in profile:
   for i in range(64):a=i*math.pi/32;vs.append((x+dx*tw,R+math.sin(a)*R*rad,z+math.cos(a)*R*rad))
  faces=[]
  for j in range(len(profile)-1):
   for i in range(64):a=j*64+i;b=j*64+(i+1)%64;faces.append((a,b,b+64,a+64))
  mesh('commercial tire','vehicle_rubber',vs,faces,True)
  cyl('wheel inner shadow','vehicle_trim',R*.57,.012,(outer-sign*.045,R,z))
  # Actual circular vent holes in stamped wheel dish, not passenger-car spokes.
  plate=cyl('pressed steel wheel','vehicle_alloy' if kei else 'vehicle_steel',R*.55,.022,(outer,R,z))
  holes=8 if kei else 6
  for i in range(holes):
   a=i*2*math.pi/holes;rad=R*.42
   cutter=cyl('wheel vent tool','vehicle_steel',.024 if kei else .032,.12,(outer,R+math.sin(a)*rad,z+math.cos(a)*rad),vertices=20)
   cut(plate,cutter,'round wheel vent')
  tube('wheel rolled rim','vehicle_alloy' if kei else 'vehicle_steel',[(outer+sign*.008,R+math.sin(i*math.pi/32)*R*.59,z+math.cos(i*math.pi/32)*R*.59) for i in range(65)],.008)
  cyl('axle hub','vehicle_steel',R*.20,.07,(outer,R,z))
  for i in range(4 if kei else 6):
   a=i*2*math.pi/(4 if kei else 6);cyl('wheel nut','vehicle_chrome',.011,.015,(outer+sign*.033,R+math.sin(a)*R*.25,z+math.cos(a)*R*.25),vertices=6)
  for dx in [-.037,0,.037]:tube('tire groove','vehicle_trim',[(x+dx,R+math.sin(i*math.pi/40)*(R-.002),z+math.cos(i*math.pi/40)*(R-.002)) for i in range(81)],.0015)
  if kei:assembly('wheel_'+('f' if z==fa else 'r')+('l' if sign>0 else 'r'),wheel_parts,(x,R,z))
 for z in [fa,ra]:
  cyl('solid axle','vehicle_steel',.045,w-.22,(0,R,z));cyl('differential','vehicle_steel',.105,.23,(0,R,z))
  for sign in [-1,1]:
   x=sign*(d.get('track',w-.20)/2)
   wheel(x,z,sign)
   if not kei and z==ra:wheel(x-sign*(tw+.015),z,sign,True)
   box('mud flap','vehicle_rubber',(tw+.025,.20,.018),(x,R*.62,z-R-.055),.003)
   if z==ra:
    for j in range(4):box('leaf spring','vehicle_steel',(.055,.012,.65-j*.08),(sign*.29,.32+j*.014,z),.004)
 # Bed dimensions follow Carry's 1,940 x 1,330 x 290 mm published specification.
 bedlen=d['bedLength'];bedw=d['bedWidth'];bedh=d['bedSide'];deck=d['deck'];bz=rear+bedlen/2+.035;end=rear+bedlen+.035
 box('deck cross bearers','vehicle_steel',(bedw-.10,.11,bedlen-.03),(0,deck-.08,bz),.012)
 box('load floor',paint,(bedw,.038,bedlen),(0,deck,bz),.008)
 for i in range(-5 if kei else -6,6 if kei else 7):box('pressed floor rib',paint,(.025,.009,bedlen-.06),(i*.115,deck+.024,bz),.004)
 for sign in [-1,1]:
  x=sign*(bedw/2+.015)
  box('drop side panel',paint,(.035,bedh,bedlen),(x,deck+bedh/2+.015,bz),.009)
  tube('folded top rail',paint,[(x,deck+bedh+.018,rear+.035),(x,deck+bedh+.018,end)],.016)
  tube('side press line',paint,[(x+sign*.02,deck+bedh*.48,rear+.08),(x+sign*.02,deck+bedh*.48,end-.05)],.006)
  for z in [rear+.17+i*(bedlen-.30)/3 for i in range(4)]:
   cyl('dropside hinge',paint,.018,.085,(x,deck-.006,z),'front',16)
   box('hinge strap',paint,(.019,.13,.032),(x+sign*.019,deck+.057,z),.005)
   tube('rope hook','vehicle_steel',[(x,deck-.09,z),(x+sign*.025,deck-.13,z),(x+sign*.025,deck-.13,z+.025)],.005)
  for z in [rear+.12,end-.12]:box('corner latch','vehicle_steel',(.022,.105,.035),(x+sign*.024,deck+bedh*.67,z),.005)
  box('rear mudguard','vehicle_steel',(.22,.05,.85),(sign*(bedw/2-.13),R*2+.10,ra),.02)
 box('tailgate',paint,(bedw+.02,bedh,.035),(0,deck+bedh/2+.015,rear+.035),.009)
 box('bed headboard',paint,(bedw,.35 if kei else .43,.036),(0,deck+.20,end),.008)
 # Cab guard stands close behind cab, not a tall isolated pole at the bed edge.
 tube('cab guard',paint,[(-bedw*.42,deck+.25,end),(-bedw*.42,H-.035,end),(bedw*.42,H-.035,end),(bedw*.42,deck+.25,end)],.018)
 for x in [-bedw*.20,bedw*.20]:tube('guard upright',paint,[(x,deck+.35,end),(x,H-.04,end)],.012)
 box('fuel tank','vehicle_steel',(.32,.25,.54),(-.35,.44,cb-.46),.045)
 box('battery box','vehicle_trim',(.26,.22,.31),(.37,.48,cb-.34),.02)
 for sign in [-1,1]:
  box('rear stop lamp','vehicle_tail',(.20 if kei else .27,.09,.04),(sign*bedw*.35,deck-.13,rear+.005),.008)
  box('rear indicator','vehicle_amber',(.07,.085,.042),(sign*bedw*.35+sign*.06,deck-.13,rear),.005)
 # Different fascias. Carry 1991 rectangular lamps and black bumper; Elf 1984 dual lamps, high grille and five lower slots.
 if kei:
  ly=.86
  face=F-.049
  for sign in [-1,1]:
   x=sign*w*.34
   box('rectangular lamp surround','vehicle_chrome',(.27,.155,.025),(x,ly,face+.006),.026)
   box('reflector housing','vehicle_headlamp',(.225,.118,.009),(x,ly,face+.012),.022)
   cyl('lamp reflector','vehicle_chrome',.044,.010,(x,ly,face+.022),'front',40)
   box('halogen lens','vehicle_lens',(.225,.118,.006),(x,ly,face+.029),.022)
   box('clear corner indicator','vehicle_reverse',(.052,.115,.018),(sign*w*.433,ly,face+.010),.008)
   for j in range(12):box('lamp fluting','vehicle_lens',(.002,.105,.003),(x-.10+j*.018,ly,face+.029),0)
  box('front badge backing','vehicle_trim',(.23,.04,.010),(0,.83,face+.009),.005)
  box('deep molded bumper','vehicle_trim',(w-.035,.32,.19),(0,.455,F-.045),.045)
  for sign in [-1,1]:box('bumper side return','vehicle_trim',(.10,.29,.30),(sign*(half-.048),.455,F-.17),.035)
  box('bumper air opening','vehicle_glass_edge',(.78,.085,.015),(0,.57,F+.064),.015)
  for sign in [-1,1]:box('amber bumper indicator','vehicle_amber',(.18,.075,.015),(sign*.48,.59,F+.065),.015)
  for y in [.55,.58]:box('bumper grille bar','vehicle_trim',(.73,.009,.014),(0,y,F+.075),.003)
 else:
  # The upper strip is a radiator grille, not the headlamp band.
  gy=1.01
  box('upper grille recess','vehicle_trim',(w-.17,.18,.035),(0,gy,F-.015),.01)
  for j in range(6):box('upper chrome slat','vehicle_chrome',(w-.24,.009,.014),(0,gy-.068+j*.026,F+.01),.002)
  box('centre badge plinth','vehicle_trim',(.30,.18,.018),(0,gy,F+.015),.005)
  for sign in [-1,1]:
   box('large amber corner','vehicle_amber',(.13,.18,.05),(sign*(half-.075),gy,F-.012),.014)
   for k in [0,1]:
    x=sign*(.46+k*.205)
    box('twin headlamp bezel','vehicle_trim',(.195,.19,.05),(x,.70,F+.006),.015)
    box('square halogen','vehicle_headlamp',(.16,.145,.017),(x,.70,F+.039),.014)
    for j in range(9):box('lamp fluting','vehicle_lens',(.002,.13,.002),(x-.064+j*.016,.70,F+.050),0)
  for i in range(5):
   x=(i-2)*.135;box('five port lower grille','vehicle_trim',(.105,.21,.03),(x,.70,F+.015),.012)
   for j in range(5):box('port slat','vehicle_steel',(.093,.008,.012),(x,.62+j*.038,F+.034),.002)
  box('steel front bumper','vehicle_alloy',(w+.025,.19,.18),(0,.435,F+.008),.035)
  for sign in [-1,1]:box('bumper fog lamp','vehicle_amber',(.20,.085,.018),(sign*.53,.44,F+.105),.012)
 # Number plates use actual vector numerals (fictitious registration).
 for end in [-1,1]:
  z=F+.071 if end>0 else rear-.022;y=.42 if end>0 else deck-.15
  box('registration plate','vehicle_plate_yellow' if kei else 'vehicle_plate_white',(.33,.165,.009),(0,y,z),.005)
  cu=bpy.data.curves.new('plate text','FONT');cu.body='91-23' if kei else '84-15';cu.align_x='CENTER';cu.size=.058;cu.extrude=.0002;o=bpy.data.objects.new('plate text',cu);bpy.context.collection.objects.link(o);o.location=P((0,y-.025,z+end*.008));o.rotation_euler=(math.pi/2,0,0 if end>0 else math.pi);cu.materials.append(g['mat']('vehicle_plate_ink'))
