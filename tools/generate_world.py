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
def height(x,z):
 x=np.asarray(x); z=np.asarray(z)
 hill=38*(1-smooth(-112,4,z))*np.exp(-(x/135)**4)
 # Compact, smooth mountain shoulders. Keep the village basin low.
 outer=smooth(190,500,np.sqrt((x*.95)**2+(z*.83)**2))
 mountains=outer*(46+48*(np.sin(x*.010+z*.006)**2)+63*(np.sin(z*.009-x*.007)**4))
 mountains+=outer*(7*np.sin(x*.061+z*.038)+4*np.sin(x*.137-z*.097)+2*np.sin(x*.271+z*.187))
 base=.5*np.sin(x*.026)*np.sin(z*.018)+.3*np.sin(z*.041)
 h=hill+mountains+base
 river_distance=x-(83+9*np.sin(z*.025))
 h-=.6*np.exp(-(river_distance/2.5)**4)*smooth(-25,-10,z)*(1-smooth(370,385,z))
 # Path bed stays below the independently modelled staircase.
 corridor=(abs(x)<4.5)&(z<=0)&(z>=-105)
 d=-z; flight=np.minimum(np.floor(d/27),3); within=np.clip(d-flight*27,0,24)
 steps=flight*50+within/.48
 h=np.where(corridor,np.maximum(-.25,steps*.19-.5),h)
 h=np.where((abs(x)<24)&(z<-105)&(z>-153),38,h)
 return h
axis=np.linspace(-600,600,N); xx,zz=np.meshgrid(axis,axis)
h=height(xx,zz); raw=np.rint(np.clip((h+8)/HEIGHT_RANGE,0,1)*65535).astype('<u2')
raw.tofile(W/'heightmap.r16'); Image.fromarray(raw.astype('uint16')).save(W/'heightmap.png')
mask=np.zeros((N,N,3),dtype=np.uint8); mask[:,:,0]=np.clip(180-h*1.1,0,255); mask[:,:,1]=np.clip(h*2,0,255); mask[:,:,2]=np.where((abs(xx)<6)&(zz<10)&(zz>-150),255,0)
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
for i in range(640):
 x=r.uniform(-260,260); z=r.uniform(-235,75)
 if abs(x)<7.8 and -112<z<15:continue
 if abs(x)<28 and -156<z<-108:continue
 if 10<x<70 and -125<z<30:continue
 asset='cedar'+str(i%3) if r.random()<.72 else 'broadleaf'
 add(asset,x,z,r.uniform(.65,1.3),r.random()*math.tau,collider={'type':'cylinder','radius':.4})
# Strong old trees at the approach.
for side in [-1,1]:
 for i in range(12):add('cedar'+str(i%3),side*r.uniform(8,12),-i*9,r.uniform(1,1.28),r.random()*6.28,collider={'type':'cylinder','radius':.48})
# Houses follow a wandering road. Mixed farm roofs.
for i in range(24):
 z=38+i*12; road=-32+18*math.sin(z*.015); side=(-1 if i%2 else 1)
 x=road+side*r.uniform(15,28)
 add(['house','house','thatch-house','metal-house'][i%4],x,z,r.uniform(.78,1.2),side*.12,collider={'type':'box','halfExtents':[5,3,4]})
 if i%3==0:add('shed',x+side*10,z+3,.65,.1)
for z in range(30,340,28):add('pole',-43+18*math.sin(z*.015),z,1,0)
for i in range(120):
 x=r.uniform(-190,170);z=r.uniform(20,360)
 if abs(x+32-18*math.sin(z*.015))<40 or abs(x-(83+9*math.sin(z*.025)))<9:continue
 if r.random()<.55:add('broadleaf',x,z,r.uniform(.48,.8),r.random()*6.28,collider={'type':'cylinder','radius':.35})
fields=[]
for side in [-1,1]:
 for col in range(3):
  for row in range(7):
   x=(-94-col*32) if side<0 else (116+col*31); z=42+row*43
   fields.append({'id':f'paddy-{side}-{col}-{row}','center':[x,float(height(x,z)),z],'size':[27,37]})
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
meta={'version':1,'seed':19940821,'units':'meters','up':'Y','extent':1200,'resolution':N,'heightEncoding':{'file':'heightmap.r16','format':'uint16-le','minHeight':-8,'range':256,'row0':'z=-600','column0':'x=-600'},'landmarks':{'foot':[0,2,12],'shrine':[0,39.7,-117],'lookout':[14,39.7,-107],'village':[-15.75,2,75],'river':[75,2,115]},'environment':{'time':18,'latitude':38.3,'date':'1994-08-21','sunAzimuth':265,'fogDensity':.0022},'steps':steps,'objects':objects,'fields':fields,'budgets':{'standard':{'triangles':1500000,'drawCalls':250,'textureMiB':256,'targetFPS':60},'low':{'triangles':650000,'drawCalls':180,'pixelRatio':1},'high':{'triangles':2200000,'drawCalls':350,'pixelRatio':1.5}}}
meta['environment'].update({'sunAzimuth':268,'sunElevation':7.5,'timeRange':[17,19],'sunAzimuthRange':[263,273],'sunElevationRange':[14,1],'hdri':'assets/venice_sunset_1k.hdr','environmentIntensity':.55,'exposureRange':[1.1,.85],'wind':'low amplitude vertex motion; reimplement per engine'})
meta['river']={'width':4.5,'bedWidth':5.5,'bankWidth':.7,'centerline':[[round(83+9*math.sin(z*.025),4),round(float(height(83+9*math.sin(z*.025),z))+.55,4),z] for z in range(-15,371,3)],'bridge':{'position':[83+9*math.sin(115*.025),float(height(83,115))+.75,115],'size':[10,.3,3]}}
meta['roads']=[{'width':4,'points':[[round(-32+18*math.sin(z*.015),4),round(float(height(-32+18*math.sin(z*.015),z))+.055,4),z] for z in range(12,365,3)]}]
(W/'scene.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
print(f'Wrote {N}x{N} uint16 terrain, masks, six original PBR sets, {len(objects)} placements, {len(steps)} steps.')
