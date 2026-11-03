import { afterEach, describe, expect, it } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Pressable, Text } from "react-native";

import { PinEntryScreen } from "../pin-entry-screen";
import { mockFn } from "../test-support/jest-mocks";

const selectedDots = (screen: Awaited<ReturnType<typeof render>>): boolean[] =>
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
    const screen = await render(
      <PinEntryScreen pinLength={4} onSubmit={onSubmit} />
    );

    expect(selectedDots(screen)).toStrictEqual([false, false, false, false]);

    await fireEvent.press(screen.getByText("1"));
    await fireEvent.press(screen.getByText("2"));
    expect(selectedDots(screen)).toStrictEqual([true, true, false, false]);

    await fireEvent.press(screen.getByText("⌫"));
    expect(selectedDots(screen)).toStrictEqual([true, false, false, false]);

    await fireEvent.press(screen.getByText("2"));
    await fireEvent.press(screen.getByText("3"));
    await fireEvent.press(screen.getByText("4"));
    await fireEvent.press(screen.getByText("5"));

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
    const screen = await render(
      <PinEntryScreen pinLength={4} onSubmit={onSubmit} />
    );

    await fireEvent.press(screen.getByText("1"));
    await fireEvent.press(screen.getByText("2"));
    await fireEvent.press(screen.getByText("3"));
    await fireEvent.press(screen.getByText("4"));

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    requestAnimationFrameMock.mock.calls[0]?.[0](0);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("1234"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("only shows Forgot PIN when the callback is explicitly provided", async () => {
    const withoutCallback = await render(
      <PinEntryScreen pinLength={4} onSubmit={mockFn()} />
    );
    expect(withoutCallback.queryByText("Forgot PIN")).toBeNull();

    const onForgotPin = mockFn();
    const withCallback = await render(
      <PinEntryScreen
        pinLength={4}
        onSubmit={mockFn()}
        onForgotPin={onForgotPin}
      />
    );
    await fireEvent.press(withCallback.getByText("Forgot PIN"));

    expect(onForgotPin).toHaveBeenCalledTimes(1);
  });

  it("lets callers replace dots and keys with slots", async () => {
    const onSubmit = mockFn();
    const screen = await render(
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
    await fireEvent.press(screen.getByText("key-1"));
    expect(screen.getByText("filled-0")).toBeTruthy();
  });
});
