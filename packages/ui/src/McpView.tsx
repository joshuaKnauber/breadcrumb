import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { Check, Copy } from "@phosphor-icons/react";
import { api } from "./api.js";
import type { McpKeyRecord } from "./types.js";
import { Loading, Skeleton } from "./ui/Skeleton.js";

const GRID = "grid-cols-[minmax(0,1fr)_150px_96px_96px_78px]";

// Served with an injected <base href>, so the endpoint resolves the same way the
// API client's relative URLs do, but agents need it absolute.
const endpoint = new URL("api/mcp", document.baseURI).toString();

// The name comes from the server rather than being derived here, so a
// configured `mcp.name` and the loopback default both reach the snippets and
// can never disagree with what the server reports to the client.
function snippets(token: string, serverName: string): { title: string; code: string }[] {
  return [
    {
      title: "Claude Code",
      code: `claude mcp add --transport http ${serverName} ${endpoint} --header "Authorization: Bearer ${token}"`,
    },
    {
      title: "Codex",
      code: `codex mcp add ${serverName} --url ${endpoint} --header "Authorization: Bearer ${token}"`,
    },
    {
      title: "Other clients",
      code: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              type: "http",
              url: endpoint,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
        null,
        2
      ),
    },
  ];
}

export function McpView() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  // Only the just-created key can expand: the token exists in memory for this
  // one render pass and is unrecoverable once dismissed.
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);

  const keys = useQuery({ queryKey: ["mcp-keys"], queryFn: api.mcpKeys });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["mcp-keys"] });

  const create = useMutation({
    mutationFn: (n: string) => api.createMcpKey(n),
    onSuccess: (res) => {
      setFresh({ id: res.key.id, token: res.token });
      setName("");
      void invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeMcpKey(id),
    onSuccess: (_res, id) => {
      setFresh((f) => (f?.id === id ? null : f));
      void invalidate();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && !create.isPending) create.mutate(trimmed);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[12px] text-faint">MCP endpoint</span>
        <span className="truncate font-mono text-[11.5px] text-muted">{endpoint}</span>
        <CopyButton value={endpoint} label="Copy endpoint" className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-16">
        <div className="max-w-[760px]">
          <form onSubmit={submit} className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name, e.g. laptop"
              aria-label="Key name"
              maxLength={255}
              className="min-w-[180px] flex-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12.5px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
            />
            <button
              type="submit"
              disabled={!name.trim() || create.isPending}
              className="rounded-md border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium text-fg hover:border-line-strong disabled:opacity-50"
            >
              {create.isPending ? "Creating" : "Create key"}
            </button>
          </form>

          {create.isError && <Problem>Could not create the key. Try again.</Problem>}
          {revoke.isError && <Problem>Could not revoke the key. Try again.</Problem>}

          {keys.isLoading && <KeysSkeleton />}
          {keys.data?.keys.length === 0 && (
            <div className="rounded-md border border-line bg-panel px-4 py-8 text-center text-faint">
              No keys yet. Create one to connect an agent.
            </div>
          )}
          {keys.data && keys.data.keys.length > 0 && (
            <div className="overflow-hidden rounded-md border border-line bg-panel">
              <div
                className={`grid ${GRID} items-center gap-3 border-b border-line px-3 py-1.5 font-mono text-[9.5px] tracking-[0.12em] text-faint uppercase`}
              >
                <span>Name</span>
                <span>Key</span>
                <span className="text-right">Created</span>
                <span className="text-right">Last used</span>
                <span />
              </div>
              {keys.data.keys.map((k) => (
                <KeyRow
                  key={k.id}
                  record={k}
                  token={fresh?.id === k.id ? fresh.token : null}
                  serverName={keys.data.serverName}
                  onDismiss={() => setFresh(null)}
                  pending={revoke.isPending && revoke.variables === k.id}
                  onRevoke={() => revoke.mutate(k.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-r-[5px] border-l-2 border-err bg-err/10 px-3 py-2 text-[12.5px] text-fg">
      {children}
    </div>
  );
}

function KeyRow({
  record,
  token,
  serverName,
  onDismiss,
  pending,
  onRevoke,
}: {
  record: McpKeyRecord;
  token: string | null;
  serverName: string;
  onDismiss: () => void;
  pending: boolean;
  onRevoke: () => void;
}) {
  return (
    <div className={token ? "border-b border-line last:border-b-0 bg-raised" : ""}>
      <div className={`grid ${GRID} items-center gap-3 px-3 py-2`}>
        <span className="truncate text-[12.5px] font-medium">{record.name}</span>
        <span className="truncate font-mono text-[11.5px] text-faint">{record.keyPrefix}…</span>
        <span className="text-right font-mono text-[11.5px] text-muted tabular-nums">
          {ago(record.createdAt)}
        </span>
        <span className="text-right font-mono text-[11.5px] text-muted tabular-nums">
          {record.lastUsedAt == null ? "never" : ago(record.lastUsedAt)}
        </span>
        <RevokeButton name={record.name} pending={pending} onConfirm={onRevoke} />
      </div>
      {token && <Connect token={token} serverName={serverName} onDismiss={onDismiss} />}
    </div>
  );
}

// Shown inline under the row that was just created, because this is the only
// moment the full key exists. Collapsing it discards the token for good.
function Connect({
  token,
  serverName,
  onDismiss,
}: {
  token: string;
  serverName: string;
  onDismiss: () => void;
}) {
  return (
    <div className="border-t border-line px-3 pt-3 pb-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold">Copy this key now</span>
        <span className="text-[12px] text-muted">It will not be shown again.</span>
        <button onClick={onDismiss} className="ml-auto text-[11.5px] text-faint hover:text-fg">
          Done
        </button>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-panel px-3 py-2 font-mono text-[12px] whitespace-nowrap text-fg">
          {token}
        </code>
        <CopyButton value={token} label="Copy key" />
      </div>
      {snippets(token, serverName).map((s) => (
        <Snippet key={s.title} title={s.title} code={s.code} />
      ))}
    </div>
  );
}

function RevokeButton({
  name,
  pending,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={pending}
        className="text-right text-[11.5px] text-faint hover:text-fg disabled:opacity-50"
      >
        {pending ? "Revoking" : "Revoke"}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup className="w-[248px] rounded-md border border-line bg-panel p-3 shadow-lg">
            <Popover.Description className="mb-3 text-[12.5px] text-muted">
              Revoke <span className="font-medium text-fg">{name}</span>? Any agent using it loses
              access immediately.
            </Popover.Description>
            <div className="flex items-center justify-end gap-2">
              <Popover.Close className="rounded-md px-2 py-1 text-[11.5px] text-faint hover:text-fg">
                Cancel
              </Popover.Close>
              <Popover.Close
                onClick={onConfirm}
                className="rounded-md border border-line bg-raised px-2.5 py-1 text-[11.5px] font-medium text-fg hover:border-line-strong"
              >
                Revoke
              </Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[10.5px] tracking-wider text-faint uppercase">{title}</span>
        <CopyButton value={code} label={`Copy ${title} snippet`} className="ml-auto" />
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-panel px-3 py-2.5 font-mono text-[11.5px] whitespace-pre text-muted">
        {code}
      </div>
    </div>
  );
}

function CopyButton({
  value,
  label,
  className = "",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = () => {
    navigator.clipboard.writeText(value).then(
      () => setState("copied"),
      () => setState("failed")
    );
    window.setTimeout(() => setState("idle"), 1500);
  };

  return (
    <button
      onClick={copy}
      aria-label={label}
      className={`flex flex-none items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-muted hover:border-line-strong hover:text-fg ${className}`}
    >
      {state === "copied" ? <Check size={12} weight="bold" /> : <Copy size={12} />}
      {state === "failed" ? "Copy failed" : state === "copied" ? "Copied" : "Copy"}
    </button>
  );
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

function KeysSkeleton() {
  return (
    <Loading label="Loading keys">
      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <div className={`grid ${GRID} items-center gap-3 border-b border-line px-3 py-1.5`}>
          <Skeleton w={38} h={8} />
          <Skeleton w={28} h={8} />
          <Skeleton w={44} h={8} className="ml-auto" />
          <Skeleton w={48} h={8} className="ml-auto" />
          <span />
        </div>
        {[118, 92].map((w, i) => (
          <div key={i} className={`grid ${GRID} items-center gap-3 px-3 py-2`}>
            <Skeleton w={w} h={12} />
            <Skeleton w={96} h={11} />
            <Skeleton w={40} h={11} className="ml-auto" />
            <Skeleton w={36} h={11} className="ml-auto" />
            <Skeleton w={44} h={11} className="ml-auto" />
          </div>
        ))}
      </div>
    </Loading>
  );
}
