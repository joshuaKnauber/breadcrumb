# @breadcrumb-sh/ui

**Private. Not published to npm.**

The Breadcrumb dashboard SPA. Vite builds it to a single self-contained HTML
file, which is then baked into `@breadcrumb-sh/core` as a TypeScript module.
`core` serves it with an injected `<base href>`, so it works at any mount path
and in every bundler, reading nothing from `node_modules` at runtime.

## Scripts

```bash
npm run dev        # Vite dev server for iterating on the dashboard
npm run build      # vite build → bake the HTML into core
npm run typecheck
```

`build` runs `scripts/emit-assets.mjs`, which writes the built HTML to
`../core/src/ui/app-html.gen.ts` (a generated file, do not edit by hand). The
root `npm run build` builds this package before `core` for that reason.

## Contributing note

Because the built UI is a build artifact baked into `core`, not a package
dependency, changesets cannot see the link. When you change the dashboard, add
the changeset to **`@breadcrumb-sh/core`** so the published package version
reflects the change. This package is in the changesets `ignore` list and is
never versioned or published on its own.
