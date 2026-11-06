"use client";

import { useEffect, useMemo, useState } from "react";
import type { Supplier, SupplierInvoice } from "@/lib/types";
import { round2, rupee, shopToday } from "@/lib/money";
import { inRange, rangeOf, type Period } from "@/lib/analytics";
import { useAdmin } from "./Store";
import { Badge, Btn, Card, DateRange, Empty, Field, Kpi, Modal, Page, PageHead, Pills, SearchBox, cx, downloadExcel, inputCls } from "./kit";

/* Suppliers and the purchase invoices they send: who, when, the price before GST, the GST on
   it, the total, and how much of it has been paid. Kept apart from Expenses. */

const th = "px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap";
const td = "px-4 py-3 text-[13px]";
const ddmmyyyy = (d: string) => (d ? d.split("-").reverse().join("/") : "—");
const atMs = (d: string) => new Date(`${d}T12:00:00`).getTime();
const MODES = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["bank", "Bank transfer"],
  ["cheque", "Cheque"],
] as const;
const GST_RATES = ["0", "5", "12", "18", "28"];

type SForm = { id?: string; name: string; contactPerson: string; phone: string; email: string; gstin: string; address: string; supplies: string; notes: string; active: boolean };
const S_BLANK: SForm = { name: "", contactPerson: "", phone: "", email: "", gstin: "", address: "", supplies: "", notes: "", active: true };

type IForm = { id?: string; supplierId: string; invoiceNo: string; invoiceDate: string; price: string; gstPercent: string; paidAmount: string; paymentMode: string; dueDate: string; notes: string };

const settle = (i: SupplierInvoice) => (i.paidAmount >= i.total - 0.005 ? "paid" : i.paidAmount > 0 ? "part" : "unpaid");
const STATUS = { paid: ["Paid", "green"], part: ["Part paid", "amber"], unpaid: ["Unpaid", "red"] } as const;

