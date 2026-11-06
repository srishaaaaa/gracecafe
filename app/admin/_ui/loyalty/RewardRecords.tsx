"use client";

import { useMemo, useState } from "react";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Badge, Btn, Empty, SearchBox, downloadExcel, fmtDate, cx } from "../kit";
import { Pager, th, td, tableWrap, usePaged, within, type PeriodData } from "./shared";

type Row = { key: string; at: number; who: string; phone: string; reward: string; how: "Points" | "Spending" | "Bill offer" | "Other"; status: "Unlocked" | "Claimed" | "Cancelled" | "Expired"; invoice: string; points: number; claimedAt: number | null };

const sel = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 outline-none focus:border-slate-400";
const TONE = { Unlocked: "green", Claimed: "slate", Cancelled: "red", Expired: "amber" } as const;

/* Rewards earned: every free gift a customer has unlocked or been given — from points, from spending, and from bill
   offers — with whether it is still waiting, or was claimed, and on which bill. */
export default function RewardRecords({ d, pd }: { d: LoyaltyState; pd: PeriodData }) {
  const { s } = useAdmin();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [how, setHow] = useState("");

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(d.customers.map((c) => [c.id, c]));
    const out: Row[] = d.vouchers.map((v) => ({
      key: v.id,
      at: v.issuedAt,
      who: byId.get(v.customerId)?.name ?? "(deleted customer)",
      phone: byId.get(v.customerId)?.phone ?? "",
      reward: v.giftQty > 1 ? `${v.giftQty} × ${v.name}` : v.name,
      how: v.source === "points" ? "Points" : v.source === "milestone" ? "Spending" : "Other",
      status: v.status === "used" ? "Claimed" : v.status === "issued" ? "Unlocked" : v.status === "cancelled" ? "Cancelled" : "Expired",
      invoice: v.invoiceNo ?? "",
      points: v.pointsCost,
      claimedAt: v.usedAt,
    }));
    // gifts that came from a bill offer (no reward on the bill)
    for (const b of s.bills) {
      if (b.status !== "completed" || b.rewardRef) continue;
      for (const [k, i] of b.items.entries()) {
        if (!i.free) continue;
        out.push({ key: `${b.id}:${k}`, at: b.createdAt, who: b.customerName && b.customerName !== "Walk-in customer" ? b.customerName : "Walk-in customer", phone: b.customerPhone, reward: `${i.qty} × ${i.name}${i.gift ? ` — ${i.gift}` : ""}`, how: "Bill offer", status: "Claimed", invoice: b.invoiceNo, points: 0, claimedAt: b.createdAt });
      }
    }
    return out.filter((r) => within(r.at, pd.range)).sort((a, b) => b.at - a.at);
  }, [d.customers, d.vouchers, s.bills, pd.range]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!status || r.status === status) && (!how || r.how === how) && (!t || `${r.who} ${r.phone} ${r.reward} ${r.invoice}`.toLowerCase().includes(t)));
  }, [rows, q, status, how]);
  const pg = usePaged(shown, 25);
  const count = (st: Row["status"]) => rows.filter((r) => r.status === st).length;

  const exportRows = () =>
    downloadExcel(`rewards-earned-${new Date().toISOString().slice(0, 10)}`, [
      ["Period", pd.label],
      ["Date earned", "Customer", "Mobile", "Reward / gift", "How earned", "Status", "Claimed on", "Bill", "Points used"],
      ...shown.map((r) => [fmtDate(r.at), r.who, r.phone, r.reward, r.how, r.status, r.claimedAt ? fmtDate(r.claimedAt) : "", r.invoice, r.points]),
    ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["Unlocked", "Claimed", "Cancelled", "Expired"] as const).map((st) => (
          <button key={st} type="button" onClick={() => setStatus(status === st ? "" : st)} className={cx("rounded-2xl border p-3 text-left transition", status === st ? "border-red-600 bg-red-50" : "border-slate-100 bg-white hover:bg-slate-50")}>
            <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-600">{st}</span>
            <b className="adm-num mt-1 block text-[20px] text-slate-900">{count(st)}</b>
            <span className="text-[11px] text-slate-500">{st === "Unlocked" ? "waiting to be claimed" : st === "Claimed" ? "handed over on a bill" : st === "Cancelled" ? "taken back" : "ran out of time"}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search customer, reward or bill…" className="h-10 min-w-[220px] flex-1 rounded-xl" />
        <select className={sel} value={how} onChange={(e) => setHow(e.target.value)} aria-label="How earned">
          <option value="">Every kind</option>
          <option value="Points">With points</option>
          <option value="Spending">For spending</option>
          <option value="Bill offer">Bill offer</option>
          <option value="Other">Other</option>
        </select>
        <Btn icon="download" onClick={exportRows} disabled={!shown.length}>
          Excel
        </Btn>
      </div>

      {!shown.length ? (
        <Empty icon="star" title="No rewards here yet">
          Gifts show up as soon as a customer unlocks one, or a bill offer gives one.
        </Empty>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full min-w-[820px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Earned</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Reward / gift</th>
                  <th className={th}>How</th>
                  <th className={th}>Status</th>
                  <th className={th}>Claimed</th>
                  <th className={th}>Bill</th>
                  <th className={cx(th, "text-right")}>Points used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pg.rows.map((r) => (
                  <tr key={r.key}>
                    <td className={cx(td, "whitespace-nowrap")}>{fmtDate(r.at)}</td>
                    <td className={td}>
                      <b className="text-slate-900">{r.who}</b>
                      <span className="block text-[11.5px] text-slate-500">{r.phone}</span>
                    </td>
                    <td className={cx(td, "font-semibold text-slate-900")}>{r.reward}</td>
                    <td className={td}>{r.how}</td>
                    <td className={td}>
                      <Badge tone={TONE[r.status]}>{r.status}</Badge>
                    </td>
                    <td className={td}>{r.claimedAt ? fmtDate(r.claimedAt) : "—"}</td>
                    <td className={td}>{r.invoice || "—"}</td>
                    <td className={cx(td, "adm-num text-right")}>{r.points || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} total={pg.total} />
        </>
      )}
    </div>
  );
}
