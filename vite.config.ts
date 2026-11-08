import { defineConfig } from "vite";
import { execSync } from "node:child_process";

// Every build gets its own data version: world data, models, textures and audio are requested
// with ?v=<version>, so a browser can never pair new code with world data cached from an older
// deploy (GitHub Pages serves everything with max-age=600 and no content hashes).
const commit = (() => {
  try {
    return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
})();
const ASSET_VERSION = `${process.env.GITHUB_SHA?.slice(0, 8) ?? commit}-${Date.now().toString(36)}`;

export default defineConfig({
  define: { __ASSET_VERSION__: JSON.stringify(ASSET_VERSION) },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          physics: ["@dimforge/rapier3d-compat"],
        },
      },
    },
  },
});
