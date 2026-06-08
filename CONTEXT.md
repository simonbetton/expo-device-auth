# Context

## Glossary

**Device-auth session**  
A local unlocked window for device authentication. It is separate from the app's login session, account session, or server token.

**Credential scope**  
The local boundary for one PIN verifier and biometric preference. A scope may represent the whole app install or one signed-in user.

**PIN verifier**  
The stored proof used to check a PIN without storing the PIN itself.

**Configured PIN**  
A PIN verifier already stored for the current credential scope. Setup is complete for that scope; further setup must be rejected or routed to change or recovery flows.

**Biometric preference**  
The user's local preference to try biometric authentication before the PIN fallback.

**Effective biometric availability**  
The condition where biometrics are both preferred and usable on the current device.

**Reauthentication**  
A fresh device-auth prompt requested for a sensitive interaction, even when the current device-auth session is still valid.

**Forgot PIN recovery**  
The host app's recovery path that verifies identity before clearing local device-auth credentials.
