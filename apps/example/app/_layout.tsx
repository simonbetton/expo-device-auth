import { DeviceAuthProvider } from "expo-device-auth";
import type { DeviceAuthConfig } from "expo-device-auth";
import { router, Stack } from "expo-router";

const deviceAuthConfig: DeviceAuthConfig = {
  biometrics: {
    androidSecurityLevel: "strong",
    defaultEnabled: false,
  },
  pinLength: 4,
  session: {
    persistAcrossRestarts: false,
    timeoutMs: 5 * 60 * 1000,
  },
};

const RootLayout = () => (
  <DeviceAuthProvider
    config={deviceAuthConfig}
    lockOnBackground={false}
    onForgotPin={() => router.navigate("/forgot-pin")}
  >
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ title: "Device Auth" }} />
      <Stack.Screen name="setup-pin" options={{ title: "Set up PIN" }} />
      <Stack.Screen name="change-pin" options={{ title: "Change PIN" }} />
      <Stack.Screen name="forgot-pin" options={{ title: "Forgot PIN" }} />
    </Stack>
  </DeviceAuthProvider>
);

export default RootLayout;
