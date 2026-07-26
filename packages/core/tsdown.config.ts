import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/adapters/index.ts",
    "src/kit/index.ts",
    "src/client.ts",
    "src/node.ts",
    "src/next.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["better-sqlite3"],
});
