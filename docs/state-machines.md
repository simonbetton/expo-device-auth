# Device-auth state machines

This audit covers the Expo example and the package it calls. The controller owns persistent transitions, the provider owns prompt requests, and the screens own PIN entry and navigation. A device-auth session is a local unlock window. The example's Forgot PIN route simulates the host's identity verification.

The issue IDs below group the fixes in this file. P1 affects credential integrity, lockout enforcement, or session revocation. P2 prevents an authentication or PIN flow from recovering or settling. P3 affects invalid configuration or the example's feedback.

## Confirmed issues and regression evidence

| Issue | Impact | Reachable behavior in baseline `13e5960` | Fixed behavior and regression |
| --- | --- | --- | --- |
| AUTH-1 | P1 | Two `setupPin` calls for one scope could both read no credential before hashing and both return success. The second write replaced the first PIN. Concurrent PIN checks could read the same attempt count and write it back with one increment, leaving later checks outside the intended lockout. | Serialize the credential read, verification and write for each storage identity and scope. `state-transitions.test.ts` checks overlapping setup and lockout accounting across two controllers. |
| AUTH-2 | P1 | A native biometric success could return after `lock` or `resetDeviceAuth` and start a session. A second controller's reset could also leave the first controller's memory session valid. Enrolled opt-in held a credential snapshot across the native prompt and could overwrite a later opt-out, updated attempt counters, or deleted credentials. Opt-in could also outlast a later opt-out while capability lookup was pending. `requireAuthToDisable` was normalized but unused. | Invalidate outstanding auth on lock/reset and old memory sessions on scope-wide revocation. Recheck the credential and preference after native UI, then commit against the current credential. Enforce the configured disable guard. `state-transitions.test.ts` uses deferred native completions and writes, shared storage, competing preference changes and a protected opt-out. |
| AUTH-3 | P1 | Setup/change wrote the verifier before deleting the prior session. If deletion rejected, setup appeared to fail but retry returned `pin_already_configured`. During PIN change the new verifier and old persisted session could both survive the failure. An initially valid session could expire while the replacement PIN was hashing and the write still committed. | Recheck the change session after hashing and revoke before writing. A rejected delete blocks the persisted session in the current runtime and leaves the verifier untouched. `state-transitions.test.ts` injects deletion failures for setup, change and reset, and advances the clock during hashing. |
| AUTH-4 | P2 | A second provider request could overwrite the first modal's resolver. Unmount and Forgot PIN could leave a request unsettled. Cancel during PIN verification could resolve the caller as cancelled while the pending check still unlocked the scope. A rejected PIN storage operation could leave the caller pending and the modal full. The background listener also retained the controller and flag from the initial mount. | Give one request ownership from lookup through settlement. Cancel it on close, recovery, scope replacement, background locking or unmount. Pass cancellation through built-in auth methods; reject and release on operational errors. `device-auth-provider.test.tsx` covers overlap, recovery, unmount, late PIN completion, rejected storage and lifecycle changes. |
| AUTH-5 | P2 | Final digit queued a submission after paint, but backspace could create a second full entry before the first callback ran. A queued submission could run after unmount. Setup/change discarded completion results and change mislabeled lockout/cancellation as an incorrect PIN. A change rejected because the session expired stayed on confirmation with no path back to current PIN verification. | Keypad accepts one submission per full entry and drops queued submissions on unmount. Setup/change await completion, reset to a retryable stage on failure, and finish once on success. `pin-entry-screen.test.tsx` exercises queued and in-flight input, and `pin-flow-screens.test.tsx` exercises failure, retry, and current PIN outcomes. |
| AUTH-6 | P3 | An empty or nonpositive lockout ladder could return `locked` with an already elapsed deadline. A numeric infinite session was accepted even with persistence, where JSON serializes the deadline to `null`. Mutating the caller's ladder could alter an existing controller's policy. The example setup route could stay blank after a rejected state read, and the recovery button could submit multiple resets. | Validate deadlines and snapshot the ladder in `config.test.ts`. Example setup offers a retry on failed reads and recovery allows one pending reset with error feedback. |

