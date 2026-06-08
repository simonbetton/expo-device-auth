import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { createDeviceAuthController } from "./device-auth-controller";
import type {
  BiometricDriver,
  DeviceAuthController,
  DeviceAuthStorage,
} from "./device-auth-controller";
import {
  createExpoBiometricDriver,
  createExpoSecureStoreStorage,
  createQuickCryptoPinHashDriver,
  createQuickCryptoRandomBytes,
} from "./expo-adapters";
import { PinEntryScreen } from "./pin-entry-screen";
import type { PinEntrySlots, PinEntryStyles } from "./pin-entry-screen";
import type { AuthResult, DeviceAuthConfig, PinLength } from "./types";

export interface DeviceAuthPromptOptions {
  title?: string;
  message?: string;
}

export type DeviceAuthHandle = DeviceAuthController & {
  authenticate(options?: DeviceAuthPromptOptions): Promise<AuthResult>;
  reauthenticate(options?: DeviceAuthPromptOptions): Promise<AuthResult>;
};

export interface DeviceAuthProviderProps {
  controller?: DeviceAuthController;
  config?: DeviceAuthConfig;
  storage?: DeviceAuthStorage;
  biometrics?: BiometricDriver;
  randomBytes?: (length: number) => Uint8Array;
  verifierIterations?: number;
  pinLength?: PinLength;
  onForgotPin?: () => void | Promise<void>;
  lockOnBackground?: boolean;
  pinStyles?: PinEntryStyles;
  pinSlots?: PinEntrySlots;
  children: React.ReactNode;
}

interface ActivePrompt {
  mode: "authenticate" | "reauthenticate";
  title: string;
  message?: string;
  resolve: (result: AuthResult) => void;
}

const createDeferred = <Result,>(): {
  promise: Promise<Result>;
  resolve: (result: Result) => void;
} => {
  let resolveResult!: (result: Result) => void;
  // eslint-disable-next-line promise/avoid-new -- React Native Hermes does not yet provide Promise.withResolvers.
  const promise = new Promise<Result>((resolve) => {
    resolveResult = resolve;
  });
  return { promise, resolve: resolveResult };
};

const DeviceAuthContext = createContext<DeviceAuthHandle | null>(null);

const defaultProviderStyles = StyleSheet.create({
  cancelButton: {
    alignItems: "center",
    borderTopColor: "#e5e7eb",
    borderTopWidth: 1,
    padding: 16,
  },
  cancelText: {
    color: "#374151",
    fontSize: 16,
    fontWeight: "600",
  },
  modalBackdrop: {
    backgroundColor: "rgba(17, 24, 39, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalSurface: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    overflow: "hidden",
  },
  pinPromptContainer: {
    backgroundColor: "#ffffff",
    flex: 0,
  },
  promptMessage: {
    color: "#b42318",
    fontSize: 15,
    padding: 12,
    textAlign: "center",
  },
});

const requiredConfig = (
  config: DeviceAuthConfig | undefined
): DeviceAuthConfig => {
  if (!config) {
    throw new Error(
      "DeviceAuthProvider requires config when controller is not provided"
    );
  }

  return config;
};

const noPinResult = (): AuthResult => ({
  error: {
    code: "no_pin",
    message: "No PIN has been configured",
  },
  status: "error",
});

const useMountEffect = (effect: () => (() => void) | undefined): void => {
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(effect, []);
};

const useLockOnBackground = (
  controller: DeviceAuthController,
  enabled: boolean
): void => {
  useMountEffect(() => {
    if (!enabled) {
      return;
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        void controller.lock();
      }
    });

    return () => subscription.remove();
  });
};

export const DeviceAuthProvider = React.forwardRef<
  DeviceAuthHandle,
  DeviceAuthProviderProps
