import { describe, expect, it } from "@jest/globals";

import {
  createDeviceAuthController,
  createMemoryDeviceAuthStorage,
} from "../device-auth-controller";
import type { DeviceAuthStorage } from "../device-auth-controller";

const fixedRandomBytes = (length: number) =>
  Uint8Array.from({ length }, (_, index) => index + 1);

const createSecureStoreCompatibleMemoryStorage = (): DeviceAuthStorage => {
  const storage = createMemoryDeviceAuthStorage();
  const secureStoreKeyPattern = /^[A-Za-z0-9._-]+$/u;

  const assertSecureStoreKey = (key: string): void => {
    if (!secureStoreKeyPattern.test(key)) {
      throw new Error("Invalid key provided to SecureStore");
    }
  };

  return {
    async deleteItem(key: string) {
      assertSecureStoreKey(key);
      await storage.deleteItem(key);
    },
    getItem(key: string) {
      assertSecureStoreKey(key);
      return storage.getItem(key);
    },
    async setItem(key: string, value: string) {
      assertSecureStoreKey(key);
      await storage.setItem(key, value);
    },
  };
};

describe("deviceAuthController", () => {
  it("uses SecureStore-compatible storage keys", async () => {
    const controller = createDeviceAuthController(
      {
        pinLength: 4,
        scopeKey: "user.1",
        session: {
          persistAcrossRestarts: true,
          timeoutMs: 5000,
        },
      },
      {
        randomBytes: fixedRandomBytes,
        storage: createSecureStoreCompatibleMemoryStorage(),
        verifierIterations: 10,
      }
    );

    await expect(controller.getState()).resolves.toMatchObject({
      needsSetup: true,
    });
    await expect(
      controller.setupPin({ confirmation: "1234", pin: "1234" })
    ).resolves.toStrictEqual({ status: "success" });
    await expect(controller.authenticateWithPin("1234")).resolves.toStrictEqual(
      {
        method: "pin",
        status: "success",
      }
    );
    await expect(controller.resetDeviceAuth()).resolves.toBeUndefined();
  });

  it("sets up scoped PIN credentials and tracks the local device-auth session timeout", async () => {
    const storage = createMemoryDeviceAuthStorage();
    let now = 1000;
    const controller = createDeviceAuthController(
      {
        pinLength: 4,
        scopeKey: "user-a",
        session: { timeoutMs: 5000 },
      },
      {
        now: () => now,
        randomBytes: fixedRandomBytes,
        storage,
        verifierIterations: 10,
      }
    );

    const initialState = await controller.getState();
    expect(initialState).toMatchObject({
      isSessionValid: false,
      needsSetup: true,
    });

    await expect(
      controller.setupPin({ confirmation: "1234", pin: "1234" })
    ).resolves.toStrictEqual({ status: "success" });

    await expect(controller.authenticateWithPin("1234")).resolves.toStrictEqual(
      {
        method: "pin",
        status: "success",
      }
    );

    const afterSetupState = await controller.getState();
    now += 4999;
    const nearExpiryState = await controller.getState();

    now += 1;
    const expiredState = await controller.getState();

    const otherScope = createDeviceAuthController(
      { pinLength: 4, scopeKey: "user-b" },
      {
        now: () => now,
        randomBytes: fixedRandomBytes,
        storage,
        verifierIterations: 10,
      }
    );
    const otherScopeState = await otherScope.getState();

    await controller.resetDeviceAuth();
    const resetState = await controller.getState();

    expect({
      afterSetup: {
        isSessionValid: afterSetupState.isSessionValid,
        needsSetup: afterSetupState.needsSetup,
      },
      expiredSessionValid: expiredState.isSessionValid,
      nearExpirySessionValid: nearExpiryState.isSessionValid,
      otherScopeNeedsSetup: otherScopeState.needsSetup,
      reset: {
        isSessionValid: resetState.isSessionValid,
        needsSetup: resetState.needsSetup,
      },
    }).toStrictEqual({
      afterSetup: {
        isSessionValid: true,
        needsSetup: false,
      },
      expiredSessionValid: false,
      nearExpirySessionValid: true,
      otherScopeNeedsSetup: true,
      reset: {
        isSessionValid: false,
        needsSetup: true,
      },
    });
  });

  it("locks PIN authentication with the configured escalating lockout ladder", async () => {
    const storage = createMemoryDeviceAuthStorage();
    let now = 10_000;
    const controller = createDeviceAuthController(
      {
        pinAttempts: {
          attemptsPerStep: 5,
          lockoutsMs: [30_000, 300_000, 900_000],
        },
        pinLength: 4,
      },
      {
        now: () => now,
        randomBytes: fixedRandomBytes,
        storage,
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        controller.authenticateWithPin("0000")
      ).resolves.toMatchObject({
        error: { code: "pin_mismatch" },
        status: "error",
      });
    }

    await expect(controller.authenticateWithPin("0000")).resolves.toStrictEqual(
      {
        status: "locked",
        until: 40_000,
      }
    );

    await expect(controller.authenticateWithPin("1234")).resolves.toStrictEqual(
      {
        status: "locked",
        until: 40_000,
      }
    );

    now = 40_000;
    await expect(controller.authenticateWithPin("1234")).resolves.toStrictEqual(
      {
        method: "pin",
        status: "success",
      }
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await controller.authenticateWithPin("0000");
    }

    await expect(controller.authenticateWithPin("1234")).resolves.toStrictEqual(
      {
        status: "locked",
        until: 340_000,
      }
    );
  });

  it("returns explicit errors for invalid setup and missing credentials", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await expect(controller.authenticateWithPin("1234")).resolves.toMatchObject(
      {
        error: { code: "no_pin" },
        status: "error",
      }
    );
    await expect(
      controller.setupPin({ confirmation: "12a4", pin: "12a4" })
    ).resolves.toMatchObject({
      error: { code: "invalid_pin" },
      status: "error",
    });
    await expect(
      controller.setupPin({ confirmation: "9999", pin: "1234" })
    ).resolves.toMatchObject({
      error: { code: "pin_confirmation_mismatch" },
      status: "error",
    });
  });

  it("rejects setup when a PIN is already configured for the credential scope", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await expect(
      controller.setupPin({ confirmation: "1234", pin: "1234" })
    ).resolves.toStrictEqual({ status: "success" });

    await expect(
      controller.setupPin({ confirmation: "5678", pin: "5678" })
    ).resolves.toMatchObject({
      error: { code: "pin_already_configured" },
      status: "error",
    });

    await expect(controller.authenticateWithPin("1234")).resolves.toStrictEqual(
      {
        method: "pin",
        status: "success",
      }
    );
    await expect(controller.authenticateWithPin("5678")).resolves.toMatchObject(
      {
        error: { code: "pin_mismatch" },
        status: "error",
      }
    );
  });

  it("requires fresh reauthentication before changing the configured PIN", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await expect(
      controller.setupPin({ confirmation: "1234", pin: "1234" })
    ).resolves.toStrictEqual({ status: "success" });
    await expect(
      controller.changePin({ confirmation: "5678", pin: "5678" })
    ).resolves.toMatchObject({
      error: { code: "reauthentication_required" },
      status: "error",
    });
  });

  it("changes the configured PIN after fresh reauthentication", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await expect(
      controller.reauthenticateWithPin("1234")
    ).resolves.toMatchObject({
      method: "pin",
      status: "success",
    });
    await expect(
      controller.changePin({ confirmation: "5678", pin: "5678" })
    ).resolves.toStrictEqual({ status: "success" });

    await expect(controller.authenticateWithPin("1234")).resolves.toMatchObject(
      {
        error: { code: "pin_mismatch" },
        status: "error",
      }
    );
    await expect(controller.authenticateWithPin("5678")).resolves.toStrictEqual(
      {
        method: "pin",
        status: "success",
      }
    );
  });

  it("persists finite sessions across controller instances when configured", async () => {
    const storage = createMemoryDeviceAuthStorage();
    let now = 1000;
    const firstController = createDeviceAuthController(
      {
        pinLength: 4,
        session: {
          persistAcrossRestarts: true,
          timeoutMs: 5000,
        },
      },
      {
        now: () => now,
        randomBytes: fixedRandomBytes,
        storage,
        verifierIterations: 10,
      }
    );

    await firstController.setupPin({ confirmation: "1234", pin: "1234" });
    await firstController.authenticateWithPin("1234");

    const restartedController = createDeviceAuthController(
      {
        pinLength: 4,
        session: {
          persistAcrossRestarts: true,
          timeoutMs: 5000,
        },
      },
      {
        now: () => now,
        randomBytes: fixedRandomBytes,
        storage,
        verifierIterations: 10,
      }
    );

    await expect(restartedController.getState()).resolves.toMatchObject({
      isSessionValid: true,
    });

    now = 6000;
    await expect(restartedController.getState()).resolves.toMatchObject({
      isSessionValid: false,
    });
  });

  it("supports memory-only infinite sessions and explicit reauthentication", async () => {
    const controller = createDeviceAuthController(
      {
        pinLength: 4,
        session: { timeoutMs: "infinite" },
      },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );

    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await controller.authenticateWithPin("1234");
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: true,
    });

    await controller.reauthenticateWithPin("1234");
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: true,
    });

    await controller.lock();
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: false,
    });
  });
});