Verification used the same Jest regressions against an archive of the baseline and the working tree. The baseline accepted both overlapping setups, undercounted overlapping attempts, allowed a late biometric success after revocation, and left the first provider prompt without its resolver. The working tree passes `pnpm verify`. The example routes are typechecked, and native services are mocked in Jest.

## Credential, verifier and PIN lockout

[controller](../packages/expo-device-auth/src/device-auth-controller.ts), [PIN verifier](../packages/expo-device-auth/src/pin-verifier.ts), [configuration](../packages/expo-device-auth/src/config.ts).

Implicit states are **absent**, **configured and accepting PINs**, and **configured with PIN checks blocked until a deadline**. The configured record carries the versioned verifier, preference, attempt count, lockout level and optional deadline. The verifier can be legacy salted SHA-256 or PBKDF2-HMAC-SHA256. Setup/change write PBKDF2. A successful verification keeps the original verifier format.

Invariants

- A configured scope has one verifier. Setup only writes when the scope is absent. A PIN change requires a configured scope and a valid current session at the post-hash authorization check.
- Only complete serialized PIN checks update the failure count. Reaching the threshold resets the step count and increments the level. The final configured duration repeats for all later levels. Correct PIN clears the failure count, and changing PIN preserves the existing lockout level and deadline. Reset clears them.
- A cancelled attempt that finished comparing a wrong PIN still counts toward lockout. Cancellation never grants a session.
- Lockout restricts PIN verification. A valid cached session or successful enabled biometric check can still authenticate.
- Policy requires a positive integer attempts threshold, a nonempty ladder of finite positive durations, and a finite positive session duration or memory-only `"infinite"`.

| From | Event and guard | Next state or result |
| --- | --- | --- |
| Absent | Setup with valid decimal PIN and matching confirmation, session cleanup succeeds | Configured and accepting PINs, count and level zero, success |
| Absent | Change, PIN check, preference change | Absent, `no_pin` |
| Configured | Setup | Unchanged, `pin_already_configured` |
| Configured | Change with valid session and matching valid replacement | New verifier, failure count cleared, prior PIN lockout policy state retained, session revoked |
| Configured | Change with invalid or expired session | Unchanged, `reauthentication_required` |
| Absent for setup or configured for change | PIN input is invalid after authorization checks | Unchanged, `invalid_pin` or `pin_confirmation_mismatch` |
| Accepting PINs | Wrong PIN below threshold | Increment count, `pin_mismatch` |
| Accepting PINs | Wrong PIN reaches threshold | Block PINs until deadline, increment level and reset step count, `locked` |
| PIN checks blocked | Check before deadline | Same deadline, `locked`, verifier untouched |
| PIN checks blocked | Clock reaches deadline | Accepting PINs at the next check, previous level retained |
| Accepting PINs | Correct PIN | Clear count and start session, success unless cancelled or storage fails |
| Any | Reset completes | Absent and locked |
| Any | Storage rejects | Operation rejects, later operations can proceed. Setup/change revoke before committing, and reset deletes the session before deleting credentials. |

## Device-auth session and operation ordering

[controller](../packages/expo-device-auth/src/device-auth-controller.ts), [Expo adapters](../packages/expo-device-auth/src/expo-adapters.ts).

Implicit session states are **locked**, **valid until a deadline**, **valid for the in-memory controller lifetime**, and **expired**. Expiry is derived on read. Storage can retain an expired record. If a revocation delete fails, the coordinator treats the persisted record as blocked for the rest of the runtime or until fresh authentication writes a replacement.

Invariants

