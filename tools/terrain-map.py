"""Review diagram for the exported terrain and settlement placements (not an in-game image)."""
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
w=json.loads(Path('public/world/scene.json').read_text());h=np.fromfile('public/world/heightmap.r16',dtype='<u2').reshape(513,513)/65535*256-8
dz,dx=np.gradient(h,1200/512);shade=np.clip((1-dx*.45-dz*.35)/np.sqrt(1+dx*dx+dz*dz),.3,1.15);t=np.clip(h/180,0,1)
c=np.stack([143-70*t,159-65*t,112-39*t],axis=-1);rgb=np.uint8(np.clip(c*shade[:,:,None],0,255));im=Image.fromarray(rgb).resize((1026,1026));draw=ImageDraw.Draw(im)
def pt(x,z):return ((x+600)/1200*1026,(z+600)/1200*1026)
for f in w['fields']:
 x,y,z=f['center'];a,b=f['size'];draw.rectangle([pt(x-a/2,z-b/2),pt(x+a/2,z+b/2)],fill='#97b45d',outline='#647e37',width=1)
for r in w['roads']:draw.line([pt(x,z) for x,y,z in r['points']],fill='#ebe4d1',width=4)
draw.line([pt(x,z) for x,y,z in w['river']['centerline']],fill='#508daa',width=5)
for o in w['objects']:
 if o['asset'] in ['house','metal-house','thatch-house','shed','shrine','office']:
  x,y,z=o['position'];draw.rectangle([pt(x-4,z-3),pt(x+4,z+3)],fill='#6b4837')
draw.line([pt(0,s['z']) for s in w['steps']],fill='#e8dcc4',width=4)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
for label,x,z in [('Shrine +38 m',-85,-160),('Raised residential terrace',-250,100),('Floodplain / 56 level paddies',100,390),('River outlet',80,530)]:draw.text(pt(x,z),label,font=font,fill='#172c25',stroke_width=2,stroke_fill='#e5e9d5')
draw.rectangle([15,15,580,62],fill='#eef0e4');draw.text((28,28),'1.2 km basin / source heightmap + exported placements',font=font,fill='#172c25');draw.line([(40,960),(211,960)],fill='#172c25',width=4);draw.text((40,975),'200 m',font=font,fill='#172c25');draw.text((960,25),'N ↑',font=font,fill='#172c25')
Path('artifacts/rebuild').mkdir(exist_ok=True);im.save('artifacts/rebuild/terrain-plan.png')
