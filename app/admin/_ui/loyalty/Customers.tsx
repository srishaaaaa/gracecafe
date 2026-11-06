"use client";

import { useEffect, useMemo, useState } from "react";
import { rupee, round2 } from "@/lib/money";
import { pointsValue } from "@/lib/loyalty/engine";
import type { Bill } from "@/lib/types";
import type { LedgerEntry, LoyaltyCustomer, LoyaltyMessage, LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Badge, Btn, Empty, Field, Modal, SearchBox, cx, downloadExcel, fmtDate, fmtDateTime, inputLineCls } from "../kit";
import { MSG_LABEL, MessageList, MessageModal, WelcomeStep, type Joined } from "./notify";
import { EARN_TYPES, LEDGER_LABEL, Pager, Stat, USE_TYPES, th, td, tableWrap, usePaged, within, type PeriodData } from "./shared";

const sel = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 outline-none focus:border-slate-400";

/* Customers: register, find, edit and look at everything about one customer. Deliberately plain — points, rewards,
   purchases and WhatsApp messages for each person, nothing else. */
export default function Customers({ d, pd, reload }: { d: LoyaltyState; pd: PeriodData; reload: () => void }) {
  const { s } = useAdmin();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return d.customers.filter((c) => (!t || c.name.toLowerCase().includes(t) || c.phone.includes(t) || c.whatsapp.includes(t)) && (!status || c.status === status));
  }, [d.customers, q, status]);
  const pg = usePaged(rows, 25);
  /* with a period chosen, the Earned / Redeemed / Purchases columns show only that time */
  const per = useMemo(() => {
    const m = new Map<string, { earned: number; redeemed: number; spent: number }>();
    const get = (id: string) => m.get(id) ?? { earned: 0, redeemed: 0, spent: 0 };
    for (const e of pd.ledger) {
      const x = get(e.customerId);
      if (EARN_TYPES.includes(e.type)) x.earned += e.points;
      else if (USE_TYPES.includes(e.type)) x.redeemed += -e.points;
      m.set(e.customerId, x);
    }
    const byPhone = new Map(d.customers.map((c) => [c.phone, c.id]));
    for (const b of s.bills) {
      const id = byPhone.get(b.customerPhone);
      if (!id || b.status !== "completed" || !within(b.createdAt, pd.range)) continue;
      const x = get(id);
      x.spent += Math.max(0, b.subtotal - b.discount);
      m.set(id, x);
    }
    return m;
  }, [pd.ledger, pd.range, d.customers, s.bills]);
  const earnedOf = (c: LoyaltyCustomer) => (pd.range ? per.get(c.id)?.earned ?? 0 : c.lifetime);
  const redeemedOf = (c: LoyaltyCustomer) => (pd.range ? per.get(c.id)?.redeemed ?? 0 : c.redeemed);
  const spentOf = (c: LoyaltyCustomer) => (pd.range ? per.get(c.id)?.spent ?? 0 : d.spend[c.id] ?? 0);
  const current = open ? d.customers.find((c) => c.id === open) ?? null : null;

  const exportRows = () =>
    downloadExcel(`loyalty-customers-${new Date().toISOString().slice(0, 10)}`, [
      ["Period", pd.label],
      ["Name", "Mobile", "WhatsApp number", "WhatsApp OK", "Status", "Available points", "Points earned", "Points redeemed", "Total purchases", "Joined"],
      ...rows.map((c) => [c.name, c.phone, c.whatsapp || c.phone, c.consent ? "Yes" : "No", c.status === "active" ? "Active" : "Deactivated", c.available, earnedOf(c), redeemedOf(c), spentOf(c), fmtDate(c.createdAt)]),
    ]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or mobile number…" className="h-10 min-w-[220px] flex-1 rounded-xl" />
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Active & deactivated</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </select>
        <Btn icon="download" onClick={exportRows} disabled={!rows.length}>
          Excel
        </Btn>
        <Btn kind="red" icon="plus" onClick={() => setAdding(true)}>
          Add customer
        </Btn>
      </div>

      {!rows.length ? (
        <Empty icon="star" title={d.customers.length ? "No customer matches" : "No loyalty customers yet"}>
          {d.customers.length ? "Try a different name or number." : "Add a customer here, or from the Billing screen when they pay. They don't have to join — billing works the same without it."}
        </Empty>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Mobile</th>
                  <th className={cx(th, "text-right")}>Points</th>
                  <th className={cx(th, "text-right")}>Earned</th>
                  <th className={cx(th, "text-right")}>Redeemed</th>
                  <th className={cx(th, "text-right")}>Purchases</th>
                  <th className={th}>Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pg.rows.map((c) => (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer hover:bg-slate-50/70">
                    <td className={td}>
                      <b className="text-slate-900">{c.name}</b>
                      {c.status !== "active" && <Badge tone="red" className="ml-2">Deactivated</Badge>}
                    </td>
                    <td className={td}>{c.phone}</td>
                    <td className={cx(td, "adm-num text-right font-bold text-slate-900")}>{c.available}</td>
                    <td className={cx(td, "adm-num text-right")}>{earnedOf(c)}</td>
                    <td className={cx(td, "adm-num text-right")}>{redeemedOf(c)}</td>
                    <td className={cx(td, "adm-num text-right")}>{rupee(spentOf(c))}</td>
                    <td className={td}>{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} total={pg.total} />
        </>
      )}
      {adding && <CustomerForm onClose={() => setAdding(false)} onDone={reload} />}
      {current && <Profile key={current.id} c={current} d={d} bills={s.bills.filter((b) => b.customerPhone === current.phone)} reload={reload} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------- add / edit ---------------- */
function CustomerForm({ customer, onClose, onDone }: { customer?: LoyaltyCustomer; onClose: () => void; onDone: () => void }) {
  const { act, toast, s } = useAdmin();
  const [f, setF] = useState({ name: customer?.name ?? "", phone: customer?.phone ?? "", whatsapp: customer?.whatsapp ?? "", consent: customer?.consent ?? s.loyaltyEarn.display.defaultConsent });
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<Joined | null>(null);
  const save = async () => {
    setBusy(true);
    const r = customer
      ? await act("loyalty.update", { id: customer.id, name: f.name, whatsapp: f.whatsapp, consent: f.consent })
      : await act<LoyaltyCustomer & { message: LoyaltyMessage | null }>("loyalty.register", { phone: f.phone, name: f.name, whatsapp: f.whatsapp, consent: f.consent });
    setBusy(false);
    if (!r.ok) return;
    onDone();
    if (!customer) {
      const m = (r.result as { message: LoyaltyMessage | null }).message;
      toast({ kind: "ok", title: `${f.name} joined the loyalty programme` });
      const c = r.result as LoyaltyCustomer;
      return setJoined({ id: c.id, name: c.name, message: m });
    }
    onClose();
  };
  if (joined) return <WelcomeStep joined={joined} onClose={onClose} />;
  return (
    <Modal
      open
      onClose={onClose}
      title={customer ? `Edit ${customer.name}` : "Add a loyalty customer"}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="red" disabled={busy || !f.name.trim() || (!customer && f.phone.length < 10)} onClick={save}>
            {busy ? "Saving…" : customer ? "Save changes" : "Add customer"}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className={inputLineCls} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Mobile number" hint={customer ? "The mobile number is how the customer is found, so it can't be changed." : "10 digits. One customer per number."}>
          <input className={inputLineCls} inputMode="tel" value={f.phone} disabled={!!customer} maxLength={14} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+ ]/g, "") })} placeholder="10-digit mobile" />
        </Field>
        <Field label="WhatsApp number" hint="Leave blank if it is the same as the mobile number.">
          <input className={inputLineCls} inputMode="tel" value={f.whatsapp} maxLength={14} onChange={(e) => setF({ ...f, whatsapp: e.target.value.replace(/[^\d+ ]/g, "") })} placeholder="Same as mobile" />
        </Field>
        <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
          <span>
            <b>The customer agrees to get WhatsApp messages</b> about their points and gifts. Messages are only prepared for customers who agree.
          </span>
        </label>
      </div>
    </Modal>
  );
}

