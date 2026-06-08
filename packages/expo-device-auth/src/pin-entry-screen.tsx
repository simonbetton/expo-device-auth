import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";

import type { PinLength } from "./types";

const DOT = "●";
const BACKSPACE = "⌫";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

const submitAfterPaint = (submit: () => void): void => {
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => {
      setTimeout(submit, 0);
    });
    return;
  }

  setTimeout(submit, 0);
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

export const PinEntryScreen = ({
  pinLength,
  title = "Enter PIN",
  onSubmit,
  onForgotPin,
  styles: styleOverrides,
  slots,
}: PinEntryScreenProps) => {
  const [digits, setDigits] = useState("");
  const dots = useMemo(
    () =>
      Array.from({ length: pinLength }, (_, index) => index < digits.length),
    [digits.length, pinLength]
  );

  const enterDigit = (digit: string) => {
    if (digits.length >= pinLength) {
      return;
    }

    const nextDigits = `${digits}${digit}`;
    setDigits(nextDigits);
    if (nextDigits.length === pinLength) {
      submitAfterPaint(() => {
        void onSubmit(nextDigits);
      });
    }
  };

  const removeDigit = () => {
    setDigits((previousDigits) => previousDigits.slice(0, -1));
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
        {KEYS.map((digit) =>
          slots?.Key ? (
            <React.Fragment key={digit}>
              {slots.Key({ label: digit, onPress: () => enterDigit(digit) })}
            </React.Fragment>
          ) : (
            <Pressable
              accessibilityRole="button"
              key={digit}
              onPress={() => enterDigit(digit)}
              style={[defaultStyles.key, styleOverrides?.key]}
            >
              <Text style={[defaultStyles.keyText, styleOverrides?.keyText]}>
                {digit}
              </Text>
            </Pressable>
          )
        )}
        <Pressable
          accessibilityRole="button"
          onPress={removeDigit}
          style={[defaultStyles.key, styleOverrides?.key]}
        >
          <Text style={[defaultStyles.keyText, styleOverrides?.keyText]}>
            {BACKSPACE}
          </Text>
        </Pressable>
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
