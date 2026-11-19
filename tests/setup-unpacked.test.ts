import { describe, expect, it } from "vitest";
import { prepareUnpackedConfig } from "../scripts/setup-unpacked.mjs";
import { UNPACKED_CLIENT_ID_PLACEHOLDER } from "../scripts/unpacked-manifest.mjs";

const KEY_A = "aGVsbG8=";
const ID_A = "cmpcenlkfplakdaocgoidlckmfljocjo";
const KEY_B = "d29ybGQ="; // "world"

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
    expect(rotated.extensionId).not.toBe(ID_A);
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
    expect(rotated.clientId).toBe("999999-new.apps.googleusercontent.com");
  });
});
