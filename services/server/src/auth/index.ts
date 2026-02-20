import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { db } from "../db/index.js";
import { apiKeys, mcpKeys } from "../db/schema.js";
import { hashApiKey } from "../lib/api-keys.js";
import type { Context, Next } from "hono";

const secret = new TextEncoder().encode(env.jwtSecret);

async function signToken() {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

// --- Routes ---

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();

  if (password !== env.adminPassword) {
    return c.json({ error: "Invalid password" }, 401);
  }

  const token = await signToken();
  setCookie(c, "session", token, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return c.json({ success: true });
});

authRoutes.post("/logout", (c) => {
  setCookie(c, "session", "", { maxAge: 0, path: "/" });
  return c.json({ success: true });
});

authRoutes.get("/me", async (c) => {
  const token = getCookie(c, "session");
  if (!token || !(await verifyToken(token))) {
    return c.json({ authenticated: false }, 401);
  }
  return c.json({ authenticated: true });
});

// --- Middleware ---

export async function requireSession(c: Context, next: Next) {
  const token = getCookie(c, "session");
  if (!token || !(await verifyToken(token))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
}

const KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const keyCache = new Map<string, { projectId: string; expiresAt: number }>();

async function resolveApiKey(hash: string): Promise<string | null> {
  const cached = keyCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId;
  }

  const [found] = await db
    .select({ projectId: apiKeys.projectId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);

  if (!found) {
    keyCache.delete(hash);
    return null;
  }

  keyCache.set(hash, {
    projectId: found.projectId,
    expiresAt: Date.now() + KEY_CACHE_TTL,
  });
  return found.projectId;
}

export async function requireApiKey(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!key) {
    return c.json({ error: "Missing API key" }, 401);
  }

  const projectId = await resolveApiKey(hashApiKey(key));
  if (!projectId) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  c.set("projectId", projectId);
  await next();
}

const mcpKeyCache = new Map<string, { projectId: string; expiresAt: number }>();

async function resolveMcpKey(hash: string): Promise<string | null> {
  const cached = mcpKeyCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId;
  }

  const [found] = await db
    .select({ projectId: mcpKeys.projectId })
    .from(mcpKeys)
    .where(eq(mcpKeys.keyHash, hash))
    .limit(1);

  if (!found) {
    mcpKeyCache.delete(hash);
    return null;
  }

  mcpKeyCache.set(hash, {
    projectId: found.projectId,
    expiresAt: Date.now() + KEY_CACHE_TTL,
  });
  return found.projectId;
}

export async function requireMcpKey(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!key) {
    return c.json({ error: "Missing MCP key" }, 401);
  }

  const projectId = await resolveMcpKey(hashApiKey(key));
  if (!projectId) {
    return c.json({ error: "Invalid MCP key" }, 401);
  }

  c.set("projectId", projectId);
  await next();
}
