import { useDeviceAuth } from "expo-device-auth";
import { router } from "expo-router";
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

  const resetAfterRecovery = async () => {
    await deviceAuth.resetDeviceAuth();
    router.replace("/setup-pin");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Forgot PIN</Text>
      <Text style={styles.body}>
        In a real app this route would verify identity with your backend before
        clearing local device auth.
      </Text>
      <Pressable style={styles.button} onPress={resetAfterRecovery}>
        <Text style={styles.buttonText}>Simulate Verified Reset</Text>
      </Pressable>
    </View>
  );
};

export default ForgotPinRoute;
