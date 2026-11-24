import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";

import type { PinLength } from "./types";
import { useMountEffect } from "./use-mount-effect";

const DOT = "●";
const BACKSPACE = "⌫";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

const submitAfterPaint = (submit: () => void): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  const schedule = () => {
    timer = setTimeout(submit, 0);
  };
  if (typeof requestAnimationFrame === "undefined") {
    schedule();
  } else {
    frame = requestAnimationFrame(schedule);
  }

  return () => {
    if (frame !== undefined && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(frame);
    }
    clearTimeout(timer);
  };
};

export interface PinEntryStyles {
  container?: StyleProp<ViewStyle>;
  title?: StyleProp<TextStyle>;
  dotsRow?: StyleProp<ViewStyle>;
  dot?: StyleProp<TextStyle>;
  dotMuted?: StyleProp<TextStyle>;
  dotUnmuted?: StyleProp<TextStyle>;
  keypad?: StyleProp<ViewStyle>;
  key?: StyleProp<ViewStyle>;
  keyText?: StyleProp<TextStyle>;
  forgotPin?: StyleProp<TextStyle>;
}

export interface PinEntrySlots {
  Dot?: (props: { filled: boolean; index: number }) => React.ReactNode;
  Key?: (props: { label: string; onPress: () => void }) => React.ReactNode;
  ForgotPin?: (props: { onPress: () => void }) => React.ReactNode;
}

export interface PinEntryScreenProps {
  pinLength: PinLength;
  title?: string;
  onSubmit: (pin: string) => void | Promise<void>;
  onForgotPin?: () => void | Promise<void>;
  styles?: PinEntryStyles;
  slots?: PinEntrySlots;
}

const defaultStyles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#f6f7f9",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  dot: {
    fontSize: 24,
  },
  dotMuted: {
    color: "#c7cbd1",
  },
  dotUnmuted: {
    color: "#1f2937",
  },
  dotsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 32,
  },
  forgotPin: {
    color: "#375dfb",
    fontSize: 15,
    marginTop: 28,
  },
  key: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d8dde5",
    borderRadius: 8,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  keyText: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "500",
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
    maxWidth: 264,
  },
  title: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 24,
  },
});

const PinKey = ({
  label,
  onPress,
  renderKey,
  styles,
}: {
  label: string;
  onPress: () => void;
  renderKey?: PinEntrySlots["Key"];
  styles?: PinEntryStyles;
}) =>
  renderKey ? (
    renderKey({ label, onPress })
  ) : (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[defaultStyles.key, styles?.key]}
    >
      <Text style={[defaultStyles.keyText, styles?.keyText]}>{label}</Text>
    </Pressable>
  );

export const PinEntryScreen = ({
  pinLength,
  title = "Enter PIN",
  onSubmit,
  onForgotPin,
  styles: styleOverrides,
  slots,
}: PinEntryScreenProps) => {
  const [digits, setDigits] = useState("");
  const input = useRef<{
    digits: string;
    pending: boolean;
    disposed: boolean;
    cancelQueued?: () => void;
  }>({ digits: "", disposed: false, pending: false });
  useMountEffect(() => {
    const { current } = input;
    current.disposed = false;
    return () => {
      current.disposed = true;
      current.cancelQueued?.();
      delete current.cancelQueued;
      current.pending = false;
      current.digits = "";
    };
  });
  const dots = useMemo(
    () =>
      Array.from({ length: pinLength }, (_, index) => index < digits.length),
    [digits.length, pinLength]
  );

  const enterDigit = useCallback(
    (digit: string) => {
      const { current } = input;
      if (
        current.disposed ||
        current.pending ||
        current.digits.length >= pinLength
      ) {
        return;
      }

      current.digits += digit;
      const nextDigits = current.digits;
      setDigits(nextDigits);
      if (nextDigits.length === pinLength) {
        current.pending = true;
        current.cancelQueued = submitAfterPaint(() => {
          delete current.cancelQueued;
          if (current.disposed || !current.pending) {
            return;
          }
          const submit = async () => {
            try {
              await onSubmit(nextDigits);
            } catch {
              current.digits = "";
              if (!current.disposed) {
                setDigits("");
              }
            }
            current.pending = false;
          };
          void submit();
        });
      }
    },
    [onSubmit, pinLength]
  );

  const removeDigit = () => {
    const { current } = input;
    if (!current.disposed && !current.pending) {
      current.digits = current.digits.slice(0, -1);
      setDigits(current.digits);
    }
  };

  return (
    <View style={[defaultStyles.container, styleOverrides?.container]}>
      <Text style={[defaultStyles.title, styleOverrides?.title]}>{title}</Text>
      <View style={[defaultStyles.dotsRow, styleOverrides?.dotsRow]}>
        {dots.map((filled, index) =>
          slots?.Dot ? (
            <React.Fragment key={index}>
              {slots.Dot({ filled, index })}
            </React.Fragment>
          ) : (
            <Text
              accessibilityLabel={filled ? "Entered digit" : "Empty digit"}
              accessibilityState={{ selected: filled }}
              key={index}
              style={[
                defaultStyles.dot,
                styleOverrides?.dot,
                filled
                  ? [defaultStyles.dotUnmuted, styleOverrides?.dotUnmuted]
                  : [defaultStyles.dotMuted, styleOverrides?.dotMuted],
              ]}
            >
              {DOT}
            </Text>
          )
        )}
      </View>
      <View style={[defaultStyles.keypad, styleOverrides?.keypad]}>
        {KEYS.map((digit) => (
          <PinKey
            key={digit}
            label={digit}
            onPress={() => enterDigit(digit)}
            renderKey={slots?.Key}
            {...(styleOverrides === undefined
              ? {}
              : { styles: styleOverrides })}
          />
        ))}
        <PinKey
          label={BACKSPACE}
          onPress={removeDigit}
          {...(styleOverrides === undefined ? {} : { styles: styleOverrides })}
        />
      </View>
      {onForgotPin
        ? (slots?.ForgotPin?.({ onPress: onForgotPin }) ?? (
            <Pressable accessibilityRole="button" onPress={onForgotPin}>
              <Text
                style={[defaultStyles.forgotPin, styleOverrides?.forgotPin]}
              >
                Forgot PIN
              </Text>
            </Pressable>
          ))
        : null}
    </View>
  );
};
