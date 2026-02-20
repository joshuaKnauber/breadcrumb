import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Point @breadcrumb/core to its TypeScript source so tests don't
    // require the package to be built first.
    alias: {
      "@breadcrumb/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    globals: true,
  },
});
