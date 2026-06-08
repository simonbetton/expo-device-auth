import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ".agents/**",
    "apps/example/.expo/**",
    "apps/example/android/**",
    "apps/example/ios/**",
  ],
});
