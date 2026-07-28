import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/routing.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  deps: {
    // Everything in `dependencies` stays external so the consumer installs one
    // copy — bundling React-context libraries like react-query or base-ui would
    // give a host app a second, invisible provider tree.
    neverBundle: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@tanstack/react-query",
      "@base-ui/react",
      /^@base-ui\/react\//,
      "chart.js",
      /^chart\.js\//,
      "react-chartjs-2",
      "@breadcrumb-sh/core",
      /^@breadcrumb-sh\/core\//,
    ],
  },
  outputOptions: {
    // Every export of the main entry is stateful React. Declaring it once here
    // lets a Next App Router page import the dashboard without marking itself a
    // client component; rolldown drops per-file directives when it bundles.
    //
    // `routing` is deliberately left unmarked — a server component has to be
    // able to *call* parseRoute, which a client module would forbid.
    banner: (chunk) => (chunk.name === "index" ? '"use client";' : ""),
  },
});
