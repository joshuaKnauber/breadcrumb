export interface DocsItem {
	label: string;
	href: string;
	/** Nested child pages, shown indented under this item. */
	items?: DocsItem[];
}

export interface DocsGroup {
	group: string;
	items: DocsItem[];
}

// Single source of truth for the docs sidebar.
export const docsNav: DocsGroup[] = [
	{
		group: "Get started",
		items: [
			{ label: "Introduction", href: "/docs/" },
			{ label: "Quickstart", href: "/docs/quickstart/" },
		],
	},
	{
		group: "Setup",
		items: [
			{
				label: "Frameworks",
				href: "/docs/frameworks/",
				items: [
					{ label: "Next.js", href: "/docs/frameworks/nextjs/" },
					{ label: "Hono", href: "/docs/frameworks/hono/" },
					{ label: "Node & Express", href: "/docs/frameworks/node/" },
					{ label: "Other frameworks", href: "/docs/frameworks/other/" },
				],
			},
			{ label: "Database & adapters", href: "/docs/database/" },
			{ label: "Migrations", href: "/docs/migrations/" },
			{ label: "Local development", href: "/docs/local-development/" },
			{ label: "Production", href: "/docs/production/" },
		],
	},
	{
		group: "Tracing",
		items: [
			{
				label: "Instrumenting",
				href: "/docs/instrumenting/",
				items: [
					{ label: "Vercel AI SDK", href: "/docs/instrumenting/ai-sdk/" },
					{ label: "Manual tracing", href: "/docs/instrumenting/manual/" },
					{ label: "OpenTelemetry", href: "/docs/instrumenting/opentelemetry/" },
				],
			},
			{ label: "Cost & tokens", href: "/docs/cost/" },
		],
	},
	{
		group: "Build your own UI",
		items: [
			{ label: "Querying your data", href: "/docs/querying/" },
			{ label: "React & client", href: "/docs/react/" },
		],
	},
	{
		group: "Reference",
		items: [{ label: "Configuration", href: "/docs/configuration/" }],
	},
];
