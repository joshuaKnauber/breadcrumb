import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env.js";
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
    maxAge: 60 * 60 * 24 * 7, // 7 days
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

export async function requireApiKey(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (key !== env.adminApiKey) {
    return c.json({ error: "Invalid API key" }, 401);
  }
  await next();
}
