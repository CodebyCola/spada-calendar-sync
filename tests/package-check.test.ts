import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageExtension } from "../scripts/package.mjs";
import { validateManifestForStore } from "../scripts/validate-manifest.mjs";

const VALID_RSA2048_SPKI_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+6ngfQssnufZb5FJ+YXTC8JaouyPROFITIkqAazoEE+VuKL5izml5+HArfZOOvs5Y2fCo/uk2D+XsLYKJMNVs2qrFdOjeWrGzYahdaxuRJKY5ZD3eJJmZjjRSqa0MshaDrot6BfYyvaG307Z4M00QC3cdwhhjpwCOql68tA1w32A8R676q/oF5qtMUFK3163AMhViqwM9I3A5irW94+7ifyu9m5rOn+tmeilkE+ZqidguwAe27sfJjOtInPB7BydmBWMqK7deTi7r53aZ5ozp3bxG+mei1seiAcX+TYUv0LI4tLmBHlob4aARVqCYlPjLGY9BwO4ioQBkxeI8KUitwIDAQAB";
const VALID_RSA2048_ID = "clanblcocdihoddhjdbfehhhbcknjgdj";

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

  it("Requires valid RSA-2048 SPKI key and rejects PKCS#8 private key or plain base64 when target is unpacked", () => {
    const missingKey = validateManifestForStore(VALID_MANIFEST, {
      target: "unpacked",
      strictOAuth: true,
    });
    expect(missingKey.errors.some((e) => /key/i.test(e))).toBe(true);

    const plainBase64Key = validateManifestForStore(
      { ...VALID_MANIFEST, key: "aGVsbG8=" },
      { target: "unpacked", strictOAuth: true }
    );
    expect(plainBase64Key.errors.some((e) => /SPKI|RSA|key/i.test(e))).toBe(true);

    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs8PrivateKey = Buffer.from(
      privateKey.export({ type: "pkcs8", format: "der" })
    ).toString("base64");
    const privateKeyResult = validateManifestForStore(
      { ...VALID_MANIFEST, key: pkcs8PrivateKey },
      { target: "unpacked", strictOAuth: true }
    );
    expect(privateKeyResult.errors.some((e) => /SPKI|public key|key/i.test(e))).toBe(true);

    const validUnpacked = validateManifestForStore(
      { ...VALID_MANIFEST, key: VALID_RSA2048_SPKI_KEY },
      { target: "unpacked", strictOAuth: true }
    );
    expect(validUnpacked.errors).toEqual([]);
    expect(validUnpacked.warnings).toEqual([]);

    const unpackedPlaceholder = {
      ...VALID_MANIFEST,
      key: VALID_RSA2048_SPKI_KEY,
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

function readTextFromZip(zipPath: string, entryPath: string): string {
  if (process.platform === "win32") {
    const escapedZip = zipPath.replace(/'/g, "''");
    const escapedEntry = entryPath.replace(/'/g, "''");
    return execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedZip}'); try { $entry = $zip.Entries | Where-Object { $_.FullName -replace '\\\\','/' -eq '${escapedEntry}' } | Select-Object -First 1; if (-not $entry) { throw 'Missing entry' }; $sr = New-Object System.IO.StreamReader($entry.Open()); try { $sr.ReadToEnd() } finally { $sr.Dispose() } } finally { $zip.Dispose() }`,
      ],
      { encoding: "utf8" }
    );
  }
  return execFileSync("unzip", ["-p", zipPath, entryPath], { encoding: "utf8" });
}

describe("packageExtension isolation", () => {
  it("Packages store and unpacked ZIPs concurrently without cross-contaminating manifests or bundles", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "spada-parallel-pkg-test-"));
    try {
      const storeBaseManifestPath = join(workDir, "store-base-manifest.json");
      const baseManifest = JSON.parse(readFileSync(join(process.cwd(), "public/manifest.json"), "utf8"));
      baseManifest.oauth2.client_id = "store-only-111.apps.googleusercontent.com";
      writeFileSync(storeBaseManifestPath, JSON.stringify(baseManifest, null, 2), "utf8");

      const unpackedConfig = {
        publicKey: VALID_RSA2048_SPKI_KEY,
        extensionId: VALID_RSA2048_ID,
        clientId: "unpacked-only-222.apps.googleusercontent.com",
      };

      const releaseDir = join(workDir, "release");
      const [storeResult, unpackedResult] = await Promise.all([
        packageExtension({
          target: "store",
          strictOAuth: true,
          releaseDir,
          baseManifestPath: storeBaseManifestPath,
          unpackedConfig,
        }),
        packageExtension({
          target: "unpacked",
          strictOAuth: true,
          releaseDir,
          baseManifestPath: storeBaseManifestPath,
          unpackedConfig,
        }),
      ]);

      const storeManifest = JSON.parse(readTextFromZip(storeResult.outZip, "manifest.json"));
      const unpackedManifest = JSON.parse(readTextFromZip(unpackedResult.outZip, "manifest.json"));

      expect("key" in storeManifest).toBe(false);
      expect(storeManifest.oauth2.client_id).toBe("store-only-111.apps.googleusercontent.com");

      expect(unpackedManifest.key).toBe(VALID_RSA2048_SPKI_KEY);
      expect(unpackedManifest.oauth2.client_id).toBe("unpacked-only-222.apps.googleusercontent.com");

      const storeOnboardingJs = readTextFromZip(storeResult.outZip, "onboarding/onboarding.js");
      const unpackedOnboardingJs = readTextFromZip(
        unpackedResult.outZip,
        "onboarding/onboarding.js"
      );
      expect(storeOnboardingJs).toMatch(/BUILD_TARGET\s*=\s*(?:true\s*\?\s*)?"store"/);
      expect(unpackedOnboardingJs).toMatch(/BUILD_TARGET\s*=\s*(?:true\s*\?\s*)?"unpacked"/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 30_000);
});
