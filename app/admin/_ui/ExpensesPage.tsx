"use client";

import { useEffect, useMemo, useState } from "react";
import type { Expense, ExpenseCategory } from "@/lib/types";
import { rupee, shopToday } from "@/lib/money";
import { expenseStats, rangeOf, type Period } from "@/lib/analytics";
import { useAdmin } from "./Store";
import { Badge, Btn, Card, Empty, DateRange, Field, Icon, Kpi, Modal, Page, PageHead, Pills, SearchBox, cx, downloadExcel, inputCls } from "./kit";

type Form = { id?: string; title: string; category: string; amount: string; paymentMode: string; notes: string; expenseDate: string };

const MODES = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["bank", "Bank"],
] as const;
const th = "px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap";
const td = "px-4 py-3 text-[13px]";
const ddmmyyyy = (d: string) => d.split("-").reverse().join("/");

export default function ExpensesPage() {
  const { s, act, confirm, toast } = useAdmin();
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [newCat, setNewCat] = useState<string | null>(null); // inline "new category" box inside the expense form

  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);
  const st = useMemo(() => expenseStats(s.expenses, range, cat, q), [s.expenses, range, cat, q]);
  /* Any filter change restarts the list at page 1. */
  // a new filter starts the list again from page 1
  const pageKey = JSON.stringify([period, from, to, cat, q]);
  const [seenKey, setSeenKey] = useState(pageKey);
  if (seenKey !== pageKey) {
    setSeenKey(pageKey);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(st.rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = st.rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  /* the shop's own list, plus any category an older expense still carries */
  const cats = useMemo(() => Array.from(new Set([...s.expenseCategories.map((c) => c.name), ...s.expenses.map((e) => e.category)])), [s.expenseCategories, s.expenses]);
  const max = st.breakdown[0]?.amount || 1;

  const open = (e?: Expense) => {
    setNewCat(null);
    setForm(
      e
        ? { id: e.id, title: e.title, category: e.category, amount: String(e.amount), paymentMode: e.paymentMode, notes: e.notes, expenseDate: e.expenseDate }
        : { title: "", category: s.expenseCategories[0]?.name ?? "General", amount: "", paymentMode: "cash", notes: "", expenseDate: shopToday() },
    );
  };

  /* creates the category for real (it is on the shop's list from now on) and selects it */
  const addCat = async () => {
    const name = (newCat ?? "").trim();
    if (!name || !form) return;
    const r = await act<ExpenseCategory>("expcat.save", { name });
    if (r.ok) {
      setForm({ ...form, category: r.result.name });
      setNewCat(null);
    }
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    const r = await act<Expense>("expense.save", { ...form });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: form.id ? "Expense updated" : `${r.result.title} — ${rupee(r.result.amount)} recorded` });
      setForm(null);
    }
  };

  /* Download the filtered expense log as an Excel workbook. */
  const exportExcel = () => {
    const head = ["Date", "Title", "Category", "Paid by", "Amount", "Notes"];
    const body = st.rows.map((e) => [ddmmyyyy(e.expenseDate), e.title, e.category, e.paymentMode.toUpperCase(), e.amount, e.notes]);
    const breakdown: (string | number)[][] = [["Category", "Amount", "Share"], ...st.breakdown.map((b) => [b.category, b.amount, `${Math.round((b.amount / (st.total || 1)) * 100)}%`])];
    downloadExcel(`expenses-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "Expenses", rows: [head, ...body] },
      { name: "By category", rows: breakdown },
    ]);
  };

  return (
    <Page>
      <PageHead
        title="Expenses"
        sub="Everything you spend. The total is subtracted from revenue in Analytics."
        right={
          <span className="flex flex-wrap gap-2">
            <Btn icon="download" onClick={exportExcel} disabled={!st.rows.length} title={st.rows.length ? "Download the filtered log as Excel" : "No expenses to download"}>
              Download Excel
            </Btn>
            <Btn icon="edit" onClick={() => setManage(true)}>
              Manage categories
            </Btn>
            <Btn kind="red" icon="plus" onClick={() => open()}>
              Add expense
            </Btn>
          </span>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
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
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <select className="h-10 rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 outline-none" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <SearchBox value={q} onChange={setQ} placeholder="Search title, category, notes…" className="w-full sm:w-64" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Total expenses" value={rupee(st.total)} hint="In the filtered range" icon="rupee" tone="rose" />
        <Kpi label="Top category" value={st.top ? st.top.category : "—"} hint={st.top ? rupee(st.top.amount) : "No expenses"} icon="trophy" tone="amber" small />
        <Kpi label="Entries" value={st.count} hint="Matching the filters" icon="list" tone="sky" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Expense log">
          {!st.rows.length ? (
            <Empty icon="bag" title={s.expenses.length ? "No expenses match" : "No expenses yet"}>
              {s.expenses.length ? null : "Add rent, ingredients, salaries… and Analytics will show net earnings."}
            </Empty>
          ) : (
            <div className="overflow-x-auto adm-scroll">
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Title</th>
                    <th className={th}>Category</th>
                    <th className={th}>Paid by</th>
                    <th className={cx(th, "text-right")}>Amount</th>
                    <th className={cx(th, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 last:border-0">
                      <td className={cx(td, "whitespace-nowrap text-slate-600")}>{ddmmyyyy(e.expenseDate)}</td>
                      <td className={td}>
                        <b className="text-slate-900">{e.title}</b>
                        {e.notes && <span className="block max-w-[260px] truncate text-[11.5px] text-slate-400">{e.notes}</span>}
                      </td>
                      <td className={td}>
                        <Badge tone="orange">{e.category}</Badge>
                      </td>
                      <td className={cx(td, "uppercase text-slate-500")}>{e.paymentMode}</td>
                      <td className={cx(td, "text-right font-bold text-slate-900")}>{rupee(e.amount)}</td>
                      <td className={cx(td, "text-right")}>
                        <span className="inline-flex gap-3 text-[11px] font-extrabold uppercase">
                          <button type="button" className="text-blue-600 hover:underline" onClick={() => open(e)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-red-600 hover:underline"
                            onClick={async () => {
                              if (await confirm({ title: `Delete “${e.title}”?`, body: `${rupee(e.amount)} will no longer count against revenue.`, ok: "Delete", danger: true })) await act("expense.delete", { id: e.id });
                            }}
                          >
                            Del
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pages > 1 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 text-[12.5px] text-slate-500">
                  <span>
                    {(safePage - 1) * PAGE_SIZE + 1}–{(safePage - 1) * PAGE_SIZE + slice.length} of {st.rows.length}
                  </span>
                  <span className="flex items-center gap-2">
                    <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">← Prev</button>
                    <span className="min-w-[96px] text-center font-semibold text-slate-700">Page {safePage} of {pages}</span>
                    <button type="button" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">Next →</button>
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="By category">
          {st.breakdown.length ? (
            <ul className="space-y-3.5">
              {st.breakdown.map((b) => (
                <li key={b.category}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <b className="text-slate-800">{b.category}</b>
                    <span className="font-semibold text-slate-600">
                      {rupee(b.amount)} · {Math.round((b.amount / (st.total || 1)) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="adm-fill h-full rounded-full bg-red-600" style={{ width: `${(b.amount / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-slate-400">Nothing to break down yet.</p>
          )}
        </Card>
      </div>

      <CategoryManager open={manage} onClose={() => setManage(false)} />

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Edit expense" : "Add expense"}
        footer={
          <>
            <Btn onClick={() => setForm(null)}>Cancel</Btn>
            <Btn kind="red" onClick={save} disabled={busy}>
              {form?.id ? "Save changes" : "Add expense"}
            </Btn>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title *" className="sm:col-span-2">
              <input className={inputCls} value={form.title} maxLength={120} placeholder="e.g. Milk & cream — weekly" onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Amount (₹) *">
              <input className={inputCls} type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Date">
              <input className={inputCls} type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
            </Field>
            <Field label="Category">
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {(cats.includes(form.category) ? cats : [...cats, form.category]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {newCat === null ? (
                <div className="mt-1.5 flex gap-3 text-[12px] font-semibold text-sky-700">
                  <button type="button" onClick={() => setNewCat("")}>
                    + New category
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input className={inputCls} autoFocus value={newCat} maxLength={40} placeholder="New category name" onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCat())} />
                  <Btn size="sm" kind="red" className="h-10" disabled={!newCat.trim()} onClick={addCat}>
                    Add
                  </Btn>
                  <Btn size="sm" className="h-10" onClick={() => setNewCat(null)}>
                    Cancel
                  </Btn>
                </div>
              )}
            </Field>
            <Field label="Paid by">
              <select className={inputCls} value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
                {MODES.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <textarea className={cx(inputCls, "h-20 py-2")} value={form.notes} maxLength={300} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </Page>
  );
}

/* Create, rename and delete the categories expenses are filed under. */
function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, act, confirm, toast } = useAdmin();
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<{ c: ExpenseCategory; moveTo: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const count = (name: string) => s.expenses.filter((e) => e.category === name).length;
  const run = async (op: string, args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const r = await act(op, args);
    setBusy(false);
    if (r.ok) toast({ kind: "ok", title: done });
    return r.ok;
  };

  const add = async () => {
    const name = adding.trim();
    if (name && (await run("expcat.save", { name }, `Added ${name}`))) setAdding("");
  };
  const rename = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    const was = s.expenseCategories.find((c) => c.id === editing.id)?.name;
    if (!name || name === was) return setEditing(null);
    if (await run("expcat.save", { id: editing.id, name }, `Renamed to ${name}`)) setEditing(null);
  };
  const remove = async (c: ExpenseCategory) => {
    if (count(c.name) > 0) {
      const other = s.expenseCategories.find((x) => x.id !== c.id);
      if (!other) return toast({ kind: "err", title: "Add another category first, so these expenses have somewhere to go." });
      return setRemoving({ c, moveTo: other.id });
    }
    if (await confirm({ title: `Delete \u201c${c.name}\u201d?`, body: "No expenses use it, so nothing else changes.", ok: "Delete", danger: true })) await run("expcat.delete", { id: c.id }, `Deleted ${c.name}`);
  };
  const confirmRemove = async () => {
    if (!removing) return;
    const { c, moveTo } = removing;
    const to = s.expenseCategories.find((x) => x.id === moveTo)?.name ?? "";
    if (await run("expcat.delete", { id: c.id, moveTo }, `Deleted ${c.name} \u2014 expenses moved to ${to}`)) setRemoving(null);
  };

  return (
    <Modal open={open} onClose={onClose} title="Expense categories" footer={<Btn onClick={onClose}>Done</Btn>}>
      <div className="mb-4 flex gap-2">
        <input className={inputCls} value={adding} maxLength={40} placeholder="New category, e.g. Gas cylinder" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Btn kind="red" icon="plus" className="h-10 shrink-0" disabled={busy || !adding.trim()} onClick={add}>
          Add
        </Btn>
      </div>
      <ul className="grid gap-2">
        {s.expenseCategories.map((c) => (
          <li key={c.id} className="rounded-xl border border-slate-100 px-4 py-2.5">
            {editing?.id === c.id ? (
              <div className="flex items-center gap-2">
                <input
                  className={inputCls}
                  autoFocus
                  value={editing.name}
                  maxLength={40}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename();
                  }}
                />
                <Btn size="sm" kind="red" disabled={busy || !editing.name.trim()} onClick={rename}>
                  Save
                </Btn>
                <Btn size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Btn>
              </div>
            ) : removing?.c.id === c.id ? (
              <div className="space-y-2.5">
                <p className="text-[13px] text-slate-700">
                  <b>{count(c.name)}</b> expense{count(c.name) === 1 ? " uses" : "s use"} <b>{c.name}</b>. Move {count(c.name) === 1 ? "it" : "them"} to:
                </p>
                <div className="flex items-center gap-2">
                  <select className={inputCls} value={removing.moveTo} onChange={(e) => setRemoving({ ...removing, moveTo: e.target.value })}>
                    {s.expenseCategories
                      .filter((x) => x.id !== c.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                  <Btn size="sm" kind="warn" disabled={busy} onClick={confirmRemove}>
                    Move &amp; delete
                  </Btn>
                  <Btn size="sm" onClick={() => setRemoving(null)}>
                    Cancel
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex-1 font-semibold text-slate-800">{c.name}</span>
                <span className="text-[12px] text-slate-500">
                  {count(c.name)} expense{count(c.name) === 1 ? "" : "s"}
                </span>
                <Btn size="sm" kind="plain" icon="edit" onClick={() => setEditing({ id: c.id, name: c.name })}>
                  Rename
                </Btn>
                <Btn size="sm" kind="plain" className="text-red-600 hover:bg-red-50" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}>
                  <Icon name="trash" size={14} />
                </Btn>
              </div>
            )}
          </li>
        ))}
        {!s.expenseCategories.length && <p className="text-[13px] text-slate-500">No categories yet &mdash; add one above.</p>}
      </ul>
    </Modal>
  );
}
