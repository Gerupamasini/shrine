import assert from 'node:assert/strict';
import { KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {NodeIO} from '@gltf-transform/core';
import {specs,palette} from './models.mjs';
const io=new NodeIO().registerExtensions([KHRMaterialsClearcoat]);
for(const s of specs){
 const doc=await io.read(new URL(`../../public/assets/models/architecture/${s.id}.glb`,import.meta.url).pathname);
 const {min,max}=getBounds(doc.getRoot().listScenes()[0]);let tris=0;
 for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
  const pos=p.getAttribute('POSITION');assert.ok(pos);assert.ok(palette[p.getMaterial().getName()]);
  const a=pos.getArray();for(let i=0;i<a.length;i++){assert.ok(Number.isFinite(a[i]));}
  tris+=(p.getIndices()?.getCount()??pos.getCount())/3;
 }
 assert.ok(Math.abs(min[1])<.001,`${s.id}: wheels on ground`);
 assert.ok(Math.abs(max[1]-s.h)<.03,`${s.id}: correct roof height`);
 assert.ok(max[2]-min[2]>s.l&&max[2]-min[2]<s.l+.3,`${s.id}: correct length`);
 assert.ok(tris<140000,`${s.id}: triangle budget`);
 const paint=doc.getRoot().listMaterials().find(m=>m.getName()===s.paint);
 assert.ok(paint.getExtension('KHR_materials_clearcoat'),'clearcoat preserved');
 assert.ok(paint.getNormalTexture(),'paint micro-normal embedded');
 if(s.id==='kei-truck'){
  for(const name of ['wheel_fl','wheel_fr','wheel_rl','wheel_rr','steering_wheel'])
   assert.ok(doc.getRoot().listNodes().some(n=>n.getName()===name),`driveable rig preserves ${name}`);
 }
 const low=await io.read(new URL(`../../public/assets/models/architecture/${s.id}-lod1.glb`,import.meta.url).pathname);
 let lowTris=0;for(const mesh of low.getRoot().listMeshes())for(const p of mesh.listPrimitives())lowTris+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;
 assert.ok(lowTris<tris*.6,'LOD reduces geometry by at least 40%');
 console.log(`${s.id}: valid geometry, materials, ground pivot, dimensions; ${tris} triangles`);
}
