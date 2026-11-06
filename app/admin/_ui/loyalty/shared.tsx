"use client";

import { useCallback, useEffect, useState } from "react";
import type { LedgerEntry, LoyaltyState } from "@/lib/loyalty/types";
import type { Range } from "@/lib/analytics";
import { useAdmin } from "../Store";
import { cx } from "../kit";

/** The Loyalty page's data, fetched separately from the main admin state and
    refreshed whenever the shop's data version moves. */
export function useLoyaltyState() {
  const { s } = useAdmin();
  const [data, setData] = useState<LoyaltyState | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/loyalty", { cache: "no-store" });
        const d = await r.json();
        if (!live) return;
        if (!r.ok) setError(d.error ?? "Couldn't load loyalty data.");
        else {
          setData(d);
          setError("");
        }
      } catch {
        if (live) setError("Network problem — couldn't load loyalty data.");
      }
    })();
    return () => {
      live = false;
    };
  }, [s.version, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}

export const LEDGER_LABEL: Record<string, string> = {
  purchase: "Purchase points",
  bonus: "Bonus",
  promo: "Promotion",
  referral: "Referral",
  occasion: "Occasion",
  redemption: "Points redeemed",
  reward: "Reward redeemed",
  expiry: "Expired",
  refund_reversal: "Refund reversal",
  refund_restore: "Refund — points returned",
  reward_reversal: "Reward reversal",
  adjustment: "Manual adjustment",
  debt_recovery: "Refund recovery",
};

export function Pager({ page, pages, onPage, total }: { page: number; pages: number; onPage: (p: number) => void; total: number }) {
  if (pages <= 1) return <p className="mt-3 text-[12px] text-slate-400">{total} record{total === 1 ? "" : "s"}</p>;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
      <span className="text-slate-500">
        {total} records · page {page} of {pages}
      </span>
      <span className="flex gap-1">
        {[
          ["‹ Prev", page - 1],
          ["Next ›", page + 1],
        ].map(([t, p]) => (
          <button key={t} type="button" disabled={(p as number) < 1 || (p as number) > pages} onClick={() => onPage(p as number)} className="h-8 rounded-lg border border-slate-200 px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            {t}
          </button>
        ))}
      </span>
    </div>
  );
}

export function usePaged<T>(rows: T[], size = 25) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, setPage, total: rows.length };
}

export function Stat({ label, value, hint, tone, note }: { label: string; value: React.ReactNode; hint?: string; tone?: "red" | "green" | "amber"; note?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)]">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">{label}</span>
      <div className={cx("adm-num mt-2 truncate text-[22px] font-extrabold", tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-900")}>{value}</div>
      {hint && <p className="mt-1 truncate text-[11px] text-slate-400">{hint}</p>}
      {note && <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-snug text-slate-500">{note}</p>}
    </div>
  );
}

export const th = "px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500";
export const td = "px-3 py-2.5 text-[13px] text-slate-700";
export const tableWrap = "adm-scroll overflow-x-auto rounded-2xl border border-slate-100";

/** Ledger types that are points earned, and those that are points used. */
export const EARN_TYPES = ["purchase", "bonus", "promo", "referral", "occasion"];
export const USE_TYPES = ["redemption", "reward"];

/** What the period filter hands to every Loyalty tab: the chosen range (null = all time), a label, and the points
    transactions inside it. */
export type PeriodData = { range: Range; label: string; ledger: LedgerEntry[] };
export const within = (t: number, r: Range) => !r || (t >= r.from && t <= r.to);
