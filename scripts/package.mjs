import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validateManifestForStore } from "./validate-manifest.mjs";

const strict = process.argv.includes("--strict");

// 1. Always build fresh dist/
execSync("node scripts/build.mjs", { stdio: "inherit" });

const distDir = join(process.cwd(), "dist");
const manifestPath = join(distDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// 2. Validate manifest metadata
const { errors, warnings } = validateManifestForStore(manifest, { strictOAuth: strict });

// 3. Verify all referenced files inside dist/ exist
const referencedFiles = [
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.options_page,
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

// 4. Create clean ZIP containing ONLY dist/ contents
const releaseDir = join(process.cwd(), "release");
mkdirSync(releaseDir, { recursive: true });
const outZip = join(releaseDir, `spada-calendar-extension-v${manifest.version}.zip`);
rmSync(outZip, { force: true });

if (process.platform === "win32") {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${outZip}' -Force"`,
    { stdio: "inherit" }
  );
} else {
  execSync(`cd "${distDir}" && zip -r "${outZip}" .`, { stdio: "inherit" });
}

console.log(`\nPackaged Chrome Web Store ZIP: ${outZip}`);
