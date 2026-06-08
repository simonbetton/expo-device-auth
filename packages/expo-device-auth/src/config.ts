import type { DeviceAuthConfig, NormalizedDeviceAuthConfig } from "./types";

const DEFAULT_SCOPE_KEY = "default";
const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_LOCKOUTS_MS = [30_000, 5 * 60 * 1000, 15 * 60 * 1000];
const SECURE_STORE_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;

export const normalizeDeviceAuthConfig = (
  config: DeviceAuthConfig
): NormalizedDeviceAuthConfig => {
  const timeoutMs = config.session?.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const persistAcrossRestarts = config.session?.persistAcrossRestarts ?? false;
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

  return {
    biometrics: {
      androidSecurityLevel: config.biometrics?.androidSecurityLevel ?? "strong",
      defaultEnabled: config.biometrics?.defaultEnabled ?? false,
      requireAuthToDisable: config.biometrics?.requireAuthToDisable ?? false,
    },
    pinAttempts: {
      attemptsPerStep: config.pinAttempts?.attemptsPerStep ?? 5,
      lockoutsMs: config.pinAttempts?.lockoutsMs ?? DEFAULT_LOCKOUTS_MS,
    },
    pinLength: config.pinLength,
    scopeKey,
    session: {
      persistAcrossRestarts,
      timeoutMs,
    },
  };
};
