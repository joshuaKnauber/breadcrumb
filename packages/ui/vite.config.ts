import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
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
