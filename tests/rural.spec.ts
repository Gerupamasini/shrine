import { test, expect } from '@playwright/test';

test('rural circuits: walk every new lane in both directions with real collisions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto('/?capture&quality=low');
  await page.waitForFunction(() => (window as any).__satoyama?.ready, null, { timeout: 600000 });
  const ids = await page.evaluate(() => (window as any).__satoyama.world.ruralLoops.map((l: any) => l.id));
  console.log('Rural world ready; testing complete circuits');
  for (const id of ids) {
    for (const reverse of [false, true]) {
      const result = await page.evaluate(({id, reverse}) => {
        const g = (window as any).__satoyama;
        const loop = g.world.ruralLoops.find((l: any) => l.id === id);
        const points = loop.roads.flatMap((id: string) => g.world.roads.find((r: any) => r.id === id).points);
        const start=points[0], end=points.at(-1);
        const back=g.world.roads.find((r: any) => r.id === loop.returnVia).points
          .filter((p: number[]) => p[2]>Math.min(start[2],end[2]) && p[2]<Math.max(start[2],end[2]));
        back.sort((a: number[], b: number[]) => (a[2]-b[2])*Math.sign(start[2]-end[2]));
        points.push(...back, start);
        if (reverse) points.reverse();
        g.setFree(false);
        g.place(points[0][0], points[0][1]+1.7, points[0][2]);
        g.walk(0,0,45);
        for (let i=1;i<points.length;i++) {
          const target=points[i];
          let p=g.state.position;
          let distance=Math.hypot(target[0]-p[0],target[2]-p[2]);
          for(let frame=0;distance>.65 && frame<900;frame+=5) {
            p=g.walk(target[0]-p[0],target[2]-p[2],5,true);
            distance=Math.hypot(target[0]-p[0],target[2]-p[2]);
          }
          if(distance>1.2) return {ok:false, id, reverse, point:i, position:p, target, distance};
        }
        return {ok:true,id,reverse};
      }, {id,reverse});
      expect(result, JSON.stringify(result)).toMatchObject({ok:true});
      console.log(`Circuit ${id}, ${reverse ? 'reverse' : 'forward'} passed`);
    }
  }
  await page.evaluate(() => {
    const g=(window as any).__satoyama;
    g.teleport('tanada'); g.lookCompass(65,-12); g.setTime(17.3);
    document.getElementById('welcome')!.hidden=true;
    document.body.classList.add('hide-ui');
    return g.renderFrames(2);
  });
  await page.screenshot({path:'artifacts/terrain/terraces.png',timeout:600000});
  await page.evaluate(() => {
    const g=(window as any).__satoyama;
    const r=g.world.roads.find((r:any)=>r.id==='east-forest');
    const k=Math.floor(r.points.length/2), p=r.points[k], q=r.points[k+2];
    g.place(p[0],p[1]+1.7,p[2]);
    g.lookCompass(Math.atan2(q[0]-p[0],-(q[2]-p[2]))*180/Math.PI,-8);
    return g.renderFrames(2);
  });
  await page.screenshot({path:'artifacts/terrain/forest-road.png',timeout:600000});
  expect(errors).toEqual([]);
});
