import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
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
import { useMountEffect } from "./use-mount-effect";

export interface DeviceAuthPromptOptions {
  title?: string;
  message?: string;
}

export type DeviceAuthHandle = DeviceAuthController & {
  authenticate: (options?: DeviceAuthPromptOptions) => Promise<AuthResult>;
  reauthenticate: (options?: DeviceAuthPromptOptions) => Promise<AuthResult>;
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

type PromptMode = "authenticate" | "reauthenticate";

interface AuthRequest {
  controller: DeviceAuthController;
  abort: AbortController;
  resolve: (result: AuthResult) => void;
  reject: (error: unknown) => void;
}

interface ActivePrompt {
  request: AuthRequest;
  mode: PromptMode;
  title: string;
}

const createAuthRequest = (controller: DeviceAuthController) => {
  let resolveRequest!: AuthRequest["resolve"];
  let rejectRequest!: AuthRequest["reject"];
  // eslint-disable-next-line promise/avoid-new -- React Native Hermes does not yet provide Promise.withResolvers.
  const promise = new Promise<AuthResult>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  return {
    promise,
    request: {
      abort: new AbortController(),
      controller,
      reject: rejectRequest,
      resolve: resolveRequest,
    },
  };
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

const BackgroundLock = ({ onBackground }: { onBackground: () => void }) => {
  useMountEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        onBackground();
      }
    });
    return () => subscription.remove();
  });
  return null;
};

const PromptLifetime = ({ onDispose }: { onDispose: () => void }) => {
  useMountEffect(() => onDispose);
  return null;
};

const controllerIds = new WeakMap<DeviceAuthController, number>();
let nextControllerId = 0;

