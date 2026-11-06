import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/* One small pool per server instance, against Supabase's *transaction pooler*
   (host "...pooler.supabase.com", port 6543). Keep the pool small (the admin page runs ~16 queries at once, so 10): every serverless
   instance opens its own, and the pooler is what multiplexes them. It is parked on
   globalThis so a dev hot-reload doesn't open a new one each time. */

const g = globalThis as typeof globalThis & { __clcDb?: ReturnType<typeof make> };

function make() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add your Supabase connection string to .env.local (and to Vercel).");
  // Supabase's certificate chain isn't in Node's default CA store, so the
  // connection is encrypted but not chain-verified (the usual setting for it).
  const pool = new Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/, "").replace(/[?&]channel_binding=[^&]*/, ""), ssl: { rejectUnauthorized: false }, max: 10 });
  return drizzle(pool, { schema });
}

export const db = new Proxy({} as ReturnType<typeof make>, {
  get: (_t, k) => Reflect.get((g.__clcDb ??= make()), k),
});

export type Db = ReturnType<typeof make>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
