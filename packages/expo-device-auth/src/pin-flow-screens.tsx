import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import { PinEntryScreen } from "./pin-entry-screen";
import type { PinEntrySlots, PinEntryStyles } from "./pin-entry-screen";
import type { AuthResult, PinLength } from "./types";

type FlowStyles = PinEntryStyles & {
  message?: StyleProp<TextStyle>;
};

type ChangeStage = "current" | "new" | "confirm";

const defaultFlowStyles = StyleSheet.create({
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

const titleForStage = (stage: ChangeStage): string => {
  switch (stage) {
    case "current": {
      return "Current PIN";
    }
    case "new": {
      return "New PIN";
    }
    case "confirm": {
      return "Confirm PIN";
    }
    default: {
      return "Current PIN";
    }
  }
};

export interface PinSetupScreenProps {
  pinLength: PinLength;
  onComplete: (pin: string) => void | Promise<void>;
  styles?: FlowStyles;
  slots?: PinEntrySlots;
}

export const PinSetupScreen = ({
  pinLength,
  onComplete,
  styles,
  slots,
}: PinSetupScreenProps) => {
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const handleSubmit = (pin: string) => {
    if (pendingPin === null) {
      setPendingPin(pin);
      setMessage(null);
      return;
    }

    if (pin !== pendingPin) {
      setPendingPin(null);
      setMessage("PINs do not match");
      setResetKey((value) => value + 1);
      return;
    }

    void onComplete(pin);
  };

  return (
    <View style={defaultFlowStyles.container}>
      {message ? (
        <Text style={[defaultFlowStyles.message, styles?.message]}>
          {message}
        </Text>
      ) : null}
      <PinEntryScreen
        key={`${pendingPin === null ? "create" : "confirm"}-${resetKey}`}
        pinLength={pinLength}
        title={pendingPin === null ? "Create PIN" : "Confirm PIN"}
        onSubmit={handleSubmit}
        {...(styles === undefined ? {} : { styles })}
        {...(slots === undefined ? {} : { slots })}
      />
    </View>
  );
};

export interface ChangePinScreenProps {
  pinLength: PinLength;
  onVerifyCurrentPin: (pin: string) => AuthResult | Promise<AuthResult>;
  onComplete: (pin: string) => void | Promise<void>;
  styles?: FlowStyles;
  slots?: PinEntrySlots;
}

export const ChangePinScreen = ({
  pinLength,
  onVerifyCurrentPin,
  onComplete,
  styles,
  slots,
}: ChangePinScreenProps) => {
  const [stage, setStage] = useState<ChangeStage>("current");
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const handleSubmit = async (pin: string) => {
    if (stage === "current") {
      const result = await onVerifyCurrentPin(pin);
      if (result.status === "success") {
        setStage("new");
        setMessage(null);
        return;
      }

      setMessage("Current PIN is incorrect");
      setResetKey((value) => value + 1);
      return;
    }

    if (stage === "new") {
      setPendingPin(pin);
      setStage("confirm");
      setMessage(null);
      return;
    }

    if (pin !== pendingPin) {
      setPendingPin(null);
      setStage("new");
      setMessage("PINs do not match");
      setResetKey((value) => value + 1);
      return;
    }

    void onComplete(pin);
  };

  return (
    <View style={defaultFlowStyles.container}>
      {message ? (
        <Text style={[defaultFlowStyles.message, styles?.message]}>
          {message}
        </Text>
      ) : null}
      <PinEntryScreen
        key={`${stage}-${resetKey}`}
        pinLength={pinLength}
        title={titleForStage(stage)}
        onSubmit={handleSubmit}
        {...(styles === undefined ? {} : { styles })}
        {...(slots === undefined ? {} : { slots })}
      />
    </View>
  );
};
