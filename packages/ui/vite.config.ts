import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The dashboard is the reference consumer of the published headless utilities.
// Read them from core *source* (core's dist is built after the UI), so the
// import specifiers match exactly what external users write.
const coreSrc = (p: string) => fileURLToPath(new URL(`../core/src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@breadcrumb-sh/core/kit": coreSrc("kit/index.ts"),
      "@breadcrumb-sh/core/client": coreSrc("client.ts"),
    },
  },
  server: {
    // dev against a running playground: npm run dev --workspace=examples/playground
    proxy: {
      "/api": {
        target: "http://localhost:4200/admin/traces",
        changeOrigin: true,
      },
    },
  },
});
