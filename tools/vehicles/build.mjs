import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {weld,dedup,prune,flatten,join,simplify,getBounds,normals} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {specs,palette} from './models.mjs';
import {splitWheels} from './wheels.mjs';
const designs=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'source/designs.json'),'utf8'));
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'public/assets/models/architecture');
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
const lod2Only=process.argv.includes('--lod2-only');
const selected=specs.filter(s=>!only||only.includes(s.id));
if(!selected.length || only?.some(id=>!specs.some(s=>s.id===id)))throw new Error('Unknown vehicle selection');
fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
if(!process.argv.includes('--optimize-only')&&!lod2Only){
 execFileSync('python3',[path.join(root,'tools/vehicles/textures.py')],{stdio:'inherit'});
 const log=fs.openSync(path.join(root,'.cache/vehicles-blender.log'),'w');
 try{execFileSync('blender',['-b','-t','4','--python',path.join(root,'tools/vehicles/source/build.py')],{stdio:['ignore',log,log],env:{...process.env,VEHICLE_IDS:selected.map(s=>s.id).join(',')}});}finally{fs.closeSync(log);}
}
await MeshoptSimplifier.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),indexPath=path.join(out,'index.json'),index=JSON.parse(fs.readFileSync(indexPath));
const count=doc=>doc.getRoot().listMeshes().reduce((sum,mesh)=>sum+mesh.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);
// LOD2, for a parked car more than ~35 m away: one mesh in one draw call, a couple of thousand
// triangles. The paint is flat colour (the materials are), so each part's colour goes into the
// vertices, the texture coordinates and normals go (their seams locked the simplifier), all parts
// share one material and the whole car is simplified at once. Glass and lenses become opaque and dark.
async function far(s){
 const doc=await io.read(path.join(out,s.id+'-lod1.glb')),root=doc.getRoot(),buffer=root.listBuffers()[0];
 const farMat=doc.createMaterial('vehicle_far').setRoughnessFactor(.5).setMetallicFactor(0);
 for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){
  const m=p.getMaterial(),c=m?m.getBaseColorFactor():[.5,.5,.5,1];
  const rgb=m&&m.getAlphaMode()==='BLEND'?[c[0]*.35+.015,c[1]*.35+.02,c[2]*.35+.025]:c.slice(0,3);
  const n=p.getAttribute('POSITION').getCount(),col=new Float32Array(n*3);
  for(let i=0;i<n;i++)col.set(rgb,i*3);
  for(const sem of p.listSemantics())if(sem!=='POSITION')p.setAttribute(sem,null);
  p.setAttribute('COLOR_0',doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer));
  p.setMaterial(farMat);
 }
 await doc.transform(flatten(),join({keepNamed:false}),weld(),simplify({simplifier:MeshoptSimplifier,ratio:.03,error:.015,lockBorder:false}),normals({overwrite:true}),dedup(),prune());
 const triangles=count(doc);await io.write(path.join(out,s.id+'-lod2.glb'),doc);
 index.assets[s.id].lod2={file:s.id+'-lod2.glb',triangles,distance:35};
 console.log(s.id,'lod2',triangles,'triangles',doc.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().length,0),'draws');
}
for(const s of selected){
 if(lod2Only){await far(s);continue;}
 const file=path.join(out,s.id+'.glb'),doc=await io.read(file);
 await doc.transform(flatten(),join({keepNamed:false,filter:node=>! /^(wheel_|steering_wheel)/.test(node.getName())}));
 // (models whose wheels came joined into the body get wheel nodes the game can spin and steer)
 const split=splitWheels(doc,designs.find(d=>d.id===s.id));
 if(split)console.log(s.id,'wheels split out:',split,'triangles');
 await doc.transform(weld(),dedup(),prune());
 const bounds=getBounds(doc.getRoot().listScenes()[0]),triangles=count(doc);
 await io.write(file,doc);
 await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:.25,error:.007}),prune());
 const low=count(doc);await io.write(path.join(out,s.id+'-lod1.glb'),doc);
 index.assets[s.id]={triangles,min:bounds.min,max:bounds.max,materials:doc.getRoot().listMaterials().map(m=>m.getName()),label:s.label,period:1994,collider:{type:'box',halfExtents:[s.w/2,s.h/2,s.l/2]},lod:{file:s.id+'-lod1.glb',triangles:low,distance:45}};
 console.log(s.id,{triangles,low,bounds,bytes:fs.statSync(file).size});
 await far(s);
}
fs.writeFileSync(indexPath,JSON.stringify(index,null,1));
const tablePath=path.join(root,'public/world/materials.json'),table=JSON.parse(fs.readFileSync(tablePath));Object.assign(table.architecture,palette);fs.writeFileSync(tablePath,JSON.stringify(table,null,1)+'\n');
