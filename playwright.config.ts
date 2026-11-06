import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  timeout: 1800000,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/browser-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 960, height: 600 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
      args: [
        "--no-sandbox",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--disable-dev-shm-usage",
      ],
    },
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
