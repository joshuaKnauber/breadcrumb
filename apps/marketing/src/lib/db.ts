import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;
let _ready = false;

export async function getDb() {
  if (!_sql) {
    const url = import.meta.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = postgres(url, { max: 5 });
  }

  if (!_ready) {
    await _sql`
      CREATE TABLE IF NOT EXISTS waitlist (
        id         SERIAL PRIMARY KEY,
        email      TEXT NOT NULL UNIQUE,
        deploy     TEXT,
        scale      TEXT,
        comments   TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    _ready = true;
  }

  return _sql;
}
