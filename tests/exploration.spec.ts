import { test, expect } from "@playwright/test";
test("arrival → 200-step climb → shrine → lookout → village; settings and collisions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__satoyama?.ready, null, {
    timeout: 90000,
  });
  await expect(page.locator("#enter")).toBeEnabled();
  await page.click("#enter");
  await page.waitForTimeout(1000);
  const arrival = await page.evaluate(() => (window as any).__satoyama.state);
  expect(arrival.grounded).toBeTruthy();
  expect(arrival.steps).toBe(200);
  await page.screenshot({ path: "artifacts/test-arrival.png" });
  // Runs the real Rapier character movement at a fixed 60Hz, not a teleport.
  const top = await page.evaluate(() =>
    (window as any).__satoyama.walk(0, -1, 1750, true),
  );
  expect(top[2]).toBeLessThan(-109);
  expect(top[1]).toBeGreaterThan(39);
  expect(top[1]).toBeLessThan(40);
  // The front wall must block further progress into the worship hall.
  const blocked = await page.evaluate(() =>
    (window as any).__satoyama.walk(0, -1, 360, true),
  );
  expect(blocked[2]).toBeGreaterThan(-132.5);
  expect(blocked[2]).toBeLessThan(-131.5);
  await page.evaluate(() => {
    const g = (window as any).__satoyama;
    g.teleport("shrine");
    g.look(0, 0.03);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "artifacts/test-shrine.png" });
  await page.evaluate(() => {
    const g = (window as any).__satoyama;
    g.teleport("lookout");
    g.look(Math.PI - 0.2, -0.21);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "artifacts/test-lookout.png" });
  const panorama = await page.evaluate(() => (window as any).__satoyama.state);
  expect(panorama.triangles).toBeLessThan(1500000);
  expect(panorama.calls).toBeLessThanOrEqual(250);
  // Return down every flight: no floating or falling through the ramp seams.
  const bottom = await page.evaluate(() => {
    const g = (window as any).__satoyama;
    g.teleport("foot");
    g.walk(0, -1, 1650, true);
    return g.walk(0, 1, 1800, true);
  });
  const ground = await page.evaluate(
    () => (window as any).__satoyama.state.groundHeight,
  );
  expect(bottom[1] - ground).toBeGreaterThan(1.5);
  expect(bottom[1] - ground).toBeLessThan(1.9);
  expect(bottom[2]).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.pointerLockElement === null);
  await page.click("#settings-button");
  await expect(page.locator("#settings")).toBeVisible();
  await page.selectOption("#quality", "low");
  await page.locator("#time").fill("1140");
  await page.locator("#time").dispatchEvent("input");
  await expect(page.locator("#clock")).toHaveText("19:00");
  await page.check("#free");
  expect(await page.evaluate(() => (window as any).__satoyama.state.free)).toBe(
    true,
  );
  await page.uncheck("#free");
  await page.locator("#time").fill("1080");
  await page.locator("#time").dispatchEvent("input");
  await page.selectOption("#quality", "standard");
  await page.click('[data-place="village"]');
  await expect(page.locator("#settings")).toBeHidden();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "artifacts/test-village.png" });
  await page.waitForFunction(
    () => (window as any).__satoyama.state.audio === "合成環境音",
    null,
    { timeout: 20000 },
  );
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#settings-button");
  await expect(page.locator("#settings")).toBeVisible();
  const panel = await page.locator("#settings").boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/test-mobile-settings.png" });
  console.log(
    "Verified states:",
    JSON.stringify({ arrival, top, blocked, panorama, bottom }),
  );
});
