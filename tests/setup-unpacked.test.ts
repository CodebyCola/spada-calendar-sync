import { describe, expect, it } from "vitest";
import { prepareUnpackedConfig } from "../scripts/setup-unpacked.mjs";
import { UNPACKED_CLIENT_ID_PLACEHOLDER } from "../scripts/unpacked-manifest.mjs";

const KEY_A =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+6ngfQssnufZb5FJ+YXTC8JaouyPROFITIkqAazoEE+VuKL5izml5+HArfZOOvs5Y2fCo/uk2D+XsLYKJMNVs2qrFdOjeWrGzYahdaxuRJKY5ZD3eJJmZjjRSqa0MshaDrot6BfYyvaG307Z4M00QC3cdwhhjpwCOql68tA1w32A8R676q/oF5qtMUFK3163AMhViqwM9I3A5irW94+7ifyu9m5rOn+tmeilkE+ZqidguwAe27sfJjOtInPB7BydmBWMqK7deTi7r53aZ5ozp3bxG+mei1seiAcX+TYUv0LI4tLmBHlob4aARVqCYlPjLGY9BwO4ioQBkxeI8KUitwIDAQAB";
const ID_A = "clanblcocdihoddhjdbfehhhbcknjgdj";

const KEY_B =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw1PrME41SAwFET27KiP794jGzxKDLAM11CsyLPU6JHPzt3nie94DPo7ZoQZEBFjjP2RtcpqWLDZV6I6ECey68V/LSwXT6mc2MdX2VlbXqs/PzbDwTce65c/9jXYLI8MRb4Bx9jW3w/6uzlK5V948O8V2O1agcn3PhHHJ6pvgD79xWCZ0YEwC52isTd/GCinpBr2X2sFMmbWxvHBFalkmbkaTzrEH6O9r/lfDWe3pKzDU7jP+w6CNouwr06wFwXkwsCdzJVm/vgj7c8xofmJaNG+AYZlqTsfL0Ip0D0ltdpdmgiHSAPm0VQQLDNSPAPBtzYfsUvmlkVF5jxhDXtWoiQIDAQAB";
const ID_B = "inhbgodncbcogfkhibhnboanolenfjkd";

describe("prepareUnpackedConfig", () => {
  it("Initializes fresh config with generated publicKey, derived extensionId, and placeholder clientId", () => {
    const config = prepareUnpackedConfig(null, {
      generatePublicKey: () => KEY_A,
    });

    expect(config).toEqual({
      publicKey: KEY_A,
      extensionId: ID_A,
      clientId: UNPACKED_CLIENT_ID_PLACEHOLDER,
    });
  });

  it("Preserves existing publicKey and clientId on re-run without resetKey", () => {
    let generated = false;
    const existing = {
      publicKey: KEY_A,
      extensionId: ID_A,
      clientId: "123456-real.apps.googleusercontent.com",
    };

    const config = prepareUnpackedConfig(existing, {
      generatePublicKey: () => {
        generated = true;
        return KEY_B;
      },
    });

    expect(generated).toBe(false);
    expect(config).toEqual(existing);
  });

  it("Refuses to silently rotate a corrupted existing publicKey without --reset-key", () => {
    let generated = false;
    const corruptedExisting = {
      publicKey: "CORRUPTED_KEY_NOT_SPKI",
      extensionId: ID_A,
      clientId: "123456-old.apps.googleusercontent.com",
    };

    expect(() =>
      prepareUnpackedConfig(corruptedExisting, {
        generatePublicKey: () => {
          generated = true;
          return KEY_B;
        },
      })
    ).toThrow(/--reset-key|corrupted|invalid/i);
    expect(generated).toBe(false);
  });

  it("Trims and saves valid clientId while rejecting malformed clientId", () => {
    const existing = {
      publicKey: KEY_A,
      extensionId: ID_A,
      clientId: UNPACKED_CLIENT_ID_PLACEHOLDER,
    };

    const updated = prepareUnpackedConfig(existing, {
      clientId: "  987654-xyz.apps.googleusercontent.com \n",
    });
    expect(updated.publicKey).toBe(KEY_A);
    expect(updated.extensionId).toBe(ID_A);
    expect(updated.clientId).toBe("987654-xyz.apps.googleusercontent.com");

    expect(() =>
      prepareUnpackedConfig(existing, {
        clientId: "987654-missing-suffix",
      })
    ).toThrow(/apps\.googleusercontent\.com/i);
  });

  it("Resets stale clientId back to placeholder when resetKey is true without a new clientId", () => {
    const existing = {
      publicKey: KEY_A,
      extensionId: ID_A,
      clientId: "123456-old.apps.googleusercontent.com",
    };

    const rotated = prepareUnpackedConfig(existing, {
      resetKey: true,
      generatePublicKey: () => KEY_B,
    });

    expect(rotated.publicKey).toBe(KEY_B);
    expect(rotated.extensionId).toBe(ID_B);
    expect(rotated.clientId).toBe(UNPACKED_CLIENT_ID_PLACEHOLDER);
  });

  it("Stores new clientId when resetKey is true and clientId is supplied", () => {
    const existing = {
      publicKey: KEY_A,
      extensionId: ID_A,
      clientId: "123456-old.apps.googleusercontent.com",
    };

    const rotated = prepareUnpackedConfig(existing, {
      resetKey: true,
      clientId: "999999-new.apps.googleusercontent.com",
      generatePublicKey: () => KEY_B,
    });

    expect(rotated.publicKey).toBe(KEY_B);
    expect(rotated.extensionId).toBe(ID_B);
    expect(rotated.clientId).toBe("999999-new.apps.googleusercontent.com");
  });
});