/* ---------------- one customer ---------------- */
function Profile({ c, d, bills, reload, onClose }: { c: LoyaltyCustomer; d: LoyaltyState; bills: Bill[]; reload: () => void; onClose: () => void }) {
  const { role, act, confirm, toast } = useAdmin();
  const admin = role === "admin";
  const cfg = d.config;
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/loyalty/ledger?customerId=${c.id}&size=100`, { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => live && setLedger(x.rows ?? []))
      .catch(() => live && setLedger([]));
    return () => {
      live = false;
    };
  }, [c.id, c.available, tick]);

  const vouchers = d.vouchers.filter((v) => v.customerId === c.id);
  const unlockedVouchers = vouchers.filter((v) => v.status === "issued" && v.kind === "free_item");
  const claimed = vouchers.filter((v) => v.status === "used");
  const pointRewards = d.rewards.filter((r) => r.active && r.trigger === "points" && r.kind === "free_item");
  const spendRewards = d.rewards.filter((r) => r.active && r.trigger === "milestone");
  const messages = d.messages.filter((m) => m.customerId === c.id);

  const gotBills = bills.filter((b) => b.status === "completed").sort((a, b) => b.createdAt - a.createdAt);
  const totalSpend = d.spend[c.id] ?? 0;

  const toggleStatus = async () => {
    const off = c.status === "active";
    const yes = await confirm({ title: off ? `Deactivate ${c.name}?` : `Reactivate ${c.name}?`, body: off ? "They stop earning and using points until you reactivate them. Their points and history are kept." : "They can earn and use points again.", ok: off ? "Deactivate" : "Reactivate", danger: off });
    if (!yes) return;
    const r = await act("loyalty.status", { id: c.id, status: off ? "inactive" : "active", reason: off ? "Deactivated by staff" : "Reactivated by staff" });
    if (r.ok) reload();
  };

  /* Delete the customer for good — asks first, and says exactly what goes and what stays */
  const remove = async () => {
    const waiting = unlockedVouchers.length;
    const yes = await confirm({
      title: `Delete ${c.name} from loyalty?`,
      danger: true,
      ok: "Yes, delete customer",
      body: (
        <div className="space-y-2.5 text-[13.5px] leading-relaxed text-slate-700">
          <p>
            <b>{c.name}</b> ({c.phone}) will be removed from the loyalty programme for good.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Their <b>{c.available} points</b> ({rupee(pointsValue(c.available, cfg))}), points history and WhatsApp history are erased.
            </li>
            <li>{waiting ? `${waiting} unlocked reward${waiting === 1 ? "" : "s"} ${waiting === 1 ? "is" : "are"} lost, and ` : ""}their reward history is erased.</li>
            <li>
              Their <b>{gotBills.length} bill{gotBills.length === 1 ? "" : "s"}</b> stay in Orders and in your sales — they just stop being linked to loyalty.
            </li>
          </ul>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">This can&apos;t be undone. To just stop them earning points, use Deactivate instead — it keeps everything.</p>
        </div>
      ),
    });
    if (!yes) return;
    const r = await act("loyalty.delete", { id: c.id });
    if (r.ok) {
      toast({ kind: "ok", title: `${c.name} was deleted from loyalty` });
      reload();
      onClose();
    }
  };

  const exportCustomer = () =>
    downloadExcel(`${c.name.replace(/[^\w]+/g, "-")}-loyalty-${new Date().toISOString().slice(0, 10)}`, [
      { name: "Customer", rows: [["Name", c.name], ["Mobile", c.phone], ["WhatsApp", c.whatsapp || c.phone], ["WhatsApp consent", c.consent ? "Yes" : "No"], ["Status", c.status === "active" ? "Active" : "Deactivated"], ["Joined", fmtDate(c.createdAt)], ["Available points", c.available], ["Points earned", c.lifetime], ["Points redeemed", c.redeemed], ["Total purchases (₹)", totalSpend]] },
      { name: "Points history", rows: [["When", "Type", "Points before", "Change", "Points after", "Bill", "Note"], ...(ledger ?? []).map((e) => [fmtDateTime(e.createdAt), LEDGER_LABEL[e.type] ?? e.type, e.balanceBefore, e.points, e.balanceAfter, e.invoiceNo ?? "", e.description])] },
      { name: "Rewards", rows: [["Reward", "Status", "Earned", "Claimed", "Bill", "Points used"], ...vouchers.map((v) => [v.name, v.status === "used" ? "Claimed" : v.status === "issued" ? "Unlocked" : v.status === "cancelled" ? "Cancelled" : "Expired", fmtDate(v.issuedAt), v.usedAt ? fmtDate(v.usedAt) : "", v.invoiceNo ?? "", v.pointsCost])] },
      { name: "Purchases", rows: [["Bill", "Date", "Eligible purchase (₹)", "Points earned", "Points redeemed", "Free gift"], ...gotBills.map((b) => [b.invoiceNo, fmtDate(b.createdAt), Math.max(0, b.subtotal - b.discount), b.pointsEarned, b.pointsRedeemed, b.items.filter((i) => i.free).map((i) => `${i.qty} × ${i.name}`).join(", ")])] },
      { name: "WhatsApp messages", rows: [["When", "Message", "Status", "Text"], ...messages.map((m) => [fmtDateTime(m.createdAt), MSG_LABEL[m.type] ?? m.type, m.status === "opened" ? "Opened in WhatsApp" : m.status === "failed" ? "Failed" : "Ready to send", m.text])] },
    ]);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={c.name}
      footer={
        <>
          <Btn icon="download" onClick={exportCustomer}>
            Excel
          </Btn>
          <Btn onClick={onClose}>Close</Btn>
        </>
      }
    >
      <div className="space-y-6">
        {/* details */}
        <section>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 text-[13px] text-slate-700">
              <p>
                <span className="text-slate-500">Mobile</span> <b>{c.phone}</b>
              </p>
              <p>
                <span className="text-slate-500">WhatsApp</span> <b>{c.whatsapp || c.phone}</b>{" "}
                {c.consent ? <Badge tone="green">Agreed to messages</Badge> : <Badge tone="slate">No WhatsApp consent</Badge>}
              </p>
              <p>
                <span className="text-slate-500">Joined</span> {fmtDate(c.createdAt)} {c.status !== "active" && <Badge tone="red">Deactivated</Badge>}
              </p>
              {d.expiring[c.id] && (
                <p className="font-semibold text-amber-700">
                  {d.expiring[c.id].points} points expire on {fmtDate(d.expiring[c.id].expiresAt)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" icon="edit" onClick={() => setEdit(true)}>
                Edit
              </Btn>
              {admin && (
                <Btn size="sm" onClick={() => setAdjust(true)}>
                  Add / remove points
                </Btn>
              )}
              <Btn size="sm" onClick={toggleStatus}>
                {c.status === "active" ? "Deactivate" : "Reactivate"}
              </Btn>
              {admin && (
                <Btn size="sm" kind="red" icon="trash" onClick={remove}>
                  Delete customer
                </Btn>
              )}
            </div>
          </div>
        </section>

        {/* points */}
        <section>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600">Points</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Available" value={c.available} hint={`worth ${rupee(pointsValue(c.available, cfg))}`} tone="green" />
            <Stat label="Total earned" value={c.lifetime} />
            <Stat label="Total redeemed" value={c.redeemed} />
            <Stat label="Total purchases" value={rupee(totalSpend)} />
          </div>
          <div className="mt-3">
            {!ledger ? (
              <p className="py-3 text-center text-[12.5px] text-slate-400">Loading points history…</p>
            ) : !ledger.length ? (
              <p className="py-3 text-center text-[12.5px] text-slate-400">No points activity yet.</p>
            ) : (
              <div className={cx(tableWrap, "max-h-72 overflow-y-auto")}>
                <table className="w-full min-w-[560px]">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className={th}>When</th>
                      <th className={th}>What</th>
                      <th className={cx(th, "text-right")}>Before</th>
                      <th className={cx(th, "text-right")}>Change</th>
                      <th className={cx(th, "text-right")}>After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.map((e) => (
                      <tr key={e.id}>
                        <td className={cx(td, "whitespace-nowrap")}>{fmtDateTime(e.createdAt)}</td>
                        <td className={td}>
                          <b className="text-slate-800">{LEDGER_LABEL[e.type] ?? e.type}</b>
                          <span className="block text-[11.5px] text-slate-500">{[e.invoiceNo, e.description].filter(Boolean).join(" · ")}</span>
                        </td>
                        <td className={cx(td, "adm-num text-right text-slate-500")}>{e.balanceBefore}</td>
                        <td className={cx(td, "adm-num text-right font-bold", e.points > 0 ? "text-emerald-600" : "text-red-600")}>{e.points > 0 ? `+${e.points}` : e.points}</td>
                        <td className={cx(td, "adm-num text-right font-bold text-slate-900")}>{e.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* rewards */}
        <section>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600">Free gifts &amp; rewards</h3>
          {!pointRewards.length && !spendRewards.length && !unlockedVouchers.length && !claimed.length ? (
            <p className="py-3 text-center text-[12.5px] text-slate-400">No rewards are set up yet — add them in Free Gifts &amp; Rewards.</p>
          ) : (
            <ul className="space-y-2">
              {pointRewards.map((r) => (
                <RewardRow key={r.id} name={`${r.giftQty > 1 ? `${r.giftQty} × ` : ""}${r.name}`} detail={`${r.pointsCost} points`} state={c.available >= r.pointsCost ? "unlocked" : "locked"} extra={c.available >= r.pointsCost ? "Ready to claim on the next bill" : `${r.pointsCost - c.available} more points to unlock`} />
              ))}
              {spendRewards.map((r) => {
                const got = d.rewardSpend[c.id]?.[r.id] ?? 0;
                const left = round2(r.milestoneAmount - (got % r.milestoneAmount));
                return <RewardRow key={r.id} name={`${r.giftQty > 1 ? `${r.giftQty} × ` : ""}${r.name}`} detail={`every ${rupee(r.milestoneAmount)} spent`} state="locked" extra={`${rupee(got)} counted so far · ${rupee(left)} more for the next one`} />;
              })}
              {unlockedVouchers.map((v) => (
                <RewardRow key={v.id} name={v.name} detail={v.note || v.ref} state="unlocked" extra={`Code ${v.ref} · unlocked ${fmtDate(v.issuedAt)} — claim it on a bill`} />
              ))}
              {claimed.map((v) => (
                <RewardRow key={v.id} name={v.name} detail={v.pointsCost ? `${v.pointsCost} points` : v.note || v.ref} state="claimed" extra={`Claimed ${v.usedAt ? fmtDate(v.usedAt) : ""}${v.invoiceNo ? ` on ${v.invoiceNo}` : ""}`} />
              ))}
            </ul>
          )}
        </section>

        {/* purchases */}
        <section>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600">Purchase history</h3>
          {!gotBills.length ? (
            <p className="py-3 text-center text-[12.5px] text-slate-400">No paid bills for this mobile number yet.</p>
          ) : (
            <div className={cx(tableWrap, "max-h-72 overflow-y-auto")}>
              <table className="w-full min-w-[560px]">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className={th}>Bill</th>
                    <th className={th}>Date</th>
                    <th className={cx(th, "text-right")}>Eligible purchase</th>
                    <th className={cx(th, "text-right")}>Earned</th>
                    <th className={cx(th, "text-right")}>Redeemed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gotBills.map((b) => (
                    <tr key={b.id}>
                      <td className={cx(td, "font-semibold text-slate-900")}>{b.invoiceNo}</td>
                      <td className={td}>{fmtDate(b.createdAt)}</td>
                      <td className={cx(td, "adm-num text-right")}>{rupee(Math.max(0, b.subtotal - b.discount))}</td>
                      <td className={cx(td, "adm-num text-right text-emerald-600")}>{b.pointsEarned ? `+${b.pointsEarned}` : "—"}</td>
                      <td className={cx(td, "adm-num text-right text-red-600")}>{b.pointsRedeemed ? `−${b.pointsRedeemed}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* WhatsApp */}
        <section>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600">WhatsApp messages</h3>
          <p className="mb-2 text-[12px] text-slate-500">Messages are prepared automatically but WhatsApp can&apos;t confirm delivery, so they show as &ldquo;Ready to send&rdquo; until you open them, then &ldquo;Opened in WhatsApp&rdquo;.</p>
          <MessageList messages={messages} onChanged={() => (reload(), setTick((n) => n + 1))} empty={c.consent ? "No messages yet." : "This customer hasn't agreed to WhatsApp messages, so none are prepared."} />
        </section>
      </div>
      {edit && <CustomerForm customer={c} onClose={() => setEdit(false)} onDone={reload} />}
      {adjust && <Adjust c={c} onClose={() => setAdjust(false)} onDone={() => (reload(), setTick((n) => n + 1))} />}
    </Modal>
  );
}

