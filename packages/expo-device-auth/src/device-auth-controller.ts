import { normalizeDeviceAuthConfig } from "./config";
import { createPinVerifier, verifyPinAgainstVerifier } from "./pin-verifier";
import type { PinHashDriver, PinVerifier } from "./pin-verifier";
import type {
  AuthResult,
  BiometricAvailability,
  DeviceAuthConfig,
  DeviceAuthState,
  NormalizedDeviceAuthConfig,
  PreferenceResult,
  SetupPinResult,
} from "./types";

interface StoredCredential {
  version: 1;
  verifier: PinVerifier;
  biometricPreferenceEnabled: boolean;
  failedAttempts: number;
  lockoutLevel: number;
  lockedUntil?: number;
}

interface StoredSession {
  expiresAt: number | "infinite";
}

export interface DeviceAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface BiometricDriver {
  getAvailability(): Promise<BiometricAvailability>;
  authenticate(options: {
    androidSecurityLevel: "strong" | "weak";
    disableDeviceFallback: true;
  }): Promise<{ success: true } | { success: false; error: string }>;
}

export interface DeviceAuthControllerOptions {
  storage: DeviceAuthStorage;
  biometrics?: BiometricDriver;
  now?: () => number;
  pinHashDriver?: PinHashDriver;
  randomBytes?: (length: number) => Uint8Array;
  verifierIterations?: number;
}

export interface DeviceAuthController {
  getState(): Promise<DeviceAuthState>;
  setupPin(input: {
    pin: string;
    confirmation: string;
  }): Promise<SetupPinResult>;
  changePin(input: {
    pin: string;
    confirmation: string;
  }): Promise<SetupPinResult>;
  authenticateWithPin(pin: string): Promise<AuthResult>;
  authenticateWithBiometrics(): Promise<AuthResult>;
  reauthenticateWithPin(pin: string): Promise<AuthResult>;
  reauthenticateWithBiometrics(): Promise<AuthResult>;
  setBiometricEnabled(enabled: boolean): Promise<PreferenceResult>;
  lock(): Promise<void>;
  resetDeviceAuth(): Promise<void>;
}

const pinMismatchResult = (): AuthResult => ({
  error: {
    code: "pin_mismatch",
    message: "PIN does not match",
  },
  status: "error",
});

const biometricUnavailableResult = (): AuthResult => ({
  error: {
    code: "biometric_unavailable",
    message: "Biometric authentication is not available",
  },
  status: "error",
});

const unsupportedBiometrics: BiometricDriver = {
  authenticate() {
    return Promise.resolve({ error: "not_available", success: false });
  },
  getAvailability() {
    return Promise.resolve({
      enrolled: false,
      hardwareSupported: false,
      reason: "hardware_unavailable",
      supportedTypes: [],
    });
  },
};

class StorageBackedDeviceAuthController implements DeviceAuthController {
  private readonly config: NormalizedDeviceAuthConfig;

  private readonly options: DeviceAuthControllerOptions;

  private memorySession: StoredSession | null = null;

  constructor(
    config: NormalizedDeviceAuthConfig,
    options: DeviceAuthControllerOptions
  ) {
    this.config = config;
    this.options = options;
  }

  async getState(): Promise<DeviceAuthState> {
    const credential = await this.readCredential();
    const biometricAvailability = await this.getBiometricAvailability();
    const biometricPreferenceEnabled =
      biometricAvailability.hardwareSupported &&
      (credential?.biometricPreferenceEnabled ?? false);

    return {
      biometricAvailability,
      biometricPreferenceEnabled,
      effectiveBiometricEnabled:
        biometricPreferenceEnabled && biometricAvailability.enrolled,
      isSessionValid: await this.isSessionValid(),
      needsSetup: credential === null,
    };
  }

  async setupPin(input: {
    pin: string;
    confirmation: string;
  }): Promise<SetupPinResult> {
    const existingCredential = await this.readCredential();
    if (existingCredential) {
      return {
        error: {
          code: "pin_already_configured",
          message: "PIN has already been configured",
        },
        status: "error",
      };
    }

    const invalidPin = this.validatePin(input.pin);
    if (invalidPin) {
      return invalidPin;
    }

    if (input.pin !== input.confirmation) {
      return {
        error: {
          code: "pin_confirmation_mismatch",
          message: "PIN confirmation does not match",
        },
        status: "error",
      };
    }

    const verifier = await createPinVerifier(input.pin, {
      ...(this.options.verifierIterations === undefined
        ? {}
        : { iterations: this.options.verifierIterations }),
      ...(this.options.pinHashDriver === undefined
        ? {}
        : { pinHashDriver: this.options.pinHashDriver }),
      ...(this.options.randomBytes === undefined
        ? {}
        : { randomBytes: this.options.randomBytes }),
    });

    const biometricAvailability = await this.getBiometricAvailability();

    await this.writeCredential({
      biometricPreferenceEnabled:
        this.config.biometrics.defaultEnabled &&
        biometricAvailability.hardwareSupported,
      failedAttempts: 0,
      lockoutLevel: 0,
      verifier,
      version: 1,
    });
    await this.lock();

    return { status: "success" };
  }

