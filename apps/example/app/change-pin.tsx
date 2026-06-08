import { ChangePinScreen, useDeviceAuth } from "expo-device-auth";
import { router } from "expo-router";

const ChangePinRoute = () => {
  const deviceAuth = useDeviceAuth();

  const completeChange = async (pin: string) => {
    const result = await deviceAuth.changePin({ confirmation: pin, pin });
    if (result.status === "success") {
      router.replace("/");
    }
  };

  return (
    <ChangePinScreen
      pinLength={4}
      onVerifyCurrentPin={(pin) => deviceAuth.reauthenticateWithPin(pin)}
      onComplete={completeChange}
    />
  );
};

export default ChangePinRoute;
