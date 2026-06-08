import { useDeviceAuth } from "expo-device-auth";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

const PIN_ALREADY_CONFIGURED_MESSAGE = "PIN has already been configured";

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 20,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 16,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  result: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    color: "#374151",
    fontFamily: "Menlo",
    padding: 12,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#d1d5db",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  secondaryButtonText: {
    color: "#1f2937",
    fontSize: 16,
    fontWeight: "600",
  },
  title: {
    color: "#111827",
    fontSize: 28,
    fontWeight: "700",
  },
});

const Action = ({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void | Promise<void>;
}) => (
  <Pressable style={styles.primaryButton} onPress={onPress}>
    <Text style={styles.primaryButtonText}>{label}</Text>
  </Pressable>
);

const readQueryMessage = (
  value: string | string[] | undefined
): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return null;
};

const HomeScreen = () => {
  const deviceAuth = useDeviceAuth();
  const { message: queryMessage } = useLocalSearchParams<{
    message?: string;
  }>();
  const [message, setMessage] = useState(
    () => readQueryMessage(queryMessage) ?? "Ready"
  );

  const authenticate = async () => {
    const result = await deviceAuth.authenticate({ title: "Unlock example" });
    setMessage(JSON.stringify(result));
  };

  const reauthenticate = async () => {
    const result = await deviceAuth.reauthenticate({
      message: "Fresh authentication is required.",
      title: "Confirm transfer",
    });
    setMessage(JSON.stringify(result));
  };

  const enableBiometrics = async () => {
    const result = await deviceAuth.setBiometricEnabled(true);
    setMessage(JSON.stringify(result));
  };

  const disableBiometrics = async () => {
    const result = await deviceAuth.setBiometricEnabled(false);
    setMessage(JSON.stringify(result));
  };

  const resetDeviceAuth = async () => {
    await deviceAuth.resetDeviceAuth();
    setMessage("Device auth reset");
  };

  const openSetupPin = async () => {
    const state = await deviceAuth.getState();
    if (state.needsSetup) {
      router.push("/setup-pin");
      return;
    }

    setMessage(PIN_ALREADY_CONFIGURED_MESSAGE);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Expo Device Auth</Text>
      <Text style={styles.result}>{message}</Text>
      <Action label="Authenticate" onPress={authenticate} />
      <Action label="Reauthenticate Action" onPress={reauthenticate} />
      <Action label="Enable Biometrics" onPress={enableBiometrics} />
      <Action label="Disable Biometrics" onPress={disableBiometrics} />
      <Action label="Reset Device Auth" onPress={resetDeviceAuth} />
      <Pressable style={styles.secondaryButton} onPress={openSetupPin}>
        <Text style={styles.secondaryButtonText}>Set up PIN</Text>
      </Pressable>
      <Link asChild href="/change-pin">
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Change PIN</Text>
        </Pressable>
      </Link>
      <Link asChild href="/forgot-pin">
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Forgot PIN</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
};

export default HomeScreen;
