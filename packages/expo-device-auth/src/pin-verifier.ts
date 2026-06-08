import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const DEFAULT_ITERATIONS = 100_000;
const ASYNC_TICK_MS = 16;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export interface PinVerifier {
  version: 1;
  kdf: "pbkdf2-hmac-sha256" | "sha256";
  iterations: number;
  salt: string;
  hash: string;
}

export interface PinVerifierOptions {
  iterations?: number;
  pinHashDriver?: PinHashDriver;
  randomBytes?: (length: number) => Uint8Array;
}

export interface PinHashDriver {
  pbkdf2Sha256(input: {
    hashBytes: number;
    iterations: number;
    pinBytes: Uint8Array;
    saltBytes: Uint8Array;
  }): Promise<Uint8Array>;
}

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const deriveSha256PinHash = (pin: string, salt: Uint8Array): string => {
  const pinBytes = new TextEncoder().encode(pin);
  const input = new Uint8Array(salt.length + pinBytes.length);
  input.set(salt);
  input.set(pinBytes, salt.length);
  return toHex(sha256(input));
};

const noblePinHashDriver: PinHashDriver = {
  pbkdf2Sha256({ hashBytes, iterations, pinBytes, saltBytes }) {
    return pbkdf2Async(sha256, pinBytes, saltBytes, {
      asyncTick: ASYNC_TICK_MS,
      c: iterations,
      dkLen: hashBytes,
    });
  },
};

const derivePbkdf2PinHash = async (
  pin: string,
  salt: Uint8Array,
  iterations: number,
  pinHashDriver: PinHashDriver
): Promise<string> => {
  const pinBytes = new TextEncoder().encode(pin);
  return toHex(
    await pinHashDriver.pbkdf2Sha256({
      hashBytes: HASH_BYTES,
      iterations,
      pinBytes,
      saltBytes: salt,
    })
  );
};

const defaultRandomBytes = (length: number): Uint8Array => {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject?.getRandomValues) {
    throw new Error("No secure random byte source is available");
  }

  return cryptoObject.getRandomValues(new Uint8Array(length));
};

const timingSafeEqualHex = (left: string, right: string): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftCodePoint = left.codePointAt(index) ?? 0;
    const rightCodePoint = right.codePointAt(index) ?? 0;
    difference += leftCodePoint === rightCodePoint ? 0 : 1;
  }

  return difference === 0;
};

const fromHex = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const createPinVerifier = async (
  pin: string,
  options: PinVerifierOptions = {}
): Promise<PinVerifier> => {
  await Promise.resolve();
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  const pinHashDriver = options.pinHashDriver ?? noblePinHashDriver;
  const saltBytes = randomBytes(SALT_BYTES);
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;

  return {
    hash: await derivePbkdf2PinHash(pin, saltBytes, iterations, pinHashDriver),
    iterations,
    kdf: "pbkdf2-hmac-sha256",
    salt: toHex(saltBytes),
    version: 1,
  };
};

export const verifyPinAgainstVerifier = async (
  pin: string,
  verifier: PinVerifier,
  options: { pinHashDriver?: PinHashDriver } = {}
): Promise<boolean> => {
  const saltBytes = fromHex(verifier.salt);
  const pinHashDriver = options.pinHashDriver ?? noblePinHashDriver;
  const expectedHash =
    verifier.kdf === "sha256"
      ? deriveSha256PinHash(pin, saltBytes)
      : await derivePbkdf2PinHash(
          pin,
          saltBytes,
          verifier.iterations,
          pinHashDriver
        );
  return timingSafeEqualHex(expectedHash, verifier.hash);
};
