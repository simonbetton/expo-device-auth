import { PinSetupScreen, useDeviceAuth } from "expo-device-auth";
import { router } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import type { EffectCallback } from "react";
import { Button, Text, View } from "react-native";

const PIN_ALREADY_CONFIGURED_MESSAGE = "PIN has already been configured";
const PIN_ALREADY_CONFIGURED_ROUTE = `/?message=${encodeURIComponent(PIN_ALREADY_CONFIGURED_MESSAGE)}`;

const useMountEffect = (effect: EffectCallback): void => {
  const onMount = useEffectEvent(effect);
  useEffect(() => onMount(), []);
};

const SetupPinRoute = () => {
  const deviceAuth = useDeviceAuth();
  const [gate, setGate] = useState<"checking" | "allowed" | "failed">(
    "checking"
  );

  const checkSetup = async () => {
    setGate("checking");
    try {
      const state = await deviceAuth.getState();
      if (state.needsSetup) {
        setGate("allowed");
        return;
      }
      router.replace(PIN_ALREADY_CONFIGURED_ROUTE);
    } catch {
      setGate("failed");
    }
  };

  useMountEffect(() => {
    void checkSetup();
  });

  const completeSetup = async (pin: string) => {
    const result = await deviceAuth.setupPin({ confirmation: pin, pin });
    if (result.status === "success") {
      router.replace("/");
      return;
    }

    if (
      result.status === "error" &&
      result.error.code === "pin_already_configured"
    ) {
      router.replace(PIN_ALREADY_CONFIGURED_ROUTE);
    }
    return result;
  };

  if (gate === "failed") {
    return (
      <View>
        <Text>Could not check PIN setup.</Text>
        <Button title="Retry" onPress={checkSetup} />
      </View>
    );
  }
  if (gate === "checking") {
    return null;
  }

  return <PinSetupScreen pinLength={4} onComplete={completeSetup} />;
};

export default SetupPinRoute;
