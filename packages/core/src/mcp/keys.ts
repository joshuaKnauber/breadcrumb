import { createHash, randomBytes } from "node:crypto";
import type { DatabaseAdapter, McpKeyRecord } from "../db/types.js";

/** How long a resolved key stays cached before the database is consulted again. */
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

const PREFIX = "bcmcp_";

/**
 * Mint a token. 32 random bytes is far beyond guessable, which is what lets the
 * stored form be a plain SHA-256 rather than a slow password hash: there is no
 * low-entropy secret to brute-force, and every MCP request has to verify one.
 */
export function generateMcpKey(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export function hashMcpKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The leading chunk shown in the UI so two keys can be told apart. */
export function mcpKeyPrefix(key: string): string {
  return key.slice(0, PREFIX.length + 6);
}

/** Pull a bearer token off a request, accepting the header spelling agents use. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

export interface McpKeyStore {
  /** Resolve a presented token to its record, or null. Caches for 5 minutes. */
  resolve(token: string): Promise<McpKeyRecord | null>;
  list(): Promise<McpKeyRecord[]>;
  /** Returns the record plus the raw token, which is never recoverable again. */
  create(name: string): Promise<{ record: McpKeyRecord; token: string }>;
  revoke(id: string): Promise<boolean>;
}

export function createMcpKeyStore(
  adapter: DatabaseAdapter,
  ready: () => Promise<void>
): McpKeyStore {
  // Resolution happens on every MCP call, and each miss is a round trip to the
  // user's own database — the same one serving their app. Cache hits by hash.
  // Revocation invalidates directly, so the TTL only bounds staleness from
  // another instance's revoke, not this one's.
  const cache = new Map<string, { record: McpKeyRecord; expiresAt: number }>();

  return {
    async resolve(token) {
      if (!token.startsWith(PREFIX)) return null;
      const hash = hashMcpKey(token);

      const cached = cache.get(hash);
      if (cached && cached.expiresAt > Date.now()) return cached.record;

      await ready();
      const record = await adapter.findMcpKeyByHash(hash);
      if (!record) {
        cache.delete(hash);
        return null;
      }
      cache.set(hash, { record, expiresAt: Date.now() + KEY_CACHE_TTL_MS });

      // Best-effort recency for the UI. A failure here must not deny a valid
      // key, and the write is skipped while the cache is warm anyway, so this
      // costs at most one update per key per TTL.
      void adapter.touchMcpKey(record.id, Date.now()).catch(() => {});
      return record;
    },

    async list() {
      await ready();
      return adapter.listMcpKeys();
    },

    async create(name) {
      await ready();
      const token = generateMcpKey();
      const record: McpKeyRecord = {
        id: crypto.randomUUID(),
        name,
        keyPrefix: mcpKeyPrefix(token),
        createdAt: Date.now(),
        lastUsedAt: null,
      };
      await adapter.insertMcpKey({ ...record, keyHash: hashMcpKey(token) });
      return { record, token };
    },

    async revoke(id) {
      await ready();
      const deleted = await adapter.deleteMcpKey(id);
      // Drop the cached entry so a revoked key stops working immediately on this
      // instance rather than lingering for the rest of its TTL. Other instances
      // still honour it until their own TTL lapses.
      for (const [hash, entry] of cache) {
        if (entry.record.id === id) cache.delete(hash);
      }
      return deleted;
    },
  };
}
