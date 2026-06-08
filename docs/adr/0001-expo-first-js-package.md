# ADR 0001: Expo-First JavaScript Package

## Status

Accepted

## Context

The package needs to be easy to install in Expo apps while supporting Face ID, Android biometrics, encrypted local storage, and a package-owned PIN fallback UI.

## Decision

Build v1 as an Expo-first TypeScript/React Native package with Expo modules as peer dependencies. Use an Expo config plugin for native app configuration instead of shipping custom native code.

## Consequences

- Consumers install version-aligned native modules with `npx expo install`.
- The package stays usable from managed Expo projects and development builds.
- Native behavior is limited to what Expo LocalAuthentication, SecureStore, and Crypto expose.
- A future custom native module remains possible if v1 needs stronger native cryptography or deeper platform control.
