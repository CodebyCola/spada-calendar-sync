import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { UNPACKED_CONFIG_REL_PATH } from "./setup-unpacked.mjs";
import { buildManifestForTarget, validateUnpackedConfig } from "./unpacked-manifest.mjs";

function parseBuildArgs(argv) {
  let target = "store";
  let outDir = "dist";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    } else if (arg === "--target" && argv[i + 1]) {
      target = argv[i + 1];
      i++;
    } else if (arg?.startsWith("--out-dir=")) {
      outDir = arg.slice("--out-dir=".length);
    } else if (arg === "--out-dir" && argv[i + 1]) {
      outDir = argv[i + 1];
      i++;
    }
  }

  return { target, outDir };
}

function prepareCleanOutDir(outDir) {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
    return;
  }
  try {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "EBUSY")) {
      for (const entry of readdirSync(outDir)) {
        rmSync(join(outDir, entry), { recursive: true, force: true });
      }
      return;
    }
    throw err;
  }
}

/**
 * Builds the Chrome extension bundle and composed manifest into an isolated or default outDir.
 * @param {{
 *   target?: "store" | "unpacked";
 *   outDir?: string;
 *   unpackedConfig?: any;
 *   unpackedConfigPath?: string;
 *   baseManifestPath?: string;
 * }} [options]
 * @returns {Promise<{ outDir: string; target: "store" | "unpacked"; manifest: Record<string, any>; warnings: string[] }>}
 */
export async function buildExtension(options = {}) {
  const target = options.target ?? "store";
  if (target !== "store" && target !== "unpacked") {
    throw new Error(`Unsupported --target "${target}". Use "store" or "unpacked".`);
  }

  const cwd = process.cwd();
  const outDir = resolve(cwd, options.outDir ?? "dist");
  const baseManifestPath = resolve(cwd, options.baseManifestPath ?? "public/manifest.json");
  const warnings = [];

  let unpackedConfig = options.unpackedConfig;
  if (target === "unpacked") {
    if (!unpackedConfig) {
      const configPath = resolve(cwd, options.unpackedConfigPath ?? UNPACKED_CONFIG_REL_PATH);
      if (!existsSync(configPath)) {
        throw new Error(
          `${UNPACKED_CONFIG_REL_PATH} tidak ditemukan. Jalankan "npm run setup:unpacked" terlebih dahulu.`
        );
      }
      unpackedConfig = JSON.parse(readFileSync(configPath, "utf8"));
    }

    const check = validateUnpackedConfig(unpackedConfig, { strictOAuth: false });
    warnings.push(...check.warnings);
    if (check.errors.length > 0) {
      throw new Error(check.errors.join("\n"));
    }
  }

  prepareCleanOutDir(outDir);

  await build({
    entryPoints: {
      "background/service-worker": "src/background/service-worker.ts",
      "content/spada-observer": "src/content/spada-observer.ts",
      "popup/popup": "src/popup/popup.ts",
      "options/options": "src/options/options.ts",
      "onboarding/onboarding": "src/onboarding/onboarding.ts",
    },
    outdir: outDir,
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

  cpSync(join(cwd, "public"), outDir, { recursive: true });
  cpSync(join(cwd, "src/popup/popup.html"), join(outDir, "popup/popup.html"));
  cpSync(join(cwd, "src/popup/popup.css"), join(outDir, "popup/popup.css"));
  cpSync(join(cwd, "src/options/options.html"), join(outDir, "options/options.html"));
  cpSync(join(cwd, "src/options/options.css"), join(outDir, "options/options.css"));
  cpSync(join(cwd, "src/onboarding/onboarding.html"), join(outDir, "onboarding/onboarding.html"));
  cpSync(join(cwd, "src/onboarding/onboarding.css"), join(outDir, "onboarding/onboarding.css"));

  const baseManifest = JSON.parse(readFileSync(baseManifestPath, "utf8"));
  const composedManifest = buildManifestForTarget(baseManifest, {
    target,
    unpackedConfig,
    strictOAuth: false,
  });
  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify(composedManifest, null, 2)}\n`,
    "utf8"
  );

  return { outDir, target, manifest: composedManifest, warnings };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { target, outDir } = parseBuildArgs(process.argv.slice(2));
    const result = await buildExtension({
      target: /** @type {"store" | "unpacked"} */ (target),
      outDir,
    });
    for (const w of result.warnings) {
      console.warn(`[WARN] ${w}`);
    }
    console.log(`Built Chrome extension cleanly into ${outDir} (target: ${result.target})`);
  } catch (err) {
    console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
