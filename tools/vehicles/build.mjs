import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {weld,dedup,prune,flatten,join,simplify,getBounds} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {specs,palette} from './models.mjs';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'public/assets/models/architecture');
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
const selected=specs.filter(s=>!only||only.includes(s.id));
if(!selected.length || only?.some(id=>!specs.some(s=>s.id===id)))throw new Error('Unknown vehicle selection');
fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
if(!process.argv.includes('--optimize-only')){
 execFileSync('python3',[path.join(root,'tools/vehicles/textures.py')],{stdio:'inherit'});
 const log=fs.openSync(path.join(root,'.cache/vehicles-blender.log'),'w');
 try{execFileSync('blender',['-b','-t','4','--python',path.join(root,'tools/vehicles/source/build.py')],{stdio:['ignore',log,log],env:{...process.env,VEHICLE_IDS:selected.map(s=>s.id).join(',')}});}finally{fs.closeSync(log);}
}
await MeshoptSimplifier.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),indexPath=path.join(out,'index.json'),index=JSON.parse(fs.readFileSync(indexPath));
const count=doc=>doc.getRoot().listMeshes().reduce((sum,mesh)=>sum+mesh.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);
for(const s of selected){
 const file=path.join(out,s.id+'.glb'),doc=await io.read(file);
 await doc.transform(flatten(),join({keepNamed:false,filter:node=>! /^(wheel_|steering_wheel)/.test(node.getName())}),weld(),dedup(),prune());
 const bounds=getBounds(doc.getRoot().listScenes()[0]),triangles=count(doc);
 await io.write(file,doc);
 await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:.25,error:.007}),prune());
 const low=count(doc);await io.write(path.join(out,s.id+'-lod1.glb'),doc);
 index.assets[s.id]={triangles,min:bounds.min,max:bounds.max,materials:doc.getRoot().listMaterials().map(m=>m.getName()),label:s.label,period:1994,collider:{type:'box',halfExtents:[s.w/2,s.h/2,s.l/2]},lod:{file:s.id+'-lod1.glb',triangles:low,distance:45}};
 console.log(s.id,{triangles,low,bounds,bytes:fs.statSync(file).size});
}
fs.writeFileSync(indexPath,JSON.stringify(index,null,1));
const tablePath=path.join(root,'public/world/materials.json'),table=JSON.parse(fs.readFileSync(tablePath));Object.assign(table.architecture,palette);fs.writeFileSync(tablePath,JSON.stringify(table,null,1)+'\n');
