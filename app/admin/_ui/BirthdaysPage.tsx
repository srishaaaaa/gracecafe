"use client";

import { useMemo, useState } from "react";
import type { BirthdayConfig, BirthdayEntry, BirthdayOffer } from "@/lib/types";
import { shopToday } from "@/lib/money";
import { useAdmin } from "./Store";
import { waLink } from "./receipt";
import { Badge, Btn, Card, Empty, Field, Icon, Modal, Page, PageHead, SearchBox, Tabs, WaIcon, cx, csv, downloadText, inputCls } from "./kit";

/* Date of Birth: save customers' birthdays (from Billing or here), see who is celebrating in a date or range, and send each a
   one-tap WhatsApp birthday offer. The offers and the message wording are edited here and saved for everyone. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type View = "calendar" | "customers" | "none";
type Quick = "today" | "week" | "month" | "all" | "custom";
type MD = { m: number; d: number };
type Range = { from: MD; to: MD } | null; // null = every birthday

const key = (x: MD) => x.m * 100 + x.d;
const parse = (dob: string): MD => ({ m: Number(dob.slice(5, 7)), d: Number(dob.slice(8, 10)) });
const inRange = (md: MD, r: Range) => {
  if (!r) return true;
  const k = key(md);
  const a = key(r.from);
  const b = key(r.to);
  return a <= b ? k >= a && k <= b : k >= a || k <= b; // a range may run over New Year
};
const daysIn = (m: number, year: number) => new Date(year, m, 0).getDate();
const phoneOk = (p: string) => /^[6-9]\d{9}$/.test(p);
const tenDigits = (v: string) => {
  const d = v.replace(/\D/g, "");
  return (d.length === 12 && d.startsWith("91") ? d.slice(2) : d).slice(0, 10);
};

/** Whole days from today until this birthday next comes round (0 = today). */
function daysUntil(md: MD, today: Date) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let n = new Date(t.getFullYear(), md.m - 1, md.d);
  if (n < t) n = new Date(t.getFullYear() + 1, md.m - 1, md.d);
  return Math.round((n.getTime() - t.getTime()) / 86_400_000);
}
const dayLabel = (n: number) => (n === 0 ? "Today 🎉" : n === 1 ? "Tomorrow" : `In ${n} days`);

