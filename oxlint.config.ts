import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import jest from "ultracite/oxlint/jest";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, jest, react],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      files: ["packages/expo-device-auth/app.plugin.js"],
      rules: {
        "eslint/func-style": "off",
        "eslint/no-implicit-globals": "off",
        "unicorn/prefer-module": "off",
      },
    },
  ],
});
