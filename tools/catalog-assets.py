from pathlib import Path
import json,hashlib,struct
root=Path(__file__).resolve().parents[1]
base=root/'public/assets'
items=[]
for f in sorted(base.rglob('*')):
 if f.is_file():
  items.append({'file':str(f.relative_to(root/'public')),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'origin':'pmndrs/drei-assets / Poly Haven' if f.suffix=='.hdr' else 'achrefelouafi/GrassSystemThreeJS' if 'pbr' in f.parts else 'dgreenheck/ez-tree (MIT; modified generator and botanical textures)' if 'botanical' in f.parts or (f.suffix=='.glb' and (f.stem.startswith('cedar') or f.stem.startswith('broadleaf'))) else 'original' if 'licenses' not in f.parts else 'license evidence'})
(root/'docs/asset-manifest.json').write_text(json.dumps(items,indent=2))
mats={}
for name in ['wood','darkwood','stone','roof','thatch','bark','soil']:
 texture='wood' if name=='darkwood' else name
 mats[name]={'baseColor':f'assets/{texture}-albedo.jpg','normal':f'assets/{texture}-normal.png','roughness':f'assets/{texture}-roughness.jpg','metallic':0,'normalConvention':'OpenGL +Y','sRGB':['baseColor']}
mats['soil'].update(baseColor='assets/pbr/Ground048-Color.jpg',normal='assets/pbr/Ground048-NormalGL.jpg',roughness='assets/pbr/Ground048-Roughness.jpg',terrainTileMetres=1200/650)
for name,file in [('leaf','cedar-spray.png'),('broadleaf','broadleaf.png')]:mats[name]={'baseColor':f'assets/{file}','doubleSided':True,'alphaMode':'MASK','alphaCutoff':.13,'roughness':1,'wind':'reimplement per engine'}
mats['moss']={'baseColor':'assets/botanical/grass-ground.jpg','normal':'assets/pbr/Ground103-NormalGL.jpg','roughness':'assets/pbr/Ground103-Roughness.jpg','terrainTileMetres':1200/650,'normalConvention':'OpenGL +Y','sRGB':['baseColor']}
mats['paper']={'color':'#beb49c','roughness':.92};mats['vermilion']={'color':'#993e2c','roughness':.83};mats['metal']={'color':'#727e7d','roughness':.65,'metallic':.25};mats['water']={'normal':'assets/water-normal.png','roughness':.18,'opacity':.66,'clearcoat':.35,'envMapIntensity':.25,'reimplement':'normal-scroll + environment reflections'}
mats['moss']['terrainTileMetres']=1200/260
mats['photobark']={'baseColor':'assets/botanical/pine-bark-Color.jpg','normal':'assets/botanical/pine-bark-NormalGL.jpg','roughness':'assets/botanical/pine-bark-Roughness.jpg','repeat':[1,3],'normalConvention':'OpenGL +Y','sRGB':['baseColor']}
for name,file in [('pine-leaves','pine'),('oak-leaves','oak')]:mats[name]={'baseColor':f'assets/botanical/{file}.png','doubleSided':True,'alphaMode':'MASK','alphaCutoff':.35,'roughness':1,'wind':'reimplement per engine','license':'MIT / Daniel Greenheck'}
mats['fern']={'color':'#667d47','roughness':1,'doubleSided':True}
mats['glass']={'color':'#283a39','roughness':.22,'metallic':.2}
mats['plaster']={'color':'#aaa38c','roughness':1,'normal':'assets/stone-normal.png','normalScale':.08}
mats['vermilion'].update(baseColor='assets/wood-albedo.jpg',normal='assets/wood-normal.png',color='#b95d43',normalScale=.11)
for name,color in {'wood':'#b8a58d','darkwood':'#695b47','stone':'#b3b5a9','roof':'#8e9894','thatch':'#c3b391','bark':'#b5a590','soil':'#b9b8a6','moss':'#e3dfc2','photobark':'#a69b87','pine-leaves':'#a0ad8c','oak-leaves':'#a5b082'}.items():mats[name]['color']=color
(root/'public/world/materials.json').write_text(json.dumps(mats,indent=2))
print('Wrote material catalog and checksummed asset manifest.')

models=[]
for f in sorted((base/'models').glob('*.glb')):
 b=f.read_bytes();g=json.loads(b[20:20+struct.unpack_from('<I',b,12)[0]]);vertices=triangles=0
 for mesh in g['meshes']:
  for primitive in mesh['primitives']:
   v=g['accessors'][primitive['attributes']['POSITION']]['count'];vertices+=v;triangles+=(g['accessors'][primitive['indices']]['count'] if 'indices' in primitive else v)//3
 models.append({'file':str(f.relative_to(root)),'vertices':vertices,'triangles':triangles,'bytes':len(b)})
(root/'docs/model-counts.json').write_text(json.dumps(models,indent=2))
