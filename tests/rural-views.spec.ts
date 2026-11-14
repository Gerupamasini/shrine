import {test} from '@playwright/test';
test('rural final ground views after bank grading',async({page})=>{
 await page.goto('/?capture&quality=low');
 await page.waitForFunction(()=>(window as any).__satoyama?.ready,null,{timeout:600000});
 await page.evaluate(()=>{document.getElementById('welcome')!.hidden=true;document.body.classList.add('hide-ui');(window as any).__satoyama.setTime(17.3);});
 for(const [id,file,end] of [['east-forest','forest-road',false],['miyazawa-farm','junction',true]] as const){
  await page.evaluate(({id,end})=>{const g=(window as any).__satoyama,r=g.world.roads.find((r:any)=>r.id===id),k=end?r.points.length-12:Math.floor(r.points.length/2),p=r.points[k],q=r.points[k+2];g.place(p[0],p[1]+1.7,p[2]);g.lookCompass(Math.atan2(q[0]-p[0],-(q[2]-p[2]))*180/Math.PI,-8);return g.renderFrames(2);},{id,end});
  await page.screenshot({path:`artifacts/terrain/${file}.png`,timeout:600000});
 }
});