function RewardRow({ name, detail, state, extra }: { name: string; detail: string; state: "locked" | "unlocked" | "claimed"; extra: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
      <span className="min-w-0">
        <b className="text-[13.5px] text-slate-900">{name}</b>
        <span className="ml-2 text-[12px] text-slate-500">{detail}</span>
        <span className="block text-[11.5px] text-slate-500">{extra}</span>
      </span>
      {state === "unlocked" ? <Badge tone="green">Unlocked</Badge> : state === "claimed" ? <Badge tone="slate">Claimed</Badge> : <Badge tone="amber">Locked</Badge>}
    </li>
  );
}

function Adjust({ c, onClose, onDone }: { c: LoyaltyCustomer; onClose: () => void; onDone: () => void }) {
  const { act, toast } = useAdmin();
  const [pts, setPts] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<LoyaltyMessage[] | null>(null);
  const n = Math.trunc(Number(pts) || 0);
  const save = async () => {
    setBusy(true);
    const r = await act<LoyaltyCustomer & { message: LoyaltyMessage | null }>("loyalty.adjust", { id: c.id, points: n, reason });
    setBusy(false);
    if (!r.ok) return;
    onDone();
    toast({ kind: "ok", title: `${n > 0 ? "Added" : "Removed"} ${Math.abs(n)} points` });
    if (r.result.message) return setSent([r.result.message]);
    onClose();
  };
  if (sent) return <MessageModal title="Tell the customer" messages={sent} onClose={onClose} />;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Add or remove points · ${c.name}`}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="red" disabled={busy || !n || !reason.trim()} onClick={save}>
            {busy ? "Saving…" : n < 0 ? "Remove points" : "Add points"}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          Available now: <b>{c.available}</b> points. Use a minus sign to remove points. This is recorded with your name, the time and the reason.
        </p>
        <Field label="Points">
          <input className={inputLineCls} inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value.replace(/[^\d-]/g, ""))} placeholder="e.g. 50 or -50" autoFocus />
        </Field>
        <Field label="Reason (required)">
          <input className={inputLineCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Points missed on an earlier bill" />
        </Field>
        {n !== 0 && <p className="text-[12.5px] font-semibold text-slate-700">New balance: {Math.max(0, c.available + n)} points</p>}
      </div>
    </Modal>
  );
}
