import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('valley fields and bunds at ground and distant viewpoints', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?capture&quality=low');
  await page.waitForFunction(() => (window as any).__satoyama?.ready, null, {timeout:600000});
  await page.evaluate(() => {
    document.getElementById('welcome')!.hidden = true;
    document.body.classList.add('hide-ui');
    (window as any).__satoyama.setTime(16);
  });
  const views = JSON.parse(fs.readFileSync('artifacts/valley-before/cameras.json','utf8'));
  for (const [name, camera] of Object.entries(views)) {
    await page.evaluate((c:any) => {
      const g=(window as any).__satoyama;
      g.place(c[0],c[1],c[2]);g.lookCompass(c[3],c[4]);return g.renderFrames(3);
    }, camera);
    await page.screenshot({path:`artifacts/valley-${process.env.VALLEY_BEFORE ? 'before':process.env.VALLEY_FINAL?'final':'after'}/${name}.png`,timeout:600000});
  }
  expect(errors).toEqual([]);
});
