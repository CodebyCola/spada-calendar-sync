import {
  deriveExtensionIdFromPublicKey,
  isPlaceholderOAuthClientId,
  isValidOAuthClientIdFormat,
} from "./unpacked-manifest.mjs";

/**
 * Validates manifest.json against Chrome Web Store or Unpacked distribution requirements.
 * @param {Record<string, any>} manifest
 * @param {{ strictOAuth?: boolean; target?: "store" | "unpacked"; disallowedClientIds?: string[] }} [options]
 * @returns {{ errors: string[]; warnings: string[] }}
 */
export function validateManifestForStore(manifest, options = {}) {
  const errors = [];
  const warnings = [];
  const strictOAuth = options.strictOAuth ?? false;
  const target = options.target ?? "store";
  const disallowedClientIds = options.disallowedClientIds ?? [];

  if (manifest.manifest_version !== 3) {
    errors.push("manifest_version must be 3.");
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("name is required.");
  } else if (manifest.name.length > 75) {
    errors.push(`name exceeds Chrome Web Store 75-character limit (${manifest.name.length}).`);
  }

  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push("description is required.");
  } else if (manifest.description.length > 132) {
    errors.push(
      `description exceeds Chrome Web Store 132-character limit (${manifest.description.length}).`
    );
  }

  if (!manifest.version || !/^\d+(\.\d+){1,3}$/.test(String(manifest.version))) {
    errors.push("version must be a valid numeric dot-separated Chrome extension version.");
  }

  if (target === "unpacked") {
    if (!manifest.key || typeof manifest.key !== "string") {
      errors.push(
        'manifest.json is missing a "key" field required for a stable unpacked Extension ID.'
      );
    } else {
      try {
        deriveExtensionIdFromPublicKey(manifest.key);
      } catch (err) {
        errors.push(`manifest.json "key" is invalid: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (manifest.key) {
    warnings.push(
      'manifest.json contains a "key" field; remove it before uploading to Chrome Web Store.'
    );
  }

  const clientId = manifest.oauth2?.client_id ?? "";
  if (!isValidOAuthClientIdFormat(clientId)) {
    const msg =
      "oauth2.client_id must be a valid Google OAuth Client ID ending with .apps.googleusercontent.com.";
    if (strictOAuth) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  } else if (isPlaceholderOAuthClientId(clientId)) {
    const msg =
      target === "unpacked"
        ? "oauth2.client_id is still set to the placeholder value; configure config/unpacked-oauth.json via `npm run setup:unpacked -- --client-id <CLIENT_ID>` before packaging unpacked ZIP."
        : "oauth2.client_id is still set to the placeholder value; replace it with your Chrome Web Store OAuth Client ID before final Chrome Web Store release.";
    if (strictOAuth) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  } else if (target === "store" && disallowedClientIds.includes(clientId)) {
    errors.push(
      "oauth2.client_id in store manifest matches the unpacked OAuth Client ID; register a dedicated Client ID for the Chrome Web Store Item ID."
    );
  }

  return { errors, warnings };
}
