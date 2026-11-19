import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildManifestForTarget,
  deriveExtensionIdFromPublicKey,
  UNPACKED_CLIENT_ID_PLACEHOLDER,
  validateUnpackedConfig,
} from "../scripts/unpacked-manifest.mjs";

// Real RSA-2048 SPKI DER public key (no private key retained) with independently computed Chromium ID
const SAMPLE_SPKI_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+6ngfQssnufZb5FJ+YXTC8JaouyPROFITIkqAazoEE+VuKL5izml5+HArfZOOvs5Y2fCo/uk2D+XsLYKJMNVs2qrFdOjeWrGzYahdaxuRJKY5ZD3eJJmZjjRSqa0MshaDrot6BfYyvaG307Z4M00QC3cdwhhjpwCOql68tA1w32A8R676q/oF5qtMUFK3163AMhViqwM9I3A5irW94+7ifyu9m5rOn+tmeilkE+ZqidguwAe27sfJjOtInPB7BydmBWMqK7deTi7r53aZ5ozp3bxG+mei1seiAcX+TYUv0LI4tLmBHlob4aARVqCYlPjLGY9BwO4ioQBkxeI8KUitwIDAQAB";
const SAMPLE_ID = "clanblcocdihoddhjdbfehhhbcknjgdj";

function rawSha256ChromeId(derBytes: Buffer): string {
  const digest = createHash("sha256").update(derBytes).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    const byte = digest[i] ?? 0;
    id += String.fromCharCode(97 + ((byte >> 4) & 0x0f));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

describe("deriveExtensionIdFromPublicKey", () => {
  it("Derives Chromium 32-char a-p extension ID from a valid RSA-2048 SPKI DER public key", () => {
    expect(deriveExtensionIdFromPublicKey(SAMPLE_SPKI_KEY)).toBe(SAMPLE_ID);
  });

  it("Rejects empty strings, PEM headers, malformed base64, and arbitrary non-SPKI base64 payloads", () => {
    expect(() => deriveExtensionIdFromPublicKey("")).toThrow(/public key/i);
    expect(() =>
      deriveExtensionIdFromPublicKey(`-----BEGIN PUBLIC KEY-----\n${SAMPLE_SPKI_KEY}`)
    ).toThrow(/base64/i);
    expect(() => deriveExtensionIdFromPublicKey("not@valid!base64")).toThrow(/base64/i);
    expect(() => deriveExtensionIdFromPublicKey("aGVsbG8=")).toThrow(/SPKI|RSA/i);
  });

  it("Rejects RSA PKCS#8 private keys, non-RSA keys, and sub-2048 RSA keys", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs8PrivateDerB64 = Buffer.from(
      privateKey.export({ type: "pkcs8", format: "der" })
    ).toString("base64");

    expect(() => deriveExtensionIdFromPublicKey(pkcs8PrivateDerB64)).toThrow(/SPKI|public key/i);

    const ed = generateKeyPairSync("ed25519");
    const edSpkiB64 = Buffer.from(ed.publicKey.export({ type: "spki", format: "der" })).toString(
      "base64"
    );
    expect(() => deriveExtensionIdFromPublicKey(edSpkiB64)).toThrow(/RSA/i);

    const rsa1024 = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const rsa1024SpkiB64 = Buffer.from(
      rsa1024.publicKey.export({ type: "spki", format: "der" })
    ).toString("base64");
    expect(() => deriveExtensionIdFromPublicKey(rsa1024SpkiB64)).toThrow(/2048/i);
  });
});

describe("validateUnpackedConfig", () => {
  it("Passes with zero errors and warnings for a complete valid unpacked config", () => {
    const result = validateUnpackedConfig(
      {
        publicKey: SAMPLE_SPKI_KEY,
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
      publicKey: SAMPLE_SPKI_KEY,
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      clientId: "invalid-client-id",
    });

    expect(result.errors.some((e) => /extensionId/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /clientId/i.test(e))).toBe(true);
  });

  it("Flags placeholder clientId as warning when strictOAuth is false and error when strictOAuth is true", () => {
    const config = {
      publicKey: SAMPLE_SPKI_KEY,
      extensionId: SAMPLE_ID,
      clientId: UNPACKED_CLIENT_ID_PLACEHOLDER,
    };

    const nonStrict = validateUnpackedConfig(config, { strictOAuth: false });
    expect(nonStrict.errors).toEqual([]);
    expect(nonStrict.warnings.some((w) => /placeholder/i.test(w))).toBe(true);

    const strict = validateUnpackedConfig(config, { strictOAuth: true });
    expect(strict.errors.some((e) => /placeholder/i.test(e))).toBe(true);
  });

  it("Rejects PKCS#8 private key DER even when extensionId matches its SHA-256 hash", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs8Der = Buffer.from(privateKey.export({ type: "pkcs8", format: "der" }));
    const pkcs8B64 = pkcs8Der.toString("base64");
    const matchingHashId = rawSha256ChromeId(pkcs8Der);

    const result = validateUnpackedConfig(
      {
        publicKey: pkcs8B64,
        extensionId: matchingHashId,
        clientId: "1234567890-abc.apps.googleusercontent.com",
      },
      { strictOAuth: true }
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.derivedExtensionId).toBeNull();
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

  it("Injects key and unpacked clientId for unpacked target and refuses PKCS#8 private keys", () => {
    const built = buildManifestForTarget(baseManifest, {
      target: "unpacked",
      strictOAuth: true,
      unpackedConfig: {
        publicKey: SAMPLE_SPKI_KEY,
        extensionId: SAMPLE_ID,
        clientId: "unpacked-client-999.apps.googleusercontent.com",
      },
    });

    expect(built.key).toBe(SAMPLE_SPKI_KEY);
    expect(built.oauth2.client_id).toBe("unpacked-client-999.apps.googleusercontent.com");
    expect(built.oauth2.scopes).toEqual(["https://www.googleapis.com/auth/calendar.events"]);

    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs8Der = Buffer.from(privateKey.export({ type: "pkcs8", format: "der" }));
    expect(() =>
      buildManifestForTarget(baseManifest, {
        target: "unpacked",
        strictOAuth: true,
        unpackedConfig: {
          publicKey: pkcs8Der.toString("base64"),
          extensionId: rawSha256ChromeId(pkcs8Der),
          clientId: "unpacked-client-999.apps.googleusercontent.com",
        },
      })
    ).toThrow(/SPKI|public key/i);
  });

  it("Allows placeholder clientId when strictOAuth is false and throws when strictOAuth is true", () => {
    const placeholderConfig = {
      publicKey: SAMPLE_SPKI_KEY,
      extensionId: SAMPLE_ID,
      clientId: UNPACKED_CLIENT_ID_PLACEHOLDER,
    };

    const devManifest = buildManifestForTarget(baseManifest, {
      target: "unpacked",
      strictOAuth: false,
      unpackedConfig: placeholderConfig,
    });
    expect(devManifest.key).toBe(SAMPLE_SPKI_KEY);
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
