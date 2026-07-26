// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { remarkAlert } from "remark-github-blockquote-alert";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://breadcrumb.sh",
  integrations: [mdx(), sitemap()],

  markdown: {
    remarkPlugins: [remarkAlert],
    shikiConfig: { theme: "night-owl" },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: cloudflare(),
});