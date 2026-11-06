import { test, expect } from "@playwright/test";

// Real Rapier character movement at a fixed 60 Hz (no teleports while walking).
test("foot torii → 200-step climb → precinct → lookout; collisions, settings, no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/?capture&quality=low");
  await page.waitForFunction(() => (window as any).__satoyama?.ready, null, { timeout: 600000 });
  await expect(page.locator("#enter")).toBeEnabled();
  const g = () => (window as any).__satoyama;
  const arrival = await page.evaluate(() => (window as any).__satoyama.state);
  expect(arrival.steps).toBe(200);
  expect(arrival.place).toBe("麓の鳥居");
  // climb at running pace up the four flights
  const top = await page.evaluate(() => (window as any).__satoyama.walk(1, 0, 2400, true));
  expect(top[0]).toBeGreaterThan(205);
  expect(top[1]).toBeGreaterThan(43.4); // eye height above the 42 m precinct
  expect(top[1]).toBeLessThan(44.0);
  // the offertory box / worship hall blocks further progress
  const blocked = await page.evaluate(() => (window as any).__satoyama.walk(1, 0, 900, true));
  expect(blocked[0]).toBeLessThan(246);
  // walk back down without falling through or floating
  const down = await page.evaluate(() => {
    const s = (window as any).__satoyama;
    s.teleport("shrine");
    return s.walk(-1, 0, 2600, true);
  });
  const st = await page.evaluate(() => (window as any).__satoyama.state);
  expect(st.grounded).toBeTruthy();
  expect(Math.abs(down[1] - 1.62 - st.groundHeight)).toBeLessThan(0.6);
  // settings: time of day and quality switch without errors
  await page.evaluate(() => {
    const s = (window as any).__satoyama;
    s.setTime(17.0);
    s.setTime(19.0);
    s.setTime(18.0);
    s.setQuality("standard");
  });
  // views for the record
  for (const [name, place, az, pitch] of [
    ["foot", "foot", 90, 2],
    ["lookout", "lookout", 225, -8],
  ] as const) {
    await page.evaluate(([p, a, pi]) => {
      const s = (window as any).__satoyama;
      s.teleport(p);
      s.lookCompass(a, pi);
      s.renderFrames(2);
    }, [place, az, pitch]);
    await page.screenshot({ path: `artifacts/test-${name}.png`, timeout: 600000 });
  }
  void g;
  expect(errors).toEqual([]);
});
