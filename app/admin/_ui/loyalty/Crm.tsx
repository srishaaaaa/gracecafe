"use client";

import { useMemo, useState } from "react";
import { rupee } from "@/lib/money";
import { SEGMENTS, segmentOf, statsFrom } from "@/lib/loyalty/engine";
import type { PurchaseStats, Segment } from "@/lib/loyalty/types";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { waLink } from "../receipt";
import { Badge, Btn, Empty, SearchBox, WaIcon, cx, downloadExcel, fmtDate, inputLineCls } from "../kit";
import { Pager, th, td, tableWrap, usePaged, within, type PeriodData } from "./shared";

const NONE: PurchaseStats = { orders: 0, visits: 0, spent: 0, aov: 0, first: null, last: null, recentVisits: 0 };

/** Suggested wording for each group — the owner can change it before sending. */
const WORDS: Record<Segment | "all", string> = {
  all: "Hi {name}! Thank you for being part of {shop}. See you again soon!",
  new: "Hi {name}! Welcome to {shop} — we loved having you. Your loyalty points are waiting for your next visit!",
  regular: "Hi {name}! Thanks for being a regular at {shop}. Keep collecting points for free gifts!",
  frequent: "Hi {name}! You are one of our most frequent visitors at {shop} — thank you! Check your points for a free gift.",
  high_value: "Hi {name}! Thank you for your support — we have something special for you at {shop}. Ask at the counter!",
  vip: "Hi {name}! You are a VIP at {shop}. Thank you! Visit us soon for a little surprise.",
  at_risk: "Hi {name}! We haven't seen you at {shop} for a while. Come back — your loyalty points are waiting!",
  inactive: "Hi {name}! We miss you at {shop}. Visit us soon and use your loyalty points!",
  lost: "Hi {name}! It's been a long time. {shop} would love to see you again — your points are still safe!",
};

/* Customer CRM: who your customers are, from their paid bills. Each loyalty customer falls into one group (new, regular,
   frequent, big spender, VIP, or slipping away); the thresholds are set in Settings. One tap opens WhatsApp with a message
   for the group — only for customers who agreed to WhatsApp messages. */