export default function BirthdaysPage() {
  const { s, act, confirm, toast, now, role } = useAdmin();
  const admin = role === "admin";
  const [view, setView] = useState<View>("calendar");
  const today = useMemo(() => new Date(now), [now]);
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);
  const [quick, setQuick] = useState<Quick>("month");
  const [custom, setCustom] = useState<{ fm: string; fd: string; tm: string; td: string }>({ fm: "", fd: "", tm: "", td: "" });
  const [picked, setPicked] = useState<MD | null>(null); // a single day chosen on the calendar
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ phone: string; name: string; dob: string; isNew: boolean } | null>(null);

  const list = s.birthdays;
  const shop = s.settings.shopName;
  const shopPhone = s.settings.customerCare || s.settings.whatsapp1;

  /* ---------- the range being looked at ---------- */
  const t = { m: today.getMonth() + 1, d: today.getDate() };
  const range: Range = useMemo(() => {
    if (picked) return { from: picked, to: picked };
    if (quick === "all") return null;
    if (quick === "today") return { from: t, to: t };
    if (quick === "week") {
      const e = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6);
      return { from: t, to: { m: e.getMonth() + 1, d: e.getDate() } };
    }
    if (quick === "month") return { from: { m: t.m, d: 1 }, to: { m: t.m, d: daysIn(t.m, today.getFullYear()) } };
    const fm = Number(custom.fm);
    const tm = Number(custom.tm);
    if (!fm || !tm) return null;
    return { from: { m: fm, d: Number(custom.fd) || 1 }, to: { m: tm, d: Number(custom.td) || daysIn(tm, today.getFullYear()) } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, quick, custom, today]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .map((b) => ({ b, md: parse(b.dob) }))
      .filter((r) => inRange(r.md, range) && (!needle || r.b.name.toLowerCase().includes(needle) || r.b.phone.includes(needle)))
      .map((r) => ({ ...r, in: daysUntil(r.md, today) }))
      .sort((a, b) => a.in - b.in || a.b.name.localeCompare(b.b.name));
  }, [list, range, q, today]);

  /* customers who have bought (with a mobile) but have no birthday saved yet */
  const without = useMemo(() => {
    const have = new Set(list.map((b) => b.phone));
    const by = new Map<string, { name: string; last: number; bills: number }>();
    for (const b of s.bills) {
      if (b.status !== "completed" || !phoneOk(b.customerPhone) || have.has(b.customerPhone)) continue;
      const x = by.get(b.customerPhone) ?? { name: "", last: 0, bills: 0 };
      x.bills++;
      if (b.createdAt >= x.last) {
        x.last = b.createdAt;
        if (b.customerName && b.customerName !== "Walk-in customer") x.name = b.customerName;
      }
      by.set(b.customerPhone, x);
    }
    return [...by].map(([phone, x]) => ({ phone, ...x })).sort((a, b) => b.last - a.last);
  }, [list, s.bills]);

  /* ---------- offers + message (a draft until Save) ---------- */
  const saved = s.birthdayConfig;
  /* a draft only exists while something is being changed; otherwise the saved copy shows */
  const [draft, setDraft] = useState<BirthdayConfig | null>(null);
  const cur = draft ?? saved;
  const { offers, selected, template: tpl } = cur;
  const patch = (p: Partial<BirthdayConfig>) => setDraft({ ...cur, ...p });
  const setOffers = (o: BirthdayOffer[]) => patch({ offers: o });
  const setSelected = (id: string) => patch({ selected: id });
  const setTpl = (t2: string) => patch({ template: t2 });
  const [offerEdit, setOfferEdit] = useState<{ id: string; name: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const offer = offers.find((o) => o.id === selected) ?? offers[0];
  const text = (name: string) =>
    tpl
      .replaceAll("{name}", name.split(" ")[0] || "there")
      .replaceAll("{shop}", shop)
      .replaceAll("{offer}", offer?.text ?? "")
      .replaceAll("{phone}", shopPhone);

  const saveConfig = async () => {
    setSaving(true);
    const r = await act("birthday.config", { offers, selected, template: tpl });
    setSaving(false);
    if (r.ok) {
      setDraft(null);
      toast({ kind: "ok", title: "Birthday offer saved." });
    }
  };
  const saveOffer = () => {
    if (!offerEdit) return;
    const name = offerEdit.name.trim();
    const t2 = offerEdit.text.trim();
    if (!name || !t2) return toast({ kind: "err", title: "Give the offer a name and its wording." });
    const id = offerEdit.id || `o${Date.now().toString(36)}`;
    patch({ offers: offers.some((o) => o.id === id) ? offers.map((o) => (o.id === id ? { id, name, text: t2 } : o)) : [...offers, { id, name, text: t2 }], selected: id });
    setOfferEdit(null);
  };
  const deleteOffer = async () => {
    if (!offer) return;
    if (!(await confirm({ title: `Delete “${offer.name}”?`, body: "It is removed from the list when you press Save.", ok: "Delete", danger: true }))) return;
    const rest = offers.filter((o) => o.id !== offer.id);
    patch({ offers: rest, selected: rest[0]?.id ?? "" });
  };

  /* ---------- add / edit / delete a birthday ---------- */
  const saveBirthday = async () => {
    if (!edit) return;
    if (!phoneOk(edit.phone)) return toast({ kind: "err", title: "Enter a valid 10-digit mobile number." });
    if (!edit.dob) return toast({ kind: "err", title: "Pick the birthday." });
    const r = await act("birthday.save", { phone: edit.phone, name: edit.name, dob: edit.dob });
    if (r.ok) {
      toast({ kind: "ok", title: "Birthday saved." });
      setEdit(null);
    }
  };
  const remove = async (b: BirthdayEntry) => {
    if (!(await confirm({ title: `Remove ${b.name || b.phone}'s birthday?`, body: "Their bills and loyalty points are not touched.", ok: "Remove", danger: true }))) return;
    await act("birthday.delete", { phone: b.phone });
  };
  const exportCsv = () =>
    downloadText(
      `birthdays-${new Date().toISOString().slice(0, 10)}`.concat(".csv"),
      csv([["Name", "Mobile", "Birthday", "Next birthday in (days)"], ...rows.map((r) => [r.b.name, r.b.phone, r.b.dob, r.in])]),
    );

  /* ---------- calendar ---------- */
  const year = today.getFullYear();
  const firstDow = (new Date(year, calMonth - 1, 1).getDay() + 6) % 7; // Monday first
  const monthDays = daysIn(calMonth, year);
  const dots = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of list) {
      const md = parse(b.dob);
      if (md.m === calMonth) m.set(md.d, (m.get(md.d) ?? 0) + 1);
    }
    return m;
  }, [list, calMonth]);

  const pickQuick = (v: Quick) => {
    setPicked(null);
    setQuick(v);
    if (v === "today") setCalMonth(t.m);
  };
  const setC = (k: keyof typeof custom, v: string) => {
    setPicked(null);
    setQuick("custom");
    setCustom((c) => ({ ...c, [k]: v }));
  };
  const sel = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13.5px] font-semibold text-slate-900 outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100";
  const monthSel = (v: string, on: (v: string) => void, ph: string) => (
    <select className={sel} value={v} onChange={(e) => on(e.target.value)} aria-label={ph}>
      <option value="">{ph}</option>
      {SHORT.map((m, i) => (
        <option key={m} value={i + 1}>
          {m}
        </option>
      ))}
    </select>
  );
  const daySel = (v: string, on: (v: string) => void, m: string) => (
    <select className={sel} value={v} onChange={(e) => on(e.target.value)} aria-label="Day" disabled={!m}>
      <option value="">Day</option>
      {Array.from({ length: m ? daysIn(Number(m), 2024) : 31 }, (_, i) => (
        <option key={i + 1} value={i + 1}>
          {i + 1}
        </option>
      ))}
    </select>
  );

  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3.5 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-[15px] font-extrabold text-red-700">{(r.b.name || "?").slice(0, 1).toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[14px] text-slate-900">{r.b.name || "Customer"}</b>
        <span className="block text-[12px] text-slate-500">
          {r.b.phone} · {r.md.d} {SHORT[r.md.m - 1]}
        </span>
      </div>
      <Badge tone={r.in === 0 ? "green" : r.in <= 7 ? "amber" : "slate"}>{dayLabel(r.in)}</Badge>
      <div className="flex items-center gap-1.5">
        <a href={waLink(r.b.phone, text(r.b.name))} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#22c55e] px-3.5 text-[12px] font-extrabold uppercase tracking-wide text-white hover:bg-[#16a34a]">
          <WaIcon size={14} /> Send offer
        </a>
        <button type="button" onClick={() => setEdit({ phone: r.b.phone, name: r.b.name, dob: r.b.dob, isNew: false })} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Edit birthday">
          <Icon name="edit" size={15} />
        </button>
        {admin && (
          <button type="button" onClick={() => remove(r.b)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-red-600 hover:bg-red-50" aria-label="Remove birthday">
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    </li>
  );

  const filterCard = (stack: boolean) => (
    <Card title="Filter by upcoming birthday" right={view === "customers" ? <Btn icon="download" onClick={exportCsv} disabled={!rows.length}>Export CSV</Btn> : undefined}>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["today", "Today"],
            ["week", "This week"],
            ["month", "This month"],
            ["all", "All"],
          ] as [Quick, string][]
        ).map(([v, label]) => {
          const on = !picked && quick === v;
          return (
            <button key={v} type="button" onClick={() => pickQuick(v)} className={cx("h-9 rounded-full px-4 text-[12px] font-bold transition", on ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
              {label}
            </button>
          );
        })}
      </div>
      <div className={cx("mt-4 grid gap-3", stack ? "grid-cols-1" : "sm:grid-cols-2")}>
        <div>
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">From</span>
          <div className="grid grid-cols-2 gap-2">
            {monthSel(custom.fm, (v) => setC("fm", v), "Month")}
            {daySel(custom.fd, (v) => setC("fd", v), custom.fm)}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">To</span>
          <div className="grid grid-cols-2 gap-2">
            {monthSel(custom.tm, (v) => setC("tm", v), "Month")}
            {daySel(custom.td, (v) => setC("td", v), custom.tm)}
          </div>
        </div>
      </div>
      {picked && (
        <p className="mt-3 text-[12px] text-slate-500">
          Showing {picked.d} {MONTHS[picked.m - 1]} only.{" "}
          <button type="button" className="font-semibold text-red-600 hover:underline" onClick={() => setPicked(null)}>
            Clear
          </button>
        </p>
      )}
    </Card>
  );

  return (
    <Page>
      <PageHead
        title="Date of Birth"
        sub="Customer birthdays & one-tap offer sender"
        right={
          <Btn kind="red" icon="plus" onClick={() => setEdit({ phone: "", name: "", dob: "", isNew: true })}>
            Add customer
          </Btn>
        }
      />
      <Tabs
        value={view}
        onChange={setView}
        options={[
          { v: "calendar", t: "Calendar" },
          { v: "customers", t: "Customers", n: undefined },
          { v: "none", t: "No birthday", n: without.length || undefined },
        ]}
      />

      {view === "calendar" && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <select className={cx(sel, "w-32 sm:w-36")} value={calMonth} onChange={(e) => setCalMonth(Number(e.target.value))} aria-label="Month">
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 hover:bg-slate-50" onClick={() => setCalMonth((m) => (m === 1 ? 12 : m - 1))} aria-label="Previous month">
                    <span className="text-[18px] leading-none">‹</span>
                  </button>
                  <button type="button" className="h-9 rounded-xl border border-slate-200 px-3 text-[12px] font-bold hover:bg-slate-50" onClick={() => (setCalMonth(t.m), setPicked(t))}>
                    Today
                  </button>
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 hover:bg-slate-50" onClick={() => setCalMonth((m) => (m === 12 ? 1 : m + 1))} aria-label="Next month">
                    <span className="text-[18px] leading-none">›</span>
                  </button>
                </div>
              </div>
              <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {DOW.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: firstDow }, (_, i) => (
                  <span key={`b${i}`} />
                ))}
                {Array.from({ length: monthDays }, (_, i) => {
                  const d = i + 1;
                  const has = dots.get(d);
                  const on = picked?.m === calMonth && picked.d === d;
                  const isToday = calMonth === t.m && d === t.d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPicked(on ? null : { m: calMonth, d })}
                      className={cx(
                        "relative grid h-10 place-items-center rounded-xl border text-[13px] font-bold transition",
                        on ? "border-red-600 bg-red-600 text-white" : isToday ? "border-red-400 bg-red-50 text-slate-900" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                      )}
                    >
                      {d}
                      {has ? <span className={cx("absolute bottom-1 h-1.5 w-1.5 rounded-full", on ? "bg-white" : "bg-red-500")} /> : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Dot = birthday
              </p>
            </Card>
            {filterCard(true)}
          </div>

          <div className="min-w-0 space-y-5">
            <Card title={`Customers with birthdays (${rows.length})`} right={<SearchBox value={q} onChange={setQ} placeholder="Search name or mobile…" className="h-9 w-full sm:w-56" />}>
              <p className="mb-3 text-[12.5px] text-slate-500">Pick a date or range on the left, then tap Send offer on a customer.</p>
              {rows.length ? (
                <ul className="space-y-2.5">
                  {rows.map((r) => (
                    <Row key={r.b.phone} r={r} />
                  ))}
                </ul>
              ) : (
                <Empty icon="calendar" title="No birthdays found for this range">
                  {list.length ? "Try another date or choose All." : "Add a birthday in Billing or with Add customer."}
                </Empty>
              )}
            </Card>

            <Card
              title="Customise offer message"
              right={
                admin ? (
                  <Btn kind="red" icon="check" onClick={saveConfig} disabled={!dirty || saving}>
                    {saving ? "Saving…" : "Save"}
                  </Btn>
                ) : undefined
              }
            >
              <p className="-mt-2 mb-4 text-[12.5px] text-slate-500">Sent on WhatsApp when you tap “Send offer”.</p>
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Select offer</span>
              <div className="flex items-center gap-2">
                <select className={cx(sel, "h-11 flex-1")} value={offer?.id ?? ""} onChange={(e) => setSelected(e.target.value)} disabled={!offers.length} aria-label="Offer">
                  {!offers.length && <option value="">No offers yet</option>}
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {admin && <button type="button" disabled={!offer} onClick={() => offer && setOfferEdit({ ...offer })} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40" aria-label="Edit offer">
                  <Icon name="edit" size={16} />
                </button>}
                {admin && <button type="button" disabled={!offer} onClick={deleteOffer} className="grid h-11 w-11 place-items-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40" aria-label="Delete offer">
                  <Icon name="trash" size={16} />
                </button>}
              </div>
              {admin && (
                <button type="button" onClick={() => setOfferEdit({ id: "", name: "", text: "" })} className="mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-[13px] font-bold text-slate-700 hover:bg-slate-50">
                  <Icon name="plus" size={14} /> Add offer
                </button>
              )}

              <span className="mb-1 mt-4 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Customise message</span>
              <textarea className={cx(inputCls, "h-40 resize-y py-2.5 text-[13.5px] leading-relaxed")} readOnly={!admin} value={tpl} maxLength={1000} onChange={(e) => setTpl(e.target.value)} />
              <p className="mt-1 text-[11.5px] text-slate-500">
                Use <b>{"{name}"}</b> for the customer&apos;s name, <b>{"{offer}"}</b> for the selected offer, <b>{"{shop}"}</b> and <b>{"{phone}"}</b> for your shop.
              </p>

              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <span className="mb-2 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-600">Message preview</span>
                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-800">{text(rows[0]?.b.name || "Aarav")}</p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {view === "customers" && (
        <div className="space-y-5">
          {filterCard(false)}
          <Card title={`Customers (${rows.length})`} right={<SearchBox value={q} onChange={setQ} placeholder="Search name or mobile…" className="h-9 w-full sm:w-56" />}>
            {rows.length ? (
              <ul className="space-y-2.5">
                {rows.map((r) => (
                  <Row key={r.b.phone} r={r} />
                ))}
              </ul>
            ) : (
              <Empty icon="calendar" title="No birthdays found for this range">
                {list.length ? "Try another range or choose All." : "Add a birthday in Billing or with Add customer."}
              </Empty>
            )}
          </Card>
        </div>
      )}

      {view === "none" && (
        <Card title={`Customers without a birthday (${without.length})`}>
          {without.length ? (
            <ul className="space-y-2.5">
              {without.map((w) => (
                <li key={w.phone} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3.5 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-[15px] font-extrabold text-slate-600">{(w.name || "?").slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[14px] text-slate-900">{w.name || "Customer"}</b>
                    <span className="block text-[12px] text-slate-500">
                      {w.phone} · {w.bills} bill{w.bills === 1 ? "" : "s"}
                    </span>
                  </div>
                  <Btn icon="plus" onClick={() => setEdit({ phone: w.phone, name: w.name, dob: "", isNew: true })}>
                    Add birthday
                  </Btn>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="check" title="All set">
              Every customer who has bought has a birthday saved.
            </Empty>
          )}
        </Card>
      )}

      {/* add / edit a birthday */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.isNew ? "Add customer birthday" : "Edit birthday"}
        footer={
          <>
            <Btn kind="plain" onClick={() => setEdit(null)}>
              Cancel
            </Btn>
            <Btn kind="red" onClick={saveBirthday}>
              Save
            </Btn>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Name">
              <input className={inputCls} value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Customer name" />
            </Field>
            <Field label="Mobile number (WhatsApp)">
              <input className={inputCls} inputMode="numeric" value={edit.phone} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, phone: tenDigits(e.target.value) })} placeholder="10-digit number" />
            </Field>
            <Field label="Birthday">
              <input className={inputCls} type="date" max={shopToday(now)} value={edit.dob} onChange={(e) => setEdit({ ...edit, dob: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      {/* add / edit an offer */}
      <Modal
        open={!!offerEdit}
        onClose={() => setOfferEdit(null)}
        title={offerEdit?.id ? "Edit offer" : "Add offer"}
        footer={
          <>
            <Btn kind="plain" onClick={() => setOfferEdit(null)}>
              Cancel
            </Btn>
            <Btn kind="red" onClick={saveOffer}>
              Done
            </Btn>
          </>
        }
      >
        {offerEdit && (
          <div className="space-y-3">
            <Field label="Offer name" hint="Shown in the list, like “40% off”">
              <input className={inputCls} value={offerEdit.name} maxLength={40} onChange={(e) => setOfferEdit({ ...offerEdit, name: e.target.value })} />
            </Field>
            <Field label="What the customer gets" hint="Goes in the message as {offer}">
              <input className={inputCls} value={offerEdit.text} maxLength={200} onChange={(e) => setOfferEdit({ ...offerEdit, text: e.target.value })} placeholder="e.g. a free Fudge Brownie with any drink" />
            </Field>
            <p className="text-[12px] text-slate-500">Press Save on the page afterwards to keep your changes.</p>
          </div>
        )}
      </Modal>
    </Page>
  );
}
