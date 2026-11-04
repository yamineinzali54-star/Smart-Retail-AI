import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Server-only DB client (postgres.js over TCP).
//
// NOTE: this module deliberately does NOT import "server-only" so it stays
// usable from scripts (db/seed.ts) and workers. Client-leak protection lives
// one layer up: lib/* modules that wrap this client MUST start with
// `import "server-only"`, and DATABASE_URL itself is never NEXT_PUBLIC_-
// prefixed. Never import this module from a client component.
//
// Driver choice: neon-http LOOKS attractive but explicitly throws
// ("No transactions support in neon-http driver") — and this codebase
// transacts everywhere (checkout, GRN, sessions, GL posting). postgres.js
// gives real transactions. `prepare: false` is REQUIRED because DATABASE_URL
// points at the Neon pooler (PgBouncer transaction mode has no prepared
// statements). `idle_timeout` lets scripts/tests exit without an explicit
// close while the server simply reconnects after idle.

// Server-only DB client (postgres.js). Import exclusively from server
// components, route handlers, server actions, and scripts — never from
// client components. Full table definitions land in ./schema.ts;
// seed in ./seed.ts.
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it.",
    );
  }
  return url;
}

const globalForDb = globalThis as unknown as {
  __sraiDbClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__sraiDbClient ??
  postgres(getDatabaseUrl(), {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sraiDbClient = client;
}

export const db = drizzle(client);
