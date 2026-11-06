"use client";

import { useMemo, useState } from "react";
import { rupee } from "@/lib/money";
import { pointsValue } from "@/lib/loyalty/engine";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Btn, Card, cx, downloadExcel, fmtDate, fmtDateTime } from "../kit";
import { MSG_LABEL } from "./notify";
import { EARN_TYPES, LEDGER_LABEL, Stat, USE_TYPES, within, type PeriodData } from "./shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

/** A plain overview of the loyalty programme: this month, the last six months of points, who the best customers are,
    the free gifts given, and what still needs doing (messages to send, points about to expire). */
export default function Dashboard({ d, pd, onOpen }: { d: LoyaltyState; pd: PeriodData; onOpen: (tab: "customers" | "rewards") => void }) {
  const { s } = useAdmin();
  const cfg = d.config;
  const range = pd.range;

  const x = useMemo(() => {
    const nameOf = new Map(d.customers.map((c) => [c.phone, c.name]));
    // free gifts from paid bills in the period
    const gifts: { at: number; invoice: string; item: string; qty: number; who: string }[] = [];
    const byItem = new Map<string, number>();
    const spendBy = new Map<string, number>();
    const idOf = new Map(d.customers.map((c) => [c.phone, c.id]));
    for (const b of s.bills) {
      if (b.status !== "completed" || !within(b.createdAt, range)) continue;
      const cid = idOf.get(b.customerPhone);
      if (cid) spendBy.set(cid, (spendBy.get(cid) ?? 0) + Math.max(0, b.subtotal - b.discount));
      for (const i of b.items) {
        if (!i.free) continue;
        gifts.push({ at: b.createdAt, invoice: b.invoiceNo, item: i.name, qty: i.qty, who: nameOf.get(b.customerPhone) ?? (b.customerName && b.customerName !== "Walk-in customer" ? b.customerName : "Walk-in") });
        byItem.set(i.name, (byItem.get(i.name) ?? 0) + i.qty);
      }
    }
    gifts.sort((a, b) => b.at - a.at);
    const periodGifts = gifts.reduce((a, g) => a + g.qty, 0);
    // points earned / redeemed in the period, in total and per customer
    const earnedBy = new Map<string, number>();
    let earned = 0;
    let redeemed = 0;
    for (const e of pd.ledger) {
      if (EARN_TYPES.includes(e.type)) {
        earned += e.points;
        earnedBy.set(e.customerId, (earnedBy.get(e.customerId) ?? 0) + e.points);
      } else if (USE_TYPES.includes(e.type)) redeemed += -e.points;
    }
    const byPoints = (range ? [...d.customers].sort((a, b) => (earnedBy.get(b.id) ?? 0) - (earnedBy.get(a.id) ?? 0)) : [...d.customers].sort((a, b) => b.available - a.available)).slice(0, 5).map((c) => ({ c, value: range ? `${earnedBy.get(c.id) ?? 0} pts earned` : `${c.available} pts` }));
    const bySpend = [...d.customers].sort((a, b) => (spendBy.get(b.id) ?? 0) - (spendBy.get(a.id) ?? 0)).slice(0, 5).map((c) => ({ c, value: spendBy.get(c.id) ?? 0 }));
    const months = (range ? d.months.filter((r) => within(new Date(`${r.month}-15T00:00:00`).getTime(), range) || within(new Date(`${r.month}-01T00:00:00`).getTime(), range)) : d.months).slice(-6);
    const newInPeriod = d.customers.filter((c) => within(c.createdAt, range)).length;
    const waiting = d.vouchers.filter((v) => v.status === "issued" && v.kind === "free_item").length;
    const inMsgs = d.messages.filter((r) => within(r.createdAt, range));
    const msg = { pending: inMsgs.filter((r) => r.status === "pending").length, opened: inMsgs.filter((r) => r.status === "opened").length, failed: inMsgs.filter((r) => r.status === "failed").length, list: inMsgs };
    const expiring = Object.entries(d.expiring).map(([id, v]) => ({ c: d.customers.find((c) => c.id === id), ...v })).filter((r) => r.c);
    return { gifts, byItem: [...byItem].sort((a, b) => b[1] - a[1]).slice(0, 5), periodGifts, byPoints, bySpend, months, earned, redeemed, newInPeriod, waiting, msg, expiring };
  }, [d, s.bills, pd.ledger, range]);

  const [busy, setBusy] = useState(false);
  const day = new Date().toISOString().slice(0, 10);
  const nameOf = (id: string) => d.customers.find((c) => c.id === id)?.name ?? "";

  /* one workbook with the whole picture: totals, months, customers, gifts given, messages */
  const exportAll = () =>
    downloadExcel(`loyalty-dashboard-${day}`, [
      {
        name: "Summary",
        rows: [
          ["Period", pd.label],
          ["Loyalty customers", d.customers.length],
          ["Points earned", x.earned],
          ["Points redeemed", x.redeemed],
          ["Available points", d.totals.outstanding],
          ["Value of available points (₹)", liability],
          ["Free gifts given", x.periodGifts],
          ["Unlocked gifts waiting", x.waiting],
          ["New customers", x.newInPeriod],
          ["WhatsApp messages ready to send", x.msg.pending],
          ["WhatsApp messages opened", x.msg.opened],
          ["WhatsApp messages failed", x.msg.failed],
        ],
      },
      { name: "Points by month", rows: [["Month", "Earned", "Redeemed"], ...x.months.map((r) => [r.month, r.earned, r.redeemed])] },
      { name: "Customers", rows: [["Customer", "Mobile", "Available points", "Points earned", "Points redeemed", "Total purchases (₹)"], ...d.customers.map((c) => [c.name, c.phone, c.available, c.lifetime, c.redeemed, d.spend[c.id] ?? 0])] },
      { name: "Free gifts given", rows: [["Date", "Bill", "Gift", "Quantity", "Given to"], ...x.gifts.map((g) => [fmtDate(g.at), g.invoice, g.item, g.qty, g.who])] },
      { name: "Points about to expire", rows: [["Customer", "Points", "Expire on"], ...x.expiring.map((r) => [r.c!.name, r.points, fmtDate(r.expiresAt)])] },
      { name: "WhatsApp messages", rows: [["When", "Customer", "Message", "Status", "Times opened", "Text"], ...x.msg.list.map((m) => [fmtDateTime(m.createdAt), nameOf(m.customerId), MSG_LABEL[m.type] ?? m.type, m.status === "opened" ? "Opened in WhatsApp" : m.status === "failed" ? "Failed" : "Ready to send", m.opens, m.text])] },
    ]);

  /* every points transaction of every customer */
  const exportLedger = async () => {
    setBusy(true);
    try {
      const rows = pd.ledger as unknown as { createdAt: number; customerId: string; type: string; balanceBefore: number; points: number; balanceAfter: number; invoiceNo: string | null; description: string; actor: string }[];
      downloadExcel(`points-transactions-${day}`, [{ name: "Points transactions", rows: [["Period", pd.label], ["When", "Customer", "Type", "Points before", "Change", "Points after", "Bill", "Note", "By"], ...rows.map((e) => [fmtDateTime(e.createdAt), nameOf(e.customerId), LEDGER_LABEL[e.type] ?? e.type, e.balanceBefore, e.points, e.balanceAfter, e.invoiceNo ?? "", e.description, e.actor])] }]);
    } finally {
      setBusy(false);
    }
  };

  const max = Math.max(...x.months.flatMap((r) => [r.earned, r.redeemed]), 1);
  const liability = pointsValue(d.totals.outstanding, cfg);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Btn icon="download" onClick={exportAll}>
          Excel · whole dashboard
        </Btn>
        <Btn icon="download" onClick={exportLedger} disabled={busy}>
          {busy ? "Preparing…" : "Excel · all points transactions"}
        </Btn>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New customers" value={x.newInPeriod} hint={pd.label} />
        <Stat label="Points earned" value={x.earned.toLocaleString("en-IN")} tone="green" hint={pd.label} />
        <Stat label="Points redeemed" value={x.redeemed.toLocaleString("en-IN")} tone="red" hint={pd.label} />
        <Stat label="Free gifts given" value={x.periodGifts} hint={`${pd.label} · ${x.waiting} unlocked, waiting`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title={range ? `Points by month · ${pd.label}` : "Points, last 6 months"}>
          {!x.months.length ? (
            <p className="py-8 text-center text-[13px] text-slate-400">Points will appear here after the first loyalty bill.</p>
          ) : (
            <>
              <div className="mb-3 flex gap-4 text-[11.5px] font-semibold text-slate-600">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-600" /> Earned
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> Redeemed
                </span>
              </div>
              <div className="flex items-end gap-2" style={{ height: 170 }} role="img" aria-label={x.months.map((r) => `${monthLabel(r.month)}: earned ${r.earned}, redeemed ${r.redeemed}`).join("; ")}>
                {x.months.map((r) => (
                  <div key={r.month} className="flex h-full flex-1 items-end justify-center gap-[3px]" title={`${monthLabel(r.month)} · earned ${r.earned} · redeemed ${r.redeemed}`}>
                    <div className="w-3 rounded-t-[3px] bg-red-600" style={{ height: `${(r.earned / max) * 90}%` }} />
                    <div className="w-3 rounded-t-[3px] bg-slate-400" style={{ height: `${(r.redeemed / max) * 90}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
                {x.months.map((r) => (
                  <span key={r.month} className="flex-1 text-center text-[10.5px] font-semibold uppercase text-slate-500">
                    {monthLabel(r.month)}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="What needs doing">
          <ul className="space-y-2.5 text-[13px]">
            <Todo n={x.msg.pending} ok="No WhatsApp messages waiting" text={`WhatsApp message${x.msg.pending === 1 ? "" : "s"} ready to send`} onClick={() => onOpen("customers")} />
            <Todo n={x.msg.failed} ok="No failed messages" text={`message${x.msg.failed === 1 ? "" : "s"} failed — fix the number and retry`} bad onClick={() => onOpen("customers")} />
            <Todo n={x.waiting} ok="No unlocked gifts waiting" text={`unlocked gift${x.waiting === 1 ? "" : "s"} not claimed yet`} onClick={() => onOpen("customers")} />
            <Todo n={x.expiring.length} ok="No points about to expire" text={`customer${x.expiring.length === 1 ? "" : "s"} with points about to expire`} onClick={() => onOpen("customers")} />
          </ul>
          <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] text-slate-600">
            Customers hold <b>{d.totals.outstanding.toLocaleString("en-IN")}</b> points, worth <b>{rupee(liability)}</b> if all were used. WhatsApp messages: {x.msg.opened} opened, {x.msg.pending} waiting.
          </p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={range ? "Most points earned" : "Top customers by points"}>
          <Ranked rows={x.byPoints.map(({ c, value }) => ({ key: c.id, name: c.name, sub: c.phone, value }))} />
        </Card>
        <Card title="Top customers by spending">
          <Ranked rows={x.bySpend.map(({ c, value }) => ({ key: c.id, name: c.name, sub: c.phone, value: rupee(value) }))} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Free gifts given" right={<button type="button" onClick={() => onOpen("rewards")} className="text-[12px] font-bold text-red-600 hover:underline">Manage gifts</button>}>
          {!x.gifts.length ? (
            <p className="py-6 text-center text-[13px] text-slate-400">No free gifts have been given yet.</p>
          ) : (
            <>
              <p className="mb-2 text-[12.5px] text-slate-600">
                <b>{x.periodGifts}</b> in total{x.byItem.length ? ` · most given: ${x.byItem.map(([n, q]) => `${n} (${q})`).join(", ")}` : ""}
              </p>
              <ul className="divide-y divide-slate-100">
                {x.gifts.slice(0, 6).map((g, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="min-w-0 truncate">
                      <b>
                        {g.qty} × {g.item}
                      </b>{" "}
                      <span className="text-slate-500">to {g.who}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-slate-500">
                      {g.invoice} · {fmtDate(g.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="Points about to expire">
          {!x.expiring.length ? (
            <p className="py-6 text-center text-[13px] text-slate-400">{cfg.expiry.days > 0 ? "Nobody has points expiring soon." : "Points never expire (you can change this in Settings)."}</p>
          ) : (
            <Ranked rows={x.expiring.map((r) => ({ key: r.c!.id, name: r.c!.name, sub: `expire ${fmtDate(r.expiresAt)}`, value: `${r.points} pts` }))} />
          )}
        </Card>
      </div>

      <Card title="Latest WhatsApp messages">
        {!x.msg.list.length ? (
          <p className="py-6 text-center text-[13px] text-slate-400">No messages yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {x.msg.list.slice(0, 6).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="min-w-0 truncate">
                  <b>{MSG_LABEL[m.type] ?? m.type}</b> <span className="text-slate-500">· {d.customers.find((c) => c.id === m.customerId)?.name ?? "customer"}</span>
                </span>
                <span className={cx("shrink-0 text-[11.5px] font-bold", m.status === "failed" ? "text-red-600" : m.status === "opened" ? "text-sky-700" : "text-amber-700")}>{m.status === "opened" ? "Opened in WhatsApp" : m.status === "failed" ? "Failed" : "Ready to send"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Todo({ n, ok, text, bad, onClick }: { n: number; ok: string; text: string; bad?: boolean; onClick: () => void }) {
  if (!n) return <li className="text-slate-400">✓ {ok}</li>;
  return (
    <li>
      <button type="button" onClick={onClick} className={cx("text-left font-semibold hover:underline", bad ? "text-red-600" : "text-amber-700")}>
        {n} {text}
      </button>
    </li>
  );
}

function Ranked({ rows }: { rows: { key: string; name: string; sub: string; value: string }[] }) {
  if (!rows.length) return <p className="py-6 text-center text-[13px] text-slate-400">Nobody yet.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
          <span className="min-w-0 truncate">
            <b className="mr-2 text-slate-400">{i + 1}</b>
            <b className="text-slate-900">{r.name}</b> <span className="text-slate-500">{r.sub}</span>
          </span>
          <b className="adm-num shrink-0 text-slate-900">{r.value}</b>
        </li>
      ))}
    </ol>
  );
}
