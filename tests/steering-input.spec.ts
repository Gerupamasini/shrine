import {test,expect} from '@playwright/test';

test('A/D and arrow keys turn toward the driver left/right in both views',async({page})=>{
 await page.goto('/?capture&quality=low');
 await page.waitForFunction(()=>(window as any).__satoyama?.ready,null,{timeout:600000});
 await page.locator('#enter').click();
 await page.evaluate(()=>document.exitPointerLock());
 await page.locator('#settings-button').click();
 await page.locator('#find-vehicle').click();
 await page.keyboard.press('e');
 for(const [key,right,view] of [['a',false,'first'],['d',true,'first'],['ArrowLeft',false,'third'],['ArrowRight',true,'third']] as const){
  const initial=await page.evaluate((view)=>{
   const g=(window as any).__satoyama, fleet=g.vehicleSystem,sim=fleet.active.sim;
   const road=g.world.roads.find((r:any)=>r.class==='prefectural').points;
   const k=road.findIndex((p:number[])=>p[2]>=20),p=road[k],q=road[k+1];
   const yaw=Math.atan2(q[0]-p[0],q[2]-p[2]);
   sim.body.setTranslation({x:p[0],y:p[1]+sim.spec.centerHeight+.08,z:p[2]},true);
   sim.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
   sim.body.setLinvel({x:0,y:0,z:0},true);sim.body.setAngvel({x:0,y:0,z:0},true);
   sim.steering=0;fleet.view=view;g.advance(60);return yaw;
  },view);
  await page.keyboard.down('w');await page.keyboard.down(key);
  const result=await page.evaluate(()=>{
   const g=(window as any).__satoyama;g.advance(100);
   const sim=g.vehicleSystem.active.sim, f=sim.position.clone().set(0,0,1).applyQuaternion(sim.rotation);
   return {x:f.x,z:f.z,steering:sim.steering};
  });
  await page.keyboard.up(key);await page.keyboard.up('w');
  const towardRight=-Math.cos(initial)*result.x+Math.sin(initial)*result.z;
  expect(towardRight*(right?1:-1),`${key} in ${view}`).toBeGreaterThan(.08);
  expect(result.steering*(right?-1:1)).toBeGreaterThan(.1);
  if(view==='first'){
   await page.evaluate(()=>(window as any).__satoyama.renderFrames(2));
   await page.screenshot({path:`artifacts/valley-${process.env.VALLEY_FINAL?'final':'after'}/steer-${right?'right':'left'}.png`,timeout:600000});
  }
 }
});
