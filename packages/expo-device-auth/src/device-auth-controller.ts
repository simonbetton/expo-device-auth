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
  /** Share this identity between adapters backed by the same store. */
  readonly coordinationKey?: object;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
}

export interface BiometricDriver {
  getAvailability: () => Promise<BiometricAvailability>;
  authenticate: (options: {
    androidSecurityLevel: "strong" | "weak";
    disableDeviceFallback: true;
  }) => Promise<{ success: true } | { success: false; error: string }>;
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
  getState: () => Promise<DeviceAuthState>;
  setupPin: (input: {
    pin: string;
    confirmation: string;
  }) => Promise<SetupPinResult>;
  changePin: (input: {
    pin: string;
    confirmation: string;
  }) => Promise<SetupPinResult>;
  authenticateWithPin: (
    pin: string,
    signal?: AbortSignal
  ) => Promise<AuthResult>;
  authenticateWithBiometrics: (signal?: AbortSignal) => Promise<AuthResult>;
  reauthenticateWithPin: (
    pin: string,
    signal?: AbortSignal
  ) => Promise<AuthResult>;
  reauthenticateWithBiometrics: (signal?: AbortSignal) => Promise<AuthResult>;
  setBiometricEnabled: (enabled: boolean) => Promise<PreferenceResult>;
  lock: () => Promise<void>;
  resetDeviceAuth: () => Promise<void>;
}

const pinMismatchResult = (): AuthResult => ({
  error: {
    code: "pin_mismatch",
    message: "PIN does not match",
  },
  status: "error",
});

