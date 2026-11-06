from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parents[1]
base=root/'public/assets'
items=[]
for f in sorted(base.rglob('*')):
 if f.is_file():
  items.append({'file':str(f.relative_to(root/'public')),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'origin':'pmndrs/drei-assets / Poly Haven' if f.suffix=='.hdr' else 'achrefelouafi/GrassSystemThreeJS' if 'pbr' in f.parts else 'original' if 'licenses' not in f.parts else 'license evidence'})
(root/'docs/asset-manifest.json').write_text(json.dumps(items,indent=2))
mats={}
for name in ['wood','darkwood','stone','roof','thatch','bark','soil']:
 texture='wood' if name=='darkwood' else name
 mats[name]={'baseColor':f'assets/{texture}-albedo.jpg','normal':f'assets/{texture}-normal.png','roughness':f'assets/{texture}-roughness.jpg','metallic':0,'normalConvention':'OpenGL +Y','sRGB':['baseColor']}
mats['soil'].update(baseColor='assets/pbr/Ground048-Color.jpg',normal='assets/pbr/Ground048-NormalGL.jpg',roughness='assets/pbr/Ground048-Roughness.jpg',terrainTileMetres=1200/180)
for name,file in [('leaf','cedar-spray.png'),('broadleaf','broadleaf.png')]:mats[name]={'baseColor':f'assets/{file}','doubleSided':True,'alphaMode':'MASK','alphaCutoff':.13,'roughness':1,'wind':'reimplement per engine'}
mats['moss']={'baseColor':'assets/pbr/Moss002-Color.jpg','normal':'assets/pbr/Moss002-NormalGL.jpg','roughness':'assets/pbr/Moss002-Roughness.jpg','terrainTileMetres':1200/180,'normalConvention':'OpenGL +Y','sRGB':['baseColor']}
mats['paper']={'color':'#beb49c','roughness':.92};mats['vermilion']={'color':'#993e2c','roughness':.83};mats['metal']={'color':'#727e7d','roughness':.65,'metallic':.25};mats['water']={'normal':'assets/water-normal.png','roughness':.18,'opacity':.66,'clearcoat':.35,'envMapIntensity':.25,'reimplement':'normal-scroll + environment reflections'}
(root/'public/world/materials.json').write_text(json.dumps(mats,indent=2))
print('Wrote material catalog and checksummed asset manifest.')
