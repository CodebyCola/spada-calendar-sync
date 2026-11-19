import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { UNPACKED_CONFIG_REL_PATH } from "./setup-unpacked.mjs";
import { validateManifestForStore } from "./validate-manifest.mjs";

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

const args = process.argv.slice(2);
const target = parseTarget(args);
if (target !== "store" && target !== "unpacked") {
  console.error(`[ERROR] Unsupported --target "${target}". Use "store" or "unpacked".`);
  process.exit(1);
}

const strictOAuth = target === "unpacked" ? true : args.includes("--strict");

// 1. Always build fresh dist/ for the requested target
execSync(`node scripts/build.mjs --target=${target}`, { stdio: "inherit" });

const distDir = join(process.cwd(), "dist");
const manifestPath = join(distDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// 2. Guard against reusing local unpacked OAuth client ID in Store releases
const disallowedClientIds = [];
if (target === "store") {
  const unpackedPath = join(process.cwd(), UNPACKED_CONFIG_REL_PATH);
  if (existsSync(unpackedPath)) {
    try {
      const unpacked = JSON.parse(readFileSync(unpackedPath, "utf8"));
      if (typeof unpacked?.clientId === "string" && unpacked.clientId.trim()) {
        disallowedClientIds.push(unpacked.clientId.trim());
      }
    } catch {
      // Ignore malformed local unpacked config when packaging store target
    }
  }
}

// 3. Validate manifest metadata
const { errors, warnings } = validateManifestForStore(manifest, {
  strictOAuth,
  target,
  disallowedClientIds,
});

// 4. Verify all referenced files & onboarding assets inside dist/ exist
const referencedFiles = [
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.options_page,
  "onboarding/onboarding.html",
  "onboarding/onboarding.css",
  "onboarding/onboarding.js",
  ...(manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []),
].filter(Boolean);

for (const relPath of referencedFiles) {
  if (!existsSync(join(distDir, relPath))) {
    errors.push(`Referenced asset missing in dist/: ${relPath}`);
  }
}

for (const w of warnings) {
  console.warn(`[WARN] ${w}`);
}

if (errors.length > 0) {
  for (const e of errors) {
    console.error(`[ERROR] ${e}`);
  }
  process.exit(1);
}

// 5. Create clean ZIP containing ONLY dist/ contents
const releaseDir = join(process.cwd(), "release");
mkdirSync(releaseDir, { recursive: true });
const zipName =
  target === "unpacked"
    ? `spada-calendar-extension-unpacked-v${manifest.version}.zip`
    : `spada-calendar-extension-v${manifest.version}.zip`;
const outZip = join(releaseDir, zipName);
rmSync(outZip, { force: true });

if (process.platform === "win32") {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${outZip}' -Force"`,
    { stdio: "inherit" }
  );
} else {
  execSync(`cd "${distDir}" && zip -r "${outZip}" .`, { stdio: "inherit" });
}

console.log(`\nPackaged ${target} ZIP: ${outZip}`);
