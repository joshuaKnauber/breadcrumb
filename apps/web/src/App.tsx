import { trpc } from "./lib/trpc";

export function App() {
  const health = trpc.health.useQuery();

  return (
    <div>
      <h1>Breadcrumb</h1>
      <p>Server: {health.data?.status ?? "connecting..."}</p>
    </div>
  );
}
