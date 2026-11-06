from PIL import Image,ImageDraw,ImageFilter
import random
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'public/assets';r=random.Random(1492)
im=Image.new('RGBA',(512,512));d=ImageDraw.Draw(im)
def line(a,b,width=2,col=(90,111,57,255)):
 d.line([a,b],fill=col,width=width)
line((256,501),(256,9),4,(85,89,47,255))
for j in range(22):
 y=38+j*20;span=min(y*.47,145)*(0.8+r.random()*.2)
 for side in [-1,1]:
  ex=256+side*span;ey=y-28-r.random()*20;line((256,y+20),(ex,ey),2)
  for k in range(17):
   t=k/17;xx=256+(ex-256)*t;yy=y+20+(ey-y-20)*t
   for s in [-1,1]:
    length=7+11*r.random();col=(r.randint(61,101),r.randint(86,126),r.randint(35,65),255)
    line((xx,yy),(xx+side*length*.6,yy+s*length),3,col)
# Antialias alpha retains finely divided needle shapes.
im.save(p/'cedar-spray.png')
# Broadleaf: veins, edge irregularity, central fold, photographed-like tonal variation (authored).
im=Image.new('RGBA',(256,256));d=ImageDraw.Draw(im);pts=[]
import math
for i in range(100):
 a=i/100*math.tau;rad=1+.025*math.sin(i*3.4);pts.append((128+math.sin(a)*81*rad,128+math.cos(a)*120*rad))
d.polygon(pts,fill=(82,112,47,255));d.line([(128,246),(128,7)],fill=(125,145,76,255),width=3)
for j in range(9):
 y=28+j*23
 for s in [-1,1]:d.line([(128,y+20),(128+s*(55*math.sin((y/256)*math.pi)+10),y-5)],fill=(101,129,59,255),width=1)
im.save(p/'broadleaf.png')
print('Original botanical alpha atlases saved.')
