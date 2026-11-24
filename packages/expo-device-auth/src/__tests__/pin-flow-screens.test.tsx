import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { ChangePinScreen, PinSetupScreen } from "../pin-flow-screens";
import { mockFn } from "../test-support/jest-mocks";
import type { AuthResult, SetupPinResult } from "../types";

const enterPin = async (
  screen: Awaited<ReturnType<typeof render>>,
  pin: string
): Promise<void> => {
  for (const digit of pin) {
    // eslint-disable-next-line no-await-in-loop -- Each key press commits before entering the next digit.
    await fireEvent.press(screen.getByText(digit));
  }
};

const enterSlotPin = async (
  screen: Awaited<ReturnType<typeof render>>,
  prefix: string,
  pin: string
): Promise<void> => {
  for (const digit of pin) {
    // eslint-disable-next-line no-await-in-loop -- Each key press commits before entering the next digit.
    await fireEvent.press(screen.getByText(`${prefix}-${digit}`));
  }
};

describe("pIN flow screens", () => {
  it("sets up a PIN through create and confirm steps", async () => {
    const onComplete = mockFn();
    const screen = await render(
      <PinSetupScreen pinLength={4} onComplete={onComplete} />
    );

    await enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());

    await enterPin(screen, "1234");
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("1234"));
    expect(onComplete).toHaveBeenCalledWith("1234");
  });

  it("returns to PIN creation after a rejected save and completes only once on retry", async () => {
    const onComplete = mockFn((_pin: string): Promise<void> =>
      Promise.resolve()
    );
    onComplete.mockRejectedValueOnce(new Error("storage unavailable"));
    const screen = await render(
      <PinSetupScreen pinLength={4} onComplete={onComplete} />
    );
    const createAndConfirm = async () => {
      await enterPin(screen, "1234");
      await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
      await enterPin(screen, "1234");
    };

    await createAndConfirm();
    await waitFor(() =>
      expect(screen.getByText("Could not save PIN. Try again.")).toBeTruthy()
    );
    await createAndConfirm();
    await waitFor(() => expect(screen.getByText("PIN set up")).toBeTruthy());
    expect(screen.queryByText("Confirm PIN")).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it("returns to current PIN verification after a rejected change", async () => {
    const onVerifyCurrentPin = mockFn((_pin: string): AuthResult => ({
      method: "pin",
      status: "success",
    }));
    const onComplete = mockFn((_pin: string): SetupPinResult => ({
      error: {
        code: "reauthentication_required",
        message: "Fresh local authentication is required",
      },
      status: "error",
    }));
    const screen = await render(
      <ChangePinScreen
        pinLength={4}
        onVerifyCurrentPin={onVerifyCurrentPin}
        onComplete={onComplete}
      />
    );
    await enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("New PIN")).toBeTruthy());
    await enterPin(screen, "5678");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    await enterPin(screen, "5678");

    await waitFor(() =>
      expect(
        screen.getByText("Fresh local authentication is required")
      ).toBeTruthy()
    );
    expect(screen.getByText("Current PIN")).toBeTruthy();
  });

  it.each([
    [{ status: "locked", until: 500 }, "Too many attempts. Try again later."],
    [{ status: "cancelled" }, "Verification cancelled. Try again."],
    [
      {
        error: { code: "no_pin", message: "Set up PIN first" },
        status: "error",
      },
      "Set up PIN first",
    ],
    [
      {
        error: { code: "pin_mismatch", message: "PIN does not match" },
        status: "error",
      },
      "Current PIN is incorrect",
    ],
  ] satisfies [AuthResult, string][])(
    "reports the current PIN outcome %p",
    async (result, message) => {
      const screen = await render(
        <ChangePinScreen
          pinLength={4}
          onVerifyCurrentPin={() => result}
          onComplete={mockFn()}
        />
      );
      await enterPin(screen, "1234");
      await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
      expect(screen.getByText("Current PIN")).toBeTruthy();
    }
  );

  it("resets setup when confirmation does not match", async () => {
    const onComplete = mockFn();
    const screen = await render(
      <PinSetupScreen pinLength={4} onComplete={onComplete} />
    );

    await enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    await enterPin(screen, "0000");

    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("PINs do not match")).toBeTruthy()
    );
    expect(screen.getByText("Create PIN")).toBeTruthy();
  });

  it("passes custom slots and styles through the PIN setup flow", async () => {
    const onComplete = mockFn();
    const screen = await render(
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

    await enterSlotPin(screen, "setup", "1234");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    await enterSlotPin(screen, "setup", "1234");

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
    const screen = await render(
      <ChangePinScreen
        pinLength={4}
        onVerifyCurrentPin={onVerifyCurrentPin}
        onComplete={onComplete}
      />
    );

    await enterPin(screen, "0000");
    await waitFor(() =>
      expect(screen.getByText("Current PIN is incorrect")).toBeTruthy()
    );

    await enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("New PIN")).toBeTruthy());

    await enterPin(screen, "5555");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());

    await enterPin(screen, "5555");
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("5555"));
    expect(onComplete).toHaveBeenCalledWith("5555");
  });

  it("resets the change flow when the new PIN confirmation does not match", async () => {
    const onComplete = mockFn();
    const screen = await render(
      <ChangePinScreen
        pinLength={4}
        onVerifyCurrentPin={() =>
          Promise.resolve({ method: "pin", status: "success" })
        }
        onComplete={onComplete}
      />
    );

    await enterPin(screen, "1234");
    await waitFor(() => expect(screen.getByText("New PIN")).toBeTruthy());

    await enterPin(screen, "5555");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    await enterPin(screen, "0000");

    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("PINs do not match")).toBeTruthy()
    );
    expect(screen.getByText("New PIN")).toBeTruthy();
  });

  it("passes custom slots and styles through the change PIN flow", async () => {
    const onComplete = mockFn();
    const screen = await render(
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

    await enterSlotPin(screen, "change", "1234");
    await waitFor(() => expect(screen.getByText("New PIN")).toBeTruthy());
    await enterSlotPin(screen, "change", "5555");
    await waitFor(() => expect(screen.getByText("Confirm PIN")).toBeTruthy());
    await enterSlotPin(screen, "change", "5555");

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("5555"));
    expect(onComplete).toHaveBeenCalledWith("5555");
  });
});
