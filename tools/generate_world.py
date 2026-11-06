"""Deterministic, engine independent world source. 1m units, +Y up."""
from pathlib import Path
import json, math, random
import numpy as np
from PIL import Image, ImageFilter
ROOT=Path(__file__).resolve().parents[1]/'public'
A=ROOT/'assets'; W=ROOT/'world'; A.mkdir(exist_ok=True); W.mkdir(exist_ok=True)
r=random.Random(19940821)
SIZE=1200; N=513; HEIGHT_RANGE=256

def smooth(a,b,x):
 t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def terrain_noise(x,z,scale):
 x=np.asarray(x)/scale;z=np.asarray(z)/scale;ix=np.floor(x);iz=np.floor(z);fx=x-ix;fz=z-iz;fx=fx*fx*(3-2*fx);fz=fz*fz*(3-2*fz)
 def h(a,b):return np.mod(np.sin(a*127.1+b*311.7+1994)*43758.5453,1)
 return (h(ix,iz)*(1-fx)+h(ix+1,iz)*fx)*(1-fz)+(h(ix,iz+1)*(1-fx)+h(ix+1,iz+1)*fx)*fz

def river_x(z):return 83+9*np.sin(np.asarray(z)*.025)
def floor_height(z):return 1.1+.003*(360-np.asarray(z))
plots=[]
for side in [-1,1]:
 for col in range(3):
  for row in range(8):
   x=(-94-col*32) if side<0 else (116+col*31);z=42+row*43
   plots.append((x,z,27+(row%3-1)*2,37+(col%2)*2,float(floor_height(z))))
for row in range(8):
 z=42+row*43;plots.append((42,z,44,36,float(floor_height(z))))
house_sites=[]
for i in range(18):
 z=40+i*19;road=-32+18*math.sin(z*.015);side=-1 if i%2 else 1
 house_sites.append((road+side*(18+4*(i%3)),z,float(floor_height(z)+1.15)))

def height(x,z):
 x=np.asarray(x);z=np.asarray(z)
 # A broad alluvial floor, incised river and elevated natural levee.
 flood=floor_height(z)
 levee=1.15*np.exp(-((x+28)/42)**4)
 west=smooth(205,550,-x)*(105+72*terrain_noise(x,z,135))
 east=smooth(255,580,x)*(115+83*terrain_noise(x+78,z,170))
 north=smooth(100,540,-z)*(135+74*terrain_noise(x-31,z,155))
 south=smooth(390,630,z)*(90+60*terrain_noise(x,z,150))*(1-np.exp(-((x-river_x(z))/110)**2))
 shoulder=(38-flood-levee)*(1-smooth(-108,0,z))*np.exp(-(x/135)**4)
 mountains=np.maximum.reduce(np.broadcast_arrays(west,east,north,south))
 rough=(terrain_noise(x,z,70)-.5)*7+(terrain_noise(x,z,24)-.5)*2
 h=flood+levee+mountains+shoulder+rough*smooth(3,50,mountains)
 # Upstream headwater valley rises into the catchment instead of cutting a
 # metre-wide sea-level trench through 200m mountains outside the village.
 headwater=flood+np.maximum(0,-z-10)*.075
 valley=.92*np.exp(-((x-river_x(z))/(55+np.maximum(0,-z)*.06))**2)*(1-smooth(-40,5,z))
 h=h*(1-valley)+headwater*valley
 # Stable, horizontal farm plots with narrow embankment transition.
 for px,pz,w,d,level in plots:
  distance=np.maximum(abs(x-px)-w/2,abs(z-pz)-d/2)
  weight=1-smooth(0,2.5,distance);h=h*(1-weight)+level*weight
 # Settled ground must be above floodplain; house pads predate placement.
 for px,pz,level in house_sites:
  distance=np.maximum(abs(x-px)-7,abs(z-pz)-6)
  weight=1-smooth(0,3,distance);h=h*(1-weight)+level*weight
 # River has one downhill water profile; banks blend into floodplain.
 rd=abs(x-river_x(z));channel=(1-smooth(2.1,4.8,rd))*smooth(-100,-15,z)
 riverbed=.55-.003*z-.85
 h=h*(1-channel)+riverbed*channel
 # Approach ties into the low terrace; four continuous stair ramps above it.
 approach=(1-smooth(10,26,abs(x)))*(1-smooth(8,28,abs(z)))
 h=h*(1-approach)
 corridor=(abs(x)<4.5)&(z<=0)&(z>=-105)
 d=-z;flight=np.minimum(np.floor(d/27),3);within=np.clip(d-flight*27,0,24)
 h=np.where(corridor,np.maximum(-.25,(flight*50+within/.48)*.19-.5),h)
 # Flat shrine bench, graded outer cut/fill apron.
 edge=np.maximum(abs(x)-24,np.maximum(-153-z,z+105))
 blend=1-smooth(0,12,edge);h=h*(1-blend)+38*blend
 return h