const biometricUnavailableResult = () => ({
  error: {
    code: "biometric_unavailable" as const,
    message: "Biometric authentication is not available",
  },
  status: "error" as const,
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

interface ScopeOperations {
  tail: Promise<void>;
  revocations: number;
  sessionGeneration: number;
  persistentSessionBlocked: boolean;
  biometricGeneration: number;
  biometricPromptOpen: boolean;
}

const storageScopes = new WeakMap<object, Map<string, ScopeOperations>>();

const operationsForScope = (
  storage: DeviceAuthStorage,
  scopeKey: string
): ScopeOperations => {
  const key = storage.coordinationKey ?? storage;
  const scopes = storageScopes.get(key) ?? new Map<string, ScopeOperations>();
  storageScopes.set(key, scopes);
  const scope = scopes.get(scopeKey) ?? {
    biometricGeneration: 0,
    biometricPromptOpen: false,
    persistentSessionBlocked: false,
    revocations: 0,
    sessionGeneration: 0,
    tail: Promise.resolve(),
  };
  scopes.set(scopeKey, scope);
  return scope;
};

const reauthenticationRequired = () => ({
  error: {
    code: "reauthentication_required" as const,
    message: "Fresh local authentication is required",
  },
  status: "error" as const,
});

class StorageBackedDeviceAuthController implements DeviceAuthController {
  private readonly config: NormalizedDeviceAuthConfig;

  private readonly options: DeviceAuthControllerOptions;

  private readonly scope: ScopeOperations;

  private memorySession: (StoredSession & { generation: number }) | null = null;

  constructor(
    config: NormalizedDeviceAuthConfig,
    options: DeviceAuthControllerOptions
  ) {
    this.config = config;
    this.options = options;
    this.scope = operationsForScope(options.storage, config.scopeKey);
  }

  async getState(): Promise<DeviceAuthState> {
    const biometricAvailability = await this.getBiometricAvailability();
    return this.runInScope(async () => {
      const credential = await this.readCredential();
      const biometricPreferenceEnabled =
        biometricAvailability.hardwareSupported &&
        (credential?.biometricPreferenceEnabled ?? false);

      return {
        biometricAvailability,
        biometricPreferenceEnabled,
        effectiveBiometricEnabled:
          biometricPreferenceEnabled && biometricAvailability.enrolled,
        isSessionValid: credential !== null && (await this.isSessionValid()),
        needsSetup: credential === null,
      };
    });
  }

  private runInScope<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    const result = this.scope.tail.then(operation);
    this.scope.tail = (async () => {
      try {
        await result;
      } catch {
        // The caller observes the rejection. The queue can still run its next item.
      }
    })();
    return result;
  }

  setupPin(input: {
    pin: string;
    confirmation: string;
  }): Promise<SetupPinResult> {
    return this.runInScope(() => this.configurePin(input));
  }

  changePin(input: {
    pin: string;
    confirmation: string;
  }): Promise<SetupPinResult> {
    return this.runInScope(() => this.configurePin(input, true));
  }

  private async configurePin(
    input: { pin: string; confirmation: string },
    change = false
  ): Promise<SetupPinResult> {
    const existingCredential = await this.readCredential();
    if (change && !existingCredential) {
      return {
        error: { code: "no_pin", message: "No PIN has been configured" },
        status: "error",
      };
    }
    if (!change && existingCredential) {
      return {
        error: {
          code: "pin_already_configured",
          message: "PIN has already been configured",
        },
        status: "error",
      };
    }

    if (change && !(await this.isSessionValid())) {
      return reauthenticationRequired();
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

    const verifier = await this.createVerifier(input.pin);

    const defaultPreference = this.config.biometrics.defaultEnabled;
    const biometricAvailability =
      !existingCredential && defaultPreference
        ? await this.getBiometricAvailability()
        : null;
    const biometricPreferenceEnabled =
      existingCredential?.biometricPreferenceEnabled ??
      biometricAvailability?.hardwareSupported === true;

    if (change && !(await this.isSessionValid())) {
      return reauthenticationRequired();
    }

    // Revoke the old session before committing the new verifier.
    await this.clearSession();
    await this.writeCredential({
      ...existingCredential,
      biometricPreferenceEnabled,
      failedAttempts: 0,
      lockoutLevel: existingCredential?.lockoutLevel ?? 0,
      verifier,
      version: 1,
    });
    this.scope.biometricGeneration += 1;
    return { status: "success" };
  }

  private createVerifier(pin: string): Promise<PinVerifier> {
    return createPinVerifier(pin, {
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
  }

  authenticateWithPin(pin: string, signal?: AbortSignal): Promise<AuthResult> {
    return this.checkPin(pin, signal);
  }

  reauthenticateWithPin(
    pin: string,
    signal?: AbortSignal
  ): Promise<AuthResult> {
    return this.checkPin(pin, signal, true);
  }

  private checkPin(
    pin: string,
    signal?: AbortSignal,
    fresh = false
  ): Promise<AuthResult> {
    const { revocations } = this.scope;
    const cancelled = () =>
      signal?.aborted === true || revocations !== this.scope.revocations;
    return this.runInScope(async () => {
      if (cancelled()) {
        return { status: "cancelled" };
      }
      if (fresh) {
        await this.clearSession();
      }
      return this.verifyPinAndStartSession(pin, cancelled);
    });
  }

  async authenticateWithBiometrics(signal?: AbortSignal): Promise<AuthResult> {
    const { revocations } = this.scope;
    const availability = await this.getBiometricAvailability();
    const generation = await this.runInScope(async () => {
      const credential = await this.readCredential();
      return availability.hardwareSupported &&
        availability.enrolled &&
        credential?.biometricPreferenceEnabled
        ? this.scope.biometricGeneration
        : null;
    });
    if (generation === null) {
      return biometricUnavailableResult();
    }
    const cancelled = () =>
      signal?.aborted === true ||
      revocations !== this.scope.revocations ||
      generation !== this.scope.biometricGeneration;

    if (cancelled() || !(await this.promptForBiometrics())) {
      return { status: "cancelled" };
    }

    return this.runInScope(async () => {
      // The native prompt runs outside the storage queue so lock and reset can finish.
      const credential = await this.readCredential();
      if (cancelled() || !credential?.biometricPreferenceEnabled) {
        return { status: "cancelled" };
      }

      return (await this.startSession(cancelled))
        ? { method: "biometric", status: "success" }
        : { status: "cancelled" };
    });
  }

  reauthenticateWithBiometrics(signal?: AbortSignal): Promise<AuthResult> {
    return this.authenticateWithBiometrics(signal);
  }

  async setBiometricEnabled(enabled: boolean): Promise<PreferenceResult> {
    const { biometricGeneration, revocations } = this.scope;
    const availability = enabled ? await this.getBiometricAvailability() : null;
    const prepare = await this.runInScope<
      PreferenceResult | { generation: number }
    >(async () => {
      const credential = await this.readCredential();
      if (!credential) {
        return {
          error: { code: "no_pin", message: "No PIN has been configured" },
          status: "error",
        } as const;
      }

      if (enabled && biometricGeneration !== this.scope.biometricGeneration) {
        return { status: "cancelled" };
      }

      if (!availability || !availability.hardwareSupported) {
        if (
          this.config.biometrics.requireAuthToDisable &&
          credential.biometricPreferenceEnabled &&
          !(await this.isSessionValid())
        ) {
          return reauthenticationRequired();
        }
        await this.writeBiometricPreference(credential, false);
        return availability
          ? biometricUnavailableResult()
          : ({ status: "success" } as const);
      }

      if (
        revocations !== this.scope.revocations ||
        !(await this.isSessionValid())
      ) {
        return reauthenticationRequired();
      }

      if (!availability.enrolled) {
        await this.writeBiometricPreference(credential, true);
        return { status: "success" } as const;
      }

      return { generation: this.scope.biometricGeneration };
    });
    if ("status" in prepare) {
      return prepare;
    }

    if (
      revocations !== this.scope.revocations ||
      prepare.generation !== this.scope.biometricGeneration ||
      !(await this.promptForBiometrics())
    ) {
      return { status: "cancelled" };
    }

    return this.runInScope(async () => {
      const credential = await this.readCredential();
      if (
        !credential ||
        prepare.generation !== this.scope.biometricGeneration
      ) {
        return { status: "cancelled" };
      }
      if (
        revocations !== this.scope.revocations ||
        !(await this.isSessionValid())
      ) {
        return reauthenticationRequired();
      }

      await this.writeBiometricPreference(credential, true);
      return { status: "success" };
    });
  }

  private async writeBiometricPreference(
    credential: StoredCredential,
    enabled: boolean
  ): Promise<void> {
    await this.writeCredential({
      ...credential,
      biometricPreferenceEnabled: enabled,
    });
    this.scope.biometricGeneration += 1;
  }

  private async promptForBiometrics(): Promise<boolean> {
    if (this.scope.biometricPromptOpen) {
      return false;
    }

    this.scope.biometricPromptOpen = true;
    try {
      const result = await this.biometrics().authenticate({
        androidSecurityLevel: this.config.biometrics.androidSecurityLevel,
        disableDeviceFallback: true,
      });
      return result.success;
    } finally {
      this.scope.biometricPromptOpen = false;
    }
  }

  lock(): Promise<void> {
    this.revokeSession();
    return this.runInScope(() => this.clearSession());
  }

  resetDeviceAuth(): Promise<void> {
    this.revokeSession();
    return this.runInScope(async () => {
      await this.clearSession();
      await this.options.storage.deleteItem(this.credentialKey());
      this.scope.biometricGeneration += 1;
    });
  }

  private revokeSession(): void {
    this.scope.revocations += 1;
    this.scope.sessionGeneration += 1;
    this.scope.persistentSessionBlocked = true;
  }

  private async clearSession(): Promise<void> {
    this.scope.sessionGeneration += 1;
    this.scope.persistentSessionBlocked = true;
    this.memorySession = null;
    await this.options.storage.deleteItem(this.sessionKey());
  }

  private async verifyPinAndStartSession(
    pin: string,
    cancelled: () => boolean
  ): Promise<AuthResult> {
    const credential = await this.readCredential();
    if (cancelled()) {
      return { status: "cancelled" };
    }
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
    if (!isMatch) {
      const result = await this.recordFailedPinAttempt(credential);
      return cancelled() ? { status: "cancelled" } : result;
    }
    if (cancelled()) {
      return { status: "cancelled" };
    }

    await this.writeCredential({
      ...credential,
      failedAttempts: 0,
    });
    return (await this.startSession(cancelled))
      ? { method: "pin", status: "success" }
      : { status: "cancelled" };
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

  private async startSession(cancelled: () => boolean): Promise<boolean> {
    if (cancelled()) {
      return false;
    }

    const { timeoutMs } = this.config.session;
    const session: StoredSession = {
      expiresAt: timeoutMs === "infinite" ? "infinite" : this.now() + timeoutMs,
    };

    if (this.config.session.persistAcrossRestarts) {
      await this.options.storage.setItem(
        this.sessionKey(),
        JSON.stringify(session)
      );
      if (cancelled()) {
        await this.clearSession();
        return false;
      }
      this.scope.persistentSessionBlocked = false;
      return true;
    }

    this.memorySession = {
      ...session,
      generation: this.scope.sessionGeneration,
    };
    return true;
  }

  private async isSessionValid(): Promise<boolean> {
    const generation = this.scope.sessionGeneration;
    const session = await this.readSession();
    if (!session || generation !== this.scope.sessionGeneration) {
      return false;
    }

    return session.expiresAt === "infinite" || this.now() < session.expiresAt;
  }

  private async readSession(): Promise<StoredSession | null> {
    if (!this.config.session.persistAcrossRestarts) {
      return this.memorySession?.generation === this.scope.sessionGeneration
        ? this.memorySession
        : null;
    }

    if (this.scope.persistentSessionBlocked) {
      return null;
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
