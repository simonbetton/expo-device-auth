import { describe, expect, it } from "@jest/globals";

import { normalizeDeviceAuthConfig } from "../config";

describe("normalizeDeviceAuthConfig", () => {
  it("accepts scope keys that are valid SecureStore key segments", () => {
    expect(
      normalizeDeviceAuthConfig({
        pinLength: 4,
        scopeKey: "tenant.1-user_2",
      })
    ).toMatchObject({
      scopeKey: "tenant.1-user_2",
    });
  });

  it.each(["", "tenant:1", "tenant 1"])(
    "rejects scopeKey %p because it would create an invalid SecureStore key",
    (scopeKey: string) => {
      expect(() =>
        normalizeDeviceAuthConfig({
          pinLength: 4,
          scopeKey,
        })
      ).toThrow(
        'scopeKey must not be empty and may only contain alphanumeric characters, ".", "-", and "_"'
      );
    }
  );

  it.each([
    { pinAttempts: { attemptsPerStep: Number.NaN } },
    { pinAttempts: { attemptsPerStep: 0 } },
    { pinAttempts: { lockoutsMs: [] } },
    { pinAttempts: { lockoutsMs: [-1] } },
    { session: { timeoutMs: Number.POSITIVE_INFINITY } },
    { session: { timeoutMs: 0 } },
  ])(
    "rejects policies with unreachable or invalid deadlines (%p)",
    (policy) => {
      expect(() =>
        normalizeDeviceAuthConfig({ pinLength: 4, ...policy })
      ).toThrow(/must/u);
    }
  );

  it("snapshots the lockout ladder at normalization", () => {
    const lockoutsMs = [300];
    const config = normalizeDeviceAuthConfig({
      pinAttempts: { lockoutsMs },
      pinLength: 4,
    });
    lockoutsMs.length = 0;

    expect(config.pinAttempts.lockoutsMs).toStrictEqual([300]);
  });

  it("rejects an infinite local device-auth session that persists across restarts", () => {
    expect(() =>
      normalizeDeviceAuthConfig({
        pinLength: 4,
        session: {
          persistAcrossRestarts: true,
          timeoutMs: "infinite",
        },
      })
    ).toThrow(
      'timeoutMs: "infinite" cannot be combined with persistAcrossRestarts'
    );
  });
});
