export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
  },
  traces: {
    all: ["traces"] as const,
    list: (filters?: Record<string, unknown>) =>
      ["traces", "list", filters] as const,
    detail: (id: string) => ["traces", "detail", id] as const,
  },
} as const;
