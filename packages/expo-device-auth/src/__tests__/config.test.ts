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