export default function SuppliersPage() {
  const { s, act, confirm, toast } = useAdmin();
  const [tab, setTab] = useState<"invoices" | "suppliers">("invoices");
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [supplier, setSupplier] = useState("all");
  const [status, setStatus] = useState<"all" | "paid" | "part" | "unpaid">("all");
  const [q, setQ] = useState("");
  const [sForm, setSForm] = useState<SForm | null>(null);
  const [iForm, setIForm] = useState<IForm | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const byId = useMemo(() => new Map(s.suppliers.map((x) => [x.id, x])), [s.suppliers]);
  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);
  // a new filter starts the list again from page 1
  const pageKey = JSON.stringify([period, from, to, supplier, status, q]);
  const [seenKey, setSeenKey] = useState(pageKey);
  if (seenKey !== pageKey) {
    setSeenKey(pageKey);
    setPage(1);
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return s.supplierInvoices.filter((i) => {
      if (!inRange(atMs(i.invoiceDate), range)) return false;
      if (supplier !== "all" && i.supplierId !== supplier) return false;
      if (status !== "all" && settle(i) !== status) return false;
      return !needle || `${i.invoiceNo} ${byId.get(i.supplierId)?.name ?? ""} ${i.notes}`.toLowerCase().includes(needle);
    });
  }, [s.supplierInvoices, range, supplier, status, q, byId]);

  const tot = useMemo(() => ({ price: round2(rows.reduce((a, i) => a + i.price, 0)), gst: round2(rows.reduce((a, i) => a + i.gstAmount, 0)), total: round2(rows.reduce((a, i) => a + i.total, 0)), due: round2(rows.reduce((a, i) => a + (i.total - i.paidAmount), 0)) }), [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* per-supplier totals over all time, for the Suppliers tab */
  const perSupplier = useMemo(() => {
    const m = new Map<string, { n: number; billed: number; due: number }>();
    for (const i of s.supplierInvoices) {
      const x = m.get(i.supplierId) ?? { n: 0, billed: 0, due: 0 };
      x.n++;
      x.billed += i.total;
      x.due += i.total - i.paidAmount;
      m.set(i.supplierId, x);
    }
    return m;
  }, [s.supplierInvoices]);

  const openInvoice = (i?: SupplierInvoice, supplierId?: string) =>
    setIForm(
      i
        ? { id: i.id, supplierId: i.supplierId, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, price: String(i.price), gstPercent: String(i.gstPercent), paidAmount: i.paidAmount ? String(i.paidAmount) : "", paymentMode: i.paymentMode, dueDate: i.dueDate, notes: i.notes }
        : { supplierId: supplierId ?? (supplier !== "all" ? supplier : s.suppliers.find((x) => x.active)?.id ?? ""), invoiceNo: "", invoiceDate: shopToday(), price: "", gstPercent: "18", paidAmount: "", paymentMode: "cash", dueDate: "", notes: "" },
    );

  const exportExcel = () => {
    const head = ["Date", "Invoice no", "Supplier", "Supplier GSTIN", "Price (before GST)", "GST %", "GST amount", "Total", "Paid", "Balance", "Status", "Paid by", "Due date", "Notes"];
    const body = rows.map((i) => {
      const sp = byId.get(i.supplierId);
      return [ddmmyyyy(i.invoiceDate), i.invoiceNo, sp?.name ?? "", sp?.gstin ?? "", i.price, i.gstPercent, i.gstAmount, i.total, i.paidAmount, round2(i.total - i.paidAmount), STATUS[settle(i)][0], i.paymentMode.toUpperCase(), ddmmyyyy(i.dueDate), i.notes];
    });
    downloadExcel(`supplier-invoices-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "Invoices", rows: [head, ...body, ["", "", "", "Total", tot.price, "", tot.gst, tot.total, "", tot.due, "", "", "", ""]] },
      { name: "Suppliers", rows: [["Name", "Contact", "Phone", "Email", "GSTIN", "Supplies", "Address", "Invoices", "Billed", "Balance due"], ...s.suppliers.map((x) => [x.name, x.contactPerson, x.phone, x.email, x.gstin, x.supplies, x.address, perSupplier.get(x.id)?.n ?? 0, round2(perSupplier.get(x.id)?.billed ?? 0), round2(perSupplier.get(x.id)?.due ?? 0)])] },
    ]);
  };

  const removeSupplier = async (x: Supplier) => {
    if (await confirm({ title: `Delete ${x.name}?`, body: "Only possible when the supplier has no invoices.", ok: "Delete", danger: true })) await act("supplier.delete", { id: x.id });
  };
  const removeInvoice = async (i: SupplierInvoice) => {
    if (await confirm({ title: `Delete invoice ${i.invoiceNo}?`, body: `${byId.get(i.supplierId)?.name ?? "Supplier"} · ${rupee(i.total)}`, ok: "Delete", danger: true })) await act("supplierinv.delete", { id: i.id });
  };

  return (
    <Page>
      <PageHead
        title="Suppliers"
        sub="Who you buy from, and every purchase invoice with its price, GST and payment."
        right={
          <span className="flex flex-wrap gap-2">
            <Btn icon="download" onClick={exportExcel} disabled={!s.supplierInvoices.length && !s.suppliers.length}>
              Download Excel
            </Btn>
            <Btn icon="plus" onClick={() => setSForm(S_BLANK)}>
              Add supplier
            </Btn>
            <Btn kind="red" icon="plus" disabled={!s.suppliers.length} title={s.suppliers.length ? "" : "Add a supplier first"} onClick={() => openInvoice()}>
              Add invoice
            </Btn>
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Purchases (incl. GST)" value={rupee(tot.total)} hint={tab === "invoices" ? "In the filtered range" : "Filtered range"} icon="bag" tone="rose" />
        <Kpi label="Price before GST" value={rupee(tot.price)} hint="Taxable value" icon="rupee" tone="slate" />
        <Kpi label="GST on purchases" value={rupee(tot.gst)} hint="Input GST paid to suppliers" icon="percent" tone="amber" />
        <Kpi label="Balance due" value={rupee(tot.due)} hint="Still to pay suppliers" icon="clock" tone="sky" />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Pills
          value={tab}
          onChange={setTab}
          options={[
            { v: "invoices", t: `Invoices · ${s.supplierInvoices.length}` },
            { v: "suppliers", t: `Suppliers · ${s.suppliers.length}` },
          ]}
        />
        {tab === "invoices" && (
          <>
            <Pills
              value={period}
              onChange={setPeriod}
              options={[
                { v: "all", t: "All" },
                { v: "today", t: "Today" },
                { v: "week", t: "Week" },
                { v: "month", t: "Month" },
                { v: "year", t: "Year" },
                { v: "custom", t: "Custom" },
              ]}
            />
            {period === "custom" && <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
          </>
        )}
      </div>

      {tab === "invoices" ? (
        <Card
          title="Supplier invoices"
          right={
            <span className="flex flex-wrap items-center gap-2">
              <select className="h-9 rounded-full border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier">
                <option value="all">All suppliers</option>
                {s.suppliers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <select className="h-9 rounded-full border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Payment status">
                <option value="all">Any status</option>
                <option value="unpaid">Unpaid</option>
                <option value="part">Part paid</option>
                <option value="paid">Paid</option>
              </select>
              <SearchBox value={q} onChange={setQ} placeholder="Invoice no, supplier…" className="w-48" />
            </span>
          }
        >
          {!rows.length ? (
            <Empty icon="bag" title={s.supplierInvoices.length ? "No invoices match" : "No invoices yet"}>
              {s.suppliers.length ? (s.supplierInvoices.length ? null : "Add an invoice to record what you bought, the GST and what you've paid.") : "Add a supplier first, then record their invoices here."}
            </Empty>
          ) : (
            <div className="adm-scroll overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Invoice no</th>
                    <th className={th}>Supplier</th>
                    <th className={cx(th, "text-right")}>Price</th>
                    <th className={cx(th, "text-right")}>GST</th>
                    <th className={cx(th, "text-right")}>Total</th>
                    <th className={th}>Payment</th>
                    <th className={cx(th, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((i) => {
                    const st = settle(i);
                    const bal = round2(i.total - i.paidAmount);
                    return (
                      <tr key={i.id} className="border-b border-slate-100 last:border-0">
                        <td className={cx(td, "whitespace-nowrap text-slate-600")}>{ddmmyyyy(i.invoiceDate)}</td>
                        <td className={td}>
                          <b className="text-slate-900">{i.invoiceNo}</b>
                          {i.notes && <span className="block max-w-[200px] truncate text-[11.5px] text-slate-400">{i.notes}</span>}
                        </td>
                        <td className={td}>{byId.get(i.supplierId)?.name ?? "—"}</td>
                        <td className={cx(td, "adm-num text-right")}>{rupee(i.price)}</td>
                        <td className={cx(td, "adm-num text-right")}>
                          {rupee(i.gstAmount)}
                          <span className="block text-[11px] text-slate-400">{i.gstPercent}%</span>
                        </td>
                        <td className={cx(td, "adm-num text-right font-bold text-slate-900")}>{rupee(i.total)}</td>
                        <td className={td}>
                          <Badge tone={STATUS[st][1]}>{STATUS[st][0]}</Badge>
                          {bal > 0 && (
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {rupee(bal)} due{i.dueDate ? ` by ${ddmmyyyy(i.dueDate)}` : ""}
                            </span>
                          )}
                        </td>
                        <td className={cx(td, "text-right")}>
                          <span className="inline-flex gap-3 text-[11px] font-extrabold uppercase">
                            <button type="button" className="text-blue-600 hover:underline" onClick={() => openInvoice(i)}>
                              Edit
                            </button>
                            <button type="button" className="text-red-600 hover:underline" onClick={() => removeInvoice(i)}>
                              Del
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 text-[13px] font-bold text-slate-900">
                  <tr>
                    <td className={td} colSpan={3}>
                      Total · {rows.length} invoice{rows.length === 1 ? "" : "s"}
                    </td>
                    <td className={cx(td, "adm-num text-right")}>{rupee(tot.price)}</td>
                    <td className={cx(td, "adm-num text-right")}>{rupee(tot.gst)}</td>
                    <td className={cx(td, "adm-num text-right")}>{rupee(tot.total)}</td>
                    <td className={td} colSpan={2}>
                      {tot.due > 0 ? `${rupee(tot.due)} due` : ""}
                    </td>
                  </tr>
                </tfoot>
              </table>
              {pages > 1 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 text-[12.5px] text-slate-500">
                  <span>
                    {(safePage - 1) * PAGE_SIZE + 1}–{(safePage - 1) * PAGE_SIZE + slice.length} of {rows.length}
                  </span>
                  <span className="flex items-center gap-2">
                    <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">
                      ← Prev
                    </button>
                    <span className="min-w-[96px] text-center font-semibold text-slate-700">
                      Page {safePage} of {pages}
                    </span>
                    <button type="button" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">
                      Next →
                    </button>
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card title="Supplier details">
          {!s.suppliers.length ? (
            <Empty icon="users" title="No suppliers yet">
              Add the people and companies you buy from — name, contact, GST number and what they supply.
            </Empty>
          ) : (
            <div className="adm-scroll overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Supplier</th>
                    <th className={th}>Contact</th>
                    <th className={th}>GSTIN</th>
                    <th className={th}>Supplies</th>
                    <th className={cx(th, "text-right")}>Invoices</th>
                    <th className={cx(th, "text-right")}>Billed</th>
                    <th className={cx(th, "text-right")}>Due</th>
                    <th className={cx(th, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {s.suppliers.map((x) => {
                    const p = perSupplier.get(x.id);
                    return (
                      <tr key={x.id} className={cx("border-b border-slate-100 last:border-0", !x.active && "opacity-60")}>
                        <td className={td}>
                          <b className="text-slate-900">{x.name}</b> {!x.active && <Badge tone="slate">Inactive</Badge>}
                          {x.address && <span className="block max-w-[220px] truncate text-[11.5px] text-slate-400">{x.address.replace(/\n/g, ", ")}</span>}
                        </td>
                        <td className={td}>
                          {x.contactPerson && <span className="block text-slate-800">{x.contactPerson}</span>}
                          <span className="text-[12px] text-slate-500">{[x.phone, x.email].filter(Boolean).join(" · ") || "—"}</span>
                        </td>
                        <td className={cx(td, "font-mono text-[12px]")}>{x.gstin || "—"}</td>
                        <td className={cx(td, "max-w-[180px] truncate text-slate-600")}>{x.supplies || "—"}</td>
                        <td className={cx(td, "adm-num text-right")}>{p?.n ?? 0}</td>
                        <td className={cx(td, "adm-num text-right")}>{rupee(p?.billed ?? 0)}</td>
                        <td className={cx(td, "adm-num text-right font-semibold", (p?.due ?? 0) > 0.005 ? "text-red-600" : "text-slate-500")}>{rupee(p?.due ?? 0)}</td>
                        <td className={cx(td, "text-right")}>
                          <span className="inline-flex gap-3 text-[11px] font-extrabold uppercase">
                            <button type="button" className="text-emerald-700 hover:underline" onClick={() => openInvoice(undefined, x.id)}>
                              + Invoice
                            </button>
                            <button type="button" className="text-blue-600 hover:underline" onClick={() => setSForm({ id: x.id, name: x.name, contactPerson: x.contactPerson, phone: x.phone, email: x.email, gstin: x.gstin, address: x.address, supplies: x.supplies, notes: x.notes, active: x.active })}>
                              Edit
                            </button>
                            <button type="button" className="text-red-600 hover:underline" onClick={() => removeSupplier(x)}>
                              Del
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {sForm && <SupplierModal initial={sForm} onClose={() => setSForm(null)} onToast={toast} />}
      {iForm && <InvoiceModal initial={iForm} suppliers={s.suppliers.filter((x) => x.active || x.id === iForm.supplierId)} onClose={() => setIForm(null)} />}
    </Page>
  );
}

function SupplierModal({ initial, onClose, onToast }: { initial: SForm; onClose: () => void; onToast: ReturnType<typeof useAdmin>["toast"] }) {
  const { act } = useAdmin();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof SForm, v: string | boolean) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true);
    const r = await act<Supplier>("supplier.save", { ...f });
    setBusy(false);
    if (r.ok) {
      onToast({ kind: "ok", title: f.id ? `${r.result.name} updated` : `${r.result.name} added` });
      onClose();
    }
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={f.id ? "Edit supplier" : "New supplier"}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="dark" disabled={busy || !f.name.trim()} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier name *" className="sm:col-span-2">
          <input className={inputCls} value={f.name} maxLength={80} autoFocus onChange={(e) => set("name", e.target.value)} placeholder="e.g. Aavin Dairy" />
        </Field>
        <Field label="Contact person">
          <input className={inputCls} value={f.contactPerson} maxLength={80} onChange={(e) => set("contactPerson", e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} inputMode="tel" value={f.phone} maxLength={20} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={inputCls} type="email" value={f.email} maxLength={120} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="GSTIN" hint="15 characters, e.g. 33ABCDE1234F1Z5">
          <input className={cx(inputCls, "uppercase")} value={f.gstin} maxLength={15} onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        </Field>
        <Field label="What they supply" className="sm:col-span-2">
          <input className={inputCls} value={f.supplies} maxLength={160} onChange={(e) => set("supplies", e.target.value)} placeholder="Milk, curd, paneer…" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <textarea className={cx(inputCls, "h-20 resize-y py-2")} value={f.address} maxLength={300} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <input className={inputCls} value={f.notes} maxLength={300} onChange={(e) => set("notes", e.target.value)} placeholder="Delivery days, credit terms…" />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Active supplier (untick to hide from new invoices)
        </label>
      </div>
    </Modal>
  );
}

function InvoiceModal({ initial, suppliers, onClose }: { initial: IForm; suppliers: Supplier[]; onClose: () => void }) {
  const { act, toast } = useAdmin();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof IForm, v: string) => setF({ ...f, [k]: v });
  const price = Math.max(0, Number(f.price) || 0);
  const pct = Math.min(100, Math.max(0, Number(f.gstPercent) || 0));
  const gst = round2((price * pct) / 100);
  const total = round2(price + gst);
  const paid = Number(f.paidAmount) || 0;
  const save = async () => {
    setBusy(true);
    const r = await act<SupplierInvoice>("supplierinv.save", { ...f });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: f.id ? `Invoice ${r.result.invoiceNo} updated` : `Invoice ${r.result.invoiceNo} — ${rupee(r.result.total)} recorded` });
      onClose();
    }
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={f.id ? "Edit supplier invoice" : "New supplier invoice"}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="dark" disabled={busy || !f.supplierId || !f.invoiceNo.trim() || !(price > 0)} onClick={save}>
            {busy ? "Saving…" : "Save invoice"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier *">
          <select className={inputCls} value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Invoice no *">
          <input className={inputCls} value={f.invoiceNo} maxLength={40} onChange={(e) => set("invoiceNo", e.target.value)} placeholder="As printed on their invoice" />
        </Field>
        <Field label="Invoice date *">
          <input className={inputCls} type="date" value={f.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} />
        </Field>
        <Field label="Due date">
          <input className={inputCls} type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label="Price before GST (₹) *">
          <input className={inputCls} type="number" min={0} step="0.01" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="GST %">
          <div className="flex gap-2">
            <select className={cx(inputCls, "w-28")} value={GST_RATES.includes(f.gstPercent) ? f.gstPercent : "custom"} onChange={(e) => set("gstPercent", e.target.value === "custom" ? "" : e.target.value)}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
              <option value="custom">Other…</option>
            </select>
            <input className={inputCls} type="number" min={0} max={100} step="0.5" inputMode="decimal" value={f.gstPercent} onChange={(e) => set("gstPercent", e.target.value)} aria-label="GST percent" />
          </div>
        </Field>

        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 px-4 py-3 text-center sm:col-span-2">
          {[
            ["Price", rupee(price)],
            [`GST ${pct}%`, rupee(gst)],
            ["Invoice total", rupee(total)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{k}</dt>
              <dd className="adm-num text-[15px] font-extrabold text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>

        <Field label="Amount paid (₹)" hint={total > 0 ? `${rupee(Math.max(0, total - paid))} still due` : undefined}>
          <div className="flex gap-2">
            <input className={inputCls} type="number" min={0} step="0.01" inputMode="decimal" value={f.paidAmount} onChange={(e) => set("paidAmount", e.target.value)} placeholder="0.00" />
            <button type="button" className="h-10 shrink-0 rounded-xl border border-slate-200 px-3 text-[12px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => set("paidAmount", String(total))}>
              Paid in full
            </button>
          </div>
        </Field>
        <Field label="Paid by">
          <select className={inputCls} value={f.paymentMode} onChange={(e) => set("paymentMode", e.target.value)}>
            {MODES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <input className={inputCls} value={f.notes} maxLength={300} onChange={(e) => set("notes", e.target.value)} placeholder="Items bought, delivery challan no…" />
        </Field>
      </div>
    </Modal>
  );
}
