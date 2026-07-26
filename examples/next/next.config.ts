import type { NextConfig } from "next";

const config: NextConfig = {
  // better-sqlite3 is native; keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],
};

export default config;