export default function Crm({ d, pd }: { d: LoyaltyState; pd: PeriodData }) {
  const { s, now } = useAdmin();
  const cfg = d.config;
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<Segment | "">("");
  const [tpl, setTpl] = useState<string | null>(null);

  const rows = useMemo(() => {
    const by = new Map<string, typeof s.bills>();
    for (const b of s.bills) if (b.customerPhone) by.set(b.customerPhone, [...(by.get(b.customerPhone) ?? []), b]);
    return d.customers.map((c) => {
      const all = by.get(c.phone) ?? [];
      const full = all.length ? statsFrom(all, cfg.crm.frequentDays, now) : NONE;
      // the group comes from the whole history; the numbers shown are for the chosen period
      const inP = all.filter((b) => within(b.createdAt, pd.range));
      const st = pd.range ? (inP.length ? statsFrom(inP, cfg.crm.frequentDays, now) : NONE) : full;
      return { c, st, seg: segmentOf(full, cfg, c.tier, now) };
    });
  }, [d.customers, s.bills, cfg, now, pd.range]);

  const counts = useMemo(() => {
    const m = new Map<Segment | "none", number>();
    for (const r of rows) m.set(r.seg ?? "none", (m.get(r.seg ?? "none") ?? 0) + 1);
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!seg || r.seg === seg) && (!t || r.c.name.toLowerCase().includes(t) || r.c.phone.includes(t))).sort((a, b) => b.st.spent - a.st.spent);
  }, [rows, q, seg]);
  const pg = usePaged(shown, 25);

  const message = tpl ?? WORDS[seg || "all"];
  const text = (name: string) => message.replaceAll("{name}", name.split(" ")[0] || "there").replaceAll("{shop}", s.settings.shopName);

  const exportRows = () =>
    downloadExcel(`customer-crm-${new Date().toISOString().slice(0, 10)}`, [
      ["Period", pd.label],
      ["Customer", "Mobile", "Group", "Orders", "Visits", "Spent", "Average bill", "Last visit", "Points", "WhatsApp OK"],
      ...shown.map((r) => [r.c.name, r.c.phone, SEGMENTS.find((x) => x.key === r.seg)?.label ?? "No bills yet", r.st.orders, r.st.visits, r.st.spent, r.st.aov, r.st.last ? fmtDate(r.st.last) : "", r.c.available, r.c.consent ? "Yes" : "No"]),
    ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {SEGMENTS.map((x) => (
          <button key={x.key} type="button" onClick={() => (setSeg(seg === x.key ? "" : x.key), setTpl(null))} className={cx("rounded-2xl border p-3 text-left transition", seg === x.key ? "border-red-600 bg-red-50" : "border-slate-100 bg-white hover:bg-slate-50")}>
            <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-600">{x.label}</span>
            <b className="adm-num mt-1 block text-[20px] text-slate-900">{counts.get(x.key) ?? 0}</b>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or mobile number…" className="h-10 min-w-[220px] flex-1 rounded-xl" />
        {seg && (
          <Btn onClick={() => (setSeg(""), setTpl(null))}>Show everyone</Btn>
        )}
        <Btn icon="download" onClick={exportRows} disabled={!shown.length}>
          Excel
        </Btn>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">WhatsApp message{seg ? ` for “${SEGMENTS.find((x) => x.key === seg)?.label}”` : ""}</span>
        <textarea className={cx(inputLineCls, "h-20 resize-y py-2.5 leading-relaxed")} value={message} maxLength={600} onChange={(e) => setTpl(e.target.value)} />
        <span className="text-[12px] text-slate-500">{"{name}"} and {"{shop}"} are filled in for each customer. Only customers who agreed to WhatsApp messages get a Send button.</span>
      </label>

      {!shown.length ? (
        <Empty icon="users" title="No customers here">
          {d.customers.length ? "Try another group or search." : "Customers appear here once they join the loyalty programme."}
        </Empty>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full min-w-[820px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Group</th>
                  <th className={cx(th, "text-right")}>Visits</th>
                  <th className={cx(th, "text-right")}>Spent</th>
                  <th className={cx(th, "text-right")}>Avg bill</th>
                  <th className={th}>Last visit</th>
                  <th className={cx(th, "text-right")}>Points</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pg.rows.map(({ c, st, seg: sg }) => {
                  const meta = SEGMENTS.find((x) => x.key === sg);
                  return (
                    <tr key={c.id}>
                      <td className={td}>
                        <b className="text-slate-900">{c.name}</b>
                        <span className="block text-[11.5px] text-slate-500">{c.phone}</span>
                      </td>
                      <td className={td}>{meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : <span className="text-slate-400">No bills yet</span>}</td>
                      <td className={cx(td, "adm-num text-right")}>{st.visits}</td>
                      <td className={cx(td, "adm-num text-right")}>{rupee(st.spent)}</td>
                      <td className={cx(td, "adm-num text-right")}>{rupee(st.aov)}</td>
                      <td className={td}>{st.last ? fmtDate(st.last) : "—"}</td>
                      <td className={cx(td, "adm-num text-right font-bold")}>{c.available}</td>
                      <td className={cx(td, "text-right")}>
                        {c.consent && c.status === "active" ? (
                          <a href={waLink(c.whatsapp || c.phone, text(c.name))} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#22c55e] px-3 text-[12px] font-extrabold uppercase tracking-wide text-white hover:bg-[#16a34a]">
                            <WaIcon size={13} /> Send
                          </a>
                        ) : (
                          <span className="text-[11.5px] text-slate-400">{c.status !== "active" ? "Deactivated" : "No consent"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} total={pg.total} />
        </>
      )}
    </div>
  );
}
