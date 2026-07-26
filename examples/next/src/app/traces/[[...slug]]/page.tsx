import { BreadcrumbDashboard } from "@breadcrumb-sh/react";
import { parseRoute } from "@breadcrumb-sh/react/routing";
import { Evals } from "./Evals";

const PAGES = [{ name: "evals", label: "Evals", element: <Evals /> }];

/**
 * The dashboard half of the mount. An optional catch-all so every route inside
 * the dashboard survives a refresh or a shared link; `basePath` is what turns
 * that address-bar sync on.
 *
 * `initialRoute` is optional — without it a deep link renders the session list
 * for one frame before hydration corrects it.
 */
export default async function TracesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  );

  return (
    <div style={{ height: "100dvh" }}>
      <BreadcrumbDashboard
        api="/api/breadcrumb"
        basePath="/traces"
        initialRoute={parseRoute(`/${(slug ?? []).join("/")}`, query.toString(), ["evals"])}
        pages={PAGES}
      />
    </div>
  );
}
