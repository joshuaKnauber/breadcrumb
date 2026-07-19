/**
 * Placeholder UI until the real SPA package exists. Server-rendered shell with
 * <base href> (the Bull Board pattern): all asset/API URLs resolve relative to
 * the mount point, so the same page works at any basePath and in `dev`.
 */
export function renderAppHtml(basePath: string): string {
  const base = basePath.endsWith("/") ? basePath : basePath + "/";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${base}" />
<title>breadcrumb</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d0f12; color: #d7dae0; padding: 2rem; }
  h1 { font-size: 1rem; margin-bottom: 1.5rem; color: #f3b661; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #22262c; }
  th { color: #8b919c; font-weight: 500; }
  tr[data-trace] { cursor: pointer; }
  tr[data-trace]:hover { background: #15181d; }
  .err { color: #e0655f; }
  .muted { color: #6b7280; }
  #detail { margin-top: 2rem; }
  .span-row { padding: 0.35rem 0.75rem; border-left: 2px solid #22262c; margin: 2px 0; }
  .span-row .k { color: #8b919c; margin-right: 0.5rem; }
  pre { background: #15181d; padding: 0.75rem; margin: 0.5rem 0 1rem; overflow-x: auto; border-radius: 4px; }
</style>
</head>
<body>
<h1>breadcrumb</h1>
<div id="traces">loading…</div>
<div id="detail"></div>
<script>
const fmtTime = (ms) => ms == null ? "–" : new Date(ms).toLocaleString();
const fmtDur = (a, b) => (a == null || b == null) ? "–" : (b - a) + "ms";

async function loadTraces() {
  const res = await fetch("api/traces");
  const { traces } = await res.json();
  const el = document.getElementById("traces");
  if (!traces.length) { el.innerHTML = '<p class="muted">No traces yet.</p>'; return; }
  el.innerHTML = '<table><tr><th>name</th><th>env</th><th>start</th><th>duration</th><th>spans</th><th>tokens</th><th>cost</th></tr>' +
    traces.map(t => \`<tr data-trace="\${t.traceId}">
      <td>\${t.errorCount > 0 ? '<span class="err">●</span> ' : ''}\${t.name}</td>
      <td class="muted">\${t.environment}</td>
      <td class="muted">\${fmtTime(t.startTime)}</td>
      <td>\${fmtDur(t.startTime, t.endTime)}</td>
      <td>\${t.spanCount}</td>
      <td>\${t.inputTokens + t.outputTokens || "–"}</td>
      <td>\${t.cost != null ? "$" + t.cost.toFixed(4) : "–"}</td>
    </tr>\`).join("") + '</table>';
  el.querySelectorAll("tr[data-trace]").forEach(tr =>
    tr.addEventListener("click", () => loadTrace(tr.dataset.trace)));
}

async function loadTrace(id) {
  const res = await fetch("api/traces/" + id);
  const { spans } = await res.json();
  const depth = {};
  spans.forEach(s => { depth[s.id] = s.parentSpanId ? (depth[s.parentSpanId] ?? 0) + 1 : 0; });
  document.getElementById("detail").innerHTML = "<h1>trace</h1>" + spans.map(s => \`
    <div class="span-row" style="margin-left:\${depth[s.id] * 1.5}rem">
      <span class="k">\${s.kind}</span>\${s.status === "error" ? '<span class="err">✗</span> ' : ""}\${s.name}
      <span class="muted">\${fmtDur(s.startTime, s.endTime)}\${s.model ? " · " + s.model : ""}</span>
      \${s.input != null ? "<pre>" + JSON.stringify(s.input, null, 2) + "</pre>" : ""}
      \${s.output != null ? "<pre>" + JSON.stringify(s.output, null, 2) + "</pre>" : ""}
      \${s.error ? '<pre class="err">' + s.error + "</pre>" : ""}
    </div>\`).join("");
}

loadTraces();
setInterval(loadTraces, 5000);
</script>
</body>
</html>`;
}
