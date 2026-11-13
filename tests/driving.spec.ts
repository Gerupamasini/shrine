import { test, expect } from "@playwright/test";

test("driving: all parked trucks, enter, steer, brake, views, pause, exit and recovery", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto("/?capture&quality=low");
  await page.waitForFunction(() => (window as any).__satoyama?.ready, null, { timeout: 600000 });
  const initial = await page.evaluate(() => {
    const g = (window as any).__satoyama;
    let staticTrucks = 0;
    g.scene.traverse((o: any) => { if (o.isInstancedMesh && o.name === "architecture/kei-truck") staticTrucks++; });
    return { fleet: g.state.vehicle.cars, placed: g.world.objects.filter((o: any) => o.asset === "kei-truck"), staticTrucks };
  });
  expect(initial.fleet).toHaveLength(8);
  expect(initial.staticTrucks).toBe(0);
  for (const car of initial.fleet) {
    expect(car.wheels).toBe(4);
    const original = initial.placed.find((o: any) => o.id === car.id);
    for (let i = 0; i < 3; i++) expect(car.position[i]).toBeCloseTo(original.position[i], 3);
  }
  await page.locator("#enter").click();
  await page.evaluate(() => document.exitPointerLock());
  // A normal user can find the nearest existing vehicle through the settings menu.
  await page.locator("#settings-button").click();
  await page.locator("#find-vehicle").click();
  await expect(page.locator("#vehicle-prompt")).toBeVisible();
  await page.keyboard.press("e");
  const entered = await page.evaluate(() => (window as any).__satoyama.state.vehicle);
  expect(entered.active).toBeTruthy();
  await expect(page.locator("#vehicle-hud")).toBeVisible();
  // Put that same truck on an existing road for a reproducible open driving stretch.
  await page.evaluate(() => {
    const g = (window as any).__satoyama, sim = g.vehicleSystem.active.sim;
    const road = g.world.roads.find((r: any) => r.class === "prefectural").points as number[][];
    let i = road.findIndex(p => p[2] >= 20); i = Math.max(1, Math.min(road.length - 2, i));
    const p = road[i], next = road[i + 1], yaw = Math.atan2(next[0] - p[0], next[2] - p[2]);
    sim.body.setTranslation({ x: p[0], y: p[1] + sim.spec.centerHeight + .08, z: p[2] }, true);
    sim.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    g.advance(90);
  });
  const before = await page.evaluate(() => (window as any).__satoyama.state.vehicle.position);
  await page.keyboard.down("w");
  const moved = await page.evaluate(() => (window as any).__satoyama.advance(150));
  await page.keyboard.up("w");
  expect(moved.speed).toBeGreaterThan(1);
  expect(await page.locator("#vehicle-speed").textContent()).toBe(String(Math.round(Math.abs(moved.speed) * 3.6)));
  expect(await page.locator("#vehicle-needle").getAttribute("transform")).not.toBe("rotate(140 116 112)");
  expect(Math.hypot(moved.position[0] - before[0], moved.position[2] - before[2])).toBeGreaterThan(3);
  await page.keyboard.press("e");
  expect(await page.evaluate(() => (window as any).__satoyama.state.vehicle.active)).toBe(entered.active);
  await expect(page.locator("#vehicle-notice")).toContainText("停車");
  await page.keyboard.down("a");
  await page.evaluate(() => (window as any).__satoyama.advance(15));
  await page.keyboard.up("a");
  expect(await page.evaluate(() => (window as any).__satoyama.state.vehicle.steering)).toBeLessThan(-.01);
  await page.keyboard.down("Space");
  await page.evaluate(() => (window as any).__satoyama.advance(120));
  await page.keyboard.up("Space");
  expect(Math.abs(await page.evaluate(() => (window as any).__satoyama.state.vehicle.speed))).toBeLessThan(.4);
  await page.keyboard.down("s");
  const reverse = await page.evaluate(() => (window as any).__satoyama.advance(75));
  await page.keyboard.up("s");
  expect(reverse.speed).toBeLessThan(-.3);
  await page.keyboard.down("Space");
  await page.evaluate(() => (window as any).__satoyama.advance(100));
  await page.keyboard.up("Space");
  // Camera mode is changed by the real V key, with the first-person camera inside the right seat.
  await page.evaluate(() => (window as any).__satoyama.renderFrames(1));
  await page.screenshot({ path: "artifacts/driving/third-person.png", timeout: 180000 });
  await page.keyboard.press("v");
  await expect(page.locator("#vehicle-view")).toHaveText("一人称");
  const camera = await page.evaluate(() => {
    const g = (window as any).__satoyama, car = g.vehicleSystem.active;
    car.root.updateMatrixWorld(true);
    const p = car.root.worldToLocal(g.camera.position.clone());
    return { eye: p.toArray(), disabledWalker: !g.vehicleSystem.walker.body.isEnabled() };
  });
  expect(camera.eye[0]).toBeLessThan(0);
  expect(camera.eye[1]).toBeCloseTo(1.30, 2);
  expect(camera.disabledWalker).toBeTruthy();
  await page.evaluate(() => (window as any).__satoyama.renderFrames(1));
  await page.screenshot({ path: "artifacts/driving/first-person.png", timeout: 180000 });
  await page.locator("#vehicle-hud").screenshot({ path: "artifacts/driving/speedometer.png", timeout: 180000 });
  const desktopBounds = await page.locator("#vehicle-hud").boundingBox();
  expect(desktopBounds!.x).toBeGreaterThan(960 * .65);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await page.locator("#vehicle-hud").boundingBox();
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(844);
  await page.setViewportSize({ width: 960, height: 600 });
  await page.keyboard.press("v");
  await expect(page.locator("#vehicle-view")).toHaveText("三人称");
  // Holding a control while opening settings must neither drive nor leave a stuck key on resume.
  await page.keyboard.down("w");
  await page.keyboard.press("Escape");
  const paused = await page.evaluate(() => (window as any).__satoyama.state.vehicle.position);
  const afterPause = await page.evaluate(() => (window as any).__satoyama.advance(120));
  expect(afterPause.position).toEqual(paused);
  await page.keyboard.up("w");
  await page.locator("#close-settings").click();
  await page.keyboard.press("r");
  const reset = await page.evaluate(() => (window as any).__satoyama.state.vehicle);
  for (let i = 0; i < 3; i++) expect(reset.position[i]).toBeCloseTo(entered.position[i], 3);
  await page.keyboard.press("e");
  expect(await page.evaluate(() => (window as any).__satoyama.state.vehicle.active)).toBeNull();
  expect(await page.evaluate(() => (window as any).__satoyama.vehicleSystem.walker.body.isEnabled())).toBeTruthy();
  // Re-enter and use existing map/settings travel: no trapped walker or orphan moving car.
  await page.keyboard.press("e");
  await page.evaluate(() => (window as any).__satoyama.teleport("village"));
  expect(await page.evaluate(() => (window as any).__satoyama.state.vehicle.active)).toBeNull();
  expect(errors).toEqual([]);
});
