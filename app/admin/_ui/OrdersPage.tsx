"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { UPI_CHANNELS, type Bill, type Coupon, type UpiChannel } from "@/lib/types";
import { computeBill, payLabel, payParts, round2, rupee, shopToday } from "@/lib/money";
import { inRange, rangeOf, type Period } from "@/lib/analytics";
import { useAdmin } from "./Store";
import { billText, waLink } from "./receipt";
import PrintModal from "./PrintModal";
import { Badge, Btn, Empty, Field, Icon, Modal, Page, PageHead, SearchBox, Switch, WaIcon, cx, downloadExcel, fmtDate, fmtDateTime, fmtTime, inputCls } from "./kit";

type DateF = Extract<Period, "today" | "week" | "month" | "custom"> | "any";
type PayF = "all" | "cash" | "upi" | "card" | "split";

/* A bill belongs to a payment filter when that method took part in it (a split bill shows
   under every method it used, and under "Split" itself). */
const payHit = (b: Bill, f: PayF) => f === "all" || (f === "split" ? b.payment === "split" : f === "cash" ? b.cashAmount > 0 : f === "upi" ? b.upiAmount > 0 : b.cardAmount > 0);


const th = "px-3 py-4 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap";
const td = "px-3 py-4 text-[13px] whitespace-nowrap";

function Chip({ on, children, onClick, tone = "red" }: { on: boolean; children: React.ReactNode; onClick: () => void; tone?: "red" | "link" }) {
  if (tone === "link")
    return (
      <button type="button" onClick={onClick} className="h-8 rounded-full px-3 text-[13px] font-semibold text-red-600 hover:bg-red-50">
        {children}
      </button>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("h-8 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition", on ? "bg-red-600 text-white shadow-[0_4px_10px_-4px_rgba(107, 117, 80,.9)]" : "bg-slate-100/80 text-slate-700 hover:bg-slate-200")}
    >
      {children}
    </button>
  );
}

