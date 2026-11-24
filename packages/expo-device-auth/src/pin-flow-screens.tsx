import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import { PinEntryScreen } from "./pin-entry-screen";
import type { PinEntrySlots, PinEntryStyles } from "./pin-entry-screen";
import type { AuthResult, PinLength, SetupPinResult } from "./types";

type FlowStyles = PinEntryStyles & {
  message?: StyleProp<TextStyle>;
};

type ChangeStage =
  | { step: "current" | "new" | "completed" }
  | { step: "confirm"; pin: string };

type CompletePin =
  | ((pin: string) => void)
  | ((pin: string) => SetupPinResult | Promise<SetupPinResult>);

const completePin = async (
  onComplete: CompletePin,
  pin: string
): Promise<string | null> => {
  try {
    const result = await onComplete(pin);
    return result?.status === "error" ? result.error.message : null;
  } catch {
    return "Could not save PIN. Try again.";
  }
};

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

const changeTitles = {
  confirm: "Confirm PIN",
  current: "Current PIN",
  new: "New PIN",
};

export interface PinSetupScreenProps {
  pinLength: PinLength;
  onComplete: CompletePin;
  styles?: FlowStyles;
  slots?: PinEntrySlots;
}

export const PinSetupScreen = ({
  pinLength,
  onComplete,
  styles,
  slots,
}: PinSetupScreenProps) => {
  const [stage, setStage] = useState<
    { step: "create" | "completed" } | { step: "confirm"; pin: string }
  >({ step: "create" });
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (pin: string) => {
    if (stage.step === "create") {
      setStage({ pin, step: "confirm" });
      setMessage(null);
      return;
    }

    if (stage.step === "confirm" && pin !== stage.pin) {
      setStage({ step: "create" });
      setMessage("PINs do not match");
      return;
    }

    const error = await completePin(onComplete, pin);
    if (error !== null) {
      setStage({ step: "create" });
      setMessage(error);
      return;
    }
    setStage({ step: "completed" });
  };

  return (
    <View style={defaultFlowStyles.container}>
      {message ? (
        <Text style={[defaultFlowStyles.message, styles?.message]}>
          {message}
        </Text>
      ) : null}
      {stage.step === "completed" ? (
        <Text>PIN set up</Text>
      ) : (
        <PinEntryScreen
          key={stage.step}
          pinLength={pinLength}
          title={stage.step === "create" ? "Create PIN" : "Confirm PIN"}
          onSubmit={handleSubmit}
          {...(styles === undefined ? {} : { styles })}
          {...(slots === undefined ? {} : { slots })}
        />
      )}
    </View>
  );
};

export interface ChangePinScreenProps {
  pinLength: PinLength;
  onVerifyCurrentPin: (pin: string) => AuthResult | Promise<AuthResult>;
  onComplete: CompletePin;
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
  const [stage, setStage] = useState<ChangeStage>({ step: "current" });
  const [message, setMessage] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const handleSubmit = async (pin: string) => {
    if (stage.step === "current") {
      try {
        const result = await onVerifyCurrentPin(pin);
        if (result.status === "success") {
          setStage({ step: "new" });
          setMessage(null);
          return;
        }

        switch (result.status) {
          case "locked": {
            setMessage("Too many attempts. Try again later.");
            break;
          }
          case "error": {
            setMessage(
              result.error.code === "pin_mismatch"
                ? "Current PIN is incorrect"
                : result.error.message
            );
            break;
          }
          default: {
            setMessage("Verification cancelled. Try again.");
            break;
          }
        }
      } catch {
        setMessage("Could not verify PIN. Try again.");
      }
      setResetKey((value) => value + 1);
      return;
    }

    if (stage.step === "new") {
      setStage({ pin, step: "confirm" });
      setMessage(null);
      return;
    }

    if (stage.step === "confirm" && pin !== stage.pin) {
      setStage({ step: "new" });
      setMessage("PINs do not match");
      return;
    }

    const error = await completePin(onComplete, pin);
    if (error !== null) {
      setStage({ step: "current" });
      setMessage(error);
      return;
    }
    setStage({ step: "completed" });
  };

  return (
    <View style={defaultFlowStyles.container}>
      {message ? (
        <Text style={[defaultFlowStyles.message, styles?.message]}>
          {message}
        </Text>
      ) : null}
      {stage.step === "completed" ? (
        <Text>PIN changed</Text>
      ) : (
        <PinEntryScreen
          key={`${stage.step}-${resetKey}`}
          pinLength={pinLength}
          title={changeTitles[stage.step]}
          onSubmit={handleSubmit}
          {...(styles === undefined ? {} : { styles })}
          {...(slots === undefined ? {} : { slots })}
        />
      )}
    </View>
  );
};
