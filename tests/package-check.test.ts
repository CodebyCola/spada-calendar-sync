import { describe, expect, it } from "vitest";
import { validateManifestForStore } from "../scripts/validate-manifest.mjs";

const VALID_MANIFEST = {
  manifest_version: 3,
  name: "SPADA UPNYK Assignment Scanner",
  version: "1.0.0",
  description:
    "Pindai semua tugas SPADA Wimaya UPNYK (termasuk yang tidak masuk kalender Moodle) dan sinkronkan ke Google Calendar.",
  icons: {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  oauth2: {
    client_id: "1234567890-abc.apps.googleusercontent.com",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  },
};

describe("validateManifestForStore", () => {
  it("Passes for a valid MV3 manifest with real client_id", () => {
    const result = validateManifestForStore(VALID_MANIFEST, { strictOAuth: true });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("Rejects descriptions exceeding 132 characters", () => {
    const result = validateManifestForStore({
      ...VALID_MANIFEST,
      description: "A".repeat(133),
    });
    expect(result.errors.some((e) => /132/.test(e))).toBe(true);
  });

  it("Flags placeholder oauth2.client_id as warning in dev mode and error in strict mode", () => {
    const withPlaceholder = {
      ...VALID_MANIFEST,
      oauth2: {
        client_id: "YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com",
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
      },
    };

    const devResult = validateManifestForStore(withPlaceholder, { strictOAuth: false });
    expect(devResult.errors).toEqual([]);
    expect(devResult.warnings.some((w) => /client_id/i.test(w))).toBe(true);

    const strictResult = validateManifestForStore(withPlaceholder, { strictOAuth: true });
    expect(strictResult.errors.some((e) => /client_id/i.test(e))).toBe(true);
  });

  it("Requires valid base64 key and checks unpacked placeholder client_id when target is unpacked", () => {
    const missingKey = validateManifestForStore(VALID_MANIFEST, {
      target: "unpacked",
      strictOAuth: true,
    });
    expect(missingKey.errors.some((e) => /key/i.test(e))).toBe(true);

    const invalidKey = validateManifestForStore(
      { ...VALID_MANIFEST, key: "not!valid@base64" },
      { target: "unpacked", strictOAuth: true }
    );
    expect(invalidKey.errors.some((e) => /key|base64/i.test(e))).toBe(true);

    const validUnpacked = validateManifestForStore(
      { ...VALID_MANIFEST, key: "aGVsbG8=" },
      { target: "unpacked", strictOAuth: true }
    );
    expect(validUnpacked.errors).toEqual([]);
    expect(validUnpacked.warnings).toEqual([]);

    const unpackedPlaceholder = {
      ...VALID_MANIFEST,
      key: "aGVsbG8=",
      oauth2: {
        client_id: "YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com",
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
      },
    };
    const devUnpacked = validateManifestForStore(unpackedPlaceholder, {
      target: "unpacked",
      strictOAuth: false,
    });
    expect(devUnpacked.errors).toEqual([]);
    expect(devUnpacked.warnings.some((w) => /client_id/i.test(w))).toBe(true);

    const strictUnpacked = validateManifestForStore(unpackedPlaceholder, {
      target: "unpacked",
      strictOAuth: true,
    });
    expect(strictUnpacked.errors.some((e) => /client_id/i.test(e))).toBe(true);
  });

  it("Rejects store manifest reusing a disallowed unpacked client_id", () => {
    const result = validateManifestForStore(VALID_MANIFEST, {
      target: "store",
      strictOAuth: true,
      disallowedClientIds: ["1234567890-abc.apps.googleusercontent.com"],
    });
    expect(result.errors.some((e) => /unpacked|disallowed|client_id/i.test(e))).toBe(true);
  });
});
