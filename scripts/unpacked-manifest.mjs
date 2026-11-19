import { createHash, createPublicKey } from "node:crypto";

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Validates that base64 bytes represent an RSA-2048 SPKI DER public key (rejecting PKCS#8 private keys
 * and arbitrary payloads), then derives Chromium's 32-character ('a'-'p') extension ID.
 * @param {string} publicKeyBase64
 * @returns {string}
 */
export function deriveExtensionIdFromPublicKey(publicKeyBase64) {
  if (typeof publicKeyBase64 !== "string" || publicKeyBase64.length === 0) {
    throw new Error("Public key is required and must be a non-empty base64 string.");
  }

  if (publicKeyBase64.length % 4 !== 0 || !BASE64_PATTERN.test(publicKeyBase64)) {
    throw new Error("Public key must be a valid canonical base64 string (without PEM headers or whitespace).");
  }

  const derBytes = Buffer.from(publicKeyBase64, "base64");
  if (derBytes.length === 0 || derBytes.toString("base64") !== publicKeyBase64) {
    throw new Error("Public key must be a valid canonical base64 string.");
  }

  let parsedKey;
  try {
    parsedKey = createPublicKey({ key: derBytes, format: "der", type: "spki" });
  } catch {
    throw new Error(
      "Public key must be a valid DER-encoded SPKI RSA-2048 public key (private keys and arbitrary base64 payloads are rejected)."
    );
  }

  if (parsedKey.type !== "public" || parsedKey.asymmetricKeyType !== "rsa") {
    throw new Error("Public key must be an RSA SPKI public key.");
  }

  if (parsedKey.asymmetricKeyDetails?.modulusLength !== 2048) {
    throw new Error(
      `Public key must be an RSA-2048 SPKI public key (got ${String(parsedKey.asymmetricKeyDetails?.modulusLength ?? "unknown")}-bit).`
    );
  }

  const canonicalSpkiDer = Buffer.from(parsedKey.export({ type: "spki", format: "der" }));
  if (Buffer.compare(derBytes, canonicalSpkiDer) !== 0) {
    throw new Error(
      "Public key contains trailing bytes or non-canonical DER encoding; expected exact DER SPKI RSA-2048 bytes."
    );
  }

  const digest = createHash("sha256").update(canonicalSpkiDer).digest();
  let extensionId = "";
  for (let i = 0; i < 16; i++) {
    const byte = digest[i] ?? 0;
    extensionId += String.fromCharCode(97 + ((byte >> 4) & 0x0f));
    extensionId += String.fromCharCode(97 + (byte & 0x0f));
  }
  return extensionId;
}

export const UNPACKED_CLIENT_ID_PLACEHOLDER = "YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com";

const OAUTH_CLIENT_ID_PATTERN = /^[^\s]+\.apps\.googleusercontent\.com$/;
const PLACEHOLDER_CLIENT_ID_PATTERN = /^YOUR_.*CLIENT_ID/i;

/**
 * Checks whether a Google OAuth Client ID has the expected *.apps.googleusercontent.com format.
 * @param {unknown} clientId
 * @returns {boolean}
 */
export function isValidOAuthClientIdFormat(clientId) {
  return typeof clientId === "string" && OAUTH_CLIENT_ID_PATTERN.test(clientId);
}

/**
 * Checks whether an OAuth Client ID is still a template placeholder value.
 * @param {unknown} clientId
 * @returns {boolean}
 */
export function isPlaceholderOAuthClientId(clientId) {
  return (
    typeof clientId !== "string" ||
    clientId.trim().length === 0 ||
    PLACEHOLDER_CLIENT_ID_PATTERN.test(clientId.trim())
  );
}

/**
 * Validates config/unpacked-oauth.json shape, extensionId derivation match, and clientId rules.
 * @param {unknown} config
 * @param {{ strictOAuth?: boolean }} [options]
 * @returns {{ errors: string[]; warnings: string[]; derivedExtensionId: string | null }}
 */
export function validateUnpackedConfig(config, options = {}) {
  const errors = [];
  const warnings = [];
  const strictOAuth = options.strictOAuth ?? false;

  if (!config || typeof config !== "object") {
    return {
      errors: ["Unpacked config must be a JSON object with publicKey, extensionId, and clientId."],
      warnings,
      derivedExtensionId: null,
    };
  }

  const record = /** @type {Record<string, unknown>} */ (config);
  let derivedExtensionId = null;

  try {
    derivedExtensionId = deriveExtensionIdFromPublicKey(
      typeof record.publicKey === "string" ? record.publicKey : ""
    );
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (derivedExtensionId) {
    if (record.extensionId !== derivedExtensionId) {
      errors.push(
        `extensionId mismatch: expected "${derivedExtensionId}" derived from publicKey, got "${String(record.extensionId ?? "")}".`
      );
    }
  }

  const clientId = record.clientId;
  if (!isValidOAuthClientIdFormat(clientId)) {
    errors.push(
      'clientId must be a valid Google OAuth Client ID ending with ".apps.googleusercontent.com".'
    );
  } else if (isPlaceholderOAuthClientId(clientId)) {
    const msg =
      "clientId is still set to the placeholder value; run `npm run setup:unpacked -- --client-id <CLIENT_ID>` before packaging unpacked ZIP.";
    if (strictOAuth) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  }

  return { errors, warnings, derivedExtensionId };
}

/**
 * Composes a target-specific Chrome Extension manifest ("store" strips key, "unpacked" injects key + clientId).
 * @param {Record<string, any>} baseManifest
 * @param {{ target: "store" | "unpacked"; unpackedConfig?: any; strictOAuth?: boolean }} options
 * @returns {Record<string, any>}
 */
export function buildManifestForTarget(baseManifest, options) {
  const target = options?.target ?? "store";
  const manifest = structuredClone(baseManifest);

  if (target === "store") {
    delete manifest.key;
    return manifest;
  }

  if (target === "unpacked") {
    const validation = validateUnpackedConfig(options?.unpackedConfig, {
      strictOAuth: options?.strictOAuth ?? false,
    });
    if (validation.errors.length > 0) {
      throw new Error(`Invalid unpacked config:\n- ${validation.errors.join("\n- ")}`);
    }

    manifest.key = options.unpackedConfig.publicKey;
    manifest.oauth2 = {
      ...(manifest.oauth2 ?? {}),
      client_id: options.unpackedConfig.clientId,
    };
    return manifest;
  }

  throw new Error(`Unsupported manifest target: ${String(target)}`);
}
