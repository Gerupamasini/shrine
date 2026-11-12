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
  // the village map: M opens the sheet over the paused walk; a place marker takes you there
  await page.locator("#enter").click();
  await page.waitForFunction(() => !(document.getElementById("minimap-wrap") as HTMLElement).hidden, null, { timeout: 60000 });
  await page.keyboard.press("m");
  await expect(page.locator("#map")).toBeVisible();
  const sheet = await page.evaluate(() => {
    const c = document.getElementById("map-canvas") as HTMLCanvasElement;
    const px = c.getContext("2d")!.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data;
    return { w: c.clientWidth, h: c.clientHeight, alpha: px[3] };
  });
  expect(sheet.alpha).toBeGreaterThan(0);
  await page.screenshot({ path: "artifacts/test-map.png", timeout: 600000 });
  const [lk, extent] = await page.evaluate(() => [(window as any).__satoyama.world.landmarks.lookout, (window as any).__satoyama.world.extent]);
  const ppm = (Math.min(sheet.w, sheet.h) * 0.9) / extent;
  await page.mouse.click(sheet.w / 2 + lk[0] * ppm, sheet.h / 2 + lk[2] * ppm);
  await expect(page.locator("#map")).toBeHidden();
  const there = await page.evaluate(() => (window as any).__satoyama.state);
  expect(there.place).toBe("見晴らし");
  await page.keyboard.press("m");
  await expect(page.locator("#map")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#map")).toBeHidden();
  void g;
  expect(errors).toEqual([]);
});

// River banks: the ground under a masonry revetment is sunk and covered by the river-works
// mesh, so the walkable cap, the washing steps and the bridge parapets come from colliders.
test("river: revetment cap, washing steps and bridge are walkable", async ({ page }) => {
  // world data is requested with the build's version, so a deploy never mixes code and stale data
  const dataUrls: string[] = [];
  page.on("request", (r) => { if (!r.url().includes("/src/") && !r.url().includes("?import") && /\/world\/[^/]+\.(json|png|r16)|\/assets\/models\//.test(r.url())) dataUrls.push(r.url()); });
  await page.goto("/?capture&quality=low");
  await page.waitForFunction(() => (window as any).__satoyama?.ready, null, { timeout: 600000 });
  const r = await page.evaluate(() => {
    const g = (window as any).__satoyama, R = g.world.river, bp = R.bed.points as number[][];
    const row = (z: number) => bp.reduce((a, b) => (Math.abs(b[1] - z) < Math.abs(a[1] - z) ? b : a));
    const out: Record<string, number> = {};
    // east levee path at a masonry reach: walking over the cap never drops into the sunken ground
    const [xc, z, B, top] = row(-150);
    g.place(xc + B + 3.5, top + 3, z);
    g.walk(0, 0, 90);
    let minCap = 1e9;
    for (let i = 0; i < 60; i++) {
      const p = g.walk(-1, 0, 2);
      if (p[0] - xc > B + 0.3 && p[0] - xc < B + 1.9) minCap = Math.min(minCap, p[1] - top);
    }
    out.capEye = minCap;
    // washing steps: down into the bed and back up to the path
    const s = R.washSteps[0], w = row(s.z);
    g.place(w[0] + w[2] + 3.2, s.topY + 3, s.z);
    g.walk(0, 0, 90);
    const down = g.walk(-1, 0, 240);
    out.stepsDown = down[1] - s.topY;
    const up = g.walk(1, 0, 320);
    out.stepsUp = up[1] - s.topY;
    // bridge deck: rest height, parapet, crossing onto the farm road
    const b = g.world.objects.find((o: any) => o.asset === "bridge");
    g.place(b.position[0], b.position[1] + 4, b.position[2]);
    out.deckEye = g.walk(0, 0, 120)[1] - b.position[1] - 0.4;
    out.parapet = Math.abs(g.walk(0, -1, 240)[2] - b.position[2]);
    out.across = g.walk(1, 0, 400)[0] - (b.position[0] + b.span / 2);
    return out;
  });
  expect(r.capEye).toBeGreaterThan(1.5);
  expect(r.stepsDown).toBeLessThan(0.5);
  expect(r.stepsUp).toBeGreaterThan(1.5);
  expect(Math.abs(r.deckEye - 1.65)).toBeLessThan(0.1);
  expect(r.parapet).toBeLessThan(1.4);
  expect(r.across).toBeGreaterThan(0);
  expect(dataUrls.length).toBeGreaterThan(5);
  for (const u of dataUrls) expect(u).toMatch(/[?&]v=[\w-]+/);
});