axis=np.linspace(-600,600,N); xx,zz=np.meshgrid(axis,axis)
h=height(xx,zz); raw=np.rint(np.clip((h+8)/HEIGHT_RANGE,0,1)*65535).astype('<u2')
raw.tofile(W/'heightmap.r16'); Image.fromarray(raw.astype('uint16')).save(W/'heightmap.png')
forest=np.clip((h-7)/32,0,1);path=np.where(((abs(xx)<6)&(zz<10)&(zz>-150))|((abs(xx)<24)&(zz<-105)&(zz>-153)),1.,0.)
mask=np.stack([(1-forest)*(1-path),forest*(1-path),path],axis=-1);mask=np.uint8(np.rint(mask*255))
Image.fromarray(mask).save(W/'surface-mask.png')
# Offline material maps. These are authored noise textures, never described as photographs.
rng=np.random.default_rng(1994)
for name,base,mode in [('soil',(113,111,81),'soil'),('stone',(164,165,151),'stone'),('wood',(132,111,86),'wood'),('bark',(111,97,78),'bark'),('roof',(93,99,95),'stone'),('thatch',(154,138,100),'thatch')]:
 n=512; y,x=np.mgrid[:n,:n]; noise=rng.normal(0,1,(n,n)); low=np.array(Image.fromarray(np.uint8(rng.random((32,32))*255)).resize((n,n),Image.Resampling.BICUBIC))/255-.5
 if mode in ['wood','bark','thatch']:
  grain=np.sin(x*.23+np.sin(y*.016)*2)+np.sin(x*.8+np.sin(y*.037)*1.8)*.4
  detail=grain*10+low*29+noise*6
  if mode=='bark':detail-=np.maximum(0,np.sin(x*.11+np.sin(y*.023))-.55)*42
  if mode=='thatch':detail=np.sin(x*2.8+np.sin(y*.004)*7)*16+noise*9+low*21
 else:detail=low*42+noise*10+np.sin(x*.065)*np.cos(y*.047)*5
 rgb=np.clip(np.array(base)[None,None,:]+detail[:,:,None],0,255).astype('uint8')
 Image.fromarray(rgb).save(A/f'{name}-albedo.jpg',quality=91)
 dx,dy=np.gradient(detail); normal=np.stack([-dy*.035,-dx*.035,np.ones_like(dx)],axis=-1); normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 Image.fromarray(np.uint8((normal*.5+.5)*255)).save(A/f'{name}-normal.png')
 Image.fromarray(np.uint8(np.clip(205+detail*.4,0,255))).save(A/f'{name}-roughness.jpg')
