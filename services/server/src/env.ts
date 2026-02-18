import "dotenv/config";

export const env = {
  adminPassword: process.env.ADMIN_PASSWORD || "admin",
  adminApiKey: process.env.ADMIN_API_KEY || "bc_dev_key",
  jwtSecret: process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "admin",
  port: Number(process.env.PORT) || 3100,
  nodeEnv: process.env.NODE_ENV || "development",
};