>(
  (
    {
      controller: providedController,
      config,
      storage,
      biometrics,
      randomBytes,
      verifierIterations,
      pinLength,
      onForgotPin,
      lockOnBackground = false,
      pinStyles,
      pinSlots,
      children,
    },
    ref
  ) => {
    const controller = useMemo(
      () =>
        providedController ??
        createDeviceAuthController(requiredConfig(config), {
          biometrics: biometrics ?? createExpoBiometricDriver(),
          pinHashDriver: createQuickCryptoPinHashDriver(),
          randomBytes: randomBytes ?? createQuickCryptoRandomBytes(),
          storage: storage ?? createExpoSecureStoreStorage(),
          ...(verifierIterations === undefined ? {} : { verifierIterations }),
        }),
      [
        biometrics,
        config,
        providedController,
        randomBytes,
        storage,
        verifierIterations,
      ]
    );
    const resolvedPinLength = pinLength ?? config?.pinLength ?? 4;
    const [activePrompt, setActivePrompt] = useState<ActivePrompt | null>(null);
    const [promptMessage, setPromptMessage] = useState<string | null>(null);
    const [promptResetKey, setPromptResetKey] = useState(0);
    const promptPinStyles = useMemo<PinEntryStyles>(
      () => ({
        ...pinStyles,
        container: [
          defaultProviderStyles.pinPromptContainer,
          pinStyles?.container,
        ],
      }),
      [pinStyles]
    );

    useLockOnBackground(controller, lockOnBackground);

    const showPinPrompt = useCallback(
      (
        mode: ActivePrompt["mode"],
        options: DeviceAuthPromptOptions
      ): Promise<AuthResult> => {
        const { promise, resolve: resolvePrompt } =
          createDeferred<AuthResult>();
        setPromptMessage(options.message ?? null);
        setPromptResetKey((value) => value + 1);
        setActivePrompt({
          mode,
          title: options.title ?? "Enter PIN",
          ...(options.message === undefined
            ? {}
            : { message: options.message }),
          resolve: resolvePrompt,
        });
        return promise;
      },
      []
    );

    const promptForFreshAuth = useCallback(
      async (
        mode: ActivePrompt["mode"],
        options: DeviceAuthPromptOptions
      ): Promise<AuthResult> => {
        const state = await controller.getState();
        if (state.effectiveBiometricEnabled) {
          const biometricResult =
            mode === "reauthenticate"
              ? await controller.reauthenticateWithBiometrics()
              : await controller.authenticateWithBiometrics();
          if (biometricResult.status === "success") {
            return biometricResult;
          }
        }

        return showPinPrompt(mode, options);
      },
      [controller, showPinPrompt]
    );

    const authenticate = useCallback(
      async (options: DeviceAuthPromptOptions = {}): Promise<AuthResult> => {
        const state = await controller.getState();
        if (state.needsSetup) {
          return noPinResult();
        }

        if (state.isSessionValid) {
          return { method: "session", status: "success" };
        }

        return promptForFreshAuth("authenticate", options);
      },
      [controller, promptForFreshAuth]
    );

    const reauthenticate = useCallback(
      async (options: DeviceAuthPromptOptions = {}): Promise<AuthResult> => {
        const state = await controller.getState();
        if (state.needsSetup) {
          return noPinResult();
        }

        return promptForFreshAuth("reauthenticate", options);
      },
      [controller, promptForFreshAuth]
    );

    const submitPromptPin = async (pin: string): Promise<void> => {
      if (!activePrompt) {
        return;
      }

      const result =
        activePrompt.mode === "reauthenticate"
          ? await controller.reauthenticateWithPin(pin)
          : await controller.authenticateWithPin(pin);

      if (result.status === "error" && result.error.code === "pin_mismatch") {
        setPromptMessage("PIN does not match");
        setPromptResetKey((value) => value + 1);
        return;
      }

      activePrompt.resolve(result);
      setActivePrompt(null);
    };

    const cancelPrompt = () => {
      if (!activePrompt) {
        return;
      }

      activePrompt.resolve({ status: "cancelled" });
      setActivePrompt(null);
    };

    const handle = useMemo<DeviceAuthHandle>(
      () => ({
        authenticate,
        authenticateWithBiometrics: () =>
          controller.authenticateWithBiometrics(),
        authenticateWithPin: (pin) => controller.authenticateWithPin(pin),
        changePin: (input) => controller.changePin(input),
        getState: () => controller.getState(),
        lock: () => controller.lock(),
        reauthenticate,
        reauthenticateWithBiometrics: () =>
          controller.reauthenticateWithBiometrics(),
        reauthenticateWithPin: (pin) => controller.reauthenticateWithPin(pin),
        resetDeviceAuth: () => controller.resetDeviceAuth(),
        setBiometricEnabled: (enabled) =>
          controller.setBiometricEnabled(enabled),
        setupPin: (input) => controller.setupPin(input),
      }),
      [authenticate, controller, reauthenticate]
    );

    useImperativeHandle(ref, () => handle, [handle]);

    return (
      <DeviceAuthContext.Provider value={handle}>
        {children}
        <Modal transparent visible={activePrompt !== null}>
          <View style={defaultProviderStyles.modalBackdrop}>
            <View style={defaultProviderStyles.modalSurface}>
              {promptMessage ? (
                <Text style={defaultProviderStyles.promptMessage}>
                  {promptMessage}
                </Text>
              ) : null}
              {activePrompt ? (
                <PinEntryScreen
                  key={promptResetKey}
                  pinLength={resolvedPinLength}
                  title={activePrompt.title}
                  onSubmit={submitPromptPin}
                  {...(onForgotPin === undefined ? {} : { onForgotPin })}
                  styles={promptPinStyles}
                  {...(pinSlots === undefined ? {} : { slots: pinSlots })}
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={cancelPrompt}
                style={defaultProviderStyles.cancelButton}
              >
                <Text style={defaultProviderStyles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </DeviceAuthContext.Provider>
    );
  }
);

export const useDeviceAuth = (): DeviceAuthHandle => {
  const handle = useContext(DeviceAuthContext);
  if (!handle) {
    throw new Error("useDeviceAuth must be used within DeviceAuthProvider");
  }

  return handle;
};
