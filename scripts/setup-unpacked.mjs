import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  deriveExtensionIdFromPublicKey,
  isPlaceholderOAuthClientId,
  isValidOAuthClientIdFormat,
  UNPACKED_CLIENT_ID_PLACEHOLDER,
} from "./unpacked-manifest.mjs";

export const UNPACKED_CONFIG_REL_PATH = "config/unpacked-oauth.json";

/**
 * Generates a fresh RSA-2048 public key (SPKI DER base64) and discards the private key in memory.
 * @returns {string}
 */
export function generateRsaPublicKeyBase64() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der).toString("base64");
}

/**
 * Pure initializer/updater for config/unpacked-oauth.json.
 * Preserves existing publicKey unless resetKey is true, and resets stale clientId when rotating keys.
 * @param {any} existingConfig
 * @param {{ clientId?: string; resetKey?: boolean; generatePublicKey?: () => string }} [options]
 * @returns {{ publicKey: string; extensionId: string; clientId: string }}
 */
export function prepareUnpackedConfig(existingConfig, options = {}) {
  const resetKey = options.resetKey ?? false;
  const generatePublicKey = options.generatePublicKey ?? generateRsaPublicKeyBase64;

  let hasValidExistingKey = false;
  if (!resetKey && existingConfig && typeof existingConfig.publicKey === "string") {
    try {
      deriveExtensionIdFromPublicKey(existingConfig.publicKey);
      hasValidExistingKey = true;
    } catch {
      hasValidExistingKey = false;
    }
  }

  const publicKey = hasValidExistingKey ? existingConfig.publicKey : generatePublicKey();
  const extensionId = deriveExtensionIdFromPublicKey(publicKey);

  let clientId;
  if (options.clientId !== undefined) {
    const trimmed = String(options.clientId).trim();
    if (!isValidOAuthClientIdFormat(trimmed)) {
      throw new Error(
        'Invalid --client-id: must be a Google OAuth Client ID ending with ".apps.googleusercontent.com".'
      );
    }
    clientId = trimmed;
  } else if (resetKey) {
    clientId = UNPACKED_CLIENT_ID_PLACEHOLDER;
  } else if (existingConfig && isValidOAuthClientIdFormat(existingConfig.clientId)) {
    clientId = existingConfig.clientId;
  } else {
    clientId = UNPACKED_CLIENT_ID_PLACEHOLDER;
  }

  return { publicKey, extensionId, clientId };
}

/**
 * Parses CLI flags: --client-id <value> (or --client-id=<value>) and --reset-key.
 * @param {string[]} argv
 */
function parseCliArgs(argv) {
  let clientId;
  let resetKey = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset-key") {
      resetKey = true;
    } else if (arg === "--client-id") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value after --client-id.");
      }
      clientId = next;
      i++;
    } else if (arg?.startsWith("--client-id=")) {
      clientId = arg.slice("--client-id=".length);
    }
  }

  return { clientId, resetKey };
}

function runCli() {
  const { clientId, resetKey } = parseCliArgs(process.argv.slice(2));
  const configPath = join(process.cwd(), UNPACKED_CONFIG_REL_PATH);

  let existingConfig = null;
  if (existsSync(configPath)) {
    existingConfig = JSON.parse(readFileSync(configPath, "utf8"));
  }

  const nextConfig = prepareUnpackedConfig(existingConfig, { clientId, resetKey });

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  console.log(`\nTersimpan di ${UNPACKED_CONFIG_REL_PATH} (gitignored — simpan backup jika pindah laptop!)`);
  console.log(`Stable Extension ID : ${nextConfig.extensionId}`);
  console.log(`OAuth Client ID     : ${nextConfig.clientId}`);

  if (isPlaceholderOAuthClientId(nextConfig.clientId)) {
    console.log("\nLangkah berikutnya di Google Cloud Console (cukup sekali):");
    console.log("  1. Aktifkan Google Calendar API & atur OAuth Consent Screen.");
    console.log("  2. APIs & Services -> Credentials -> Create Credentials -> OAuth client ID.");
    console.log(`  3. Application type: Chrome Extension | Item ID: ${nextConfig.extensionId}`);
    console.log("  4. Jalankan:");
    console.log("     npm run setup:unpacked -- --client-id <CLIENT_ID_DARI_GOOGLE>");
    console.log("  5. Lalu buat ZIP siap bagikan:");
    console.log("     npm run package:unpacked\n");
  } else {
    console.log("\nKonfigurasi unpacked siap! Jalankan:");
    console.log("  npm run package:unpacked\n");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runCli();
  } catch (err) {
    console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
