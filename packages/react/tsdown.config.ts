import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react/jsx-runtime", "@tanstack/react-query", "@breadcrumb-sh/core/client"],
});
