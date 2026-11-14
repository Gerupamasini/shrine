import {test,expect} from '@playwright/test';
import fs from 'node:fs';
test('rural lanes: low speed truck traversal and braking',async({page})=>{
 page.on('console',m=>{if(m.text().startsWith('route-progress'))console.log(m.text());});
 await page.goto('/?capture&quality=low');
 await page.waitForFunction(()=>(window as any).__satoyama?.ready,null,{timeout:600000});
 const ids=await page.evaluate(()=>(window as any).__satoyama.world.ruralLoops.flatMap((l:any)=>l.roads));
 const selected=process.env.RURAL_DRIVE_ROAD;
 if(selected)expect(ids).toContain(selected);
 const results=[];
 const report=selected ? 'artifacts/terrain/driving-recheck.json' : 'artifacts/terrain/driving-routes.json';
 for(const id of ids.filter((id:string)=>!selected || id===selected)){
 const result=await page.evaluate((id)=>{
  const g=(window as any).__satoyama, fleet=g.vehicleSystem,car=fleet.cars[0], sim=car.sim;
  const route=g.world.roads.find((r:any)=>r.id===id).points;
  const p=route[0],q=route.find((v:number[])=>Math.hypot(v[0]-p[0],v[2]-p[2])>6) ?? route[3];
  fleet.leaveForTravel();sim.enter();fleet.active=car;fleet.walker.body.setEnabled(false);
  sim.body.setTranslation({x:p[0],y:p[1]+sim.spec.centerHeight+.2,z:p[2]},true);
  sim.body.setRotation(sim.rotation.setFromAxisAngle({x:0,y:1,z:0},Math.atan2(q[0]-p[0],q[2]-p[2])),true);
  let index=0, frames=0, lastIndex=0, arrived=false;
  for(;frames<60000;frames++){
   if(frames>0 && frames%900===0){if(index<=lastIndex)break;lastIndex=index;}
   if(frames%5000===0)console.log('route-progress',id,index,route.length);
   const pos=sim.position;
   while(index<route.length-1 && Math.hypot(route[index][0]-pos.x,route[index][2]-pos.z)<4)index++;
   const target=route[index],heading=Math.atan2(target[0]-pos.x,target[2]-pos.z);
   const forward=pos.clone().set(0,0,1).applyQuaternion(sim.rotation);
   const angle=Math.atan2(Math.sin(heading-Math.atan2(forward.x,forward.z)),Math.cos(heading-Math.atan2(forward.x,forward.z)));
   fleet.step(1/60,{throttle:sim.speed<3?1:0,steer:Math.max(-1,Math.min(1,angle*2)),brake:sim.speed>3.7});
   if(index===route.length-1 && Math.hypot(target[0]-pos.x,target[2]-pos.z)<3){arrived=true;break;}
   if(Math.hypot(target[0]-pos.x,target[2]-pos.z)>25)break;
  }
  for(let i=0;i<120;i++)fleet.step(1/60,{throttle:0,steer:0,brake:true});
  return {id,index,total:route.length,frames,position:sim.position.toArray(),speed:sim.speed,target:route[index],rotation:sim.rotation.toArray(),ok:arrived && Math.abs(sim.speed)<.3};
 },id);
 results.push(result);console.log(JSON.stringify(result));
 fs.writeFileSync(report,JSON.stringify(results,null,2));
 }
 fs.writeFileSync(report,JSON.stringify(results,null,2));
 expect(results.filter(r=>!r.ok)).toEqual([]);
 await page.evaluate(()=>{const g=(window as any).__satoyama;g.vehicleSystem.view='first';document.getElementById('welcome')!.hidden=true;return g.renderFrames(2)});
 await page.screenshot({path:'artifacts/terrain/road-driver.png',timeout:600000});
 if(selected){
  await page.evaluate(()=>{const g=(window as any).__satoyama;g.teleport('tanada');g.lookCompass(65,-12);g.setTime(17.3);document.body.classList.add('hide-ui');return g.renderFrames(2);});
  await page.screenshot({path:'artifacts/terrain/terraces.png',timeout:600000});
  for(const [id,file,end] of [['east-forest','forest-road',false],['miyazawa-farm','junction',true]] as const){
   await page.evaluate(({id,end})=>{const g=(window as any).__satoyama;const r=g.world.roads.find((r:any)=>r.id===id);const k=end?r.points.length-12:Math.floor(r.points.length/2),p=r.points[k],q=r.points[k+2];g.place(p[0],p[1]+1.7,p[2]);g.lookCompass(Math.atan2(q[0]-p[0],-(q[2]-p[2]))*180/Math.PI,-8);return g.renderFrames(2);},{id,end});
   await page.screenshot({path:`artifacts/terrain/${file}.png`,timeout:600000});
  }
 }

});
