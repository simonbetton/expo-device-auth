import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { NitroModules } from "react-native-nitro-modules";

import {
  createExpoBiometricDriver,
  createExpoSecureStoreStorage,
  createQuickCryptoPinHashDriver,
  createQuickCryptoRandomBytes,
} from "../expo-adapters";
import { clearAllMocks, mocked } from "../test-support/jest-mocks";

jest.mock<Partial<typeof SecureStore>>("expo-secure-store", () => ({
  deleteItemAsync: jest.fn<typeof SecureStore.deleteItemAsync>(),
  getItemAsync: jest.fn<typeof SecureStore.getItemAsync>(),
  setItemAsync: jest.fn<typeof SecureStore.setItemAsync>(),
}));

jest.mock<Partial<typeof LocalAuthentication>>(
  "expo-local-authentication",
  () => ({
    AuthenticationType: {
      FACIAL_RECOGNITION: 2,
      FINGERPRINT: 1,
      IRIS: 3,
    },
    authenticateAsync: jest.fn<typeof LocalAuthentication.authenticateAsync>(),
    hasHardwareAsync: jest.fn<typeof LocalAuthentication.hasHardwareAsync>(),
    isEnrolledAsync: jest.fn<typeof LocalAuthentication.isEnrolledAsync>(),
    supportedAuthenticationTypesAsync:
      jest.fn<typeof LocalAuthentication.supportedAuthenticationTypesAsync>(),
  })
);

describe("expo adapters", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  it("adapts SecureStore to DeviceAuthStorage", async () => {
    mocked(SecureStore.getItemAsync).mockResolvedValue("saved");
    const storage = createExpoSecureStoreStorage();

    await expect(storage.getItem("credential")).resolves.toBe("saved");
    await storage.setItem("credential", "next");
    await storage.deleteItem("credential");

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith("credential");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("credential", "next");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("credential");
  });

  it("adapts QuickCrypto PBKDF2 hashing", async () => {
    await expect(
      createQuickCryptoPinHashDriver().pbkdf2Sha256({
        hashBytes: 4,
        iterations: 100,
        pinBytes: new TextEncoder().encode("1234"),
        saltBytes: Uint8Array.from([1, 2, 3]),
      })
    ).resolves.toStrictEqual(Uint8Array.from([50, 52, 54, 53]));

    const nativePbkdf2 = mocked(NitroModules.createHybridObject).mock.results[0]
      ?.value as { pbkdf2: { mock: { calls: unknown[][] } } } | undefined;
    const [password, salt, iterations, keyLength, digest] =
      nativePbkdf2?.pbkdf2.mock.calls[0] ?? [];

    expect(new Uint8Array(password as ArrayBuffer)).toStrictEqual(
      new TextEncoder().encode("1234")
    );
    expect(new Uint8Array(salt as ArrayBuffer)).toStrictEqual(
      Uint8Array.from([1, 2, 3])
    );
    expect({ digest, iterations, keyLength }).toStrictEqual({
      digest: "sha256",
      iterations: 100,
      keyLength: 4,
    });
  });

  it("adapts QuickCrypto random bytes", () => {
    const bytes = createQuickCryptoRandomBytes()(3);

    expect(bytes).toStrictEqual(Uint8Array.from([1, 2, 3]));
    expect(NitroModules.createHybridObject).toHaveBeenCalledWith("Random");
  });

  it("maps biometric availability and authentication options", async () => {
    mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true);
    mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(true);
    mocked(
      LocalAuthentication.supportedAuthenticationTypesAsync
    ).mockResolvedValue([1, 2]);
    mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({
      success: true,
    });

    const driver = createExpoBiometricDriver();

    await expect(driver.getAvailability()).resolves.toStrictEqual({
      enrolled: true,
      hardwareSupported: true,
      reason: "available",
      supportedTypes: ["fingerprint", "face"],
    });
    await expect(
      driver.authenticate({
        androidSecurityLevel: "strong",
        disableDeviceFallback: true,
      })
    ).resolves.toStrictEqual({ success: true });

    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
      biometricsSecurityLevel: "strong",
      disableDeviceFallback: true,
      fallbackLabel: "",
    });
  });

  it("maps Expo biometric prompt failures to adapter failures", async () => {
    mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({
      error: "user_cancel",
      success: false,
    });

    await expect(
      createExpoBiometricDriver().authenticate({
        androidSecurityLevel: "weak",
        disableDeviceFallback: true,
      })
    ).resolves.toStrictEqual({ error: "user_cancel", success: false });
  });

  it("marks biometrics unavailable when hardware or enrollment is missing", async () => {
    mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(false);
    const driver = createExpoBiometricDriver();

    await expect(driver.getAvailability()).resolves.toStrictEqual({
      enrolled: false,
      hardwareSupported: false,
      reason: "hardware_unavailable",
      supportedTypes: [],
    });

    mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true);
    mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(false);
    mocked(
      LocalAuthentication.supportedAuthenticationTypesAsync
    ).mockResolvedValue([3]);

    await expect(driver.getAvailability()).resolves.toStrictEqual({
      enrolled: false,
      hardwareSupported: true,
      reason: "not_enrolled",
      supportedTypes: ["iris"],
    });
  });
});
