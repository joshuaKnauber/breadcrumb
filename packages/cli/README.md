# @breadcrumb-sh/cli

CLI for [Breadcrumb](https://breadcrumb.sh): a standalone local dev server and
database migrations. Installs the `breadcrumb` command.

```bash
npm i -D @breadcrumb-sh/cli
# or run without installing:
npx breadcrumb <command>
```

## Commands

### `breadcrumb dev`

Boots a standalone local tracing server backed by SQLite, with the dashboard and
ingest endpoint. Unauthenticated by design, for local use only.

```bash
breadcrumb dev [--port 4106] [--db .breadcrumb/dev.db]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--port` | `4106` | Port to listen on. |
| `--db` | `.breadcrumb/dev.db` | SQLite file (created if missing). |

Point external services at the ingest endpoint with the dev API key `dev`:

```
▸ breadcrumb dev server → http://localhost:4106
▸ ingest (key: "dev")   → http://localhost:4106/api/ingest/spans
▸ storage               → .breadcrumb/dev.db
```

### `breadcrumb migrate`

Applies the Breadcrumb schema directly to your database, creating tables and
adding any missing columns.

```bash
breadcrumb migrate [--database <url|path>]
```

The target comes from `--database`, or `$DATABASE_URL` if omitted. A
`postgres://` or `postgresql://` URL uses the Postgres adapter; anything else is
treated as a SQLite file path.

```bash
breadcrumb migrate --database postgres://user:pass@localhost:5432/app
breadcrumb migrate --database ./prod.db
DATABASE_URL=postgres://… breadcrumb migrate
```

### `breadcrumb generate`

Writes a reviewable `.sql` migration file instead of touching your database.
Commit it and apply it with your own tooling.

```bash
breadcrumb generate [--database <url|path>] [--dialect postgres|sqlite] \
                    [--out <dir>] [--name <name>]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--database` | `$DATABASE_URL` | Diff against a live database, emitting only the delta. |
| `--dialect` | none | Emit a fresh full schema when no database is given (`postgres` or `sqlite`). |
| `--out` | `./breadcrumb/migrations` | Output directory. |
| `--name` | `breadcrumb` | Filename suffix. |

Pass either `--database` (to diff a live DB) or `--dialect` (for a fresh
schema). Files are named `<timestamp>_<name>.sql`.

```bash
# Fresh schema for a new Postgres database
breadcrumb generate --dialect postgres

# Delta against a live database, custom name and dir
breadcrumb generate --database $DATABASE_URL --name init --out ./db/migrations
```

## License

MIT
