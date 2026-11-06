// Evaluate a JS expression inside the running app (capture mode). node tools/probe.mjs "<expr>"
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 400)));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://127.0.0.1:5173/?capture&quality=${process.env.Q || "standard"}`);
await page.waitForFunction(() => window.__satoyama?.ready || !document.getElementById("error").hidden, null, { timeout: 600000 });
console.log(JSON.stringify(await page.evaluate(process.argv[2]), null, 1));
await browser.close();
