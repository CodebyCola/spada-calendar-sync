import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { buildExtension } from "./build.mjs";
import { UNPACKED_CONFIG_REL_PATH } from "./setup-unpacked.mjs";
import { validateManifestForStore } from "./validate-manifest.mjs";

const execFileAsync = promisify(execFile);

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

/**
 * Packages an extension ZIP using a dedicated isolated temporary staging directory
 * so concurrent store and unpacked packaging processes cannot cross-contaminate outputs.
 * @param {{
 *   target?: "store" | "unpacked";
 *   strictOAuth?: boolean;
 *   releaseDir?: string;
 *   unpackedConfig?: any;
 *   unpackedConfigPath?: string;
 *   baseManifestPath?: string;
 * }} [options]
 * @returns {Promise<{ outZip: string; target: "store" | "unpacked"; warnings: string[] }>}
 */
export async function packageExtension(options = {}) {
  const target = options.target ?? "store";
  if (target !== "store" && target !== "unpacked") {
    throw new Error(`Unsupported --target "${target}". Use "store" or "unpacked".`);
  }

  // Unpacked distribution ZIPs always enforce strict OAuth (never ship placeholder clientId)
  const strictOAuth = target === "unpacked" ? true : (options.strictOAuth ?? false);
  const cwd = process.cwd();
  const stagingDir = mkdtempSync(join(tmpdir(), `spada-ext-${target}-`));

  try {
    // 1. Build into isolated empty staging directory (never mutates shared dist/)
    const built = await buildExtension({
      target,
      outDir: stagingDir,
      unpackedConfig: target === "unpacked" ? options.unpackedConfig : undefined,
      unpackedConfigPath: options.unpackedConfigPath,
      baseManifestPath: options.baseManifestPath,
    });

    const manifestPath = join(stagingDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    // 2. Guard against reusing local unpacked OAuth client ID in Store releases
    const disallowedClientIds = [];
    if (target === "store") {
      if (typeof options.unpackedConfig?.clientId === "string" && options.unpackedConfig.clientId.trim()) {
        disallowedClientIds.push(options.unpackedConfig.clientId.trim());
      } else {
        const unpackedPath = resolve(cwd, options.unpackedConfigPath ?? UNPACKED_CONFIG_REL_PATH);
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
    }

    // 3. Validate manifest metadata from the exact stagingDir that will be archived
    const { errors, warnings } = validateManifestForStore(manifest, {
      strictOAuth,
      target,
      disallowedClientIds,
    });
    const allWarnings = [...built.warnings, ...warnings];

    // 4. Verify all referenced files & onboarding assets inside stagingDir exist
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
      if (!existsSync(join(stagingDir, relPath))) {
        errors.push(`Referenced asset missing in staging directory: ${relPath}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    // 5. Create clean ZIP containing ONLY this isolated stagingDir's contents
    const releaseDir = resolve(cwd, options.releaseDir ?? "release");
    mkdirSync(releaseDir, { recursive: true });
    const zipName =
      target === "unpacked"
        ? `spada-calendar-extension-unpacked-v${manifest.version}.zip`
        : `spada-calendar-extension-v${manifest.version}.zip`;
    const outZip = join(releaseDir, zipName);
    rmSync(outZip, { force: true });

    if (process.platform === "win32") {
      const escapedStaging = stagingDir.replace(/'/g, "''");
      const escapedZip = outZip.replace(/'/g, "''");
      await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${escapedStaging}\\*' -DestinationPath '${escapedZip}' -Force`,
      ]);
    } else {
      await execFileAsync("zip", ["-r", outZip, "."], { cwd: stagingDir });
    }

    return { outZip, target, warnings: allWarnings };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    const target = /** @type {"store" | "unpacked"} */ (parseTarget(args));
    const strictOAuth = target === "unpacked" ? true : args.includes("--strict");
    const result = await packageExtension({ target, strictOAuth });
    for (const w of result.warnings) {
      console.warn(`[WARN] ${w}`);
    }
    console.log(`\nPackaged ${result.target} ZIP: ${result.outZip}`);
  } catch (err) {
    const lines = (err instanceof Error ? err.message : String(err)).split("\n");
    for (const line of lines) {
      console.error(`[ERROR] ${line}`);
    }
    process.exit(1);
  }
}