export default function OrdersPage() {
  const { s, act, confirm, role } = useAdmin();
  const [type, setType] = useState<"all" | "tab" | "counter">("all");
  const [date, setDate] = useState<DateF>("any");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<PayF>("all");
  const [editing, setEditing] = useState<Bill | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [bill, setBill] = useState<Bill | null>(null);
  const [printFor, setPrintFor] = useState<Bill | null>(null);

  const remove = async (b: Bill) => {
    const body =
      b.status === "completed"
        ? "It is removed from Orders and Analytics for good. Its items go back into stock and any coupon use is given back. This can't be undone."
        : "This voided bill is removed from your records for good. This can't be undone.";
    if (await confirm({ title: `Delete ${b.invoiceNo}?`, body, ok: "Delete bill", danger: true })) {
      const r = await act("bill.delete", { id: b.id });
      if (r.ok && bill?.id === b.id) setBill(null);
    }
  };

  const range = date === "any" ? null : rangeOf(date, from, to);
  const needle = q.trim().toLowerCase();

  /* everything except the payment filter — the boxes below are totals of this */
  const base = useMemo(
    () =>
      s.bills
        .filter((b) => (type === "all" || b.source === type) && inRange(b.createdAt, range))
        .filter((b) => !needle || `${b.invoiceNo} ${b.customerName} ${b.customerPhone} ${b.couponCode ?? ""} ${b.items.map((i) => i.name).join(" ")}`.toLowerCase().includes(needle)),
    [s.bills, type, range, needle],
  );
  const bills = useMemo(() => base.filter((b) => payHit(b, pay)).sort((a, b) => b.createdAt - a.createdAt), [base, pay]);

  /* money collected per payment method, from the completed bills in the date / type / search filters */
  const boxes = useMemo(() => {
    const done = base.filter((b) => b.status === "completed");
    const of = (f: PayF, amt: (b: Bill) => number) => {
      const hit = done.filter((b) => payHit(b, f));
      return { amount: round2(hit.reduce((n, b) => n + amt(b), 0)), count: hit.length };
    };
    return {
      all: { amount: round2(done.reduce((n, b) => n + b.total, 0)), count: done.length },
      cash: of("cash", (b) => b.cashAmount),
      upi: of("upi", (b) => b.upiAmount),
      card: of("card", (b) => b.cardAmount),
      split: of("split", (b) => b.total),
    };
  }, [base]);

  /* Any filter change starts the list again from page 1 (otherwise an invisible
     page number carries over to a shorter result set). */
  // a new filter starts the list again from page 1
  const pageKey = JSON.stringify([type, date, from, to, needle, pay]);
  const [seenKey, setSeenKey] = useState(pageKey);
  if (seenKey !== pageKey) {
    setSeenKey(pageKey);
    setPage(1);
  }

  /* The bills on screen as an Excel workbook with real columns. */
  const exportRows = (): (string | number)[][] => [
    ["Invoice", "Type", "Customer", "Mobile", "Items", "Subtotal", "Coupon", "Coupon discount", "Manual discount", "Extra", "Bill type", "GST %", "Taxable amount", "GST amount", "Total", "Payment", "UPI came through", "Cash", "UPI", "Card", "Status", "Date", "Time", "Reward", "Reward discount", "Points redeemed", "Points discount", "Points earned"],
    ...bills.map((b) => [b.invoiceNo, b.source, b.customerName, b.customerPhone, b.itemCount, b.subtotal, b.couponCode ?? "", b.couponDiscount, b.manualDiscount, b.extra, b.isGst ? "GST" : "Non-GST", b.gstPercent, b.taxableAmount, b.gstAmount, b.total, b.payment, UPI_CHANNELS.find((c) => c.key === b.upiChannel)?.label ?? "", b.cashAmount, b.upiAmount, b.cardAmount, b.status, fmtDate(b.createdAt), fmtTime(b.createdAt), b.rewardName ?? "", b.rewardDiscount, b.pointsRedeemed, b.pointsDiscount, b.pointsEarned]),
  ];
  const stamp = () => new Date().toISOString().slice(0, 10);
  const exportExcel = () => downloadExcel(`bills-${stamp()}.xlsx`, [{ name: "Bills", rows: exportRows() }]);

  const count = bills.length;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = bills.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pages, p)));

  return (
    <Page>
      <PageHead
        title="Order Management"
        right={
          <Link href="/admin/billing" className="inline-flex h-11 items-center gap-2 rounded-xl bg-red-600 px-5 text-[14px] font-bold text-white shadow-[0_6px_16px_-8px_rgba(107, 117, 80,.8)] hover:bg-red-700">
            <Icon name="cart" size={18} /> Open POS
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {(
          [
            ["all", "All payments", "Total billed", "bg-slate-100 text-slate-600"],
            ["cash", "Cash", "Collected in cash", "bg-emerald-50 text-emerald-600"],
            ["upi", "UPI / GPay / QR", "Collected by UPI", "bg-violet-50 text-violet-600"],
            ["card", "Card", "Collected by card", "bg-sky-50 text-sky-600"],
            ["split", "Split bills", "Paid with 2+ methods", "bg-amber-50 text-amber-600"],
          ] as const
        ).map(([k, label, hint, tone]) => (
          <button
            key={k}
            type="button"
            onClick={() => setPay(pay === k ? "all" : k)}
            aria-pressed={pay === k}
            className={cx("min-w-0 rounded-2xl border bg-white p-4 text-left shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)] transition hover:border-slate-300 active:scale-[.99]", pay === k ? "border-red-300 ring-2 ring-red-100" : "border-slate-100")}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">{label}</span>
              <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full", tone)}>
                <Icon name="rupee" size={14} stroke={2.4} />
              </span>
            </div>
            <div className="adm-num mt-2 truncate text-[22px] font-extrabold text-slate-900">{rupee(boxes[k].amount)}</div>
            <p className="mt-1 truncate text-[11px] text-slate-400">
              {boxes[k].count} bill{boxes[k].count === 1 ? "" : "s"} · {hint}
            </p>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-slate-100 p-5 shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)] lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Type</span>
            {(
              [
                ["all", "All Bills"],
                ["tab", "Customer tab"],
                ["counter", "Counter"],
              ] as const
            ).map(([v, t]) => (
              <Chip key={v} on={type === v} onClick={() => setType(v)}>
                {t}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Paid by</span>
            {(
              [
                ["all", "All"],
                ["cash", "Cash"],
                ["upi", "UPI"],
                ["card", "Card"],
                ["split", "Split"],
              ] as const
            ).map(([v, t]) => (
              <Chip key={v} on={pay === v} onClick={() => setPay(v)}>
                {t}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Date</span>
            {(
              [
                ["today", "Today"],
                ["week", "This Week"],
                ["month", "This Month"],
                ["custom", "Custom Range"],
              ] as const
            ).map(([v, t]) => (
              <Chip key={v} on={date === v} onClick={() => setDate(v)}>
                {t}
              </Chip>
            ))}
            {date !== "any" && (
              <Chip on={false} tone="link" onClick={() => (setDate("any"), setFrom(""), setTo(""))}>
                Clear Dates
              </Chip>
            )}
            {date === "custom" && (
              <span className="adm-in flex items-center gap-2 text-[12px] text-slate-500">
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-slate-800" />
                to
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-slate-800" />
              </span>
            )}
          </div>
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search invoice, name, mobile, item…" className="w-full lg:w-80" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-[12.5px] font-semibold text-slate-600">{count} result(s)</span>
        <button type="button" onClick={exportExcel} disabled={!count} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 hover:underline disabled:opacity-40">
          <Icon name="download" size={15} /> Export Excel
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)]">
        <div className="overflow-x-auto adm-scroll">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={th}>Invoice no</th>
                  <th className={th}>Customer name</th>
                  <th className={th}>Mobile</th>
                  <th className={th}>Bill type</th>
                  <th className={th}>Total</th>
                  <th className={th}>Payment</th>
                  <th className={th}>Date</th>
                  <th className={cx(th, "text-center")}>Status</th>
                  <th className={cx(th, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((b) => (
                  <tr key={b.id} className={cx("border-b border-slate-100 transition-colors hover:bg-slate-50/60", b.status === "void" && "opacity-55")}>
                    <td className={td}>
                      <button type="button" onClick={() => setBill(b)} className="inline-flex items-center gap-2 font-bold text-red-600">
                        {b.invoiceNo}
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-slate-50 text-slate-400">
                          <Icon name="external" size={13} />
                        </span>
                      </button>
                    </td>
                    <td className={cx(td, "font-semibold text-slate-800")}>{b.customerName || "—"}</td>
                    <td className={cx(td, "adm-num text-slate-600")}>{b.customerPhone || <span className="text-slate-400">—</span>}</td>
                    <td className={td}>{b.source === "tab" ? <Badge tone="orange">Customer tab</Badge> : <Badge tone="sky">Counter</Badge>}</td>
                    <td className={cx(td, "font-bold text-slate-900")}>{rupee(b.total)}</td>
                    <td className={cx(td, "text-slate-600")}>{payLabel(b)}</td>
                    <td className={cx(td, "text-slate-600")}>{fmtDate(b.createdAt)}</td>
                    <td className={cx(td, "text-center")}>{b.status === "completed" ? <Badge tone="green">Completed</Badge> : <Badge tone="slate">Void</Badge>}</td>
                    <td className={cx(td, "text-right")}>
                      <span className="inline-flex gap-1.5">
                        {b.customerPhone && (
                          <a suppressHydrationWarning href={waLink(b.customerPhone, billText(b, s.settings.shopName, s.settings.publicUrl))} target="_blank" rel="noopener noreferrer" title="Send on WhatsApp" aria-label="Send on WhatsApp" className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-[#22c55e] hover:bg-emerald-100">
                            <WaIcon size={18} />
                          </a>
                        )}
                        <button type="button" title="View details" aria-label="View details" onClick={() => setBill(b)} className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                          <Icon name="eye" size={16} />
                        </button>
                        <button type="button" title="Edit details" aria-label="Edit details" onClick={() => setEditing(b)} className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                          <Icon name="edit" size={16} />
                        </button>
                        <button type="button" title="Print receipt" aria-label="Print receipt" onClick={() => setPrintFor(b)} className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                          <Icon name="print" size={16} />
                        </button>
                        {role === "admin" && (
                          <button type="button" title="Delete bill" aria-label="Delete bill" onClick={() => remove(b)} className="grid h-9 w-9 place-items-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100">
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          {!count && (
            <Empty icon="billing" title="No bills match">
              Settled tabs and counter bills show up here.
            </Empty>
          )}
        </div>
      </div>
      {pages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-slate-500">
          <span>
            {(safePage - 1) * PAGE_SIZE + 1}–{(safePage - 1) * PAGE_SIZE + slice.length} of {count}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={safePage <= 1} onClick={() => goto(safePage - 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">← Prev</button>
            <span className="min-w-[96px] text-center font-semibold text-slate-700">Page {safePage} of {pages}</span>
            <button type="button" disabled={safePage >= pages} onClick={() => goto(safePage + 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">Next →</button>
          </span>
        </div>
      )}

      <PrintModal bill={printFor} onClose={() => setPrintFor(null)} />
      {editing && (
        <EditBill
          key={editing.id}
          b={editing}
          admin={role === "admin"}
          onClose={() => setEditing(null)}
          onSaved={(nb) => {
            if (bill?.id === nb.id) setBill(nb);
          }}
        />
      )}

      {/* ---------- bill detail ---------- */}
      <Modal
        open={!!bill}
        onClose={() => setBill(null)}
        title={bill?.invoiceNo ?? ""}
        footer={
          bill && (
            <>
              {bill.status === "completed" && (
                <Btn
                  kind="plain"
                  className="mr-auto text-red-600"
                  onClick={async () => {
                    if (await confirm({ title: `Void ${bill.invoiceNo}?`, body: "It drops out of revenue, its items return to stock and any coupon use is given back. This can't be undone.", ok: "Void bill", danger: true })) {
                      const r = await act<Bill>("bill.void", { id: bill.id });
                      if (r.ok) setBill(r.result);
                    }
                  }}
                >
                  Void bill
                </Btn>
              )}
              {bill.customerPhone && (
                <a href={waLink(bill.customerPhone, billText(bill, s.settings.shopName, s.settings.publicUrl))} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#22c55e] px-4 text-[13px] font-semibold text-white hover:bg-[#16a34a]">
                  <WaIcon size={16} /> WhatsApp
                </a>
              )}
              <a href={`/invoice/${bill.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-xl border border-slate-200 px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                View invoice
              </a>
              <Btn icon="edit" onClick={() => setEditing(bill)}>
                Edit details
              </Btn>
              <Btn kind="dark" icon="print" onClick={() => setPrintFor(bill)}>
                Print
              </Btn>
            </>
          )
        }
      >
        {bill && (
          <div className="text-[13.5px]">
            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4">
              <p>
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Customer</span>
                <b>{bill.customerName || "—"}</b>
                <span className="block text-slate-500">{bill.customerPhone || "no phone"}</span>
              </p>
              <p className="text-right">
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{bill.source === "tab" ? "Customer tab" : "Counter"}</span>
                <b>{fmtDateTime(bill.createdAt)}</b>
                <span className="block">{bill.status === "completed" ? <Badge tone="green">Completed</Badge> : <Badge tone="slate">Void</Badge>}</span>
              </p>
            </div>
            <ul className="my-4 divide-y divide-dashed divide-slate-200">
              {bill.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-3 py-2">
                  <span>
                    <b>{i.qty}×</b> {i.name} <span className="text-slate-400">@ {rupee(i.price)}</span>
                  </span>
                  <b>{rupee(i.qty * i.price)}</b>
                </li>
              ))}
            </ul>
            <dl className="space-y-1.5 border-t border-slate-200 pt-3">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal ({bill.itemCount} items)</dt>
                <dd>{rupee(bill.subtotal)}</dd>
              </div>
              {bill.couponDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>
                    Coupon {bill.couponCode} ({bill.couponPercent}%)
                  </dt>
                  <dd>-{rupee(bill.couponDiscount)}</dd>
                </div>
              )}
              {bill.manualDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>Discount{bill.manualType === "percent" ? ` (${bill.manualValue}%)` : ""}</dt>
                  <dd>-{rupee(bill.manualDiscount)}</dd>
                </div>
              )}
              {bill.rewardDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>Reward {bill.rewardName}</dt>
                  <dd>-{rupee(bill.rewardDiscount)}</dd>
                </div>
              )}
              {bill.pointsDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>Loyalty points ({bill.pointsRedeemed} pts)</dt>
                  <dd>-{rupee(bill.pointsDiscount)}</dd>
                </div>
              )}
              {bill.pointsEarned > 0 && (
                <div className="flex justify-between text-amber-700">
                  <dt>Loyalty points earned</dt>
                  <dd>{bill.pointsEarned} pts</dd>
                </div>
              )}
              {bill.extra > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Extra charges</dt>
                  <dd>{rupee(bill.extra)}</dd>
                </div>
              )}
              {bill.isGst ? (
                <div className="flex justify-between">
                  <dt className="text-slate-500">GST ({bill.gstPercent}%) on {rupee(bill.taxableAmount)}</dt>
                  <dd>{rupee(bill.gstAmount)}</dd>
                </div>
              ) : (
                <div className="flex justify-between text-slate-400">
                  <dt>Non-GST bill</dt>
                  <dd>GST not applicable</dd>
                </div>
              )}
              <div className="flex justify-between pt-2 text-[17px]">
                <dt className="font-bold">Grand total</dt>
                <dd className="adm-num font-extrabold">{rupee(bill.total)}</dd>
              </div>
              <div className="flex justify-between text-slate-500">
                <dt>Paid · {payLabel(bill)}</dt>
                <dd>
                  {rupee(bill.received)}
                  {bill.change > 0 && ` (change ${rupee(bill.change)})`}
                </dd>
              </div>
              {bill.payment === "split" && (
                <div className="flex justify-between text-[12px] text-slate-400">
                  <dt>Split</dt>
                  <dd>{payParts(bill).map(([m, n]) => `${m} ${rupee(n)}`).join(" · ")}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </Modal>
    </Page>
  );
}

let itemSeq = 0; // keys for the item rows in the edit form

/* Edit an invoice: who it was for, its date, its items and prices, the discount, extra charges
   and GST (the total is worked out again), and how it was paid. Changing quantities puts stock
   back or takes it out. A bill that earned or used loyalty points, or a voided one, keeps its
   amounts — void it and bill again for those. Staff edits go to the admin to approve. */
function EditBill({ b, admin, onClose, onSaved }: { b: Bill; admin: boolean; onClose: () => void; onSaved: (b: Bill) => void }) {
  const { act, toast } = useAdmin();
  const [f, setF] = useState({
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    invoiceDate: shopToday(b.createdAt),
    payment: b.payment as string,
    cashAmount: b.cashAmount ? String(b.cashAmount) : "",
    upiAmount: b.upiAmount ? String(b.upiAmount) : "",
    cardAmount: b.cardAmount ? String(b.cardAmount) : "",
    upiChannel: (b.upiChannel || "counter_qr") as UpiChannel,
    manualType: b.manualType as string,
    manualValue: b.manualValue ? String(b.manualValue) : "",
    extra: b.extra ? String(b.extra) : "",
    isGst: b.isGst,
    gstPercent: String(b.gstPercent || 18),
  });
  const [items, setItems] = useState(() => b.items.map((i) => ({ key: ++itemSeq, productId: i.productId, name: i.name, price: String(i.price), qty: i.qty })));
  const [busy, setBusy] = useState(false);

  const loyaltyLocked = !!b.loyaltyCustomerId || b.pointsEarned > 0 || b.pointsRedeemed > 0 || b.rewardDiscount > 0 || b.pointsDiscount > 0;
  const amountsLocked = loyaltyLocked || b.status !== "completed";
  const setItem = (key: number, p: Partial<(typeof items)[number]>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // the new totals, worked out the way the server will
  const coupon: Coupon | null = b.couponCode ? { id: "", audience: "all", code: b.couponCode, percent: b.couponPercent, minOrder: 0, expiresAt: null, limit: null, used: 0, active: true, restricted: false, phones: [], sent: 0, createdAt: 0 } : null;
  const clean = items.filter((i) => i.name.trim() && Number(i.price) >= 0 && i.qty >= 1).map((i) => ({ productId: i.productId, name: i.name.trim(), price: Number(i.price) || 0, qty: i.qty }));
  const calc = computeBill({ items: clean, coupon, manualType: f.manualType === "percent" ? "percent" : "amount", manualValue: Number(f.manualValue) || 0, extra: Number(f.extra) || 0, gst: f.isGst, gstPercent: Number(f.gstPercent) || 0 });
  const total = amountsLocked ? b.total : calc.total;

  const split = f.payment === "split";
  const sum = round2((Number(f.cashAmount) || 0) + (Number(f.upiAmount) || 0) + (Number(f.cardAmount) || 0));
  const splitBad = split && Math.abs(sum - total) > 0.01;
  const noItems = !amountsLocked && !clean.length;

  const save = async () => {
    setBusy(true);
    const r = await act<Bill>("bill.edit", {
      id: b.id,
      customerName: f.customerName,
      customerPhone: f.customerPhone,
      invoiceDate: f.invoiceDate,
      payment: f.payment,
      cashAmount: f.cashAmount,
      upiAmount: f.upiAmount,
      cardAmount: f.cardAmount,
      ...(f.payment === "upi" || (split && Number(f.upiAmount) > 0) ? { upiChannel: f.upiChannel } : {}),
      ...(amountsLocked ? {} : { items: clean, manualType: f.manualType, manualValue: f.manualValue, extra: f.extra, isGst: f.isGst, gstPercent: f.gstPercent }),
    });
    setBusy(false);
    if (r.ok) {
      if (!r.pending) {
        toast({ kind: "ok", title: `${b.invoiceNo} updated` });
        onSaved(r.result);
      }
      onClose();
    }
  };

  const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500";
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Edit invoice · ${b.invoiceNo}`}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="dark" disabled={busy || splitBad || noItems} onClick={save}>
            {busy ? "Saving…" : admin ? "Save changes" : "Send for approval"}
          </Btn>
        </>
      }
    >
      <div className="space-y-5">
        {!admin && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-[12.5px] font-semibold text-amber-800">Your changes go to the admin, and apply only once they approve.</p>}

        <section className="grid gap-3 sm:grid-cols-3">
          <Field label="Customer name">
            <input className={inputCls} value={f.customerName} maxLength={80} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
          </Field>
          <Field label="Mobile" hint={loyaltyLocked ? "Fixed — this bill used loyalty." : undefined}>
            <input className={inputCls} inputMode="numeric" disabled={loyaltyLocked} value={f.customerPhone} maxLength={14} onChange={(e) => setF({ ...f, customerPhone: e.target.value.replace(/[^\d+ ]/g, "") })} />
          </Field>
          <Field label="Invoice date" hint={loyaltyLocked ? "Fixed — this bill used loyalty." : undefined}>
            <input className={inputCls} type="date" disabled={loyaltyLocked} max={shopToday()} value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} />
          </Field>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className={lbl}>Items</span>
            {!amountsLocked && (
              <Btn size="sm" icon="plus" onClick={() => setItems((xs) => [...xs, { key: ++itemSeq, productId: null, name: "", price: "", qty: 1 }])}>
                Add item
              </Btn>
            )}
          </div>
          {amountsLocked && (
            <p className="mb-2 rounded-xl bg-slate-50 px-3.5 py-2 text-[12.5px] text-slate-600">
              {b.status !== "completed" ? "This bill is void, so its items and amounts can't be changed." : "This bill earned or used loyalty points, so its items and amounts are fixed. Void it and bill again to change them."}
            </p>
          )}
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.key} className="grid grid-cols-[1fr_88px_72px_auto] items-center gap-2">
                <input className={inputCls} disabled={amountsLocked} value={i.name} maxLength={120} placeholder="Item" onChange={(e) => setItem(i.key, { name: e.target.value })} aria-label="Item name" />
                <input className={cx(inputCls, "text-right")} disabled={amountsLocked} type="number" min={0} step="0.5" inputMode="decimal" value={i.price} placeholder="Price" onChange={(e) => setItem(i.key, { price: e.target.value })} aria-label="Price" />
                <input className={cx(inputCls, "text-right")} disabled={amountsLocked} type="number" min={1} max={999} step={1} inputMode="numeric" value={i.qty} onChange={(e) => setItem(i.key, { qty: Math.max(1, Math.min(999, Math.floor(Number(e.target.value)) || 1)) })} aria-label="Quantity" />
                {!amountsLocked && items.length > 1 ? (
                  <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))} className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove item">
                    <Icon name="x" size={15} />
                  </button>
                ) : (
                  <span className="w-10" />
                )}
              </li>
            ))}
          </ul>
        </section>

        {!amountsLocked && (
          <section className="grid gap-3 sm:grid-cols-3">
            <Field label="Discount">
              <div className="flex gap-2">
                <select className={cx(inputCls, "w-20")} value={f.manualType} onChange={(e) => setF({ ...f, manualType: e.target.value })} aria-label="Discount type">
                  <option value="amount">₹</option>
                  <option value="percent">%</option>
                </select>
                <input className={inputCls} type="number" min={0} step="0.5" inputMode="decimal" value={f.manualValue} placeholder="0" onChange={(e) => setF({ ...f, manualValue: e.target.value })} />
              </div>
            </Field>
            <Field label="Extra charges (₹)">
              <input className={inputCls} type="number" min={0} step="0.5" inputMode="decimal" value={f.extra} placeholder="0" onChange={(e) => setF({ ...f, extra: e.target.value })} />
            </Field>
            <Field label="GST">
              <div className="flex items-center gap-3">
                <Switch on={f.isGst} onChange={(v) => setF({ ...f, isGst: v })} label="GST invoice" />
                {f.isGst && <input className={cx(inputCls, "w-24")} type="number" min={0} max={100} step="0.5" inputMode="decimal" value={f.gstPercent} onChange={(e) => setF({ ...f, gstPercent: e.target.value })} aria-label="GST percent" />}
                {f.isGst && <span className="text-[12px] text-slate-500">%</span>}
              </div>
            </Field>
          </section>
        )}

        <section className="rounded-2xl bg-slate-50 p-4 text-[13px]">
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd>{rupee(amountsLocked ? b.subtotal : calc.subtotal)}</dd>
            </div>
            {(amountsLocked ? b.discount : calc.discount) > 0 && (
              <div className="flex justify-between text-red-600">
                <dt>Discounts{b.couponCode ? ` (incl. ${b.couponCode})` : ""}</dt>
                <dd>-{rupee(amountsLocked ? b.discount : calc.discount)}</dd>
              </div>
            )}
            {(amountsLocked ? b.extra : calc.extra) > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Extra charges</dt>
                <dd>{rupee(amountsLocked ? b.extra : calc.extra)}</dd>
              </div>
            )}
            {(amountsLocked ? b.isGst : f.isGst) && (
              <div className="flex justify-between">
                <dt className="text-slate-500">GST ({amountsLocked ? b.gstPercent : calc.gstPercent}%)</dt>
                <dd>{rupee(amountsLocked ? b.gstAmount : calc.gstAmount)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-[16px]">
              <dt className="font-bold">Invoice total</dt>
              <dd className="adm-num font-extrabold">
                {rupee(total)}
                {total !== b.total && <span className="ml-2 text-[12px] font-semibold text-slate-400 line-through">{rupee(b.total)}</span>}
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3">
          <Field label="Paid by" hint={b.status !== "completed" ? "A voided bill's payment can't be changed." : total !== b.total ? "The total changed — check how it was paid." : undefined}>
            <select className={inputCls} disabled={b.status !== "completed"} value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })}>
              <option value="cash">Cash</option>
              <option value="upi">UPI / GPay / QR</option>
              <option value="card">Card</option>
              <option value="split">Split (two or more)</option>
            </select>
          </Field>
          {(f.payment === "upi" || (split && Number(f.upiAmount) > 0)) && (
            <Field label="UPI payment came through">
              <select className={inputCls} disabled={b.status !== "completed"} value={f.upiChannel} onChange={(e) => setF({ ...f, upiChannel: e.target.value as UpiChannel })}>
                {UPI_CHANNELS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {split && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["cashAmount", "Cash"],
                    ["upiAmount", "UPI"],
                    ["cardAmount", "Card"],
                  ] as const
                ).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input className={inputCls} type="number" min={0} step="0.01" inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <p className={cx("text-[12px] font-semibold", splitBad ? "text-red-600" : "text-emerald-700")}>
                {rupee(sum)} of {rupee(total)}
                {splitBad ? ` — ${rupee(Math.abs(round2(total - sum)))} ${sum < total ? "short" : "over"}` : " — adds up"}
              </p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
