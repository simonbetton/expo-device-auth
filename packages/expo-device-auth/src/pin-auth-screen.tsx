import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import type { DeviceAuthController } from "./device-auth-controller";
import { PinEntryScreen } from "./pin-entry-screen";
import type { PinEntrySlots, PinEntryStyles } from "./pin-entry-screen";
import type { AuthResult, PinLength } from "./types";

export interface PinAuthScreenProps {
  controller: DeviceAuthController;
  pinLength: PinLength;
  onResult: (result: AuthResult) => void | Promise<void>;
  mode?: "authenticate" | "reauthenticate";
  title?: string;
  onForgotPin?: () => void | Promise<void>;
  styles?: PinEntryStyles & {
    message?: StyleProp<TextStyle>;
  };
  slots?: PinEntrySlots;
}

const defaultAuthStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  message: {
    color: "#b42318",
    fontSize: 15,
    padding: 12,
    textAlign: "center",
  },
});

export const PinAuthScreen = ({
  controller,
  pinLength,
  onResult,
  mode = "authenticate",
  title = "Enter PIN",
  onForgotPin,
  styles,
  slots,
}: PinAuthScreenProps) => {
  const [message, setMessage] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const submitPin = async (pin: string) => {
    const result =
      mode === "reauthenticate"
        ? await controller.reauthenticateWithPin(pin)
        : await controller.authenticateWithPin(pin);

    if (result.status === "error" && result.error.code === "pin_mismatch") {
      setMessage("PIN does not match");
      setResetKey((value) => value + 1);
      return;
    }

    await onResult(result);
  };

  return (
    <View style={defaultAuthStyles.container}>
      {message ? (
        <Text style={[defaultAuthStyles.message, styles?.message]}>
          {message}
        </Text>
      ) : null}
      <PinEntryScreen
        key={resetKey}
        pinLength={pinLength}
        title={title}
        onSubmit={submitPin}
        {...(onForgotPin === undefined ? {} : { onForgotPin })}
        {...(styles === undefined ? {} : { styles })}
        {...(slots === undefined ? {} : { slots })}
      />
    </View>
  );
};
