import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => window.__satoyama?.ready, null, {
    timeout: 90000,
  });
  await page.click("#enter");
  await page.keyboard.press("Escape");
  await fs.mkdir("artifacts/rebuild", { recursive: true });
  for (const [name, yaw, pitch] of [
    ["foot", 0, 0.1],
    ["lookout", Math.PI - 0.2, -0.21],
    ["shrine", 0, 0.06],
    ["village", 0, 0.02],
  ]) {
    await page.evaluate(
      ([name, yaw, pitch]) => {
        window.__satoyama.teleport(name);
        window.__satoyama.look(yaw, pitch);
      },
      [name, yaw, pitch],
    );
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `artifacts/rebuild/${name}.png` });
    console.log(
      name,
      JSON.stringify(await page.evaluate(() => window.__satoyama.state)),
    );
  }
  console.log("ERRORS", errors);
} finally {
  await browser.close();
}
