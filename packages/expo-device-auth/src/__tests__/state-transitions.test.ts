import { describe, expect, it } from "@jest/globals";

import {
  createDeviceAuthController,
  createMemoryDeviceAuthStorage,
} from "../device-auth-controller";
import type { BiometricDriver } from "../device-auth-controller";
import type { PinHashDriver } from "../pin-verifier";
import { deferred } from "../test-support/jest-mocks";
import type { DeviceAuthConfig } from "../types";

const pin = { confirmation: "1234", pin: "1234" };
const replacement = { confirmation: "5678", pin: "5678" };
const success = { method: "pin", status: "success" };
const cancelled = { status: "cancelled" };

const optionsFor = () => ({
  now: () => 1000,
  randomBytes: (length: number) => new Uint8Array(length),
  storage: createMemoryDeviceAuthStorage(),
  verifierIterations: 10,
});

const deferredBiometrics = () => {
  const opened = deferred<undefined>();
  const response = deferred<{ success: true }>();
  const biometrics: BiometricDriver = {
    authenticate() {
      opened.resolve(undefined);
      return response.promise;
    },
    getAvailability: () =>
      Promise.resolve({
        enrolled: true,
        hardwareSupported: true,
        reason: "available",
        supportedTypes: ["face"],
      }),
  };
  return {
    biometrics,
    opened: opened.promise,
    succeed: () => response.resolve({ success: true }),
  };
};

