"use client";

import { useMemo, useState } from "react";
import { UPI_CHANNELS, type Bill } from "@/lib/types";
import { round2, rupee, shopToday } from "@/lib/money";
import { completedIn, customerStats, expensesIn, gstReport, isoWeek, itemStats, monthly, rangeOf, splitGst, startOfWeek, paymentStats, summary, weekly, type Period } from "@/lib/analytics";
import Link from "next/link";
import { useAdmin } from "./Store";
import { useLedger } from "./ledger";
import { Badge, Btn, Card, DateRange, Empty, Icon, Kpi, Page, PageHead, Pills, SearchBox, Switch, Tabs, cx, downloadExcel, fmtDate, fmtTime, type ExcelSheet } from "./kit";

type Tab = "revenue" | "today" | "products" | "customers" | "coupons";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ---------------- charts ---------------- */

/** Single-series column chart: thin red columns, value on hover/focus. */
function Columns({ data, height = 200, empty }: { data: { label: string; full: string; value: number }[]; height?: number; empty?: string }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  return (
    <div>
      <div className="relative flex items-end gap-1 sm:gap-2" style={{ height }} role="img" aria-label={data.map((d) => `${d.full}: ${rupee(d.value)}`).join(", ")}>
        {!max && empty && <p className="absolute inset-0 grid place-items-center text-[13px] text-slate-400">{empty}</p>}
        {data.map((d, i) => {
          const pct = max ? (d.value / max) * 88 : 0;
          return (
            <div key={d.full} tabIndex={0} className="group relative flex h-full flex-1 items-end justify-center rounded-lg outline-none transition-colors hover:bg-slate-50 focus-visible:bg-slate-50">
              {d.value > 0 && (
                <div className="adm-bar w-3 rounded-t-[4px] bg-red-600 transition-colors group-hover:bg-red-700 sm:w-4" style={{ height: `${pct}%`, ["--i" as string]: i }} />
              )}
              <div
                className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-center text-[11px] leading-tight text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                style={{ bottom: `calc(${pct}% + 8px)` }}
              >
                <span className="block text-slate-300">{d.full}</span>
                <b className="text-[12.5px]">{rupee(d.value)}</b>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1 border-t border-slate-100 pt-3 sm:gap-2">
        {data.map((d) => (
          <span key={d.full} className="flex-1 text-center text-[10.5px] font-semibold uppercase text-slate-500">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceSplit({ tab, counter }: { tab: number; counter: number }) {
  const max = Math.max(tab, counter, 1);
  const rows = [
    { label: "Customer tabs (QR)", n: tab, text: "text-red-600", bar: "bg-red-600" },
    { label: "Counter", n: counter, text: "text-emerald-600", bar: "bg-emerald-500" },
  ];
  return (
    <div className="space-y-5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-2 flex items-center justify-between">
            <span className={cx("text-[11px] font-bold uppercase tracking-[0.14em]", r.text)}>{r.label}</span>
            <b className="adm-num text-[15px] text-slate-900">{r.n}</b>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            {r.n > 0 && <div className={cx("adm-fill h-full rounded-full", r.bar)} style={{ width: `${(r.n / max) * 100}%` }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

/** GST invoices vs non-GST bills: how revenue splits, and the tax collected on the GST side. */
function GstSplit({ gstN, gstRev, gst, taxable, nonGstN, nonGstRev }: { gstN: number; gstRev: number; gst: number; taxable: number; nonGstN: number; nonGstRev: number }) {
  const total = gstRev + nonGstRev;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return (
    <div className="space-y-4">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {gstRev > 0 && <div className="adm-fill h-full bg-amber-500" style={{ width: `${pct(gstRev)}%` }} title={`GST ${rupee(gstRev)}`} />}
        {nonGstRev > 0 && <div className="adm-fill h-full bg-slate-400" style={{ width: `${pct(nonGstRev)}%` }} title={`Non-GST ${rupee(nonGstRev)}`} />}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">GST invoices</span>
            <b className="adm-num text-[16px] text-slate-900">{rupee(gstRev)}</b>
          </div>
          <p className="mt-1 text-[11.5px] text-slate-500">
            {gstN} invoice{gstN === 1 ? "" : "s"} · {rupee(gst)} GST on {rupee(taxable)} taxable
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Non-GST bills</span>
            <b className="adm-num text-[16px] text-slate-900">{rupee(nonGstRev)}</b>
          </div>
          <p className="mt-1 text-[11.5px] text-slate-500">{nonGstN} bill{nonGstN === 1 ? "" : "s"} · no tax charged</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3 text-[13px]">
        <dt className="font-semibold text-slate-600">Total GST collected</dt>
        <dd className="adm-num font-extrabold text-amber-700">{rupee(gst)}</dd>
      </div>
    </div>
  );
}

/** Per-rate GST table: how much taxable, CGST, SGST and GST fell under each rate. */
function GstByRate({ rates }: { rates: { rate: number; invoices: number; taxable: number; gst: number; total: number; cgst: number; sgst: number }[] }) {
  if (!rates.length) return <p className="py-8 text-center text-[13px] text-slate-400">No GST invoices in this period yet.</p>;
  const cell = "px-3 py-2.5 text-[12.5px] whitespace-nowrap";
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100 adm-scroll">
      <table className="w-full min-w-[480px]">
        <thead className="bg-slate-50">
          <tr>
            <th className={cx(th, "text-left")}>GST rate</th>
            <th className={cx(th, "text-right")}>Invoices</th>
            <th className={cx(th, "text-right")}>Taxable</th>
            <th className={cx(th, "text-right")}>CGST</th>
            <th className={cx(th, "text-right")}>SGST</th>
            <th className={cx(th, "text-right")}>Total GST</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.rate} className="border-b border-slate-100 last:border-0">
              <td className={cx(cell, "font-bold text-slate-900")}>{r.rate}%</td>
              <td className={cx(cell, "text-right text-slate-600")}>{r.invoices}</td>
              <td className={cx(cell, "adm-num text-right text-slate-700")}>{rupee(r.taxable)}</td>
              <td className={cx(cell, "adm-num text-right text-slate-700")}>{rupee(r.cgst)}</td>
              <td className={cx(cell, "adm-num text-right text-slate-700")}>{rupee(r.sgst)}</td>
              <td className={cx(cell, "adm-num text-right font-bold text-amber-700")}>{rupee(r.gst)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Invoice-by-invoice GST — the list an accountant files from. Shows the latest few, the Excel export has them all. */
function GstRegister({ bills, onExport }: { bills: Bill[]; onExport: () => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? bills : bills.slice(0, 12);
  const cell = "px-3 py-2.5 text-[12.5px] whitespace-nowrap";
  return (
    <Card
      title="GST invoices"
      right={
        <Btn size="sm" icon="download" onClick={onExport} disabled={!bills.length}>
          Download Excel
        </Btn>
      }
    >
      {!bills.length ? (
        <p className="py-8 text-center text-[13px] text-slate-400">No GST invoices in this period yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-100 adm-scroll">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={cx(th, "text-left")}>Invoice</th>
                  <th className={cx(th, "text-left")}>Date</th>
                  <th className={cx(th, "text-left")}>Customer</th>
                  <th className={cx(th, "text-right")}>Rate</th>
                  <th className={cx(th, "text-right")}>Taxable</th>
                  <th className={cx(th, "text-right")}>CGST</th>
                  <th className={cx(th, "text-right")}>SGST</th>
                  <th className={cx(th, "text-right")}>Invoice total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const half = splitGst(b.gstAmount);
                  return (
                    <tr key={b.id} className="border-b border-slate-100 last:border-0">
                      <td className={cx(cell, "font-semibold text-slate-900")}>{b.invoiceNo}</td>
                      <td className={cx(cell, "text-slate-600")}>{fmtDate(b.createdAt)}</td>
                      <td className={cx(cell, "max-w-[180px] truncate text-slate-700")}>{b.customerName || b.customerPhone || "—"}</td>
                      <td className={cx(cell, "text-right text-slate-600")}>{b.gstPercent}%</td>
                      <td className={cx(cell, "adm-num text-right text-slate-700")}>{rupee(b.taxableAmount)}</td>
                      <td className={cx(cell, "adm-num text-right text-slate-700")}>{rupee(half.cgst)}</td>
                      <td className={cx(cell, "adm-num text-right text-slate-700")}>{rupee(half.sgst)}</td>
                      <td className={cx(cell, "adm-num text-right font-bold text-amber-700")}>{rupee(b.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {bills.length > rows.length || all ? (
            <button type="button" onClick={() => setAll(!all)} className="mt-3 text-[12.5px] font-bold text-red-600 hover:underline">
              {all ? "Show fewer" : `Show all ${bills.length} invoices`}
            </button>
          ) : null}
        </>
      )}
    </Card>
  );
}

function TopItems({ bills, n = 5, empty = "No sales in this period." }: { bills: Bill[]; n?: number; empty?: string }) {
  const top = itemStats(bills).slice(0, n);
  const max = top[0]?.revenue || 1;
  if (!top.length) return <p className="py-8 text-center text-[13px] text-slate-500">{empty}</p>;
  return (
    <ol className="space-y-4">
      {top.map((t, i) => (
        <li key={t.key} className="grid grid-cols-[18px_1fr_auto] items-start gap-x-3">
          <span className="pt-0.5 text-[12px] font-semibold text-slate-400">{i + 1}</span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-800">{t.name}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="adm-fill h-full rounded-full bg-red-600" style={{ width: `${(t.revenue / max) * 100}%` }} />
            </div>
          </div>
          <div className="text-right">
            <b className="adm-num block text-[13px] text-red-600">{rupee(t.revenue)}</b>
            <span className="text-[10.5px] text-slate-400">{t.qty} pcs</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

const th = "px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500";
const td = "px-4 py-3.5 text-[13px]";

/* ---------------- page ---------------- */

export default function AnalyticsPage() {
  const { s, floor, now } = useAdmin();
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState<Tab>("revenue");
  const [gstView, setGstView] = useState(false);
  const [q, setQ] = useState("");

  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);
  const inPeriod = useMemo(() => completedIn(s.bills, range), [s.bills, range]);
  const gstr = useMemo(() => gstReport(inPeriod), [inPeriod]);
  const today = useMemo(() => completedIn(s.bills, rangeOf("today")), [s.bills, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = summary(inPeriod);
  const pay = paymentStats(inPeriod);
  const tsum = summary(today);

  const year = new Date().getFullYear();
  const months = monthly(s.bills, year);
  const yearTotal = months.reduce((a, b) => a + b, 0);
  const activeMonths = new Date().getMonth() + 1;
  const wkStart = startOfWeek();
  const week = weekly(s.bills, wkStart);
  const wk = isoWeek();

  const needle = q.trim().toLowerCase();

  /* The Expenses tab has its own filters; this uses the period picked here, so
     the two agree on what "this month" means but can differ in range. */
  const expensesTotal = useMemo(() => expensesIn(s.expenses, range).reduce((a, e) => a + e.amount, 0), [s.expenses, range]);
  /* GST collected is passed on to the government, so it isn't earnings. */
  const net = sum.revenue - sum.gst - expensesTotal;
  const gstBills = useMemo(() => inPeriod.filter((b) => b.isGst).sort((a, b) => b.createdAt - a.createdAt), [inPeriod]);
  const exportGst = () => {
    const head = ["Invoice", "Date", "Customer", "Mobile", "GST %", "Taxable amount", "CGST", "SGST", "Total GST", "Invoice total"];
    const body = gstBills.map((b) => {
      const h = splitGst(b.gstAmount);
      return [b.invoiceNo, fmtDate(b.createdAt), b.customerName, b.customerPhone, b.gstPercent, b.taxableAmount, h.cgst, h.sgst, b.gstAmount, b.total];
    });
    downloadExcel(`gst-invoices-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "GST invoices", rows: [head, ...body] }]);
  };
  const { data: ledger } = useLedger({ from: range?.from, to: range?.to, size: 1 });
  const stock = ledger?.stats ?? { added: 0, sold: 0, removed: 0, returned: 0, adjusted: 0, net: 0 };
  const lowCount = s.products.filter((p) => p.stock !== null && p.stock <= p.lowAt).length;
  const customers = useMemo(() => customerStats(inPeriod), [inPeriod]);
  const repeat = customers.filter((c) => c.visits > 1).length;

  const periodLabel = ({ all: "all-time", today: "today", week: "this-week", month: "this-month", year: "this-year", custom: `${from || "start"}_${to || "end"}` } as const)[period];
  /* A multi-sheet .xls — opens in Excel, Numbers and Google Sheets with real
     columns and real numbers. Captures what each tab shows for the chosen
     period, so an owner can file the whole report in one click. */
  const exportExcel = () => {
    const products = itemStats(inPeriod);
    const sheets: ExcelSheet[] = [
      {
        name: "Summary",
        rows: [
          ["Grace cafe · Analytics"],
          ["Period", periodLabel],
          [],
          ["Metric", "Value"],
          ["Total revenue", sum.revenue],
          ["Total expenses", expensesTotal],
          ["GST collected", sum.gst],
          ["Net earnings", net],
          ["Completed bills", sum.count],
          ["Tab bills", sum.tabN],
          ["Counter bills", sum.counterN],
          ["Tab revenue", sum.tabRev],
          ["Counter revenue", sum.counterRev],
          ["Items sold", sum.items],
          ["Avg order value", Math.round(sum.aov)],
          ["Discounts given", sum.discount],
          ["Discounted bills", sum.discounted],
          ["Top product", sum.top],
          [],
          ["Payment", "Amount"],
          ["Cash", pay.cash],
          ["Card", pay.card],
          ["UPI", pay.upi],
        ],
      },
      {
        name: "Bills",
        rows: [
          ["Invoice", "Date", "Time", "Source", "Customer", "Phone", "Items", "Subtotal", "Discount", "Coupon", "Extra", "GST %", "Taxable", "GST amount", "Total", "Payment", "Status"],
          ...inPeriod
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((b) => [b.invoiceNo, fmtDate(b.createdAt), fmtTime(b.createdAt), b.source, b.customerName, b.customerPhone, b.itemCount, b.subtotal, b.discount, b.couponCode ?? "", b.extra, b.gstPercent, b.taxableAmount, b.gstAmount, b.total, b.payment, b.status]),
        ],
      },
      {
        name: "Products",
        rows: [
          ["#", "Product", "Category", "Units sold", "Revenue", "Share %", "In stock"],
          ...products.map((p, i) => {
            const prod = p.productId ? s.products.find((x) => x.id === p.productId) : null;
            const total = products.reduce((a, x) => a + x.revenue, 0) || 1;
            return [i + 1, p.name, prod?.category ?? "Custom", p.qty, p.revenue, Math.round((p.revenue / total) * 100), prod?.stock ?? ""];
          }),
        ],
      },
      {
        name: "Customers",
        rows: [
          ["Customer", "Phone", "Visits", "Revenue", "Avg / visit"],
          ...customers.map((c) => [c.name || "Guest", c.phone, c.visits, c.spent, Math.round(c.spent / c.visits)]),
        ],
      },
      {
        name: "Coupons",
        rows: [
          ["Invoice", "Date", "Customer phone", "Coupon", "Order total", "Discount applied", "Source"],
          ...inPeriod
            .filter((b) => b.discount > 0)
            .map((b) => [b.invoiceNo, fmtDate(b.createdAt), b.customerPhone, b.couponCode ?? "Manual", b.subtotal, b.discount, b.couponSource ?? "staff"]),
        ],
      },
    ];
    downloadExcel(`chef-loving-analytics-${periodLabel}-${new Date().toISOString().slice(0, 10)}`, sheets);
  };

  return (
    <Page>
      <PageHead
        title="Analytics"
        sub="Real-time store & customer insights"
        right={
          tab === "revenue" ? (
            <div
              className={cx(
                "flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-wide transition",
                gstView ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500",
              )}
            >
              GST view
              <Switch on={gstView} onChange={setGstView} label="GST view" />
            </div>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Pills
          label="Period:"
          value={period}
          onChange={setPeriod}
          options={[
            { v: "all", t: "All time" },
            { v: "today", t: "Today" },
            { v: "week", t: "This week" },
            { v: "month", t: "This month" },
            { v: "year", t: "This year" },
            { v: "custom", t: "Custom" },
          ]}
        />
        {period === "custom" && <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        <Btn size="md" kind="dark" icon="download" onClick={exportExcel} disabled={!inPeriod.length} className="ml-auto">
          Export Excel
        </Btn>
      </div>

      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          setQ("");
        }}
        options={[
          { v: "revenue", t: "Revenue" },
          { v: "today", t: "Today's sales" },
          { v: "products", t: "Products" },
          { v: "customers", t: "Customers" },
          { v: "coupons", t: "Coupons" },
        ]}
      />

      {/* ============ GST VIEW ============ */}
      {tab === "revenue" && gstView && (
        <div className="adm-in space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="GST collected" value={rupee(gstr.gst)} hint={gstr.avgRate > 0 ? `Avg ${gstr.avgRate.toFixed(1)}% on taxable sales` : "No GST collected yet"} icon="percent" tone="amber" />
            <Kpi label="Taxable sales" value={rupee(gstr.taxable)} hint="Value GST was charged on" icon="rupee" tone="sky" />
            <Kpi label="GST invoice value" value={rupee(gstr.revenue)} hint="Taxable sales + GST" icon="billing" tone="emerald" />
            <Kpi label="GST invoices" value={gstr.invoices} hint={`of ${sum.count} bill${sum.count === 1 ? "" : "s"} in period`} icon="list" tone="violet" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="CGST (central)" value={rupee(gstr.cgst)} hint="Half of GST collected" icon="percent" tone="violet" />
            <Kpi label="SGST (state)" value={rupee(gstr.sgst)} hint="Half of GST collected" icon="percent" tone="violet" />
            <Kpi label="Non-GST sales" value={rupee(sum.nonGstRev)} hint={`${gstr.nonGstBills} bill${gstr.nonGstBills === 1 ? "" : "s"} billed without GST`} icon="bag" tone="slate" />
            <Kpi label="GST rates used" value={gstr.rates.length ? gstr.rates.map((r) => `${r.rate}%`).join(", ") : "—"} hint={`${gstr.rates.length} rate${gstr.rates.length === 1 ? "" : "s"} in this period`} icon="sliders" tone="amber" small />
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Card title="GST by rate" right={<span className="text-[12px] text-slate-500">CGST + SGST shown separately</span>}>
              <GstByRate rates={gstr.rates} />
            </Card>
            <Card title="GST vs Non-GST" right={<span className="text-[12px] text-slate-500">{sum.count} bill{sum.count === 1 ? "" : "s"} in period</span>}>
              {sum.count ? (
                <GstSplit gstN={sum.gstN} gstRev={sum.gstRev} gst={sum.gst} taxable={sum.taxable} nonGstN={sum.nonGstN} nonGstRev={sum.nonGstRev} />
              ) : (
                <p className="text-[13px] text-slate-400">No bills in this period.</p>
              )}
            </Card>
          </div>

          <GstRegister bills={gstBills} onExport={exportGst} />

          <p className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-2.5 text-center text-[12.5px] text-amber-800">
            GST view — only the tax side of the books. Turn off <b>GST view</b> to see full revenue, products and customers.
          </p>
        </div>
      )}

      {/* ============ REVENUE ============ */}
      {tab === "revenue" && !gstView && (
        <div className="adm-in space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Net earnings" value={rupee(net)} hint={sum.gst > 0 ? "Revenue − GST − expenses" : "Revenue − expenses"} icon="rupee" tone={net >= 0 ? "emerald" : "red"} />
            <Kpi label="Total revenue" value={rupee(sum.revenue)} hint={sum.gst > 0 ? `Includes ${rupee(sum.gst)} GST collected` : "Customer tabs + counter combined"} icon="rupee" tone="emerald" details={<RevenueBreakdown bills={inPeriod} periodLabel={periodLabel} />} />
            <Kpi label="Total expenses" value={rupee(expensesTotal)} hint="From the Expenses tab" icon="bag" tone="rose" />
            <Kpi label="Discounts given" value={rupee(sum.discount)} hint={`${sum.discounted} discounted bills`} icon="coupon" tone="violet" />
          </div>
          <p className="rounded-xl border border-slate-100 bg-white px-4 py-2.5 text-center text-[12.5px] font-semibold text-slate-500">
            Calculation: <b className="text-slate-800">Revenue {rupee(sum.revenue)}</b>
            {sum.gst > 0 && (
              <>
                {" "}− <b className="text-slate-800">GST {rupee(sum.gst)}</b>
              </>
            )}{" "}
            − <b className="text-slate-800">Expenses {rupee(expensesTotal)}</b> = <b className={net >= 0 ? "text-emerald-600" : "text-red-600"}>{rupee(net)}</b>
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Completed bills" value={sum.count} hint="Tab + counter bills" icon="billing" tone="amber" />
            <Kpi label="Tab revenue" value={rupee(sum.tabRev)} hint="Guests who ordered from their phone" icon="utensils" tone="sky" />
            <Kpi label="Counter revenue" value={rupee(sum.counterRev)} hint="Walk-in counter sales" icon="bag" tone="violet" />
            <Kpi label="GST collected" value={rupee(sum.gst)} hint={`${sum.gstN} GST invoice${sum.gstN === 1 ? "" : "s"} of ${sum.count}`} icon="percent" tone="amber" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Tab bills" value={sum.tabN} hint="Customer tabs settled" icon="tables" tone="rose" />
            <Kpi label="Counter bills" value={sum.counterN} hint="Walk-in bills" icon="bag" tone="sky" />
            <Kpi label="Total items sold" value={sum.items} hint="From completed bills" icon="box" tone="violet" />
            <Kpi label="Avg order value" value={rupee(Math.round(sum.aov))} hint="Per completed bill" icon="zap" tone="orange" />
            <Kpi label="Top product" value={sum.top} hint="Most sold item" icon="star" tone="amber" small />
          </div>

          {/* Two balanced columns: the browser flows the cards down the first column and
              then the second, so neither side is left with a gap under it however tall the
              cards turn out. */}
          <div className="-mb-5 gap-5 xl:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
            <Card>
              <h2 className="text-[15px] font-bold text-slate-800">
                Revenue Trend This Year <span className="text-red-600">{year}</span>
              </h2>
              <div className="mb-6 mt-2 flex flex-wrap items-center gap-3">
                <b className="adm-num text-[22px] font-extrabold text-slate-900">{rupee(yearTotal)}</b>
                <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">Avg {rupee(Math.round(yearTotal / activeMonths))}/mo</span>
              </div>
              <Columns data={months.map((v, i) => ({ label: MONTHS[i], full: `${MONTHS[i]} ${year}`, value: v }))} empty="No revenue yet this year" />
            </Card>
            <Card>
              <h2 className="text-[15px] font-bold text-slate-800">
                Revenue This Week{" "}
                <span className="text-red-600">
                  (Week {wk.week} of {wk.year})
                </span>
              </h2>
              <p className="mb-6 mt-1 text-[12px] text-slate-500">{rupee(week.reduce((a, b) => a + b, 0))} total</p>
              <Columns
                height={180}
                data={week.map((v, i) => {
                  const d = new Date(wkStart + i * 86400000 + 3600000);
                  return { label: DAYS[i], full: `${DAYS[i]} ${d.getDate()}/${d.getMonth() + 1}`, value: v };
                })}
                empty="No revenue yet this week"
              />
            </Card>
            <Card title="Top Items by Revenue">
              <TopItems bills={inPeriod} />
            </Card>
            <Card title="Customers" right={<span className="text-[12px] text-slate-500">{customers.length} known · {repeat} repeat</span>}>
              {customers.length ? (
                <ul className="space-y-2.5 text-[13px]">
                  {customers.slice(0, 5).map((c) => (
                    <li key={c.key} className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <b className="block truncate text-slate-800">{c.name || "—"}</b>
                        <span className="text-[11.5px] text-slate-400">{c.phone} · {c.visits} visit{c.visits === 1 ? "" : "s"}</span>
                      </span>
                      <b className="shrink-0 text-slate-900">{rupee(c.spent)}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-slate-400">No customer mobiles on bills in this period.</p>
              )}
            </Card>
            <Card title="GST vs Non-GST" right={<span className="text-[12px] text-slate-500">{sum.count} bill{sum.count === 1 ? "" : "s"} in period</span>}>
              {sum.count ? (
                <GstSplit gstN={sum.gstN} gstRev={sum.gstRev} gst={sum.gst} taxable={sum.taxable} nonGstN={sum.nonGstN} nonGstRev={sum.nonGstRev} />
              ) : (
                <p className="text-[13px] text-slate-400">No bills in this period.</p>
              )}
            </Card>
            <Card title="Order Source">
              <SourceSplit tab={sum.tabN} counter={sum.counterN} />
            </Card>
            <Card title="Payment mode" right={pay.splitN ? <span className="text-[12px] text-slate-500">{pay.splitN} split bill{pay.splitN === 1 ? "" : "s"}</span> : undefined}>
              <dl className="space-y-2 text-[13px]">
                <div className="flex justify-between"><dt className="text-slate-500">Cash</dt><dd className="font-bold text-slate-900">{rupee(pay.cash)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Card</dt><dd className="font-bold text-slate-900">{rupee(pay.card)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">UPI</dt><dd className="font-bold text-slate-900">{rupee(pay.upi)}</dd></div>
              </dl>
            </Card>
            <Card title="Stock movement" right={<Link href="/admin/inventory/movements" className="text-[12px] font-bold text-red-600 hover:underline">Open</Link>}>
              <dl className="space-y-2 text-[13px]">
                <div className="flex justify-between"><dt className="text-slate-500">Stock added</dt><dd className="font-bold text-emerald-600">+{stock.added}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Units sold</dt><dd className="font-bold text-slate-900">{stock.sold}</dd></div>
                {stock.removed > 0 && <div className="flex justify-between"><dt className="text-slate-500">Removed (waste / own use)</dt><dd className="font-bold text-slate-900">{stock.removed}</dd></div>}
                <div className="flex justify-between"><dt className="text-slate-500">Returned (cancel / void)</dt><dd className="font-bold text-slate-900">+{stock.returned}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Adjustments</dt><dd className="font-bold text-slate-900">{stock.adjusted > 0 ? "+" : ""}{stock.adjusted}</dd></div>
                <div className="flex justify-between border-t border-dashed border-slate-200 pt-2"><dt className="text-slate-500">Low / sold-out items</dt><dd className={cx("font-bold", lowCount ? "text-amber-600" : "text-slate-900")}>{lowCount}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      )}

      {/* ============ TODAY ============ */}
      {tab === "today" && (
        <div className="adm-in space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Today's revenue" value={rupee(tsum.revenue)} hint="Completed today" icon="rupee" tone="emerald" />
            <Kpi label="Today's bills" value={tsum.count} hint="Completed today" icon="billing" tone="sky" />
            <Kpi
              label="Today's items sold"
              value={
                <>
                  {tsum.items} <span className="text-[14px] font-bold">pcs</span>
                </>
              }
              hint="Quantity sold today"
              icon="box"
              tone="violet"
            />
            <Kpi label="Today's avg order value" value={rupee(Math.round(tsum.aov))} hint="Per invoice today" icon="zap" tone="orange" />
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              title={<span className="text-[14px] uppercase tracking-[0.14em] text-slate-900">Today&apos;s transactions</span>}
              right={<SearchBox value={q} onChange={setQ} placeholder="Search contact no…" className="w-full sm:w-64" />}
            >
              <div className="overflow-x-auto rounded-xl adm-scroll">
                <table className="w-full min-w-[560px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={th}>Invoice ID</th>
                      <th className={th}>Customer no</th>
                      <th className={th}>Source</th>
                      <th className={th}>Items</th>
                      <th className={cx(th, "text-right")}>Grand total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {today
                      .filter((b) => !needle || `${b.customerPhone} ${b.invoiceNo} ${b.customerName}`.toLowerCase().includes(needle))
                      .slice()
                      .reverse()
                      .map((b) => (
                        <tr key={b.id} className="border-b border-slate-100 last:border-0">
                          <td className={cx(td, "font-semibold text-slate-900")}>
                            {b.invoiceNo}
                            <span className="block text-[11px] font-normal text-slate-400">{fmtTime(b.createdAt)}</span>
                          </td>
                          <td className={cx(td, "text-slate-700")}>{b.customerPhone || "—"}</td>
                          <td className={td}>{b.source === "tab" ? <Badge tone="red">{b.customerName || b.customerPhone || "Tab"}</Badge> : <Badge tone="green">Counter</Badge>}</td>
                          <td className={cx(td, "text-slate-700")}>{b.itemCount}</td>
                          <td className={cx(td, "text-right font-bold text-slate-900")}>{rupee(b.total)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!today.length && <p className="py-14 text-center text-[14px] italic text-slate-400">No transactions found for today.</p>}
              </div>
            </Card>
            <div className="space-y-5">
              <Card title={<span className="text-[14px] uppercase tracking-[0.14em] text-slate-900">Live right now</span>}>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Open tabs</p>
                    <p className="adm-num mt-1 text-[22px] font-extrabold">{floor.filter((f) => f.session).length}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Unbilled</p>
                    <p className="adm-num mt-1 text-[22px] font-extrabold">{rupee(floor.reduce((a, f) => a + f.total, 0))}</p>
                  </div>
                </div>
              </Card>
              <Card title={<span className="text-[14px] uppercase tracking-[0.14em] text-slate-900">Today&apos;s channel split</span>}>
                {today.length ? <SourceSplit tab={tsum.tabN} counter={tsum.counterN} /> : <p className="py-8 text-center text-[14px] text-slate-600">No sales today.</p>}
              </Card>
              <Card title={<span className="text-[14px] uppercase tracking-[0.14em] text-slate-900">Today&apos;s top items</span>}>
                <TopItems bills={today} empty="No items sold today." />
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ============ PRODUCTS ============ */}
      {tab === "products" && <ProductsTab bills={inPeriod} q={q} setQ={setQ} />}

      {/* ============ CUSTOMERS ============ */}
      {tab === "customers" && <CustomersTab bills={inPeriod} />}

      {/* ============ COUPONS ============ */}
      {tab === "coupons" && (
        <div className="adm-in grid gap-5 xl:grid-cols-[minmax(300px,380px)_1fr]">
          <Card title="Discount Summary">
            <div className="space-y-4">
              {[
                { l: "Total discounts given", v: rupee(sum.discount), c: "text-red-600", i: "%" },
                { l: "Discounted orders", v: String(sum.discounted), c: "text-slate-900", i: "▦" },
                { l: "Guest-applied coupons", v: `${inPeriod.filter((b) => b.couponSource === "guest").length} · ${rupee(inPeriod.filter((b) => b.couponSource === "guest").reduce((a, b) => a + b.couponDiscount, 0))}`, c: "text-sky-600", i: "☺" },
                { l: "Avg discount per order", v: rupee(sum.discounted ? Math.round(sum.discount / sum.discounted) : 0), c: "text-slate-900", i: "₹" },
              ].map((x) => (
                <div key={x.l} className="rounded-2xl border border-stone-100 bg-[#f8f7f3] p-5">
                  <div className="flex items-start justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">{x.l}</span>
                    <span className="text-[15px] font-bold text-red-500">{x.i}</span>
                  </div>
                  <p className={cx("adm-num mt-2 text-[22px] font-extrabold", x.c)}>{x.v}</p>
                </div>
              ))}
              <div className="pt-1">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">By coupon</p>
                {(() => {
                  const m = new Map<string, { n: number; d: number }>();
                  for (const b of inPeriod) if (b.couponCode) m.set(b.couponCode, { n: (m.get(b.couponCode)?.n ?? 0) + 1, d: (m.get(b.couponCode)?.d ?? 0) + b.couponDiscount });
                  const rows = [...m.entries()].sort((a, b) => b[1].d - a[1].d);
                  return rows.length ? (
                    <ul className="space-y-2 text-[13px]">
                      {rows.map(([c, v]) => (
                        <li key={c} className="flex justify-between">
                          <b className="text-slate-800">{c}</b>
                          <span className="text-slate-500">
                            {v.n}× · <span className="font-semibold text-red-600">-{rupee(v.d)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-slate-400">No coupons redeemed in this period.</p>
                  );
                })()}
              </div>
            </div>
          </Card>
          <Card title="Promo Campaign Performance" right={<SearchBox value={q} onChange={setQ} placeholder="Search code/mobile/amount…" className="w-full sm:w-64" />}>
            <div className="overflow-x-auto adm-scroll">
              <table className="w-full min-w-[620px]">
                <thead className="bg-[#f8f7f3]">
                  <tr>
                    <th className={th}>Transaction ID</th>
                    <th className={th}>Customer mobile</th>
                    <th className={th}>Coupon</th>
                    <th className={cx(th, "text-right")}>Order total</th>
                    <th className={cx(th, "text-right")}>Discount applied</th>
                  </tr>
                </thead>
                <tbody>
                  {inPeriod
                    .filter((b) => b.discount > 0)
                    .filter((b) => !needle || `${b.invoiceNo} ${b.customerPhone} ${b.couponCode ?? ""} ${b.subtotal} ${b.discount}`.toLowerCase().includes(needle))
                    .slice()
                    .reverse()
                    .map((b) => (
                      <tr key={b.id} className="border-b border-slate-100 last:border-0">
                        <td className={cx(td, "font-semibold text-slate-900")}>{b.invoiceNo}</td>
                        <td className={cx(td, "font-medium text-slate-700")}>{b.customerPhone || "—"}</td>
                        <td className={td}>{b.couponCode ? <span className="inline-flex items-center gap-1.5"><Badge tone="violet">{b.couponCode}</Badge>{b.couponSource === "guest" && <Badge tone="sky">Guest</Badge>}</span> : <span className="text-[12px] text-slate-400">Manual</span>}</td>
                        <td className={cx(td, "text-right font-semibold text-slate-800")}>{rupee(b.subtotal)}</td>
                        <td className={cx(td, "text-right font-semibold text-red-600")}>-{rupee(b.discount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!inPeriod.some((b) => b.discount > 0) && <Empty icon="coupon" title="No discounted bills in this period" />}
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}

function ProductsTab({ bills, q, setQ }: { bills: Bill[]; q: string; setQ: (v: string) => void }) {
  const { s } = useAdmin();
  const stats = itemStats(bills);
  const total = stats.reduce((a, x) => a + x.revenue, 0) || 1;
  const rows = [
    ...stats,
    ...s.products.filter((p) => !stats.some((x) => x.productId === p.id)).map((p) => ({ key: p.id, productId: p.id, name: p.name, qty: 0, revenue: 0 })),
  ];
  const needle = q.trim().toLowerCase();
  const low = s.products.filter((p) => p.stock !== null && p.stock <= p.lowAt);
  const byQty = [...stats].sort((a, b) => b.qty - a.qty);
  return (
    <div className="adm-in space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Units sold" value={stats.reduce((a, x) => a + x.qty, 0)} hint="In the selected period" icon="box" tone="violet" />
        <Kpi label="Products sold" value={stats.length} hint={`of ${s.products.length} on the catalogue`} icon="list" tone="sky" />
        <Kpi label="Best seller" value={byQty[0]?.name ?? "—"} hint={byQty[0] ? `${byQty[0].qty} pcs` : "No sales yet"} icon="trophy" tone="amber" small />
        <Kpi label="Low / sold out" value={low.length} hint="Check the inventory" icon="alert" tone={low.length ? "red" : "slate"} />
      </div>
      <Card title="Product performance" right={<SearchBox value={q} onChange={setQ} placeholder="Search products…" className="w-full sm:w-64" />}>
        <div className="overflow-x-auto adm-scroll">
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>#</th>
                <th className={th}>Product</th>
                <th className={th}>Category</th>
                <th className={cx(th, "text-right")}>Units</th>
                <th className={cx(th, "text-right")}>Revenue</th>
                <th className={cx(th, "w-[22%]")}>Share</th>
                <th className={cx(th, "text-right")}>In stock</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => !needle || r.name.toLowerCase().includes(needle))
                .map((r, i) => {
                  const p = r.productId ? s.products.find((x) => x.id === r.productId) : null;
                  return (
                    <tr key={r.key} className="border-b border-slate-100 last:border-0">
                      <td className={cx(td, "text-slate-400")}>{i + 1}</td>
                      <td className={cx(td, "font-semibold text-slate-900")}>{r.name}</td>
                      <td className={cx(td, "text-slate-500")}>{p?.category ?? "Custom item"}</td>
                      <td className={cx(td, "text-right font-semibold")}>{r.qty}</td>
                      <td className={cx(td, "text-right font-bold text-slate-900")}>{rupee(r.revenue)}</td>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            {r.revenue > 0 && <div className="adm-fill h-full rounded-full bg-red-600" style={{ width: `${(r.revenue / total) * 100}%` }} />}
                          </div>
                          <span className="w-10 text-right text-[11px] text-slate-500">{Math.round((r.revenue / total) * 100)}%</span>
                        </div>
                      </td>
                      <td className={cx(td, "text-right")}>
                        {!p ? (
                          <span className="text-slate-300">—</span>
                        ) : p.stock === null ? (
                          <span className="text-slate-400">∞</span>
                        ) : (
                          <span className={cx("font-semibold", p.stock <= 0 ? "text-red-600" : p.stock <= p.lowAt ? "text-amber-600" : "text-slate-700")}>{p.stock}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CustomersTab({ bills }: { bills: Bill[] }) {
  const { s } = useAdmin();
  const tbills = bills.filter((b) => b.source === "tab");
  /* A customer is a mobile number; counter walk-ins without one aren't grouped. */
  const byPhone = new Map<string, Bill[]>();
  for (const b of bills) if (b.customerPhone) byPhone.set(b.customerPhone, [...(byPhone.get(b.customerPhone) ?? []), b]);
  const rows = [...byPhone.entries()]
    .map(([phone, mine]) => {
      const revenue = mine.reduce((a, b) => a + b.total, 0);
      return {
        phone,
        name: mine.find((b) => b.customerName)?.customerName ?? "",
        visits: mine.length,
        revenue,
        avg: revenue / mine.length,
        last: Math.max(...mine.map((b) => b.createdAt)),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const max = rows[0]?.revenue || 1;
  const revenue = tbills.reduce((a, b) => a + b.total, 0);
  const durations = tbills
    .map((b) => {
      const sess = s.sessions.find((x) => x.id === b.sessionId);
      return sess ? b.createdAt - sess.openedAt : null;
    })
    .filter((x): x is number => x !== null);
  return (
    <div className="adm-in space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Customers" value={rows.length} hint="Different mobiles billed" icon="users" tone="sky" />
        <Kpi label="Repeat customers" value={rows.filter((r) => r.visits > 1).length} hint="Came back in the period" icon="zap" tone="orange" />
        <Kpi label="Avg spend / visit" value={rupee(tbills.length ? Math.round(revenue / tbills.length) : 0)} hint="Per settled tab" icon="rupee" tone="emerald" />
        <Kpi label="Avg time on a tab" value={durations.length ? `${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60000)} min` : "—"} hint="First order → bill" icon="clock" tone="violet" />
      </div>
      <Card title="Top customers">
        {!rows.length ? (
          <Empty icon="users" title="No customers yet">
            Bills that carry a mobile number show up here.
          </Empty>
        ) : (
          <div className="overflow-x-auto adm-scroll">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Customer</th>
                  <th className={cx(th, "w-[30%]")}>Revenue</th>
                  <th className={cx(th, "text-right")}>Visits</th>
                  <th className={cx(th, "text-right")}>Avg / visit</th>
                  <th className={cx(th, "text-right")}>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.phone} className="border-b border-slate-100 last:border-0">
                    <td className={td}>
                      <b className="block text-slate-900">{r.name || "Guest"}</b>
                      <span className="adm-num text-[12px] text-slate-500">{r.phone}</span>
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-3">
                        <b className="adm-num w-24 shrink-0 text-slate-900">{rupee(r.revenue)}</b>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          {r.revenue > 0 && <div className="adm-fill h-full rounded-full bg-red-600" style={{ width: `${(r.revenue / max) * 100}%` }} />}
                        </div>
                      </div>
                    </td>
                    <td className={cx(td, "text-right font-semibold")}>{r.visits}</td>
                    <td className={cx(td, "text-right")}>{rupee(Math.round(r.avg))}</td>
                    <td className={cx(td, "text-right text-slate-500")}>{fmtDate(r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* What the Total revenue box opens to: how the money came in — cash, UPI (GPay / QR), card — plus
   what coupons took off, and a day-by-day tracker of the same, downloadable as Excel. */
function RevenueBreakdown({ bills, periodLabel }: { bills: Bill[]; periodLabel: string }) {
  const total = round2(bills.reduce((n, b) => n + b.total, 0));
  const by = useMemo(() => {
    const days = new Map<string, { date: string; cash: number; upi: number; card: number; coupon: number; total: number; bills: number }>();
    const coupons = new Map<string, { code: string; bills: number; off: number }>();
    for (const b of bills) {
      const date = shopToday(b.createdAt);
      const d = days.get(date) ?? { date, cash: 0, upi: 0, card: 0, coupon: 0, total: 0, bills: 0 };
      d.cash += b.cashAmount;
      d.upi += b.upiAmount;
      d.card += b.cardAmount;
      d.coupon += b.couponDiscount;
      d.total += b.total;
      d.bills++;
      days.set(date, d);
      if (b.couponCode && b.couponDiscount > 0) {
        const c = coupons.get(b.couponCode) ?? { code: b.couponCode, bills: 0, off: 0 };
        c.bills++;
        c.off += b.couponDiscount;
        coupons.set(b.couponCode, c);
      }
    }
    return { days: [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1)), coupons: [...coupons.values()].sort((a, b) => b.off - a.off) };
  }, [bills]);

  const cash = round2(bills.reduce((n, b) => n + b.cashAmount, 0));
  const upi = round2(bills.reduce((n, b) => n + b.upiAmount, 0));
  const card = round2(bills.reduce((n, b) => n + b.cardAmount, 0));
  const couponOff = round2(bills.reduce((n, b) => n + b.couponDiscount, 0));
  const couponBills = bills.filter((b) => b.couponDiscount > 0).length;
  const rows = [
    { label: "Cash", amount: cash, n: bills.filter((b) => b.cashAmount > 0).length, bar: "bg-emerald-500" },
    { label: "UPI / GPay / QR", amount: upi, n: bills.filter((b) => b.upiAmount > 0).length, bar: "bg-violet-500" },
    { label: "Card", amount: card, n: bills.filter((b) => b.cardAmount > 0).length, bar: "bg-sky-500" },
  ];
  const d2 = (d: string) => d.split("-").reverse().join("/");

  // UPI split by how it reached the shop (WhatsApp link, counter QR, guest's phone…); bills from before this was recorded are "not recorded"
  const upiBy = UPI_CHANNELS.map((c) => ({ label: c.label, amount: round2(bills.filter((b) => b.upiChannel === c.key).reduce((n, b) => n + b.upiAmount, 0)), n: bills.filter((b) => b.upiChannel === c.key && b.upiAmount > 0).length }));
  const upiUnknown = round2(bills.filter((b) => !b.upiChannel).reduce((n, b) => n + b.upiAmount, 0));
  const upiUnknownN = bills.filter((b) => !b.upiChannel && b.upiAmount > 0).length;
  const upiRows = [...upiBy, { label: "Not recorded (older bills)", amount: upiUnknown, n: upiUnknownN }].filter((r) => r.amount > 0);

  const exportExcel = () =>
    downloadExcel(`revenue-by-payment-${periodLabel}-${new Date().toISOString().slice(0, 10)}`, [
      {
        name: "Summary",
        rows: [
          ["Payment", "Amount", "Bills"],
          ...rows.map((r) => [r.label, r.amount, r.n]),
          ...upiRows.map((r) => ["   UPI · " + r.label, r.amount, r.n]),
          ["Total revenue", total, bills.length],
          [],
          ["Coupon discounts given", couponOff, couponBills],
        ],
      },
      { name: "Day by day", rows: [["Date", "Bills", "Cash", "UPI / GPay / QR", "Card", "Coupon discount", "Total"], ...by.days.map((d) => [d2(d.date), d.bills, round2(d.cash), round2(d.upi), round2(d.card), round2(d.coupon), round2(d.total)])] },
      { name: "Coupons", rows: [["Coupon", "Bills", "Discount given"], ...by.coupons.map((c) => [c.code, c.bills, round2(c.off)])] },
    ]);

  if (!bills.length) return <p className="py-6 text-center text-[13px] text-slate-400">No completed bills in this period yet.</p>;
  return (
    <div className="space-y-5">
      <div>
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Collected by payment method</h4>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                <b className="text-slate-800">{r.label}</b>
                <span className="adm-num font-bold text-slate-900">
                  {rupee(r.amount)} <span className="font-medium text-slate-400">· {r.n} bill{r.n === 1 ? "" : "s"} · {total ? Math.round((r.amount / total) * 100) : 0}%</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={cx("h-full rounded-full", r.bar)} style={{ width: `${total ? Math.min(100, (r.amount / total) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
        {upiRows.length > 0 && (
          <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-2.5 text-[12.5px]">
            <p className="mb-1 font-bold text-violet-900">UPI — how it came in</p>
            <ul className="space-y-0.5">
              {upiRows.map((r) => (
                <li key={r.label} className="flex justify-between text-slate-700">
                  <span>{r.label}</span>
                  <span className="adm-num font-semibold">
                    {rupee(r.amount)} <span className="font-normal text-slate-400">· {r.n} bill{r.n === 1 ? "" : "s"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-2.5 text-[13px]">
          <span className="font-bold text-amber-900">Coupons — discount given</span>
          <span className="adm-num font-extrabold text-amber-900">
            {rupee(couponOff)} <span className="font-medium text-amber-700">· {couponBills} bill{couponBills === 1 ? "" : "s"}</span>
          </span>
        </div>
        {by.coupons.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100 text-[12.5px]">
            {by.coupons.map((c) => (
              <li key={c.code} className="flex justify-between px-3.5 py-2">
                <span className="font-mono font-bold tracking-wider text-slate-700">{c.code}</span>
                <span className="text-slate-600">
                  {c.bills} bill{c.bills === 1 ? "" : "s"} · {rupee(c.off)} off
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11.5px] text-slate-400">A split bill counts in each method it used. Cash + UPI + card adds up to total revenue ({rupee(total)}).</p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Day-by-day tracker</h4>
          <button type="button" onClick={exportExcel} className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-emerald-700 hover:underline">
            <Icon name="download" size={14} /> Excel
          </button>
        </div>
        <div className="adm-scroll max-h-[260px] overflow-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead className="sticky top-0 bg-slate-50 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Cash</th>
                <th className="px-3 py-2 text-right">UPI</th>
                <th className="px-3 py-2 text-right">Card</th>
                <th className="px-3 py-2 text-right">Coupon</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {by.days.map((d) => (
                <tr key={d.date} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {d2(d.date)} <span className="text-slate-400">· {d.bills}</span>
                  </td>
                  <td className="adm-num px-3 py-2 text-right">{rupee(d.cash)}</td>
                  <td className="adm-num px-3 py-2 text-right">{rupee(d.upi)}</td>
                  <td className="adm-num px-3 py-2 text-right">{rupee(d.card)}</td>
                  <td className="adm-num px-3 py-2 text-right text-amber-700">{d.coupon ? `-${rupee(d.coupon)}` : "—"}</td>
                  <td className="adm-num px-3 py-2 text-right font-bold text-slate-900">{rupee(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
