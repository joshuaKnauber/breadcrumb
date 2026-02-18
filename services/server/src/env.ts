import "dotenv/config";

export const env = {
  adminPassword: process.env.ADMIN_PASSWORD || "admin",
  jwtSecret: process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "admin",
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/breadcrumb",
  clickhouseUrl: process.env.CLICKHOUSE_URL || "http://localhost:8123",
  clickhouseDb: process.env.CLICKHOUSE_DB || "breadcrumb",
  clickhouseUser: process.env.CLICKHOUSE_USER || "default",
  clickhousePassword: process.env.CLICKHOUSE_PASSWORD || "",
  port: Number(process.env.PORT) || 3100,
  nodeEnv: process.env.NODE_ENV || "development",
};
