import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});
try {
  const p = await b.newPage();
  p.on("pageerror", (e) => console.error(e));
  await p.goto("http://127.0.0.1:5173/tools/bake-forest.html");
  await p.waitForFunction(() => window.bake);
  const meta = {};
  for (const name of ["cedar0", "broadleaf"]) {
    const { url, ...dims } = await p.evaluate(
      (name) => window.bake(name),
      name,
    );
    await fs.writeFile(
      "public/assets/botanical/" + name + "-impostor.png",
      Buffer.from(url.split(",")[1], "base64"),
    );
    meta[name] = dims;
  }
  await fs.writeFile(
    "public/assets/botanical/impostors.json",
    JSON.stringify(meta, null, 2),
  );
  console.log(meta);
} finally {
  await b.close();
}