  async changePin(input: {
    pin: string;
    confirmation: string;
  }): Promise<SetupPinResult> {
    const existingCredential = await this.readCredential();
    if (!existingCredential) {
      return {
        error: {
          code: "no_pin",
          message: "No PIN has been configured",
        },
        status: "error",
      };
    }

    if (!(await this.isSessionValid())) {
      return {
        error: {
          code: "reauthentication_required",
          message: "Fresh local authentication is required",
        },
        status: "error",
      };
    }

    const invalidPin = this.validatePin(input.pin);
    if (invalidPin) {
      return invalidPin;
    }

    if (input.pin !== input.confirmation) {
      return {
        error: {
          code: "pin_confirmation_mismatch",
          message: "PIN confirmation does not match",
        },
        status: "error",
      };
    }

    const verifier = await createPinVerifier(input.pin, {
      ...(this.options.verifierIterations === undefined
        ? {}
        : { iterations: this.options.verifierIterations }),
      ...(this.options.pinHashDriver === undefined
        ? {}
        : { pinHashDriver: this.options.pinHashDriver }),
      ...(this.options.randomBytes === undefined
        ? {}
        : { randomBytes: this.options.randomBytes }),
    });

    await this.writeCredential({
      ...existingCredential,
      failedAttempts: 0,
      verifier,
    });
    await this.lock();

    return { status: "success" };
  }

  authenticateWithPin(pin: string): Promise<AuthResult> {
    return this.verifyPinAndStartSession(pin);
  }

  async authenticateWithBiometrics(): Promise<AuthResult> {
    const state = await this.getState();
    if (!state.effectiveBiometricEnabled) {
      return biometricUnavailableResult();
    }

    const result = await this.biometrics().authenticate({
      androidSecurityLevel: this.config.biometrics.androidSecurityLevel,
      disableDeviceFallback: true,
    });

    if (!result.success) {
      return { status: "cancelled" };
    }

    await this.startSession();
    return { method: "biometric", status: "success" };
  }

  async reauthenticateWithPin(pin: string): Promise<AuthResult> {
    await this.lock();
    return this.verifyPinAndStartSession(pin);
  }

  reauthenticateWithBiometrics(): Promise<AuthResult> {
    return this.authenticateWithBiometrics();
  }

  async setBiometricEnabled(enabled: boolean): Promise<PreferenceResult> {
    const credential = await this.readCredential();
    if (!credential) {
      return {
        error: {
          code: "no_pin",
          message: "No PIN has been configured",
        },
        status: "error",
      };
    }

    if (!enabled) {
      await this.writeCredential({
        ...credential,
        biometricPreferenceEnabled: false,
      });
      return { status: "success" };
    }

    const availability = await this.getBiometricAvailability();
    if (!availability.hardwareSupported) {
      await this.writeCredential({
        ...credential,
        biometricPreferenceEnabled: false,
      });
      return {
        error: {
          code: "biometric_unavailable",
          message: "This device does not support biometric authentication",
        },
        status: "error",
      };
    }

    if (!(await this.isSessionValid())) {
      return {
        error: {
          code: "reauthentication_required",
          message: "Fresh local authentication is required",
        },
        status: "error",
      };
    }

    if (availability.enrolled) {
      const result = await this.biometrics().authenticate({
        androidSecurityLevel: this.config.biometrics.androidSecurityLevel,
        disableDeviceFallback: true,
      });
      if (!result.success) {
        return {
          status: "cancelled",
        };
      }
    }

    await this.writeCredential({
      ...credential,
      biometricPreferenceEnabled: true,
    });
    return { status: "success" };
  }

  async lock(): Promise<void> {
    this.memorySession = null;
    await this.options.storage.deleteItem(this.sessionKey());
  }

  async resetDeviceAuth(): Promise<void> {
    await this.lock();
    await this.options.storage.deleteItem(this.credentialKey());
  }

