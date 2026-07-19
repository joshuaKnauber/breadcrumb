import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/adapters/index.ts", "src/node.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["better-sqlite3"],
});
