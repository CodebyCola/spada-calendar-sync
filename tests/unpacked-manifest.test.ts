import { describe, expect, it } from "vitest";
import {
  buildManifestForTarget,
  deriveExtensionIdFromPublicKey,
  UNPACKED_CLIENT_ID_PLACEHOLDER,
  validateUnpackedConfig,
} from "../scripts/unpacked-manifest.mjs";

const SAMPLE_KEY = "aGVsbG8=";
const SAMPLE_ID = "cmpcenlkfplakdaocgoidlckmfljocjo";

describe("deriveExtensionIdFromPublicKey", () => {
  it("Derives Chromium 32-char a-p extension ID from base64 DER bytes", () => {
    // Independent vector: sha256("hello") first 16 bytes = 2cf24dba5fb0a30e26e83b2ac5b9e29e
    expect(deriveExtensionIdFromPublicKey("aGVsbG8=")).toBe("cmpcenlkfplakdaocgoidlckmfljocjo");
  });

  it("Rejects empty strings, PEM headers, and malformed base64", () => {
    expect(() => deriveExtensionIdFromPublicKey("")).toThrow(/public key/i);
    expect(() => deriveExtensionIdFromPublicKey("-----BEGIN PUBLIC KEY-----\naGVsbG8=")).toThrow(
      /base64/i
    );
    expect(() => deriveExtensionIdFromPublicKey("not@valid!base64")).toThrow(/base64/i);
  });
});

describe("validateUnpackedConfig", () => {
  it("Passes with zero errors and warnings for a complete valid unpacked config", () => {
    const result = validateUnpackedConfig(
      {
        publicKey: SAMPLE_KEY,
        extensionId: SAMPLE_ID,
        clientId: "1234567890-abc.apps.googleusercontent.com",
      },
      { strictOAuth: true }
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.derivedExtensionId).toBe(SAMPLE_ID);
  });

  it("Rejects mismatched extensionId and malformed clientId", () => {
    const result = validateUnpackedConfig({
      publicKey: SAMPLE_KEY,
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      clientId: "invalid-client-id",
    });

    expect(result.errors.some((e) => /extensionId/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /clientId/i.test(e))).toBe(true);
  });

  it("Flags placeholder clientId as warning when strictOAuth is false and error when strictOAuth is true", () => {
    const config = {
      publicKey: SAMPLE_KEY,
      extensionId: SAMPLE_ID,
      clientId: UNPACKED_CLIENT_ID_PLACEHOLDER,
    };

    const nonStrict = validateUnpackedConfig(config, { strictOAuth: false });
    expect(nonStrict.errors).toEqual([]);
    expect(nonStrict.warnings.some((w) => /placeholder/i.test(w))).toBe(true);

    const strict = validateUnpackedConfig(config, { strictOAuth: true });
    expect(strict.errors.some((e) => /placeholder/i.test(e))).toBe(true);
  });
});

describe("buildManifestForTarget", () => {
  const baseManifest = {
    manifest_version: 3,
    name: "SPADA UPNYK Assignment Scanner",
    version: "1.0.0",
    key: "should-be-stripped-in-store",
    oauth2: {
      client_id: "store-client-123.apps.googleusercontent.com",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    },
  };

  it("Strips key and preserves base oauth2 client_id for store target without mutating baseManifest", () => {
    const built = buildManifestForTarget(baseManifest, { target: "store" });

    expect("key" in built).toBe(false);
    expect(built.oauth2.client_id).toBe("store-client-123.apps.googleusercontent.com");
    expect(baseManifest.key).toBe("should-be-stripped-in-store");
  });

  it("Injects key and unpacked clientId for unpacked target", () => {
    const built = buildManifestForTarget(baseManifest, {
      target: "unpacked",
      strictOAuth: true,
      unpackedConfig: {
        publicKey: SAMPLE_KEY,
        extensionId: SAMPLE_ID,
        clientId: "unpacked-client-999.apps.googleusercontent.com",
      },
    });

    expect(built.key).toBe(SAMPLE_KEY);
    expect(built.oauth2.client_id).toBe("unpacked-client-999.apps.googleusercontent.com");
    expect(built.oauth2.scopes).toEqual(["https://www.googleapis.com/auth/calendar.events"]);
  });

  it("Allows placeholder clientId when strictOAuth is false and throws when strictOAuth is true", () => {
    const placeholderConfig = {
      publicKey: SAMPLE_KEY,
      extensionId: SAMPLE_ID,
      clientId: UNPACKED_CLIENT_ID_PLACEHOLDER,
    };

    const devManifest = buildManifestForTarget(baseManifest, {
      target: "unpacked",
      strictOAuth: false,
      unpackedConfig: placeholderConfig,
    });
    expect(devManifest.key).toBe(SAMPLE_KEY);
    expect(devManifest.oauth2.client_id).toBe(UNPACKED_CLIENT_ID_PLACEHOLDER);

    expect(() =>
      buildManifestForTarget(baseManifest, {
        target: "unpacked",
        strictOAuth: true,
        unpackedConfig: placeholderConfig,
      })
    ).toThrow(/placeholder/i);
  });
});
