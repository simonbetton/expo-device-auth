import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type * as LocalAuthentication from "expo-local-authentication";
import type * as SecureStore from "expo-secure-store";
import React from "react";
import { Text } from "react-native";

import {
  createDeviceAuthController,
  createMemoryDeviceAuthStorage,
} from "../device-auth-controller";
import type { BiometricDriver } from "../device-auth-controller";
import { DeviceAuthProvider, useDeviceAuth } from "../device-auth-provider";
import type { DeviceAuthHandle } from "../device-auth-provider";
import { mockFn } from "../test-support/jest-mocks";
import { AppStateMock } from "../test-support/react-native-mock";

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

const fixedRandomBytes = (length: number) =>
  Uint8Array.from({ length }, (_, index) => index + 1);

const Consumer = () => {
  const controller = useDeviceAuth();
  return <Text>{controller ? "controller-ready" : "missing-controller"}</Text>;
};

const pressAndFlushPinSubmit = async (
  screen: ReturnType<typeof render>,
  label: string
): Promise<void> => {
  await act(async () => {
    fireEvent.press(screen.getByText(label));
    for (let step = 0; step < 10; step += 1) {
      await Promise.resolve();
    }
  });
  await waitFor(() => expect(true).toBe(true));
};

const enterPin = async (
  screen: ReturnType<typeof render>,
  pin: string
): Promise<void> => {
  for (const digit of pin) {
    await pressAndFlushPinSubmit(screen, digit);
  }
};

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

