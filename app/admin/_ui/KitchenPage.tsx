"use client";

import { useMemo, useState } from "react";
import type { Order, OrderStatus } from "@/lib/types";
import { rupee } from "@/lib/money";
import { useAdmin, whoIs } from "./Store";
import { Badge, Btn, Empty, Icon, Page, PageHead, cx, fmtTime } from "./kit";

const minsSince = (t: number, now: number) => Math.max(0, Math.round((now - t) / 60000));

const COLS: { key: OrderStatus; title: string; next: OrderStatus; cta: string; tone: "amber" | "sky" | "green" }[] = [
  { key: "new", title: "New", next: "preparing", cta: "Start cooking", tone: "amber" },
  { key: "preparing", title: "Preparing", next: "served", cta: "Mark served", tone: "sky" },
  { key: "served", title: "Served", next: "served", cta: "", tone: "green" },
];

const CARD = "rounded-2xl border border-slate-100 bg-white p-3.5 shadow-[0_2px_10px_-4px_rgba(15,23,42,.1)] flex flex-col gap-2.5";
const COL = "rounded-[22px] bg-slate-50/70 p-3 min-w-0";

/* The on-screen Kitchen Order Ticket (KOT) queue. Admin can disable the whole
   feature from Settings — the server guard sends staff back to Billing and the
   nav link hides, so this page only renders when the toggle is on. */
export default function KitchenPage() {
  const { s, act, now, confirm } = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);

  const orders = useMemo(() => {
    /* Served tickets in the last 30 min stay visible as a "just-sent" tail;
       after that they fall off automatically. */
    const cutoff = now - 30 * 60_000;
    return s.orders
      .filter((o) => o.status === "new" || o.status === "preparing" || (o.status === "served" && o.updatedAt >= cutoff))
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [s.orders, now]);

  const grouped = useMemo(() => {
    const g: Record<OrderStatus, Order[]> = { new: [], preparing: [], served: [], cancelled: [] };
    for (const o of orders) g[o.status]?.push(o);
    return g;
  }, [orders]);

  const advance = async (o: Order, next: OrderStatus) => {
    if (next === "served" && o.items.length > 0) {
      const ok = await confirm({ title: `Mark ticket #${o.no} as served?`, body: `${whoIs(o)} · ${o.items.reduce((a, i) => a + i.qty, 0)} items`, ok: "Mark served" });
      if (!ok) return;
    }
    setBusy(o.id);
    await act("order.status", { id: o.id, status: next });
    setBusy(null);
  };

  const cancel = async (o: Order) => {
    if (!(await confirm({ title: `Cancel ticket #${o.no}?`, body: `Items go back into stock. ${whoIs(o)}'s tab stays open.`, ok: "Cancel ticket", danger: true }))) return;
    setBusy(o.id);
    await act("order.status", { id: o.id, status: "cancelled" });
    setBusy(null);
  };

  return (
    <Page>
      <PageHead
        title="Kitchen Queue"
        sub="Every open ticket on one screen — slide a card right as it moves through the kitchen."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {COLS.map((col) => {
          const list = grouped[col.key];
          return (
            <section key={col.key} className={COL}>
              <header className="mb-3 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-slate-700">
                  {col.title}
                  <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-black text-slate-700">{list.length}</span>
                </h2>
                {col.key === "new" && list.length > 0 && <Badge tone="amber">Needs attention</Badge>}
              </header>
              {list.length === 0 ? (
                <Empty icon={col.key === "new" ? "bell" : col.key === "preparing" ? "utensils" : "check"} title={col.key === "new" ? "No new tickets" : col.key === "preparing" ? "Nothing cooking" : "No served tickets yet"} />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {list.map((o) => {
                    const mins = minsSince(o.createdAt, now);
                    const items = o.items.reduce((a, i) => a + i.qty, 0);
                    const hot = col.key !== "served" && mins >= 15;
                    return (
                      <li key={o.id} className={cx(CARD, hot && "border-red-200 ring-1 ring-red-100")}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <b className="block truncate text-[14px] text-slate-900">#{o.no} · {whoIs(o)}</b>
                            <p className="truncate text-[11.5px] text-slate-500">
                              {o.source === "customer" ? "Self-ordered" : "Counter"} · {fmtTime(o.createdAt)}
                            </p>
                          </div>
                          <span className={cx("adm-num shrink-0 rounded-full px-2 py-1 text-[11px] font-bold", hot ? "bg-red-50 text-red-600" : mins >= 7 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600")}>
                            {mins === 0 ? "just now" : `${mins}m`}
                          </span>
                        </div>
                        <ul className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
                          {o.items.map((i, k) => (
                            <li key={k} className="flex justify-between py-0.5">
                              <span className="truncate pr-2"><b className="adm-num text-slate-900">{i.qty}×</b> {i.name}</span>
                              <span className="adm-num shrink-0 text-slate-500">{rupee(i.price * i.qty)}</span>
                            </li>
                          ))}
                        </ul>
                        {o.note && <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-900"><b>Note:</b> {o.note}</p>}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11.5px] text-slate-500">{items} item{items === 1 ? "" : "s"} · {rupee(o.subtotal)}</span>
                          {col.key !== "served" ? (
                            <div className="flex gap-1.5">
                              <Btn size="sm" kind="ghost" onClick={() => cancel(o)} disabled={busy === o.id} aria-label="Cancel ticket">
                                <Icon name="x" size={14} />
                              </Btn>
                              <Btn size="sm" kind={col.key === "new" ? "dark" : "red"} onClick={() => advance(o, col.next)} disabled={busy === o.id}>
                                {col.cta}
                              </Btn>
                            </div>
                          ) : (
                            <Badge tone="green">Served</Badge>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Page>
  );
}