describe("credential and session transitions", () => {
  it("commits only one overlapping setup for the same store and scope", async () => {
    const options = optionsFor();
    const first = createDeviceAuthController({ pinLength: 4 }, options);
    const second = createDeviceAuthController({ pinLength: 4 }, options);

    const results = await Promise.all([
      first.setupPin(pin),
      second.setupPin(replacement),
    ]);

    expect(results).toMatchObject([
      { status: "success" },
      { error: { code: "pin_already_configured" }, status: "error" },
    ]);
    await expect(second.authenticateWithPin(pin.pin)).resolves.toStrictEqual(
      success
    );
  });

  it("counts overlapping failed PIN checks across controllers, including the lockout boundary", async () => {
    const policy: DeviceAuthConfig = {
      pinAttempts: { attemptsPerStep: 2, lockoutsMs: [500] },
      pinLength: 4,
    };
    const options = optionsFor();
    const first = createDeviceAuthController(policy, options);
    const second = createDeviceAuthController(policy, options);
    await first.setupPin(pin);

    const results = await Promise.all([
      first.authenticateWithPin("0000"),
      second.authenticateWithPin("0000"),
      first.authenticateWithPin(pin.pin),
    ]);

    expect(results).toMatchObject([
      { error: { code: "pin_mismatch" }, status: "error" },
      { status: "locked", until: 1500 },
      { status: "locked", until: 1500 },
    ]);
  });

  it("invalidates an existing memory session when another controller resets and sets up the scope", async () => {
    const options = optionsFor();
    const first = createDeviceAuthController({ pinLength: 4 }, options);
    const second = createDeviceAuthController({ pinLength: 4 }, options);
    await first.setupPin(pin);
    await first.authenticateWithPin(pin.pin);

    await second.resetDeviceAuth();
    await expect(first.getState()).resolves.toMatchObject({
      isSessionValid: false,
      needsSetup: true,
    });
    await second.setupPin(replacement);
    await expect(first.getState()).resolves.toMatchObject({
      isSessionValid: false,
      needsSetup: false,
    });
  });

  it.each(["lock", "resetDeviceAuth"] as const)(
    "discards a biometric result that arrives after %s",
    async (revoke) => {
      const native = deferredBiometrics();
      const controller = createDeviceAuthController(
        {
          biometrics: { defaultEnabled: true },
          pinLength: 4,
          session: { persistAcrossRestarts: true },
        },
        { ...optionsFor(), biometrics: native.biometrics }
      );
      await controller.setupPin(pin);
      const auth = controller.authenticateWithBiometrics();
      await native.opened;
      await controller[revoke]();
      native.succeed();

      await expect(auth).resolves.toStrictEqual(cancelled);
      await expect(controller.getState()).resolves.toMatchObject({
        isSessionValid: false,
        needsSetup: revoke === "resetDeviceAuth",
      });
    }
  );

  it("discards in-flight biometric opt-in after the user disables it", async () => {
    const native = deferredBiometrics();
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        ...optionsFor(),
        biometrics: native.biometrics,
      }
    );
    await controller.setupPin(pin);
    await controller.authenticateWithPin(pin.pin);
    const enable = controller.setBiometricEnabled(true);
    await native.opened;

    await controller.setBiometricEnabled(false);
    native.succeed();

    await expect(enable).resolves.toStrictEqual(cancelled);
    await expect(controller.getState()).resolves.toMatchObject({
      biometricPreferenceEnabled: false,
    });
  });

  it("discards earlier opt-in when disable commits during availability lookup", async () => {
    const availability =
      deferred<Awaited<ReturnType<BiometricDriver["getAvailability"]>>>();
    const unenrolled = {
      enrolled: false,
      hardwareSupported: true,
      reason: "not_enrolled",
      supportedTypes: [],
    } as const;
    let reading = false;
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        ...optionsFor(),
        biometrics: {
          authenticate: () => Promise.resolve({ success: true }),
          getAvailability: () =>
            reading
              ? availability.promise
              : Promise.resolve({ ...unenrolled, supportedTypes: [] }),
        },
      }
    );
    await controller.setupPin(pin);
    await controller.authenticateWithPin(pin.pin);
    reading = true;
    const enable = controller.setBiometricEnabled(true);
    await controller.setBiometricEnabled(false);
    availability.resolve({
      enrolled: false,
      hardwareSupported: true,
      reason: "not_enrolled",
      supportedTypes: [],
    });

    await expect(enable).resolves.toStrictEqual(cancelled);
    await expect(controller.getState()).resolves.toMatchObject({
      biometricPreferenceEnabled: false,
    });
  });

  it("honors requireAuthToDisable when the preference is enabled", async () => {
    const native = deferredBiometrics();
    const controller = createDeviceAuthController(
      {
        biometrics: { defaultEnabled: true, requireAuthToDisable: true },
        pinLength: 4,
      },
      { ...optionsFor(), biometrics: native.biometrics }
    );
    await controller.setupPin(pin);

    await expect(controller.setBiometricEnabled(false)).resolves.toMatchObject({
      error: { code: "reauthentication_required" },
      status: "error",
    });
    await controller.authenticateWithPin(pin.pin);
    await expect(controller.setBiometricEnabled(false)).resolves.toStrictEqual({
      status: "success",
    });
    await expect(controller.getState()).resolves.toMatchObject({
      biometricPreferenceEnabled: false,
    });
  });

  it("leaves setup retryable if persistent session deletion fails", async () => {
    const options = optionsFor();
    const { deleteItem } = options.storage;
    let fail = true;
    options.storage.deleteItem = async (key) => {
      if (fail) {
        fail = false;
        throw new Error("delete failed");
      }
      await deleteItem(key);
    };
    const controller = createDeviceAuthController(
      { pinLength: 4, session: { persistAcrossRestarts: true } },
      options
    );

    await expect(controller.setupPin(pin)).rejects.toThrow("delete failed");
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: false,
      needsSetup: true,
    });
    await expect(controller.setupPin(pin)).resolves.toStrictEqual({
      status: "success",
    });
  });

  it("keeps the old PIN and revokes the session when deletion fails during change", async () => {
    const options = optionsFor();
    const { deleteItem } = options.storage;
    let fail = false;
    options.storage.deleteItem = (key) =>
      fail ? Promise.reject(new Error("delete failed")) : deleteItem(key);
    const config = {
      pinLength: 4,
      session: { persistAcrossRestarts: true },
    } as const;
    const controller = createDeviceAuthController(config, options);
    await controller.setupPin(pin);
    await controller.authenticateWithPin(pin.pin);

    fail = true;
    await expect(controller.changePin(replacement)).rejects.toThrow(
      "delete failed"
    );
    const second = createDeviceAuthController(config, options);
    await expect(second.getState()).resolves.toMatchObject({
      isSessionValid: false,
    });

    fail = false;
    await expect(second.authenticateWithPin(pin.pin)).resolves.toStrictEqual(
      success
    );
    await expect(second.changePin(replacement)).resolves.toStrictEqual({
      status: "success",
    });
  });

  it("discards a persisted session write when lock is requested before it settles", async () => {
    const writing = deferred<undefined>();
    const resume = deferred<undefined>();
    const options = optionsFor();
    const { setItem } = options.storage;
    options.storage.setItem = async (key, value) => {
      if (key.endsWith(".session")) {
        writing.resolve(undefined);
        await resume.promise;
      }
      await setItem(key, value);
    };
    const controller = createDeviceAuthController(
      { pinLength: 4, session: { persistAcrossRestarts: true } },
      options
    );
    await controller.setupPin(pin);
    const auth = controller.authenticateWithPin(pin.pin);
    await writing.promise;

    const lock = controller.lock();
    resume.resolve(undefined);
    await expect(auth).resolves.toStrictEqual(cancelled);
    await lock;
    await expect(
      options.storage.getItem("expo-device-auth.default.session")
    ).resolves.toBeNull();
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: false,
    });
  });

  it("can retry reset after the credential delete fails with the session already revoked", async () => {
    const options = optionsFor();
    const { deleteItem } = options.storage;
    let fail = true;
    options.storage.deleteItem = async (key) => {
      if (fail && key.endsWith(".credential")) {
        fail = false;
        throw new Error("credential delete failed");
      }
      await deleteItem(key);
    };
    const controller = createDeviceAuthController(
      { pinLength: 4, session: { persistAcrossRestarts: true } },
      options
    );
    await controller.setupPin(pin);
    await controller.authenticateWithPin(pin.pin);

    await expect(controller.resetDeviceAuth()).rejects.toThrow(
      "credential delete failed"
    );
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: false,
      needsSetup: false,
    });
    await controller.resetDeviceAuth();
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: false,
      needsSetup: true,
    });
  });

  it("requires the session to still be valid when a PIN change finishes hashing", async () => {
    const started = deferred<undefined>();
    const resume = deferred<undefined>();
    let now = 1000;
    const pinHashDriver: PinHashDriver = {
      async pbkdf2Sha256({ hashBytes, pinBytes }) {
        if (pinBytes[0] === 53) {
          started.resolve(undefined);
          await resume.promise;
        }
        return new Uint8Array(hashBytes).fill(pinBytes[0] ?? 0);
      },
    };
    const controller = createDeviceAuthController(
      { pinLength: 4, session: { timeoutMs: 500 } },
      { ...optionsFor(), now: () => now, pinHashDriver }
    );
    await controller.setupPin(pin);
    await controller.authenticateWithPin(pin.pin);
    const change = controller.changePin(replacement);
    await started.promise;
    now = 1500;
    resume.resolve(undefined);

    await expect(change).resolves.toMatchObject({
      error: { code: "reauthentication_required" },
      status: "error",
    });
    await expect(
      controller.authenticateWithPin(pin.pin)
    ).resolves.toStrictEqual(success);
  });
});
