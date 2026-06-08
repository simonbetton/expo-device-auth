# expo-device-auth

Expo-first local device authentication for React Native apps.

- Biometric authentication through Expo LocalAuthentication.
- Package-owned PIN fallback with encrypted local storage.
- 4- or 6-digit PIN setup, auth, and change flows.
- Provider-owned modal prompt for sensitive reauthentication.
- Slot and style APIs for replacing default UI without requiring NativeWind or another styling library.

## Install

```sh
npm install expo-device-auth
npx expo install expo-local-authentication expo-secure-store
```

Use a development build for supported biometric testing. Expo Go is not the supported target for this package.

## Configure

Add the config plugin:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-device-auth",
        {
          "faceIDPermission": "Use Face ID to unlock the app.",
          "configureAndroidBackup": true
        }
      ]
    ]
  }
}
```

## Basic Usage

```tsx
import {
  DeviceAuthProvider,
  PinSetupScreen,
  useDeviceAuth,
} from "expo-device-auth";

const config = {
  pinLength: 4,
  session: {
    timeoutMs: 5 * 60 * 1000,
    persistAcrossRestarts: false,
  },
  biometrics: {
    defaultEnabled: false,
    androidSecurityLevel: "strong",
  },
} as const;

export function App() {
  return (
    <DeviceAuthProvider
      config={config}
      onForgotPin={() => {
        // Navigate to a host-owned recovery flow.
      }}
    >
      <Root />
    </DeviceAuthProvider>
  );
}

function SensitiveActionButton() {
  const deviceAuth = useDeviceAuth();

  async function confirm() {
    const result = await deviceAuth.reauthenticate({
      title: "Confirm transfer",
    });

    if (result.status === "success") {
      // Continue the sensitive action.
    }
  }

  return null;
}
```

## API

`DeviceAuthProvider`

- `config`: package configuration.
- `controller`: optional controller override for tests or advanced integrations.
- `onForgotPin`: optional callback; the Forgot PIN button is hidden unless provided.
- `lockOnBackground`: immediately locks when the app backgrounds.
- `pinStyles` and `pinSlots`: customize default PIN UI.

`useDeviceAuth()`

- `authenticate(options?)`: returns the current local session when valid; otherwise prompts.
- `reauthenticate(options?)`: always prompts, even during a valid local session.
- `setBiometricEnabled(enabled)`: manages biometric preference.
- `setupPin({ pin, confirmation })`
- `changePin({ pin, confirmation })`: requires fresh local authentication first.
- `authenticateWithPin(pin)`
- `reauthenticateWithPin(pin)`
- `authenticateWithBiometrics()`
- `resetDeviceAuth()`
- `lock()`
- `getState()`

Screens:

- `PinSetupScreen`
- `PinAuthScreen`
- `ChangePinScreen`
- `PinEntryScreen`

## Security Model

The PIN is a local gate, not a server authorization mechanism. The raw PIN is never stored. The package stores a salted verifier in Expo SecureStore and applies configurable attempt lockouts.

Forgot PIN recovery belongs to the host app. After the host verifies identity, call `resetDeviceAuth()` to clear local credentials and set up a new PIN.

## Testing

The package is built with TDD and has enforced Jest coverage thresholds:

```sh
pnpm --filter expo-device-auth test:coverage
```