- A valid session requires a configured PIN. The expiry boundary is strict, `now < expiresAt`. Valid memory-only sessions belong to the controller that issued them. Lock, change and reset invalidate earlier memory sessions across coordinated controllers.
- A successful lock or reset prevents an earlier pending PIN or biometric result from reopening the session. A candidate biometric result also loses authority after a credential or preference write.
- The runtime queue is per storage object or shared `coordinationKey`, and per scope. Expo wrappers share one key. Custom adapters over the same store must share an identity. Separate JS runtimes and out-of-band storage writers are outside the coordinator. Persistent revocation across a process restart requires successful storage deletion. The storage API has no cross-key transaction or rollback for adapters that mutate and then reject.

| From | Event and guard | Next state or result |
| --- | --- | --- |
| Configured, any session | Successful checked PIN or enabled biometric result, still current | New timed session, or memory-only infinite session |
| Valid | Provider `authenticate` | Return cached session success |
| Any | PIN reauthentication begins | Revoke current session, then apply PIN verification rules |
| Any | Biometric reauthentication begins | Fresh native prompt, session refreshed on success. Native cancellation leaves any prior session until another revocation or expiry. |
| Valid timed | Deadline reached | Expired |
| Any | Explicit lock, or background when configured | Revoke in the current runtime, delete persisted session |
| Any | Setup/change commit or successful reset | Locked |
| Native prompt pending | Lock, reset, credential change, preference change, or request abort before completion | Discard obsolete result |
| Persisted session write pending | Cancellation before write settles | Remove the new record after the write, then return cancelled if cleanup succeeds |
| Operation pending | Storage or driver rejects | Reject the operation and release its queue position or native prompt slot |

## Biometric preference and availability

The implicit states are **off**, **preferred but unavailable**, and **effective**. Hardware and enrollment are observed through the driver. The stored preference is independent of enrollment. The public preference reports false on unsupported hardware even if a stored preference exists.

| From | Event and guard | Next state or result |
| --- | --- | --- |
| Absent | Set preference | `no_pin` |
| Off | Setup with default enabled and supported hardware | Preferred, effective if enrolled |
| Off or preferred | Enable with supported hardware, valid session and no enrollment | Preferred, unavailable until enrollment |
| Off or preferred | Enable with supported and enrolled hardware, valid session | Begin native confirmation; commit against current credential if operation and session are still valid |
| Any configured | Disable | Off, or `reauthentication_required` if a stored opt-in is protected by `requireAuthToDisable` and the session is invalid |
| Any configured | Enable with unsupported hardware | `biometric_unavailable`; clears an unprotected stored preference or a protected one authorized by a valid session |
| Preferred | Enrollment becomes available or unavailable | Effective when supported and enrolled, otherwise preferred but unavailable |
| Effective | Request fresh biometric authentication | Native prompt opens if the scope has no native prompt open. Success starts a session only if authorization remains current. |
| Native prompt open | Native failure, or another request while prompt is open | Cancelled; provider may fall back to PIN. Native settlement releases the slot. |
| Any | Reset commits | Off |

## Provider request and app lifecycle

[provider](../packages/expo-device-auth/src/device-auth-provider.tsx).

Explicit request modes are `authenticate` and `reauthenticate`. Implicit phases are **idle**, **checking state**, **native prompt**, **PIN entry or verification**, and **settled**. `AuthResult` discriminates success, cancellation, PIN lockout and domain errors. Driver and storage exceptions reject the caller's promise.

Invariants

- One request owns a provider prompt. An overlapping request returns cancelled while the owner continues. Late results can settle only their own request.
- Cancel, recovery, Android back, configured background, explicit lock/reset and scope disposal settle the outstanding request. Built-in methods observe its abort signal. Injected controllers must honor that signal to prevent a late session write.
- App background is the native `background` state. The transient `inactive` state alone keeps the current request, including while system UI is displayed. The listener follows the selected controller and the current flag.

