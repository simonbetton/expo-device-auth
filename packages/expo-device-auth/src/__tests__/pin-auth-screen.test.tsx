import { describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import {
  createDeviceAuthController,
  createMemoryDeviceAuthStorage,
} from "../device-auth-controller";
import { PinAuthScreen } from "../pin-auth-screen";
import { mockFn } from "../test-support/jest-mocks";

const fixedRandomBytes = (length: number) =>
  Uint8Array.from({ length }, (_, index) => index + 1);

const enterPin = async (
  screen: ReturnType<typeof render>,
  pin: string
): Promise<void> => {
  for (const digit of pin) {
    await act(async () => {
      fireEvent.press(screen.getByText(digit));
      await Promise.resolve();
    });
  }
};

describe("pinAuthScreen", () => {
  it("authenticates with PIN and reports the result", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        now: () => 0,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    const onResult = mockFn();
    const screen = render(
      <PinAuthScreen
        controller={controller}
        pinLength={4}
        onResult={onResult}
        title="Unlock"
      />
    );

    await enterPin(screen, "1234");

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        method: "pin",
        status: "success",
      })
    );
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("reauthenticates with PIN and passes custom slots and styles to the entry UI", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        now: () => 0,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    await controller.authenticateWithPin("1234");
    const onResult = mockFn();
    const screen = render(
      <PinAuthScreen
        controller={controller}
        mode="reauthenticate"
        pinLength={4}
        onResult={onResult}
        styles={{ keyText: { color: "#111827" } }}
        slots={{
          Key: ({ label, onPress }) => (
            <Text onPress={onPress}>{`slot-${label}`}</Text>
          ),
        }}
      />
    );

    for (const digit of ["1", "2", "3", "4"]) {
      await act(async () => {
        fireEvent.press(screen.getByText(`slot-${digit}`));
        await Promise.resolve();
      });
    }

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        method: "pin",
        status: "success",
      })
    );
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error for a mismatched PIN", async () => {
    const controller = createDeviceAuthController(
      { pinLength: 4 },
      {
        now: () => 0,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    const screen = render(
      <PinAuthScreen
        controller={controller}
        pinLength={4}
        onResult={mockFn()}
      />
    );

    await enterPin(screen, "0000");

    await waitFor(() =>
      expect(screen.getByText("PIN does not match")).toBeTruthy()
    );
    expect(screen.getByText("PIN does not match")).toBeTruthy();
  });

  it("reports lockout and only renders Forgot PIN when configured", async () => {
    const controller = createDeviceAuthController(
      {
        pinAttempts: { attemptsPerStep: 1, lockoutsMs: [30_000] },
        pinLength: 4,
      },
      {
        now: () => 0,
        randomBytes: fixedRandomBytes,
        storage: createMemoryDeviceAuthStorage(),
        verifierIterations: 10,
      }
    );
    await controller.setupPin({ confirmation: "1234", pin: "1234" });
    const onResult = mockFn();
    const onForgotPin = mockFn();
    const screen = render(
      <PinAuthScreen
        controller={controller}
        pinLength={4}
        onResult={onResult}
        onForgotPin={onForgotPin}
      />
    );

    fireEvent.press(screen.getByText("Forgot PIN"));
    expect(onForgotPin).toHaveBeenCalledTimes(1);

    await enterPin(screen, "0000");

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ status: "locked", until: 30_000 })
    );
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
