"""Deterministic original microsurface maps. No external source images."""
from PIL import Image
import random, math
from pathlib import Path
out=Path(__file__).resolve().parents[2]/'public/assets/textures/vehicles'
out.mkdir(parents=True,exist_ok=True)
n=512;rng=random.Random(1994)
for name in ['paint','rubber','fabric']:
    height=[]
    for y in range(n):
        for x in range(n):
            noise=rng.uniform(-1,1)
            if name=='fabric': v=.5+.17*math.sin(x*math.pi/3)*math.sin(y*math.pi/3)+noise*.05
            elif name=='rubber': v=.5+noise*.12
            else:v=.5+noise*.035+.018*math.sin(x*.25)*math.sin(y*.27)
            height.append(v)
    normal=Image.new('RGB',(n,n));rough=Image.new('RGB',(n,n));norm=[];orm=[]
    for y in range(n):
        for x in range(n):
            dx=(height[y*n+(x+1)%n]-height[y*n+(x-1)%n])*.8
            dy=(height[((y+1)%n)*n+x]-height[((y-1)%n)*n+x])*.8
            norm.append((round(128-dx*127),round(128+dy*127),255))
            v=height[y*n+x]
            orm.append((255,round(235+20*(v-.5)),255))
    normal.putdata(norm);rough.putdata(orm)
    normal.save(out/(name+'-normal.png'),optimize=True);rough.save(out/(name+'-orm.png'),optimize=True)
