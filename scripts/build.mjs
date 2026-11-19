import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { UNPACKED_CONFIG_REL_PATH } from "./setup-unpacked.mjs";
import { buildManifestForTarget, validateUnpackedConfig } from "./unpacked-manifest.mjs";

function parseTarget(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith("--target=")) {
      return arg.slice("--target=".length);
    }
    if (arg === "--target" && argv[i + 1]) {
      return argv[i + 1];
    }
  }
  return "store";
}

const target = parseTarget(process.argv.slice(2));
if (target !== "store" && target !== "unpacked") {
  console.error(`[ERROR] Unsupported --target "${target}". Use "store" or "unpacked".`);
  process.exit(1);
}

let unpackedConfig;
if (target === "unpacked") {
  const configPath = join(process.cwd(), UNPACKED_CONFIG_REL_PATH);
  if (!existsSync(configPath)) {
    console.error(
      `[ERROR] ${UNPACKED_CONFIG_REL_PATH} tidak ditemukan. Jalankan "npm run setup:unpacked" terlebih dahulu.`
    );
    process.exit(1);
  }
  unpackedConfig = JSON.parse(readFileSync(configPath, "utf8"));
  const check = validateUnpackedConfig(unpackedConfig, { strictOAuth: false });
  for (const w of check.warnings) {
    console.warn(`[WARN] ${w}`);
  }
  if (check.errors.length > 0) {
    for (const e of check.errors) {
      console.error(`[ERROR] ${e}`);
    }
    process.exit(1);
  }
}

function prepareCleanDistDir(distDir) {
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
    return;
  }
  try {
    rmSync(distDir, { recursive: true, force: true });
    mkdirSync(distDir, { recursive: true });
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "EBUSY")) {
      for (const entry of readdirSync(distDir)) {
        rmSync(join(distDir, entry), { recursive: true, force: true });
      }
      return;
    }
    throw err;
  }
}

prepareCleanDistDir("dist");

await build({
  entryPoints: {
    "background/service-worker": "src/background/service-worker.ts",
    "content/spada-observer": "src/content/spada-observer.ts",
    "popup/popup": "src/popup/popup.ts",
    "options/options": "src/options/options.ts",
    "onboarding/onboarding": "src/onboarding/onboarding.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: ["chrome120"],
  platform: "browser",
  sourcemap: false,
  minify: false,
  define: {
    __BUILD_TARGET__: JSON.stringify(target),
  },
});

cpSync("public", "dist", { recursive: true });
cpSync("src/popup/popup.html", "dist/popup/popup.html");
cpSync("src/popup/popup.css", "dist/popup/popup.css");
cpSync("src/options/options.html", "dist/options/options.html");
cpSync("src/options/options.css", "dist/options/options.css");
cpSync("src/onboarding/onboarding.html", "dist/onboarding/onboarding.html");
cpSync("src/onboarding/onboarding.css", "dist/onboarding/onboarding.css");

const baseManifest = JSON.parse(readFileSync(join(process.cwd(), "public/manifest.json"), "utf8"));
const composedManifest = buildManifestForTarget(baseManifest, {
  target,
  unpackedConfig,
  strictOAuth: false,
});
writeFileSync(
  join(process.cwd(), "dist/manifest.json"),
  `${JSON.stringify(composedManifest, null, 2)}\n`,
  "utf8"
);

console.log(`Built Chrome extension cleanly into dist/ (target: ${target})`);
