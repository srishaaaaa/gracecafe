"use client";

import { useMemo } from "react";
import type { Order } from "@/lib/types";
import { useAdmin } from "./Store";
import { Btn, Empty, Icon, Page, PageHead, ago, cx, fmtTime } from "./kit";

/* ---------------- live queue ---------------- */
/* A ticket left this long without moving gets flagged, so a guest who has been
   waiting stands out on a glance across the counter. */
const WAIT_WARN = 10 * 60 * 1000;

function Ticket({ o, now, onMove }: { o: Order; now: number; onMove: (next: Order["status"]) => void }) {
  const isNew = o.status === "new";
  const late = now - o.createdAt > WAIT_WARN;
  return (
    <article className={cx("adm-in flex flex-col rounded-2xl border bg-white p-4 shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)]", isNew ? "border-red-200" : "border-amber-200")}>
      <header className="flex items-start gap-3">
        <span className={cx("adm-num grid h-11 min-w-11 shrink-0 place-items-center rounded-xl px-2 text-[15px] font-extrabold", isNew ? "bg-red-600 text-white" : "bg-amber-100 text-amber-900")}>#{o.no}</span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[16px] font-extrabold leading-tight text-slate-900">{o.customerName || "Guest"}</b>
          <span className="adm-num block truncate text-[12px] text-slate-500">{o.customerPhone}</span>
        </div>
        <span
          className={cx("adm-num shrink-0 rounded-md px-2 py-1 text-[11px] font-bold", late ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")}
          title={`Placed at ${fmtTime(o.createdAt)}`}
        >
          {ago(o.createdAt, now)}
        </span>
      </header>

      <ul className="my-3 space-y-1.5 border-y border-dashed border-slate-200 py-3 text-[13.5px]">
        {o.items.map((i, k) => (
          <li key={k} className="flex gap-2">
            <b className="adm-num w-8 shrink-0 text-slate-900">{i.qty}×</b>
            <span className="min-w-0 flex-1 text-slate-700">{i.name}</span>
          </li>
        ))}
      </ul>

      {o.note && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900">“{o.note}”</p>}

      <div className="mt-auto flex gap-2">
        {isNew ? (
          <Btn size="lg" kind="dark" className="flex-1" onClick={() => onMove("preparing")}>
            Accept
          </Btn>
        ) : (
          <Btn size="lg" kind="green" className="flex-1" onClick={() => onMove("served")}>
            Served
          </Btn>
        )}
        <Btn size="lg" kind="plain" className="text-red-600" onClick={() => onMove("cancelled")} aria-label={`Cancel order ${o.no}`}>
          <Icon name="x" size={16} />
        </Btn>
      </div>
    </article>
  );
}

export default function QueuePage() {
  const { s, act, confirm, now } = useAdmin();

  /* Only what the guests' own phones sent, oldest first — the kitchen works the
     top of the list down. Orders the counter puts in are already in hand, so
     they live on the Order Management page instead. */
  const queue = useMemo(
    () => s.orders.filter((o) => o.source === "customer" && (o.status === "new" || o.status === "preparing")).sort((a, b) => a.createdAt - b.createdAt),
    [s.orders],
  );

  const move = async (o: Order, next: Order["status"]) => {
    if (next === "cancelled" && !(await confirm({ title: `Cancel order #${o.no}?`, body: "Its items go back into stock and drop off the tab's bill.", ok: "Cancel order", danger: true }))) return;
    act("order.status", { id: o.id, status: next });
  };

  return (
    <Page>
      <PageHead
        title="Live queue"
        bar
        sub={
          <>
            Everything guests have sent in, oldest first. The board keeps itself up to date — leave it open on the counter screen.
          </>
        }
      />

      {!queue.length ? (
        <Empty icon="check" title="All caught up">
          Nothing waiting and nothing on the pass. An order appears here the moment a guest sends one.
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {(["new", "preparing"] as const).map((col) => {
            const list = queue.filter((o) => o.status === col);
            return (
              <section key={col}>
                <h2 className="mb-3 flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  <span className={cx("h-2 w-2 rounded-full", col === "new" ? "bg-red-600" : "bg-amber-400")} />
                  {col === "new" ? "Waiting to be accepted" : "In the kitchen"}
                  <span className="adm-num text-slate-400">{list.length}</span>
                </h2>
                {list.length ? (
                  <div className="grid gap-3">
                    {list.map((o) => (
                      <Ticket key={o.id} o={o} now={now} onMove={(next) => move(o, next)} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-[13px] text-slate-400">
                    {col === "new" ? "No new orders waiting." : "Nothing being prepared."}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Page>
  );
}
