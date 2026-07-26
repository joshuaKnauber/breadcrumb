import type { DatabaseAdapter, RetentionRule } from "./db/types.js";

export interface RetentionOptions {
  /** Window for environments without an explicit entry. Default: "90d". */
  default?: string;
  /** Per-environment overrides, e.g. { development: "7d" }. */
  environments?: Record<string, string>;
  /** "auto" (default): bounded sweeps piggyback on ingest. "manual": only bc.api.runRetention(). */
  sweep?: "auto" | "manual";
}

const UNITS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value: string): number {
  const match = value.match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new Error(`[breadcrumb] invalid retention duration "${value}" — use e.g. "30m", "12h", "90d"`);
  }
  return Number(match[1]) * UNITS[match[2]!]!;
}

const SWEEP_INTERVAL_MS = 15 * 60_000;
const SWEEP_BATCH_LIMIT = 5_000;

export interface Sweeper {
  /** Cheap check called after ingest writes; runs a bounded sweep at most every 15min. */
  maybeSweep(): Promise<void>;
  /** One bounded retention batch; returns rows deleted. */
  run(): Promise<number>;
}

export function createSweeper(
  adapter: DatabaseAdapter,
  options: RetentionOptions | undefined
): Sweeper {
  const defaultMs = parseDuration(options?.default ?? "90d");
  const envMs = Object.fromEntries(
    Object.entries(options?.environments ?? { development: "7d" }).map(([env, d]) => [
      env,
      parseDuration(d),
    ])
  );
  const auto = (options?.sweep ?? "auto") === "auto";

  let lastSweep = 0;
  let sweeping = false;

  function rules(now: number): RetentionRule[] {
    return [
      ...Object.entries(envMs).map(([environment, ms]) => ({ environment, before: now - ms })),
      { environment: null, before: now - defaultMs },
    ];
  }

  async function run(): Promise<number> {
    return adapter.deleteExpiredSpans(rules(Date.now()), SWEEP_BATCH_LIMIT);
  }

  return {
    run,
    async maybeSweep() {
      if (!auto || sweeping) return;
      const now = Date.now();
      // Cheap in-process pre-check, then a DB-backed atomic claim so only one
      // instance sweeps per interval across the whole deployment.
      if (now - lastSweep < SWEEP_INTERVAL_MS) return;
      lastSweep = now;
      sweeping = true;
      try {
        if (await adapter.claimSweep(now, SWEEP_INTERVAL_MS)) await run();
      } catch (error) {
        console.error("[breadcrumb] retention sweep failed:", error);
      } finally {
        sweeping = false;
      }
    },
  };
}
