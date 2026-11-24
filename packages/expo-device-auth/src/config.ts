import type {
  DeviceAuthConfig,
  NormalizedDeviceAuthConfig,
  SessionTimeout,
} from "./types";

const DEFAULT_SCOPE_KEY = "default";
const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_LOCKOUTS_MS = [30_000, 5 * 60 * 1000, 15 * 60 * 1000];
const SECURE_STORE_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;

const isPositiveDuration = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const validatePolicies = (
  timeoutMs: SessionTimeout,
  attemptsPerStep: number,
  lockoutsMs: number[]
): void => {
  if (timeoutMs !== "infinite" && !isPositiveDuration(timeoutMs)) {
    throw new Error("Session timeout must be finite and positive");
  }
  if (!(Number.isSafeInteger(attemptsPerStep) && attemptsPerStep > 0)) {
    throw new Error("PIN attempts per step must be a positive integer");
  }
  if (lockoutsMs.length === 0 || ![...lockoutsMs].every(isPositiveDuration)) {
    throw new Error("PIN lockouts must contain finite positive durations");
  }
};

export const normalizeDeviceAuthConfig = (
  config: DeviceAuthConfig
): NormalizedDeviceAuthConfig => {
  const timeoutMs = config.session?.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const persistAcrossRestarts = config.session?.persistAcrossRestarts ?? false;
  const attemptsPerStep = config.pinAttempts?.attemptsPerStep ?? 5;
  const lockoutsMs = config.pinAttempts?.lockoutsMs ?? DEFAULT_LOCKOUTS_MS;
  const scopeKey = config.scopeKey ?? DEFAULT_SCOPE_KEY;

  if (timeoutMs === "infinite" && persistAcrossRestarts) {
    throw new Error(
      'timeoutMs: "infinite" cannot be combined with persistAcrossRestarts'
    );
  }

  if (!SECURE_STORE_KEY_SEGMENT_PATTERN.test(scopeKey)) {
    throw new Error(
      'scopeKey must not be empty and may only contain alphanumeric characters, ".", "-", and "_"'
    );
  }

  validatePolicies(timeoutMs, attemptsPerStep, lockoutsMs);

  return {
    biometrics: {
      androidSecurityLevel: config.biometrics?.androidSecurityLevel ?? "strong",
      defaultEnabled: config.biometrics?.defaultEnabled ?? false,
      requireAuthToDisable: config.biometrics?.requireAuthToDisable ?? false,
    },
    pinAttempts: {
      attemptsPerStep,
      lockoutsMs: [...lockoutsMs],
    },
    pinLength: config.pinLength,
    scopeKey,
    session: {
      persistAcrossRestarts,
      timeoutMs,
    },
  };
};
