const { createRunOncePlugin, withPlugins } = require("@expo/config-plugins");
const pkg = require("./package.json");

const DEFAULT_FACE_ID_PERMISSION = "Allow $(PRODUCT_NAME) to use Face ID.";

const withExpoDeviceAuth = (config, props = {}) => {
  const faceIDPermission = props.faceIDPermission ?? DEFAULT_FACE_ID_PERMISSION;
  const configureAndroidBackup = props.configureAndroidBackup ?? true;

  return withPlugins(config, [
    [
      "expo-local-authentication",
      {
        faceIDPermission,
      },
    ],
    [
      "expo-secure-store",
      {
        configureAndroidBackup,
        faceIDPermission,
      },
    ],
    "react-native-quick-crypto",
  ]);
};

const plugin = createRunOncePlugin(withExpoDeviceAuth, pkg.name, pkg.version);

module.exports = plugin;
module.exports.withExpoDeviceAuth = withExpoDeviceAuth;
module.exports.DEFAULT_FACE_ID_PERMISSION = DEFAULT_FACE_ID_PERMISSION;