  private async verifyPinAndStartSession(pin: string): Promise<AuthResult> {
    const credential = await this.readCredential();
    if (!credential) {
      return {
        error: {
          code: "no_pin",
          message: "No PIN has been configured",
        },
        status: "error",
      };
    }

    if (credential.lockedUntil && this.now() < credential.lockedUntil) {
      return { status: "locked", until: credential.lockedUntil };
    }

    const isMatch = await verifyPinAgainstVerifier(
      pin,
      credential.verifier,
      this.options.pinHashDriver === undefined
        ? {}
        : { pinHashDriver: this.options.pinHashDriver }
    );
    if (isMatch) {
      await this.writeCredential({
        ...credential,
        failedAttempts: 0,
      });
      await this.startSession();
      return { method: "pin", status: "success" };
    }

    return this.recordFailedPinAttempt(credential);
  }

  private async recordFailedPinAttempt(
    credential: StoredCredential
  ): Promise<AuthResult> {
    const failedAttempts = credential.failedAttempts + 1;

    if (failedAttempts < this.config.pinAttempts.attemptsPerStep) {
      await this.writeCredential({
        ...credential,
        failedAttempts,
      });
      return pinMismatchResult();
    }

    const lockouts = this.config.pinAttempts.lockoutsMs;
    const lockoutIndex = Math.min(credential.lockoutLevel, lockouts.length - 1);
    const lockoutMs = lockouts[lockoutIndex] ?? 0;
    const lockedUntil = this.now() + lockoutMs;

    await this.writeCredential({
      ...credential,
      failedAttempts: 0,
      lockedUntil,
      lockoutLevel: credential.lockoutLevel + 1,
    });

    return { status: "locked", until: lockedUntil };
  }

  private validatePin(pin: string): SetupPinResult | null {
    const isDigitsOnly = /^\d+$/u.test(pin);
    if (pin.length === this.config.pinLength && isDigitsOnly) {
      return null;
    }

    return {
      error: {
        code: "invalid_pin",
        message: `PIN must be ${this.config.pinLength} digits`,
      },
      status: "error",
    };
  }

  private async startSession(): Promise<void> {
    const { timeoutMs } = this.config.session;
    const session: StoredSession = {
      expiresAt: timeoutMs === "infinite" ? "infinite" : this.now() + timeoutMs,
    };

    if (this.config.session.persistAcrossRestarts) {
      await this.options.storage.setItem(
        this.sessionKey(),
        JSON.stringify(session)
      );
      return;
    }

    this.memorySession = session;
  }

  private async isSessionValid(): Promise<boolean> {
    const session = await this.readSession();
    if (!session) {
      return false;
    }

    return session.expiresAt === "infinite" || this.now() < session.expiresAt;
  }

  private async readSession(): Promise<StoredSession | null> {
    if (!this.config.session.persistAcrossRestarts) {
      return this.memorySession;
    }

    const value = await this.options.storage.getItem(this.sessionKey());
    return value ? (JSON.parse(value) as StoredSession) : null;
  }

  private async readCredential(): Promise<StoredCredential | null> {
    const value = await this.options.storage.getItem(this.credentialKey());
    return value ? (JSON.parse(value) as StoredCredential) : null;
  }

  private getBiometricAvailability(): Promise<BiometricAvailability> {
    return this.biometrics().getAvailability();
  }

  private biometrics(): BiometricDriver {
    return this.options.biometrics ?? unsupportedBiometrics;
  }

  private async writeCredential(credential: StoredCredential): Promise<void> {
    await this.options.storage.setItem(
      this.credentialKey(),
      JSON.stringify(credential)
    );
  }

  private credentialKey(): string {
    return `expo-device-auth.${this.config.scopeKey}.credential`;
  }

  private sessionKey(): string {
    return `expo-device-auth.${this.config.scopeKey}.session`;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export const createDeviceAuthController = (
  config: DeviceAuthConfig,
  options: DeviceAuthControllerOptions
): DeviceAuthController => {
  const normalizedConfig = normalizeDeviceAuthConfig(config);
  return new StorageBackedDeviceAuthController(normalizedConfig, options);
};

export const createMemoryDeviceAuthStorage = (): DeviceAuthStorage => {
  const values = new Map<string, string>();

  return {
    deleteItem(key) {
      values.delete(key);
      return Promise.resolve();
    },
    getItem(key) {
      return Promise.resolve(values.get(key) ?? null);
    },
    setItem(key, value) {
      values.set(key, value);
      return Promise.resolve();
    },
  };
};
