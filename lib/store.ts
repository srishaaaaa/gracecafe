import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, type Db, type Tx } from "./db";
import { meta } from "./db/schema";
import { notifyChanged } from "./realtime";

/* Postgres (Supabase) storage.
   - reads go straight to the pooled connection
   - every write runs in one transaction that first locks the meta row,
     so writes are serialized exactly as the old in-process queue did — stock,
     coupon usage and order numbers can't race — and rolls back whole if a
     validation error is thrown
   - `meta.version` bumps on every write; the admin panel checks it as a fallback to the live signal */

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Read-only access. Do not write through it. */
export function read<T>(fn: (q: Db) => Promise<T>): Promise<T> {
  return fn(db);
}

/** Serialized, all-or-nothing write. */
export async function mutate<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const out = await db.transaction(async (tx) => {
    /* Bumping the version first takes a row lock on meta, which is what serializes
       writers: a second write waits here until the first commits. One statement
       instead of a separate lock query — every round trip to the database counts. */
    await tx.update(meta).set({ version: sql`${meta.version} + 1` }).where(eq(meta.id, 1));
    const out = await fn(tx);
    return out;
  });
  /* Nudge open screens once the write has committed, after the response is sent. */
  after(notifyChanged);
  return out;
}

export async function currentVersion(): Promise<number> {
  const [m] = await db.select({ v: meta.version }).from(meta).where(eq(meta.id, 1));
  return m?.v ?? 0;
}
