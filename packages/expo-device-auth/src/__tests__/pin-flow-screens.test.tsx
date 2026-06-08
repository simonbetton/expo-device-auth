import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { ChangePinScreen, PinSetupScreen } from "../pin-flow-screens";
import { mockFn } from "../test-support/jest-mocks";

const enterPin = (screen: ReturnType<typeof render>, pin: string): void => {
  for (const digit of pin) {
    fireEvent.press(screen.getByText(digit));
  }
};

const enterSlotPin = (
  screen: ReturnType<typeof render>,
  prefix: string,
  pin: string
): void => {
  for (const digit of pin) {
    fireEvent.press(screen.getByText(`${prefix}-${digit}`));
  }
};

describe("pIN flow screens", () => {
  it("sets up a PIN through create and confirm steps", async () => {
    const onComplete = mockFn();
    const screen = render(
      <PinSetupScreen pinLength={4} onComplete={onComplete} />
    );

    enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());

    enterPin(screen, "1234");
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("1234"));
    expect(onComplete).toHaveBeenCalledWith("1234");
  });

  it("resets setup when confirmation does not match", async () => {
    const onComplete = mockFn();
    const screen = render(
      <PinSetupScreen pinLength={4} onComplete={onComplete} />
    );

    enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    enterPin(screen, "0000");

    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("PINs do not match")).toBeTruthy()
    );
    expect(screen.getByText("Create PIN")).toBeTruthy();
  });

  it("passes custom slots and styles through the PIN setup flow", async () => {
    const onComplete = mockFn();
    const screen = render(
      <PinSetupScreen
        pinLength={4}
        onComplete={onComplete}
        styles={{ keyText: { color: "#111827" } }}
        slots={{
          Key: ({ label, onPress }) => (
            <Text onPress={onPress}>{`setup-${label}`}</Text>
          ),
        }}
      />
    );

    enterSlotPin(screen, "setup", "1234");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    enterSlotPin(screen, "setup", "1234");

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("1234"));
    expect(onComplete).toHaveBeenCalledWith("1234");
  });

  it("changes a PIN after verifying the current PIN", async () => {
    const onVerifyCurrentPin = mockFn((pin: string) =>
      Promise.resolve(
        pin === "1234"
          ? { method: "pin" as const, status: "success" as const }
          : {
              error: {
                code: "pin_mismatch" as const,
                message: "PIN does not match",
              },
              status: "error" as const,
            }
      )
    );
    const onComplete = mockFn();
    const screen = render(
      <ChangePinScreen
        pinLength={4}
        onVerifyCurrentPin={onVerifyCurrentPin}
        onComplete={onComplete}
      />
    );

    enterPin(screen, "0000");
    await waitFor(() =>
      expect(screen.getByText("Current PIN is incorrect")).toBeTruthy()
    );

    enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("New PIN")).toBeTruthy());

    enterPin(screen, "5555");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());

    enterPin(screen, "5555");
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("5555"));
    expect(onComplete).toHaveBeenCalledWith("5555");
  });

  it("resets the change flow when the new PIN confirmation does not match", async () => {
    const onComplete = mockFn();
    const screen = render(
      <ChangePinScreen
        pinLength={4}
        onVerifyCurrentPin={() =>
          Promise.resolve({ method: "pin", status: "success" })
        }
        onComplete={onComplete}
      />
    );

    enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("New PIN")).toBeTruthy());

    enterPin(screen, "5555");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    enterPin(screen, "0000");

    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("PINs do not match")).toBeTruthy()
    );
    expect(screen.getByText("New PIN")).toBeTruthy();
  });

  it("passes custom slots and styles through the change PIN flow", async () => {
    const onComplete = mockFn();
    const screen = render(
      <ChangePinScreen
        pinLength={4}
        onVerifyCurrentPin={() =>
          Promise.resolve({ method: "pin", status: "success" })
        }
        onComplete={onComplete}
        styles={{ keyText: { color: "#111827" } }}
        slots={{
          Key: ({ label, onPress }) => (
            <Text onPress={onPress}>{`change-${label}`}</Text>
          ),
        }}
      />
    );

    enterSlotPin(screen, "change", "1234");
    await waitFor(() => expect(screen.getByText("New PIN")).toBeTruthy());
    enterSlotPin(screen, "change", "5555");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    enterSlotPin(screen, "change", "5555");

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("5555"));
    expect(onComplete).toHaveBeenCalledWith("5555");
  });
});
