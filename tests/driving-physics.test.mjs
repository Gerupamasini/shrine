import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import RAPIER from '@dimforge/rapier3d-compat';

// Exercise the shipping TypeScript physics class against real Rapier, without WebGL.
fs.mkdirSync('.cache', {recursive:true});
const source=fs.readFileSync('src/vehicles/simulation.ts','utf8');
fs.writeFileSync('.cache/vehicle-simulation-test.mjs',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {VehicleSimulation}=await import('../.cache/vehicle-simulation-test.mjs');
await RAPIER.init();
const spec={id:'kei-truck',width:1.395,length:3.295,height:1.715,wheelbase:1.855,frontAxle:1.06,radius:.263,track:1.205,mass:800,centerHeight:.60,suspension:.24};
function fixture(){
 const world=new RAPIER.World({x:0,y:-9.81,z:0});
 world.createCollider(RAPIER.ColliderDesc.cuboid(100,.1,100).setTranslation(0,-.1,0));
 const walker=world.createCollider(RAPIER.ColliderDesc.ball(.3).setTranslation(90,1,90));
 const sim=new VehicleSimulation(world,{id:'test-truck',asset:'kei-truck',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},spec);
 world.step();sim.enter();
 const step=(n,input={throttle:0,steer:0,brake:true})=>{for(let i=0;i<n;i++){sim.beforeStep(1/60,input,walker);world.timestep=1/60;world.step();}};
 step(60);
 return {world,sim,step};
}
test('accelerates forward, brakes to a stop, then reverses',()=>{
 const {world,sim,step}=fixture();
 try{
  step(120,{throttle:1,steer:0,brake:false});
  assert.ok(sim.position.z>3,`forward z=${sim.position.z}, speed=${sim.speed}`);
  assert.ok(sim.speed>2);
  step(120);assert.ok(Math.abs(sim.speed)<.25,`braked ${sim.speed}`);
  const z=sim.position.z;step(120,{throttle:-1,steer:0,brake:false});
  assert.ok(sim.position.z<z-2);assert.ok(sim.speed<-.5);
  assert.ok(sim.position.y>-.2 && sim.position.y<.2,`ground y=${sim.position.y}`);
 }finally{world.free();}
});
test('steering changes the travel direction while driving',()=>{
 const {world,sim,step}=fixture();
 try{step(150,{throttle:1,steer:-1,brake:false});assert.ok(sim.position.x<-.5,`left x=${sim.position.x}`);assert.ok(Math.abs(sim.rotation.y)>.1);}finally{world.free();}
});
test('a solid wall blocks the chassis even with the throttle held',()=>{
 const {world,sim,step}=fixture();
 try{
  world.createCollider(RAPIER.ColliderDesc.cuboid(10,2,.2).setTranslation(0,2,8));world.step();
  step(600,{throttle:1,steer:0,brake:false});
  assert.ok(sim.position.z<6.6,`wall crossing z=${sim.position.z}`);
  assert.ok(sim.position.z>3);assert.ok(Math.abs(sim.position.x)<.5);
 }finally{world.free();}
});
test('parking stops motion and recovery returns to the original placement',()=>{
 const {world,sim,step}=fixture();
 try{
  step(120,{throttle:1,steer:0,brake:false});sim.park();const p=sim.position.clone();
  for(let i=0;i<120;i++)world.step();assert.ok(sim.position.distanceTo(p)<.001);
  sim.reset();assert.ok(sim.position.length()<.001);assert.ok(Math.abs(sim.speed)<.001);
 }finally{world.free();}
});
test('suspension follows a rising ramp and brakes hold on the incline',()=>{
 const {world,sim,step}=fixture();
 try{
  world.createCollider(RAPIER.ColliderDesc.cuboid(5,.1,10).setTranslation(0,.9,10).setRotation({x:Math.sin(-.1/2),y:0,z:0,w:Math.cos(-.1/2)}));
  world.step();step(150,{throttle:1,steer:0,brake:false});
  assert.ok(sim.position.z>4);assert.ok(sim.position.y>.2,`ramp height ${sim.position.y}`);
  assert.ok(Math.abs(sim.rotation.x)>.01);
  step(120);assert.ok(Math.abs(sim.speed)<.35,`hill brake ${sim.speed}`);
 }finally{world.free();}
});
