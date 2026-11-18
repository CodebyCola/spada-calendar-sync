/**
 * Validates manifest.json against Chrome Web Store submission requirements.
 * @param {Record<string, any>} manifest
 * @param {{ strictOAuth?: boolean }} [options]
 * @returns {{ errors: string[]; warnings: string[] }}
 */
export function validateManifestForStore(manifest, options = {}) {
  const errors = [];
  const warnings = [];
  const strictOAuth = options.strictOAuth ?? false;

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

  if (manifest.key) {
    warnings.push(
      'manifest.json contains a "key" field; remove it before uploading to Chrome Web Store.'
    );
  }

  const clientId = manifest.oauth2?.client_id ?? "";
  if (!clientId || clientId.startsWith("YOUR_CHROME_EXTENSION_CLIENT_ID")) {
    const msg =
      "oauth2.client_id is still set to the placeholder value; replace it with your Chrome Extension OAuth Client ID before final Chrome Web Store release.";
    if (strictOAuth) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  }

  return { errors, warnings };
}
