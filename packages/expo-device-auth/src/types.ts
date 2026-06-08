export type PinLength = 4 | 6;

export type SessionTimeout = number | "infinite";

export interface DeviceAuthConfig {
  pinLength: PinLength;
  session?: {
    timeoutMs?: SessionTimeout;
    persistAcrossRestarts?: boolean;
  };
  biometrics?: {
    defaultEnabled?: boolean;
    androidSecurityLevel?: "strong" | "weak";
    requireAuthToDisable?: boolean;
  };
  pinAttempts?: {
    attemptsPerStep?: number;
    lockoutsMs?: number[];
  };
  scopeKey?: string;
}

export interface NormalizedDeviceAuthConfig {
  pinLength: PinLength;
  scopeKey: string;
  session: {
    timeoutMs: SessionTimeout;
    persistAcrossRestarts: boolean;
  };
  biometrics: {
    defaultEnabled: boolean;
    androidSecurityLevel: "strong" | "weak";
    requireAuthToDisable: boolean;
  };
  pinAttempts: {
    attemptsPerStep: number;
    lockoutsMs: number[];
  };
}

export type DeviceAuthErrorCode =
  | "biometric_cancelled"
  | "biometric_unavailable"
  | "invalid_pin"
  | "no_pin"
  | "pin_already_configured"
  | "pin_confirmation_mismatch"
  | "pin_mismatch"
  | "reauthentication_required";

export interface DeviceAuthError {
  code: DeviceAuthErrorCode;
  message: string;
}

export type AuthResult =
  | { status: "success"; method: "pin" | "biometric" | "session" }
  | { status: "cancelled" }
  | { status: "locked"; until: number }
  | { status: "error"; error: DeviceAuthError };

export type SetupPinResult =
  | { status: "success" }
  | { status: "error"; error: DeviceAuthError };

export type PreferenceResult =
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "error"; error: DeviceAuthError };

export type BiometricAvailabilityReason =
  | "available"
  | "hardware_unavailable"
  | "not_enrolled";

export interface BiometricAvailability {
  hardwareSupported: boolean;
  enrolled: boolean;
  supportedTypes: ("face" | "fingerprint" | "iris")[];
  reason: BiometricAvailabilityReason;
}

export interface DeviceAuthState {
  needsSetup: boolean;
  isSessionValid: boolean;
  biometricPreferenceEnabled: boolean;
  effectiveBiometricEnabled: boolean;
  biometricAvailability: BiometricAvailability;
}
