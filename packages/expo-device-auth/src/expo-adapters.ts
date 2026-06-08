import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { NitroModules } from "react-native-nitro-modules";
import type { HybridObject } from "react-native-nitro-modules";

import type {
  BiometricDriver,
  DeviceAuthStorage,
} from "./device-auth-controller";
import type { PinHashDriver } from "./pin-verifier";
import type { BiometricAvailability } from "./types";

interface QuickCryptoPbkdf2 extends HybridObject<{
  android: "c++";
  ios: "c++";
}> {
  pbkdf2(
    password: ArrayBuffer,
    salt: ArrayBuffer,
    iterations: number,
    keyLength: number,
    digest: string
  ): Promise<ArrayBuffer>;
}

interface QuickCryptoRandom extends HybridObject<{
  android: "c++";
  ios: "c++";
}> {
  randomFillSync(
    buffer: ArrayBuffer,
    offset: number,
    size: number
  ): ArrayBuffer;
}

let quickCryptoPbkdf2: QuickCryptoPbkdf2 | null = null;
let quickCryptoRandom: QuickCryptoRandom | null = null;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const getQuickCryptoPbkdf2 = (): QuickCryptoPbkdf2 => {
  quickCryptoPbkdf2 ??=
    NitroModules.createHybridObject<QuickCryptoPbkdf2>("Pbkdf2");
  return quickCryptoPbkdf2;
};

const getQuickCryptoRandom = (): QuickCryptoRandom => {
  quickCryptoRandom ??=
    NitroModules.createHybridObject<QuickCryptoRandom>("Random");
  return quickCryptoRandom;
};

const mapAuthenticationType = (
  type: LocalAuthentication.AuthenticationType
): BiometricAvailability["supportedTypes"][number] => {
  switch (type) {
    case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION: {
      return "face";
    }
    case LocalAuthentication.AuthenticationType.IRIS: {
      return "iris";
    }
    default: {
      return "fingerprint";
    }
  }
};

export const createExpoSecureStoreStorage = (): DeviceAuthStorage => ({
  async deleteItem(key) {
    await SecureStore.deleteItemAsync(key);
  },
  getItem(key) {
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
});

export const createQuickCryptoPinHashDriver = (): PinHashDriver => ({
  async pbkdf2Sha256({ hashBytes, iterations, pinBytes, saltBytes }) {
    const derivedKey = await getQuickCryptoPbkdf2().pbkdf2(
      toArrayBuffer(pinBytes),
      toArrayBuffer(saltBytes),
      iterations,
      hashBytes,
      "sha256"
    );
    return new Uint8Array(derivedKey);
  },
});

export const createQuickCryptoRandomBytes =
  (): ((length: number) => Uint8Array) => (length) => {
    const buffer = new ArrayBuffer(length);
    getQuickCryptoRandom().randomFillSync(buffer, 0, length);
    return new Uint8Array(buffer);
  };

export const createExpoBiometricDriver = (): BiometricDriver => ({
  async authenticate(options) {
    const result = await LocalAuthentication.authenticateAsync({
      biometricsSecurityLevel: options.androidSecurityLevel,
      disableDeviceFallback: options.disableDeviceFallback,
      fallbackLabel: "",
    });

    return result.success
      ? { success: true }
      : { error: result.error, success: false };
  },
  async getAvailability() {
    const hardwareSupported = await LocalAuthentication.hasHardwareAsync();
    if (!hardwareSupported) {
      return {
        enrolled: false,
        hardwareSupported: false,
        reason: "hardware_unavailable",
        supportedTypes: [],
      };
    }

    const [enrolled, supportedAuthenticationTypes] = await Promise.all([
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    return {
      enrolled,
      hardwareSupported: true,
      reason: enrolled ? "available" : "not_enrolled",
      supportedTypes: supportedAuthenticationTypes.map(mapAuthenticationType),
    };
  },
});