| From | Event and guard | Next state or result |
| --- | --- | --- |
| Idle | API request | Checking state |
| Checking | PIN absent | Settled, `no_pin` |
| Checking | Authenticate and session valid | Settled, cached-session success |
| Checking | Fresh auth needed and biometrics effective | Native prompt |
| Checking or native prompt | Biometrics unavailable, or native result non-success while owner remains active | PIN entry |
| Native prompt | Valid biometric success | Settled, biometric success |
| PIN entry | Full PIN | Verify with controller in request mode |
| Verifying PIN | Mismatch | Same request, new keypad instance and error message |
| Verifying PIN | Any other result | Settled with result |
| Checking, native prompt or verifying PIN | Controller throws | Settled by rejection |
| Active | Cancel, recovery, background with locking, lock/reset, controller replacement or unmount | Abort and settle as cancelled. Recovery invokes the host callback after closing the prompt. |
| Active | Additional request on same provider and controller | Additional caller gets cancelled, owner continues |

## Keypad and PIN screens

[entry](../packages/expo-device-auth/src/pin-entry-screen.tsx), [PIN auth](../packages/expo-device-auth/src/pin-auth-screen.tsx), [setup and change](../packages/expo-device-auth/src/pin-flow-screens.tsx).

The keypad's implicit phases are editing, full and queued, and submitting. Screen stages are explicit tagged states for setup and change. Only confirmation carries a candidate PIN. The PIN is held in memory for entry and confirmation.

| Machine | From | Event and guard | Next state |
| --- | --- | --- | --- |
| Keypad | Editing | Digit or backspace | Edit digits and dots together. At configured length queue one submission after paint. |
| Keypad | Queued or submitting | Digit or backspace | Keep the submitted value until the callback settles |
| Keypad | Queued | Unmount before dispatch | Drop the callback |
| Keypad | Submitting | Callback settles | Full and editable if still mounted. Rejection clears digits. Parent may replace the keypad. |
| PIN auth screen | Enter PIN | Mismatch or controller exception | Show retry message and clear keypad |
| PIN auth screen | Enter PIN | Other result | Report to host, clear keypad if still mounted |
| Setup | Create | Full PIN | Confirm with candidate |
| Setup | Confirm | Mismatch or failed save | Create with feedback |
| Setup | Confirm | Match and successful save | Completed |
| Change | Current | Valid verification | Enter new PIN |
| Change | Current | Mismatch, lockout, cancellation, missing PIN or verification error | Stay on current with outcome-specific feedback |
| Change | New | Full PIN | Confirm with candidate |
| Change | Confirm | Mismatch | Return to new PIN with feedback |
| Change | Confirm | Match, save fails or session expired | Return to current PIN verification with feedback |
| Change | Confirm | Match and successful save | Completed |

## Example navigation and native boundaries

[example routes](../apps/example/app), [Expo adapters](../packages/expo-device-auth/src/expo-adapters.ts), [config plugin](../packages/expo-device-auth/app.plugin.js).

| From | Event and guard | Next state |
| --- | --- | --- |
| Home | Setup action and scope absent | Setup route |
| Home or setup gate | Configured PIN observed | Home with already-configured feedback |
| Setup gate | Read fails | Retry UI |
| Setup route | Setup succeeds | Home |
| Home | Change action | Current PIN verification route |
| Change route | Change succeeds | Home |
| Home or PIN modal | Forgot PIN | Recovery route. Provider-owned modal settles first. |
| Recovery ready | Simulate verified reset | Resetting. Further taps are ignored while pending. |
| Recovery resetting | Reset succeeds or rejects | Setup route on success, retry UI on failure |

The config plugin changes build-time configuration. It has no runtime transitions. The Expo biometric adapter maps hardware and enrollment to availability and its native prompt result to success or failure. QuickCrypto lazily creates and reuses native hashing and random objects. The Jest suite substitutes native services and exercises the JS state transitions and adapter contract.