describe("deviceAuthProvider", () => {
  beforeEach(() => {
    AppStateMock.reset();
  });

  it("provides the controller through useDeviceAuth", () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      { storage: createMemoryDeviceAuthStorage() }
    );

    const screen = render(
      <DeviceAuthProvider controller={controller}>
        <Consumer />
      </DeviceAuthProvider>
    );

    expect(screen.getByText("controller-ready")).toBeTruthy();
  });

  it("fails clearly when useDeviceAuth is used outside the provider", () => {
    expect(() => render(<Consumer />)).toThrow(
      "useDeviceAuth must be used within DeviceAuthProvider"
    );
  });

  it("reauthenticates with biometrics even when the local session is already valid", async () => {
    const biometrics = enrolledBiometrics({ success: true });
    const controller = createDeviceAuthController(
      { biometrics: { defaultEnabled: true }, pinLength: 4 },
      {
        biometrics,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await controller.authenticateWithPin("1234");

    const ref = React.createRef<DeviceAuthHandle>();
    render(
      <DeviceAuthProvider ref={ref} controller={controller}>
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    await expect(ref.current?.reauthenticate()).resolves.toStrictEqual({
      method: "biometric",
      status: "success",
    });
    expect(biometrics.authenticateCalls).toHaveLength(1);
  });

  it("returns no-pin and session shortcut results from authenticate", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    const ref = React.createRef<DeviceAuthHandle>();
    render(
      <DeviceAuthProvider ref={ref} controller={controller}>
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    await expect(ref.current?.authenticate()).resolves.toMatchObject({
      error: { code: "no_pin" },
      status: "error",
    });

    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await controller.authenticateWithPin("1234");

    await expect(ref.current?.authenticate()).resolves.toStrictEqual({
      method: "session",
      status: "success",
    });
  });

  it("returns no-pin from reauthenticate before setup", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    const ref = React.createRef<DeviceAuthHandle>();
    render(
      <DeviceAuthProvider ref={ref} controller={controller}>
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    await expect(ref.current?.reauthenticate()).resolves.toMatchObject({
      error: { code: "no_pin" },
      status: "error",
    });
  });

  it("can create its controller from provider config and injected adapters", async () => {
    const ref = React.createRef<DeviceAuthHandle>();
    render(
      <DeviceAuthProvider
        ref={ref}
        config={{ pinLength: 4 }}
        storage={createMemoryDeviceAuthStorage()}
        randomBytes={fixedRandomBytes}
        verifierIterations={10}
      >
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    await expect(
      ref.current?.setupPin({ confirmation: "1234", pin: "1234" })
    ).resolves.toStrictEqual({ status: "success" });
    await expect(ref.current?.getState()).resolves.toMatchObject({
      needsSetup: false,
    });
  });

  it("exposes controller methods through the provider handle", async () => {
    const biometrics = enrolledBiometrics({ success: true });
    const controller = createDeviceAuthController(
      { biometrics: { defaultEnabled: true }, pinLength: 4 },
      {
        biometrics,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    const ref = React.createRef<DeviceAuthHandle>();
    render(
      <DeviceAuthProvider ref={ref} controller={controller}>
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    await ref.current?.setupPin({ confirmation: "1234", pin: "1234" });
    const authenticateWithPinResult =
      await ref.current?.authenticateWithPin("1234");
    const authenticateWithBiometricsResult =
      await ref.current?.authenticateWithBiometrics();
    const reauthenticateWithBiometricsResult =
      await ref.current?.reauthenticateWithBiometrics();
    const reauthenticateWithPinResult =
      await ref.current?.reauthenticateWithPin("1234");
    const disableBiometricsResult =
      await ref.current?.setBiometricEnabled(false);
    await ref.current?.lock();
    const lockedState = await ref.current?.getState();
    await ref.current?.resetDeviceAuth();
    const resetState = await ref.current?.getState();

    expect({
      authenticateWithBiometricsResult,
      authenticateWithPinResult,
      disableBiometricsResult,
      isLockedSessionValid: lockedState?.isSessionValid,
      isResetNeedingSetup: resetState?.needsSetup,
      reauthenticateWithBiometricsResult,
      reauthenticateWithPinResult,
    }).toStrictEqual({
      authenticateWithBiometricsResult: {
        method: "biometric",
        status: "success",
      },
      authenticateWithPinResult: {
        method: "pin",
        status: "success",
      },
      disableBiometricsResult: {
        status: "success",
      },
      isLockedSessionValid: false,
      isResetNeedingSetup: true,
      reauthenticateWithBiometricsResult: {
        method: "biometric",
        status: "success",
      },
      reauthenticateWithPinResult: {
        method: "pin",
        status: "success",
      },
    });
  });

  it("prompts for PIN during authenticate when no valid local session exists", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });

    const ref = React.createRef<DeviceAuthHandle>();
    const screen = render(
      <DeviceAuthProvider ref={ref} controller={controller} pinLength={4}>
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    const result = ref.current?.authenticate();
    await waitFor(() => expect(screen.getByText("Enter PIN")).toBeTruthy());
    await enterPin(screen, "1234");

    let resolvedResult: unknown;
    await act(async () => {
      resolvedResult = await result;
    });
    expect(resolvedResult).toStrictEqual({
      method: "pin",
      status: "success",
    });
  });

  it("prompts for PIN when Promise.withResolvers is unavailable", async () => {
    const promiseConstructor = Promise as typeof Promise & {
      withResolvers?: unknown;
    };
    const originalWithResolvers = promiseConstructor.withResolvers;
    Object.defineProperty(Promise, "withResolvers", {
      configurable: true,
      value: undefined,
    });

    try {
      const controller = createDeviceAuthController(
        { pinLength: 4 },
        {
          randomBytes: fixedRandomBytes,
          storage: createMemoryDeviceAuthStorage(),
          verifierIterations: 10,
        }
      );
      await controller.setupPin({ confirmation: "1234", pin: "1234" });

      const ref = React.createRef<DeviceAuthHandle>();
      const screen = render(
        <DeviceAuthProvider ref={ref} controller={controller} pinLength={4}>
          <Text>Ready</Text>
        </DeviceAuthProvider>
      );

      const result = ref.current?.authenticate();
      await waitFor(() => expect(screen.getByText("Enter PIN")).toBeTruthy());
      await enterPin(screen, "1234");

      let resolvedResult: unknown;
      await act(async () => {
        resolvedResult = await result;
      });
      expect(resolvedResult).toStrictEqual({
        method: "pin",
        status: "success",
      });
    } finally {
      Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        value: originalWithResolvers,
      });
    }
    expect(promiseConstructor.withResolvers).toBe(originalWithResolvers);
  });

  it("passes provider PIN slots into the owned modal", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });

    const ref = React.createRef<DeviceAuthHandle>();
    const screen = render(
      <DeviceAuthProvider
        ref={ref}
        controller={controller}
        pinLength={4}
        pinSlots={{
          Key: ({ label, onPress }) => (
            <Text onPress={onPress}>{`slot-${label}`}</Text>
          ),
        }}
        pinStyles={{ keyText: { color: "#111827" } }}
      >
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    const result = ref.current?.authenticate();
    await waitFor(() => expect(screen.getByText("slot-1")).toBeTruthy());
    for (const digit of ["1", "2", "3", "4"]) {
      await pressAndFlushPinSubmit(screen, `slot-${digit}`);
    }

    let resolvedResult: unknown;
    await act(async () => {
      resolvedResult = await result;
    });
    expect(resolvedResult).toStrictEqual({
      method: "pin",
      status: "success",
    });
  });

  it("falls back to the provider-owned PIN modal when biometrics are cancelled", async () => {
    const controller = createDeviceAuthController(
      { biometrics: { defaultEnabled: true }, pinLength: 4 },
      {
        biometrics: enrolledBiometrics({ success: false }),
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });

    const ref = React.createRef<DeviceAuthHandle>();
    const screen = render(
      <DeviceAuthProvider
        ref={ref}
        controller={controller}
        onForgotPin={mockFn()}
        pinLength={4}
      >
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    const result = ref.current?.reauthenticate({
      message: "Fresh authentication is required.",
      title: "Confirm transfer",
    });

    await waitFor(() =>
      expect(screen.getByText("Confirm transfer")).toBeTruthy()
    );
    expect(screen.getByText("Fresh authentication is required.")).toBeTruthy();
    await enterPin(screen, "1234");

    let resolvedResult: unknown;
    await act(async () => {
      resolvedResult = await result;
    });
    expect(resolvedResult).toStrictEqual({
      method: "pin",
      status: "success",
    });
  });

  it("keeps the PIN modal open after mismatch and resolves cancellation", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });

    const ref = React.createRef<DeviceAuthHandle>();
    const screen = render(
      <DeviceAuthProvider ref={ref} controller={controller} pinLength={4}>
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    const result = ref.current?.reauthenticate();
    await waitFor(() => expect(screen.getByText("Enter PIN")).toBeTruthy());
    await enterPin(screen, "0000");

    await waitFor(() =>
      expect(screen.getByText("PIN does not match")).toBeTruthy()
    );
    fireEvent.press(screen.getByText("Cancel"));

    await expect(result).resolves.toStrictEqual({ status: "cancelled" });
  });

  it("locks the local session when the app backgrounds if configured", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4, session: { timeoutMs: "infinite" } },
      {
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await controller.authenticateWithPin("1234");

    render(
      <DeviceAuthProvider controller={controller} lockOnBackground>
        <Text>Ready</Text>
      </DeviceAuthProvider>
    );

    AppStateMock.emit("background");

    await waitFor(async () => {
      const state = await controller.getState();
      expect(state.isSessionValid).toBe(false);
    });
    await expect(controller.getState()).resolves.toMatchObject({
      isSessionValid: false,
    });
  });

  it("requires config when a controller is not provided", () => {
    expect(() =>
      render(
        <DeviceAuthProvider>
          <Text>Ready</Text>
        </DeviceAuthProvider>
      )
    ).toThrow(
      "DeviceAuthProvider requires config when controller is not provided"
    );
  });
});