# Periodic, small-scale water normal map; independent from stone surfaces.
y,x=np.mgrid[:512,:512];x=x/512*math.tau;y=y/512*math.tau
waveheight=np.sin(x*4+y*7)*.6+np.sin(x*13-y*9)*.22+np.sin(x*21+y*17)*.08
dy,dx=np.gradient(waveheight);normal=np.stack([-dx*7,-dy*7,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
Image.fromarray(np.uint8((normal*.5+.5)*255)).save(A/'water-normal.png')
objects=[]
def add(asset,x,z,scale=1,rotation=0,**kw):
 y=float(height(x,z)); objects.append(dict(id=f'{asset}-{len(objects):04}',asset=asset,position=[round(x,3),round(y,3),round(z,3)],rotation=[0,rotation,0],scale=[scale]*3,**kw))
# Sacred approach: exactly 200 steps, four flights, three 3m landings.
steps=[]
for i in range(200):
 f=i//50; local=i%50
 steps.append(dict(index=i+1,x=0,y=round((i+1)*.19,4),z=round(-(f*27+(local+1)*.48),4),width=5.4,depth=.48,rise=.19))
add('torii',0,5,1,0,landmark=True)
add('torii',0,-108,.9,0,landmark=True); objects[-1]['position'][1]=38
add('shrine',0,-137,1,0,collider={'type':'box','halfExtents':[7,4,4.5]}); objects[-1]['position'][1]=38
add('office',-17,-127,.85,.1,collider={'type':'box','halfExtents':[4,3,3]});objects[-1]['position'][1]=38
add('temizuya',13,-117,1,0); objects[-1]['position'][1]=38
add('ema',-9,-116,1,0);objects[-1]['position'][1]=38
for x in [-4.4,4.4]:
 for i in [7,53,105,155,199]:
  s=steps[i]; add('lantern',x,s['z'],.85);objects[-1]['position'][1]=s['y']-.15
for x in [-5,5]:
 add('komainu',x,-126);objects[-1]['position'][1]=38
# Forest plants: many varied forms; path clearance and lookout kept open.
for i in range(1150):
 x=r.uniform(-420,420); z=r.uniform(-340,430)
 if float(height(x,z))<12 and z>15:continue
 if r.random()>float(terrain_noise(x,z,60))*.7+.25:continue
 if abs(x)<7.8 and -112<z<15:continue
 if abs(x)<28 and -156<z<-108:continue
 if 10<x<70 and -125<z<30:continue
 asset='cedar'+str(i%3) if r.random()<.48 else 'broadleaf'
 add(asset,x,z,r.uniform(.65,1.3),r.random()*math.tau,collider={'type':'cylinder','radius':.4})
# Strong old trees at the approach.
for side in [-1,1]:
 for i in range(5 if side==1 else 12):add('cedar'+str(i%3),side*r.uniform(8,12),-i*9,r.uniform(1,1.28),r.random()*6.28,collider={'type':'cylinder','radius':.48})
# Fern colonies on the shaded approach banks, clear of the walking tread.
for i in range(260):
 z=r.uniform(-103,10);x=r.choice([-1,1])*r.uniform(4.8,18)
 add('fern',x,z,r.uniform(.7,1.4),r.random()*math.tau)
# Small farmsteads on the higher natural levee, with real level pads.
for i,(x,z,level) in enumerate(house_sites):
 side=-1 if i%2 else 1
 add(['house','metal-house','thatch-house'][i%3],x,z,1,math.pi/2*side,collider={'type':'box','halfExtents':[5,3,5]})
 add('shed',x+side*12,z+4,.65,math.pi/2,collider={'type':'box','halfExtents':[2.5,1.6,2]})
for z in range(30,340,28):add('pole',-43+18*math.sin(z*.015),z,1,0)
for i in range(120):
 x=r.uniform(-190,170);z=r.uniform(20,360)
 if abs(x+32-18*math.sin(z*.015))<40 or abs(x-(83+9*math.sin(z*.025)))<9:continue
 if r.random()<.55:add('broadleaf',x,z,r.uniform(.48,.8),r.random()*6.28,collider={'type':'cylinder','radius':.35})
fields=[{'id':f'paddy-{i}','center':[x,level,z],'size':[w,d]} for i,(x,z,w,d,level) in enumerate(plots)]
# Clear road, river, farm plots and house footprints before finalizing vegetation.
houses=[o for o in objects if o.get('collider',{}).get('type')=='box']
def keep_object(o):
 if not (o['asset'].startswith('cedar') or o['asset']=='broadleaf'):return True
 x,_,z=o['position']
 if 12<=z<=365 and abs(x-(-32+18*math.sin(z*.015)))<5:return False
 if -15<=z<=370 and abs(x-(83+9*math.sin(z*.025)))<6:return False
 for h in houses:
  hx,_,hz=h['position'];ext=h['collider']['halfExtents'];scale=h['scale'][0]
  if abs(x-hx)<ext[0]*scale+2.5 and abs(z-hz)<ext[2]*scale+2.5:return False
 for f in fields:
  if abs(x-f['center'][0])<f['size'][0]/2+1 and abs(z-f['center'][2])<f['size'][1]/2+1:return False
 return True
objects=[o for o in objects if keep_object(o)]
meta={'version':2,'seed':19940821,'units':'meters','up':'Y','extent':1200,'resolution':N,'heightEncoding':{'file':'heightmap.r16','format':'uint16-le','minHeight':-8,'range':256,'row0':'z=-600','column0':'x=-600'},'landmarks':{'foot':[0,2,12],'shrine':[0,39.7,-117],'lookout':[21,39.7,-107],'village':[-15.75,float(height(-15.75,75))+1.7,75],'river':[75,float(height(75,115))+1.7,115]},'environment':{'time':18,'latitude':38.3,'date':'1994-08-21','sunAzimuth':240,'fogDensity':.0012},'steps':steps,'objects':objects,'fields':fields,'budgets':{'standard':{'triangles':1500000,'drawCalls':250,'textureMiB':256,'targetFPS':60},'low':{'triangles':650000,'drawCalls':180,'pixelRatio':1},'high':{'triangles':2200000,'drawCalls':350,'pixelRatio':1.5}}}
meta['environment'].update({'sunAzimuth':240,'sunElevation':7.5,'timeRange':[17,19],'sunAzimuthRange':[235,245],'sunElevationRange':[14,1],'hdri':'assets/venice_sunset_1k.hdr','environmentIntensity':.4,'distantCanopy':'canopy.json','exposureRange':[1.3,.95],'hemisphereIntensityRange':[2.0,.8],'directionalIntensityRange':[6.5,1.0],'wind':'low amplitude vertex motion; reimplement per engine'})
meta['river']={'width':4.5,'bedWidth':5.5,'bankWidth':.7,'centerline':[[round(83+9*math.sin(z*.025),4),round(.55-.003*z,4),z] for z in range(-15,591,3)],'bridge':{'position':[83+9*math.sin(115*.025),float(height(83+9*math.sin(115*.025)+6,115))+.15,115],'size':[10,.3,3]}}
meta['roads']=[{'width':4,'points':[[round(-32+18*math.sin(z*.015),4),round(float(height(-32+18*math.sin(z*.015),z))+.055,4),z] for z in range(12,365,3)]}]
(W/'scene.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
print(f'Wrote {N}x{N} uint16 terrain, masks, six original PBR sets, {len(objects)} placements, {len(steps)} steps.')
