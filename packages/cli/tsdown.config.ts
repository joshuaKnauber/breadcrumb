import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  external: ["better-sqlite3", "@breadcrumb-sh/core"],
});
