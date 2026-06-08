import { afterEach, describe, expect, it } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Pressable, Text } from "react-native";

import { PinEntryScreen } from "../pin-entry-screen";
import { mockFn } from "../test-support/jest-mocks";

const selectedDots = (screen: ReturnType<typeof render>): boolean[] =>
  screen
    .getAllByText("●")
    .map((dot) => dot.props.accessibilityState?.selected ?? false);

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

describe("pinEntryScreen", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
  });

  it("uses keypad input to unmute dots and submit when the configured PIN length is reached", async () => {
    const onSubmit = mockFn();
    const screen = render(<PinEntryScreen pinLength={4} onSubmit={onSubmit} />);

    expect(selectedDots(screen)).toStrictEqual([false, false, false, false]);

    fireEvent.press(screen.getByText("1"));
    fireEvent.press(screen.getByText("2"));
    expect(selectedDots(screen)).toStrictEqual([true, true, false, false]);

    fireEvent.press(screen.getByText("⌫"));
    expect(selectedDots(screen)).toStrictEqual([true, false, false, false]);

    fireEvent.press(screen.getByText("2"));
    fireEvent.press(screen.getByText("3"));
    fireEvent.press(screen.getByText("4"));
    fireEvent.press(screen.getByText("5"));

    expect(selectedDots(screen)).toStrictEqual([true, true, true, true]);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("1234"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("waits for an animation frame before submitting when animation frames are available", async () => {
    const requestAnimationFrameMock = mockFn(
      (_frameHandler: FrameRequestCallback) => 1
    );
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: requestAnimationFrameMock,
    });

    const onSubmit = mockFn();
    const screen = render(<PinEntryScreen pinLength={4} onSubmit={onSubmit} />);

    fireEvent.press(screen.getByText("1"));
    fireEvent.press(screen.getByText("2"));
    fireEvent.press(screen.getByText("3"));
    fireEvent.press(screen.getByText("4"));

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    requestAnimationFrameMock.mock.calls[0]?.[0](0);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("1234"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("only shows Forgot PIN when the callback is explicitly provided", () => {
    const withoutCallback = render(
      <PinEntryScreen pinLength={4} onSubmit={mockFn()} />
    );
    expect(withoutCallback.queryByText("Forgot PIN")).toBeNull();

    const onForgotPin = mockFn();
    const withCallback = render(
      <PinEntryScreen
        pinLength={4}
        onSubmit={mockFn()}
        onForgotPin={onForgotPin}
      />
    );
    fireEvent.press(withCallback.getByText("Forgot PIN"));

    expect(onForgotPin).toHaveBeenCalledTimes(1);
  });

  it("lets callers replace dots and keys with slots", () => {
    const onSubmit = mockFn();
    const screen = render(
      <PinEntryScreen
        pinLength={4}
        onSubmit={onSubmit}
        slots={{
          Dot: ({ filled, index }) => (
            <Text>{`${filled ? "filled" : "empty"}-${index}`}</Text>
          ),
          Key: ({ label, onPress }) => (
            <Pressable onPress={onPress}>
              <Text>{`key-${label}`}</Text>
            </Pressable>
          ),
        }}
      />
    );

    expect(screen.getByText("empty-0")).toBeTruthy();
    fireEvent.press(screen.getByText("key-1"));
    expect(screen.getByText("filled-0")).toBeTruthy();
  });
});
