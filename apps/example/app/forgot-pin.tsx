import { useDeviceAuth } from "expo-device-auth";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const styles = StyleSheet.create({
  body: {
    color: "#4b5563",
    fontSize: 16,
    lineHeight: 22,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 16,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  container: {
    gap: 16,
    padding: 20,
  },
  title: {
    color: "#111827",
    fontSize: 28,
    fontWeight: "700",
  },
});

const ForgotPinRoute = () => {
  const deviceAuth = useDeviceAuth();

  const isResetting = useRef(false);
  const [status, setStatus] = useState<"ready" | "resetting" | "failed">(
    "ready"
  );

  const resetAfterRecovery = async () => {
    if (isResetting.current) {
      return;
    }
    isResetting.current = true;
    setStatus("resetting");
    try {
      await deviceAuth.resetDeviceAuth();
      router.replace("/setup-pin");
    } catch {
      setStatus("failed");
      isResetting.current = false;
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Forgot PIN</Text>
      <Text style={styles.body}>
        In a real app this route would verify identity with your backend before
        clearing local device auth.
      </Text>
      {status === "failed" ? (
        <Text>Could not reset device auth. Try again.</Text>
      ) : null}
      <Pressable
        disabled={status === "resetting"}
        style={styles.button}
        onPress={resetAfterRecovery}
      >
        <Text style={styles.buttonText}>Simulate Verified Reset</Text>
      </Pressable>
    </View>
  );
};

export default ForgotPinRoute;
