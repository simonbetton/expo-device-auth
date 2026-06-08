import { PinSetupScreen, useDeviceAuth } from "expo-device-auth";
import { router } from "expo-router";
import { useEffect, useState } from "react";

const PIN_ALREADY_CONFIGURED_MESSAGE = "PIN has already been configured";
const PIN_ALREADY_CONFIGURED_ROUTE = `/?message=${encodeURIComponent(PIN_ALREADY_CONFIGURED_MESSAGE)}`;

const useMountEffect = (effect: () => (() => void) | undefined): void => {
  /* eslint-disable react-hooks/exhaustive-deps, no-restricted-syntax */
  useEffect(effect, []);
};

const SetupPinRoute = () => {
  const deviceAuth = useDeviceAuth();
  const [isAllowed, setIsAllowed] = useState(false);

  useMountEffect((): undefined => {
    void (async () => {
      const state = await deviceAuth.getState();
      if (state.needsSetup) {
        setIsAllowed(true);
        return;
      }

      router.replace(PIN_ALREADY_CONFIGURED_ROUTE);
    })();

    return undefined;
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
  };

  if (!isAllowed) {
    return null;
  }

  return <PinSetupScreen pinLength={4} onComplete={completeSetup} />;
};

export default SetupPinRoute;
