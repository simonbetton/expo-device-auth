import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  clearAllMocks,
  mockFn,
  resetModules,
} from "../test-support/jest-mocks";

interface AppPluginConfig {
  name: string;
  slug: string;
  plugins?: unknown[];
}

interface PluginProps {
  configureAndroidBackup?: boolean;
  faceIDPermission?: string;
}

type AppPlugin = (
  config: AppPluginConfig,
  props?: PluginProps
) => AppPluginConfig;

const loadPlugin = async (): Promise<AppPlugin> => {
  const pluginPath = "../../app.plugin.js";
  const { default: plugin } = await import(pluginPath);
  return plugin as AppPlugin;
};

const withPlugins = mockFn((config: AppPluginConfig, plugins: unknown[]) => ({
  ...config,
  plugins,
}));
const createRunOncePlugin = mockFn(
  (plugin: AppPlugin, _name: string, _version?: string) => plugin
);

interface ConfigPluginsMock {
  createRunOncePlugin: typeof createRunOncePlugin;
  withPlugins: typeof withPlugins;
}

jest.mock<ConfigPluginsMock>("@expo/config-plugins", () => ({
  createRunOncePlugin,
  withPlugins,
}));

describe("expo config plugin", () => {
  beforeEach(() => {
    clearAllMocks();
    resetModules();
  });

  it("forwards Face ID permission and SecureStore backup options to Expo plugins", async () => {
    const plugin = await loadPlugin();
    const config = { name: "Example", slug: "example" };

    const result = plugin(config, {
      configureAndroidBackup: false,
      faceIDPermission: "Use Face ID to unlock Example.",
    });

    expect(createRunOncePlugin).toHaveBeenCalledWith(
      expect.any(Function),
      "expo-device-auth",
      "0.0.0"
    );
    expect(withPlugins).toHaveBeenCalledWith(config, [
      [
        "expo-local-authentication",
        { faceIDPermission: "Use Face ID to unlock Example." },
      ],
      [
        "expo-secure-store",
        {
          configureAndroidBackup: false,
          faceIDPermission: "Use Face ID to unlock Example.",
        },
      ],
      "react-native-quick-crypto",
    ]);
    expect(result.plugins).toHaveLength(3);
  });

  it("uses conservative defaults when plugin props are omitted", async () => {
    const plugin = await loadPlugin();

    plugin({ name: "Example", slug: "example" });

    expect(withPlugins).toHaveBeenCalledWith(expect.any(Object), [
      [
        "expo-local-authentication",
        { faceIDPermission: "Allow $(PRODUCT_NAME) to use Face ID." },
      ],
      [
        "expo-secure-store",
        {
          configureAndroidBackup: true,
          faceIDPermission: "Allow $(PRODUCT_NAME) to use Face ID.",
        },
      ],
      "react-native-quick-crypto",
    ]);
  });
});
