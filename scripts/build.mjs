import { cpSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: {
    "background/service-worker": "src/background/service-worker.ts",
    "content/spada-observer": "src/content/spada-observer.ts",
    "popup/popup": "src/popup/popup.ts",
    "options/options": "src/options/options.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: ["chrome120"],
  platform: "browser",
  sourcemap: false,
  minify: false,
});

cpSync("public", "dist", { recursive: true });
cpSync("src/popup/popup.html", "dist/popup/popup.html");
cpSync("src/popup/popup.css", "dist/popup/popup.css");
cpSync("src/options/options.html", "dist/options/options.html");
cpSync("src/options/options.css", "dist/options/options.css");

console.log("Built Chrome extension cleanly into dist/");
