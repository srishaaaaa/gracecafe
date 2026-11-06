"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { IngredientLedger, IngredientMoveType, IngredientUnit } from "@/lib/types";
import { rupee } from "@/lib/money";
import { rangeOf, type Period } from "@/lib/analytics";
import { useAdmin } from "./Store";
import { Badge, Btn, Card, DateRange, Empty, Icon, Kpi, Page, PageHead, Pills, SearchBox, cx, fmtDateTime, type BadgeTone } from "./kit";

/* ============================================================
   INGREDIENT MOVEMENTS LOG
   The full ledger — every purchase, batch use, waste or correction — on its own
   page, with real column sort (click a header to flip asc/desc) and an Excel
   download of the whole filtered period.
   ============================================================ */

const TYPE: Record<IngredientMoveType, [string, BadgeTone]> = {
  purchase: ["Purchased", "green"],
  use: ["Batch use", "sky"],
  waste: ["Wasted", "red"],
  adjust: ["Adjustment", "amber"],
};

const num3 = (n: number) => Math.round(n * 1000) / 1000;

const th = "px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap";
const td = "px-4 py-3 text-[13px]";

type SortKey = "date" | "ingredient" | "type" | "qty" | "cost" | "balance";
type SortDir = "asc" | "desc";

/* ---------------- hook: one page of the ledger ---------------- */
type LQ = { from?: number | null; to?: number | null; type?: string; iid?: string; q?: string; sort?: string; dir?: string; page?: number; size?: number };
function useIngredientLedger(query: LQ) {
  const { s } = useAdmin();
  const [got, setGot] = useState<{ key: string; data: IngredientLedger } | null>(null);
  const key = JSON.stringify(query);
  useEffect(() => {
    let dead = false;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(JSON.parse(key) as LQ)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    fetch(`/api/admin/ingredient-moves?${p}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!dead && !d.error) setGot({ key, data: d }); })
      .catch(() => {});
    return () => { dead = true; };
  }, [key, s.version]);
  return { data: got?.data ?? null, loading: got?.key !== key };
}

/* Column header the user can click to sort by. Shows the active direction. */
function SortTh({ label, col, sort, dir, onSort, align = "left" }: { label: string; col: SortKey; sort: SortKey; dir: SortDir; onSort: (c: SortKey) => void; align?: "left" | "right" }) {
  const on = sort === col;
  return (
    <th className={cx(th, align === "right" && "text-right", "cursor-pointer select-none hover:text-slate-900")} onClick={() => onSort(col)}>
      <span className={cx("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        <span className={cx("text-[9px]", on ? "text-slate-700" : "text-slate-300")}>{on ? (dir === "asc" ? "▲" : "▼") : "▲▼"}</span>
      </span>
    </th>
  );
}

export default function IngredientMovesPage() {
  const { s, toast } = useAdmin();

  /* ---------- filters ---------- */
  const [period, setPeriod] = useState<Period>("all"); // default All so nothing is hidden
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<"all" | IngredientMoveType>("all");
  const [iid, setIid] = useState("all");
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { const t = setTimeout(() => setNeedle(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);

  const { data } = useIngredientLedger({ from: range?.from, to: range?.to, type, iid, q: needle, sort, dir, page, size: 50 });

  const ings = s.ingredients ?? [];
  const filter = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));
  const goto = (p: number) => setPage(Math.max(1, Math.min(data?.pages ?? 1, p)));

  const toggleSort = (col: SortKey) => {
    setPage(1);
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(col); setDir(col === "ingredient" || col === "type" ? "asc" : "desc"); }
  };

  const resetFilters = () => {
    setPeriod("all");
    setFrom("");
    setTo("");
    setType("all");
    setIid("all");
    setQ("");
    setSort("date");
    setDir("desc");
    setPage(1);
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams({ export: "xlsx" });
      if (range && Number.isFinite(range.from)) p.set("from", String(range.from));
      if (range && Number.isFinite(range.to)) p.set("to", String(range.to));
      if (type !== "all") p.set("type", type);
      if (iid !== "all") p.set("iid", iid);
      if (needle) p.set("q", needle);
      p.set("sort", sort);
      p.set("dir", dir);
      const r = await fetch(`/api/admin/ingredient-moves?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ingredient-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ kind: "ok", title: "Excel file downloaded.", body: "Two sheets: Movements (every line) and Summary by ingredient." });
    } catch {
      toast({ kind: "err", title: "Couldn't prepare the download." });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page>
      <PageHead
        title="Movements log"
        sub="Every purchase, batch use, waste and correction, filtered and sorted. Click a column header to sort it; download the current view as Excel."
        right={
          <>
            <Btn icon="download" disabled={exporting || !data?.total} onClick={exportXlsx}>{exporting ? "Preparing…" : "Download Excel (.xlsx)"}</Btn>
            <Link href="/admin/inventory/ingredients" className="inline-flex h-9 items-center rounded-xl bg-slate-100 px-3.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-200">← Ingredients</Link>
          </>
        }
      />

      {/* ---------- filter bar ---------- */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Pills value={period} onChange={filter(setPeriod)} options={[{ v: "all", t: "All" }, { v: "today", t: "Today" }, { v: "week", t: "Week" }, { v: "month", t: "Month" }, { v: "year", t: "Year" }, { v: "custom", t: "Custom" }]} />
          {period === "custom" && <DateRange from={from} to={to} onFrom={filter(setFrom)} onTo={filter(setTo)} />}
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <select className="h-10 rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 outline-none" value={type} onChange={(e) => filter(setType)(e.target.value as typeof type)} aria-label="Movement type">
              <option value="all">All movements</option>
              {Object.entries(TYPE).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
            </select>
            <select className="h-10 max-w-[220px] rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 outline-none" value={iid} onChange={(e) => filter(setIid)(e.target.value)} aria-label="Ingredient">
              <option value="all">All ingredients</option>
              {(data?.ingredients ?? ings.map((i) => ({ id: i.id, name: i.name, unit: i.unit as IngredientUnit }))).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <SearchBox value={q} onChange={filter(setQ)} placeholder="Search notes…" className="w-full max-w-[200px]" />
            <Btn size="sm" onClick={resetFilters}>Reset</Btn>
          </div>
        </div>
      </Card>

      {/* ---------- period totals ---------- */}
      {data && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi small label="Purchased" value={rupee(data.stats.purchased.cost)} hint={`${num3(data.stats.purchased.qty)} g/ml`} icon="plus" tone="emerald" />
          <Kpi small label="Used in batches" value={rupee(data.stats.used.cost)} hint={`${num3(data.stats.used.qty)} g/ml`} icon="orders" tone="sky" />
          <Kpi small label="Wasted" value={rupee(data.stats.wasted.cost)} hint={`${num3(data.stats.wasted.qty)} g/ml`} icon="trash" tone="rose" />
          <Kpi small label="Adjustments" value={`${num3(data.stats.adjusted.qty)} g/ml`} icon="refresh" tone="slate" />
        </div>
      )}

      {/* ---------- per-ingredient summary ---------- */}
      {data && data.perIngredient.length > 0 && (
        <Card className="mt-4" title={<span className="flex items-center gap-2.5"><Icon name="box" size={18} className="text-red-600" /> Summary by ingredient</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-slate-50/60">
                <tr>
                  <th className={th}>Ingredient</th>
                  <th className={cx(th, "text-right")}>Purchased</th>
                  <th className={cx(th, "text-right")}>Used</th>
                  <th className={cx(th, "text-right")}>Wasted</th>
                  <th className={cx(th, "text-right")}>Closing stock</th>
                </tr>
              </thead>
              <tbody>
                {data.perIngredient.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className={td}><b className="text-slate-900">{p.name}</b></td>
                    <td className={cx(td, "text-right adm-num text-emerald-700")}>{num3(p.in)}{p.unit}</td>
                    <td className={cx(td, "text-right adm-num text-sky-700")}>{num3(p.used)}{p.unit}</td>
                    <td className={cx(td, "text-right adm-num text-red-600")}>{num3(p.wasted)}{p.unit}</td>
                    <td className={cx(td, "text-right adm-num font-semibold")}>{num3(p.close)}{p.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------- ledger table ---------- */}
      <Card className="mt-4" title={<span className="flex items-center gap-2.5"><Icon name="list" size={18} className="text-red-600" /> Movements ({data?.total ?? 0})</span>}>
        {!data?.rows.length ? (
          <Empty icon="list" title="No movements for these filters.">Clear the filters, widen the date range, or log a purchase to get started.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead className="bg-slate-50/60">
                  <tr>
                    <SortTh label="When" col="date" sort={sort} dir={dir} onSort={toggleSort} />
                    <SortTh label="Ingredient" col="ingredient" sort={sort} dir={dir} onSort={toggleSort} />
                    <SortTh label="Type" col="type" sort={sort} dir={dir} onSort={toggleSort} />
                    <SortTh label="Change" col="qty" sort={sort} dir={dir} onSort={toggleSort} align="right" />
                    <SortTh label="Cost" col="cost" sort={sort} dir={dir} onSort={toggleSort} align="right" />
                    <SortTh label="Balance" col="balance" sort={sort} dir={dir} onSort={toggleSort} align="right" />
                    <th className={th}>Batch</th>
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className={cx(td, "whitespace-nowrap text-slate-500")}>{fmtDateTime(r.createdAt)}</td>
                      <td className={td}><b className="text-slate-900">{r.ingredientName}</b></td>
                      <td className={td}><Badge tone={TYPE[r.type][1]}>{TYPE[r.type][0]}</Badge></td>
                      <td className={cx(td, "text-right adm-num font-semibold", r.qty < 0 ? "text-red-600" : "text-emerald-700")}>{r.qty > 0 ? "+" : ""}{num3(r.qty)}{r.unit}</td>
                      <td className={cx(td, "text-right adm-num")}>{r.cost > 0 ? rupee(r.cost) : <span className="text-slate-400">—</span>}</td>
                      <td className={cx(td, "text-right adm-num")}>{num3(r.balanceAfter)}{r.unit}</td>
                      <td className={cx(td, "font-semibold text-slate-800")}>
                        {r.batchName || <span className="font-normal text-slate-400">—</span>}
                        {r.madeFor && <span className="mt-0.5 block text-[12px] font-semibold text-emerald-700">Made: {r.madeFor}</span>}
                        {r.batchNote && <span className="mt-0.5 block text-[11.5px] font-normal text-slate-500">{r.batchNote}</span>}
                      </td>
                      <td className={cx(td, "text-slate-600")}>{r.note || <span className="text-slate-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data.pages ?? 1) > 1 && (
              <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-slate-600">
                <span>Page {data.page} of {data.pages} · {data.total} movement{data.total === 1 ? "" : "s"}</span>
                <div className="flex gap-2">
                  <Btn size="sm" disabled={data.page <= 1} onClick={() => goto(data.page - 1)}>← Prev</Btn>
                  <Btn size="sm" disabled={data.page >= data.pages} onClick={() => goto(data.page + 1)}>Next →</Btn>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </Page>
  );
}
