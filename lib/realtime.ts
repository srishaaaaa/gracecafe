import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* Live "something changed" signal over Supabase Realtime broadcast.

   The channel carries no data — just a nudge. The server sends it after every
   write; browsers respond by re-fetching through the normal API, so all access
   control stays in the route handlers. Both ends are optional: without the
   NEXT_PUBLIC_SUPABASE_* variables the app simply falls back to its slow poll. */

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TOPIC = "shop";
const EVENT = "changed";

/** Browser: calls `onChange` whenever the server reports a write. Returns an unsubscribe. */
export function subscribeChanges(onChange: () => void): () => void {
  if (!URL_ || !KEY) return () => {};
  const client: SupabaseClient = createClient(URL_, KEY, { realtime: { params: { eventsPerSecond: 5 } } });
  const ch = client.channel(TOPIC).on("broadcast", { event: EVENT }, onChange).subscribe();
  return () => {
    client.removeChannel(ch);
    client.realtime.disconnect();
  };
}

/** Server: nudges every open screen. Never throws — a missed nudge only means the slow poll catches up. */
export async function notifyChanged() {
  if (!URL_ || !KEY) return;
  try {
    await fetch(`${URL_}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: TOPIC, event: EVENT, payload: {}, private: false }] }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {}
}
