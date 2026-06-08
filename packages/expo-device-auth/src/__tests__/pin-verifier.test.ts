import { describe, expect, it } from "@jest/globals";

import { createPinVerifier, verifyPinAgainstVerifier } from "../pin-verifier";
import type { PinVerifier } from "../pin-verifier";

const fixedRandomBytes = (length: number) =>
  Uint8Array.from({ length }, (_, index) => index + 1);

describe("pIN verifier", () => {
  it("uses PBKDF2 by default", async () => {
    const verifier = await createPinVerifier("1234", {
      randomBytes: fixedRandomBytes,
    });

    expect(verifier).toMatchObject({
      iterations: 100_000,
      kdf: "pbkdf2-hmac-sha256",
    });
    await expect(verifyPinAgainstVerifier("1234", verifier)).resolves.toBe(
      true
    );
    await expect(verifyPinAgainstVerifier("9999", verifier)).resolves.toBe(
      false
    );
  });

  it("creates a salted PBKDF2 verifier when iterations are explicitly configured", async () => {
    const verifier = await createPinVerifier("1234", {
      iterations: 10,
      randomBytes: fixedRandomBytes,
    });

    expect(verifier).toMatchObject({
      iterations: 10,
      kdf: "pbkdf2-hmac-sha256",
      salt: "0102030405060708090a0b0c0d0e0f10",
      version: 1,
    });
    expect(verifier.hash).toHaveLength(64);
    expect(JSON.stringify(verifier)).not.toContain("1234");
    await expect(verifyPinAgainstVerifier("1234", verifier)).resolves.toBe(
      true
    );
    await expect(verifyPinAgainstVerifier("9999", verifier)).resolves.toBe(
      false
    );
  });

  it("verifies legacy salted SHA-256 PIN verifiers", async () => {
    const verifier: PinVerifier = {
      hash: "d18fa507126ac611650477696f75c190ea24fef7d70c8719a7a105b1571e244f",
      iterations: 0,
      kdf: "sha256",
      salt: "0102030405060708090a0b0c0d0e0f10",
      version: 1,
    };

    await expect(verifyPinAgainstVerifier("1234", verifier)).resolves.toBe(
      true
    );
    await expect(verifyPinAgainstVerifier("9999", verifier)).resolves.toBe(
      false
    );
  });

  it("uses a custom PIN hash driver for PBKDF2 derivation and verification", async () => {
    const calls: string[] = [];
    const pinHashDriver = {
      pbkdf2Sha256({
        hashBytes,
        iterations,
        pinBytes,
        saltBytes,
      }: {
        hashBytes: number;
        iterations: number;
        pinBytes: Uint8Array;
        saltBytes: Uint8Array;
      }) {
        calls.push(`${new TextDecoder().decode(pinBytes)}:${iterations}`);
        const output = new Uint8Array(hashBytes);
        output.set(saltBytes.slice(0, Math.min(hashBytes, saltBytes.length)));
        return Promise.resolve(output);
      },
    };

    const verifier = await createPinVerifier("1234", {
      iterations: 10,
      pinHashDriver,
      randomBytes: fixedRandomBytes,
    });

    await expect(
      verifyPinAgainstVerifier("1234", verifier, { pinHashDriver })
    ).resolves.toBe(true);
    expect(calls).toStrictEqual(["1234:10", "1234:10"]);
  });

  it("uses the default secure random source and rejects hash length mismatches", async () => {
    const verifier = await createPinVerifier("1234", { iterations: 10 });

    expect(verifier.salt).toHaveLength(32);
    await expect(
      verifyPinAgainstVerifier("1234", {
        ...verifier,
        hash: verifier.hash.slice(0, -2),
      })
    ).resolves.toBe(false);
  });

  it("fails clearly when no secure random source is available", async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });

    await expect(createPinVerifier("1234", { iterations: 10 })).rejects.toThrow(
      "No secure random byte source is available"
    );

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    expect(globalThis.crypto).toBe(originalCrypto);
  });
});
