import { Hono } from "hono";

export const ingestRoutes = new Hono();

ingestRoutes.post("/traces", async (c) => {
  const body = await c.req.json();
  // TODO: validate, write to ClickHouse
  console.log("ingested traces:", Array.isArray(body) ? body.length : 1);
  return c.json({ success: true }, 202);
});
