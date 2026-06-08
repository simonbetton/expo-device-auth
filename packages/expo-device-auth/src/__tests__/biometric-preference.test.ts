import { describe, expect, it } from "@jest/globals";

import {
  createDeviceAuthController,
  createMemoryDeviceAuthStorage,
} from "../device-auth-controller";
import type { BiometricDriver } from "../device-auth-controller";

const fixedRandomBytes = (length: number) =>
  Uint8Array.from({ length }, (_, index) => index + 1);

const unsupportedBiometrics = (): BiometricDriver => ({
  authenticate() {
    return Promise.resolve({ error: "not_available", success: false });
  },
  getAvailability() {
    return Promise.resolve({
      enrolled: false,
      hardwareSupported: false,
      reason: "hardware_unavailable",
      supportedTypes: [],
    });
  },
});

const supportedButNotEnrolledBiometrics = (): BiometricDriver => ({
  authenticate() {
    return Promise.resolve({ error: "not_enrolled", success: false });
  },
  getAvailability() {
    return Promise.resolve({
      enrolled: false,
      hardwareSupported: true,
      reason: "not_enrolled",
      supportedTypes: ["face"],
    });
  },
});

const enrolledBiometrics = ({
  success,
}: {
  success: boolean;
}): BiometricDriver & {
  authenticateCalls: {
    androidSecurityLevel: "strong" | "weak";
    disableDeviceFallback: true;
  }[];
} => {
  const authenticateCalls: {
    androidSecurityLevel: "strong" | "weak";
    disableDeviceFallback: true;
  }[] = [];

  return {
    authenticate(options) {
      authenticateCalls.push(options);
      return Promise.resolve(
        success ? { success: true } : { error: "user_cancel", success: false }
      );
    },
    authenticateCalls,
    getAvailability() {
      return Promise.resolve({
        enrolled: true,
        hardwareSupported: true,
        reason: "available",
        supportedTypes: ["face"],
      });
    },
  };
};

describe("biometric preference", () => {
  it("forces biometric preference off when the device has no biometric hardware", async () => {
    const controller = createDeviceAuthController(
      {
        biometrics: { defaultEnabled: true },
        pinLength: 4,
      },
      {
        biometrics: unsupportedBiometrics(),
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });

    await expect(controller.getState()).resolves.toMatchObject({
      biometricAvailability: {
        enrolled: false,
        hardwareSupported: false,
        reason: "hardware_unavailable",
      },
      biometricPreferenceEnabled: false,
      effectiveBiometricEnabled: false,
    });

    await expect(controller.setBiometricEnabled(true)).resolves.toMatchObject({
      error: { code: "biometric_unavailable" },
      status: "error",
    });
  });

  it("allows pre-enabling biometrics when hardware exists but nothing is enrolled yet", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        biometrics: supportedButNotEnrolledBiometrics(),
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await controller.authenticateWithPin("1234");

    await expect(controller.setBiometricEnabled(true)).resolves.toStrictEqual({
      status: "success",
    });

    await expect(controller.getState()).resolves.toMatchObject({
      biometricAvailability: {
        enrolled: false,
        hardwareSupported: true,
        reason: "not_enrolled",
      },
      biometricPreferenceEnabled: true,
      effectiveBiometricEnabled: false,
    });
  });

  it("requires a valid local session before enabling enrolled biometrics", async () => {
    const biometrics = enrolledBiometrics({ success: true });
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        biometrics,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await expect(controller.setBiometricEnabled(true)).resolves.toMatchObject({
      error: { code: "reauthentication_required" },
      status: "error",
    });

    await controller.authenticateWithPin("1234");
    await expect(controller.setBiometricEnabled(true)).resolves.toStrictEqual({
      status: "success",
    });
    expect(biometrics.authenticateCalls).toStrictEqual([
      { androidSecurityLevel: "strong", disableDeviceFallback: true },
    ]);
    await expect(controller.getState()).resolves.toMatchObject({
      biometricPreferenceEnabled: true,
      effectiveBiometricEnabled: true,
    });
  });

  it("can disable biometrics and treats a failed enrolled prompt as cancelled", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        biometrics: enrolledBiometrics({ success: false }),
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await expect(controller.setBiometricEnabled(false)).resolves.toMatchObject({
      error: { code: "no_pin" },
      status: "error",
    });

    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await controller.authenticateWithPin("1234");

    await expect(controller.setBiometricEnabled(true)).resolves.toStrictEqual({
      status: "cancelled",
    });
    await expect(controller.setBiometricEnabled(false)).resolves.toStrictEqual({
      status: "success",
    });
  });

  it("authenticates with enabled biometrics and refreshes the local session", async () => {
    const biometrics = enrolledBiometrics({ success: true });
    const controller = createDeviceAuthController(
      {
        biometrics: {
          androidSecurityLevel: "weak",
          defaultEnabled: true,
        },
        pinLength: 4,
      },
      {
        biometrics,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });

    await expect(
      controller.authenticateWithBiometrics()
    ).resolves.toStrictEqual({
      method: "biometric",
      status: "success",
    });
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: true,
    });
    expect(biometrics.authenticateCalls).toStrictEqual([
      { androidSecurityLevel: "weak", disableDeviceFallback: true },
    ]);
  });

  it("reports biometric cancellation and unavailable biometric auth without throwing", async () => {
    const controller = createDeviceAuthController(
      {
        biometrics: { defaultEnabled: true },
        pinLength: 4,
      },
      {
        biometrics: enrolledBiometrics({ success: false }),
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await expect(
      controller.authenticateWithBiometrics()
    ).resolves.toStrictEqual({
      status: "cancelled",
    });

    const unsupportedController = createDeviceAuthController(
      {
        biometrics: { defaultEnabled: true },
        pinLength: 4,
      },
      {
        biometrics: unsupportedBiometrics(),
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await unsupportedController.setupPin({ confirmation: "1234", pin: "1234" });
    await expect(
      unsupportedController.authenticateWithBiometrics()
    ).resolves.toMatchObject({
      error: { code: "biometric_unavailable" },
      status: "error",
    });
  });
});
