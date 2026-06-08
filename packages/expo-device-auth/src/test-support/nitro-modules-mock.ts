import { jest } from "@jest/globals";

const pbkdf2 = jest.fn(
  (
    password: ArrayBuffer,
    salt: ArrayBuffer,
    _iterations: number,
    keyLength: number,
    _digest: string
  ): Promise<ArrayBuffer> => {
    const passwordBytes = new Uint8Array(password);
    const saltBytes = new Uint8Array(salt);
    const derivedKey = new Uint8Array(keyLength);

    for (let index = 0; index < keyLength; index += 1) {
      derivedKey[index] =
        ((passwordBytes[index % passwordBytes.length] ?? 0) +
          (saltBytes[index % saltBytes.length] ?? 0)) %
        256;
    }

    return Promise.resolve(derivedKey.buffer);
  }
);

const randomFillSync = jest.fn(
  (buffer: ArrayBuffer, offset: number, size: number): ArrayBuffer => {
    const bytes = new Uint8Array(buffer);

    for (let index = 0; index < size; index += 1) {
      bytes[offset + index] = index + 1;
    }

    return buffer;
  }
);

export const NitroModules = {
  createHybridObject: jest.fn(() => ({
    pbkdf2,
    randomFillSync,
  })),
};