const controllerKey = (controller: DeviceAuthController): number => {
  const existing = controllerIds.get(controller);
  if (existing !== undefined) {
    return existing;
  }
  nextControllerId += 1;
  controllerIds.set(controller, nextControllerId);
  return nextControllerId;
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
    const currentRequest = useRef<AuthRequest | null>(null);
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

    const finishRequest = useCallback(
      (request: AuthRequest, settle: () => void) => {
        if (currentRequest.current === request) {
          currentRequest.current = null;
          setActivePrompt(null);
          settle();
        }
      },
      []
    );

    const cancelPrompt = useCallback(() => {
      const request = currentRequest.current;
      if (request) {
        request.abort.abort();
        finishRequest(request, () => request.resolve({ status: "cancelled" }));
      }
    }, [finishRequest]);

    const disposeRequests = () => {
      const request = currentRequest.current;
      if (request?.controller === controller) {
        currentRequest.current = null;
        request.abort.abort();
        request.resolve({ status: "cancelled" });
      }
      setActivePrompt((prompt) =>
        prompt?.request.controller === controller ? null : prompt
      );
    };

    const requestAuth = useCallback(
      (
        mode: PromptMode,
        options: DeviceAuthPromptOptions
      ): Promise<AuthResult> => {
        if (currentRequest.current?.controller === controller) {
          return Promise.resolve({ status: "cancelled" });
        }
        currentRequest.current?.abort.abort();
        currentRequest.current?.resolve({ status: "cancelled" });
        const { promise, request } = createAuthRequest(controller);
        currentRequest.current = request;
        const { signal } = request.abort;

        const begin = async () => {
          try {
            const state = await controller.getState();
            if (signal.aborted) {
              return;
            }
            if (state.needsSetup) {
              finishRequest(request, () => request.resolve(noPinResult()));
              return;
            }
            if (mode === "authenticate" && state.isSessionValid) {
              finishRequest(request, () =>
                request.resolve({ method: "session", status: "success" })
              );
              return;
            }
            if (state.effectiveBiometricEnabled) {
              const result =
                mode === "reauthenticate"
                  ? await controller.reauthenticateWithBiometrics(signal)
                  : await controller.authenticateWithBiometrics(signal);
              if (result.status === "success") {
                finishRequest(request, () => request.resolve(result));
                return;
              }
            }
            if (!signal.aborted) {
              setPromptMessage(options.message ?? null);
              setPromptResetKey((value) => value + 1);
              setActivePrompt({
                mode,
                request,
                title: options.title ?? "Enter PIN",
              });
            }
          } catch (error) {
            finishRequest(request, () => request.reject(error));
          }
        };

        void begin();
        return promise;
      },
      [controller, finishRequest]
    );

    const visiblePrompt =
      activePrompt?.request.controller === controller ? activePrompt : null;

    const submitPromptPin = async (pin: string): Promise<void> => {
      if (!activePrompt || currentRequest.current !== activePrompt.request) {
        return;
      }
      const { mode, request } = activePrompt;
      try {
        const { signal } = request.abort;
        const result =
          mode === "reauthenticate"
            ? await controller.reauthenticateWithPin(pin, signal)
            : await controller.authenticateWithPin(pin, signal);

        if (currentRequest.current !== request) {
          return;
        }
        if (result.status === "error" && result.error.code === "pin_mismatch") {
          setPromptMessage("PIN does not match");
          setPromptResetKey((value) => value + 1);
          return;
        }
        finishRequest(request, () => request.resolve(result));
      } catch (error) {
        finishRequest(request, () => request.reject(error));
      }
    };

    const openRecovery = useCallback(async () => {
      cancelPrompt();
      await onForgotPin?.();
    }, [cancelPrompt, onForgotPin]);

    const lockOnBackgroundNow = useCallback(() => {
      cancelPrompt();
      // The controller revokes the in-process session even if storage rejects deletion.
      void controller.lock().catch(() => {
        /* The in-process session was revoked. */
      });
    }, [cancelPrompt, controller]);

    const handle = useMemo<DeviceAuthHandle>(
      () => ({
        authenticate: (options = {}) => requestAuth("authenticate", options),
        authenticateWithBiometrics: (signal) =>
          controller.authenticateWithBiometrics(signal),
        authenticateWithPin: (pin, signal) =>
          controller.authenticateWithPin(pin, signal),
        changePin: (input) => controller.changePin(input),
        getState: () => controller.getState(),
        lock: () => {
          cancelPrompt();
          return controller.lock();
        },
        reauthenticate: (options = {}) =>
          requestAuth("reauthenticate", options),
        reauthenticateWithBiometrics: (signal) =>
          controller.reauthenticateWithBiometrics(signal),
        reauthenticateWithPin: (pin, signal) =>
          controller.reauthenticateWithPin(pin, signal),
        resetDeviceAuth: () => {
          cancelPrompt();
          return controller.resetDeviceAuth();
        },
        setBiometricEnabled: (enabled) =>
          controller.setBiometricEnabled(enabled),
        setupPin: (input) => controller.setupPin(input),
      }),
      [cancelPrompt, controller, requestAuth]
    );

    useImperativeHandle(ref, () => handle, [handle]);

    return (
      <DeviceAuthContext.Provider value={handle}>
        <PromptLifetime
          key={controllerKey(controller)}
          onDispose={disposeRequests}
        />
        {lockOnBackground ? (
          <BackgroundLock
            key={controllerKey(controller)}
            onBackground={lockOnBackgroundNow}
          />
        ) : null}
        {children}
        <Modal
          transparent
          visible={visiblePrompt !== null}
          onRequestClose={cancelPrompt}
        >
          <View style={defaultProviderStyles.modalBackdrop}>
            <View style={defaultProviderStyles.modalSurface}>
              {promptMessage ? (
                <Text style={defaultProviderStyles.promptMessage}>
                  {promptMessage}
                </Text>
              ) : null}
              {visiblePrompt ? (
                <PinEntryScreen
                  key={promptResetKey}
                  pinLength={resolvedPinLength}
                  title={visiblePrompt.title}
                  onSubmit={submitPromptPin}
                  {...(onForgotPin === undefined
                    ? {}
                    : { onForgotPin: openRecovery })}
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

DeviceAuthProvider.displayName = "DeviceAuthProvider";

export const useDeviceAuth = (): DeviceAuthHandle => {
  const handle = useContext(DeviceAuthContext);
  if (!handle) {
    throw new Error("useDeviceAuth must be used within DeviceAuthProvider");
  }

  return handle;
};
