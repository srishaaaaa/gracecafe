"use client";

/* Loyalty controls for the Billing screen: who the customer is, joining the programme, using points, claiming a gift,
   the free gifts this bill qualifies for, and the points it will earn. The numbers here are a preview — the server
   re-checks and recomputes everything when the bill is saved. */

import { useCallback, useEffect, useState } from "react";
import type { Bill, OrderItem, Product } from "@/lib/types";
import { rupee } from "@/lib/money";
import type { LoyaltyCustomer, LoyaltyLookup, LoyaltyMessage } from "@/lib/loyalty/types";
import { earnFor, pointsValue, redeemCap, rewardValue, voucherLive } from "@/lib/loyalty/engine";
import { offerEntitlements, type Entitlement } from "@/lib/loyalty/gifts";
import { useAdmin } from "../Store";
import { Badge, Btn, Icon, Modal, inputLineCls, labelCls } from "../kit";
import { MessageList, type Joined } from "./notify";

const okPhone = (p: string) => /^[6-9]\d{9}$/.test(p);

export async function fetchLookup(phone: string): Promise<LoyaltyLookup | null> {
  try {
    const r = await fetch(`/api/admin/loyalty/lookup?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as LoyaltyLookup) : null;
  } catch {
    return null;
  }
}

/** The customer behind a mobile, re-fetched when the number changes or data moves. */
export function useLoyaltyLookup(phone: string, version: number) {
  const [data, setData] = useState<{ phone: string; lk: LoyaltyLookup | null } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!okPhone(phone)) return;
    let live = true;
    const t = setTimeout(async () => {
      const lk = await fetchLookup(phone);
      if (live) setData({ phone, lk });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [phone, version, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const lk = okPhone(phone) && data?.phone === phone ? data.lk : null;
  return { lk, loading: okPhone(phone) && data?.phone !== phone, reload };
}

/** The shop's bill offers. They apply to anyone, so they are loaded without a customer. */
export function useBillOffers(version: number) {
  const [lk, setLk] = useState<LoyaltyLookup | null>(null);
  useEffect(() => {
    let live = true;
    fetchLookup("").then((x) => live && setLk(x));
    return () => {
      live = false;
    };
  }, [version]);
  return lk;
}

type Base = { subtotal: number; couponDiscount: number; manualDiscount: number; discount: number };

/** The free gift the chosen reward entitles the customer to (or null). */
export function selectedGift(lk: LoyaltyLookup | null, sel: string): Entitlement | null {
  if (!lk?.customer || !lk.config.enabled) return null;
  if (sel.startsWith("v:")) {
    const v = lk.vouchers.find((y) => y.ref === sel.slice(2));
    return v && v.kind === "free_item" && v.productId ? { key: `voucher:${v.ref}`, source: "voucher", name: v.name, productId: v.productId, qty: Math.max(1, v.giftQty) } : null;
  }
  if (sel.startsWith("r:")) {
    const r = lk.rewards.find((y) => y.id === sel.slice(2));
    return r && r.productId ? { key: `reward:${r.id}`, source: "reward", name: r.name, productId: r.productId, qty: Math.max(1, r.giftQty) } : null;
  }
  return null;
}

/** Every free gift this bill can carry: the shop's bill offers (anyone) plus the reward the customer chose. */
export function giftEntitlements(offers: LoyaltyLookup | null, items: OrderItem[], afterManual: number, reward: Entitlement | null, member = false): Entitlement[] {
  const on = offers?.enabled !== false && offers?.config.gifts.offers !== false;
  return [...(on && offers ? offerEntitlements(offers.offers, items, afterManual, Date.now(), member) : []), ...(reward ? [reward] : [])];
}

/** Works out the reward and points discounts for the preview. `items` includes the free gift lines. */
export function loyaltyCalc(x: { lk: LoyaltyLookup | null; sel: string; pts: string; items: OrderItem[]; products: Product[]; base: Base }) {
  const { lk, items, base } = x;
  const c = lk?.customer;
  const none = { active: false, rewardDiscount: 0, pointsDiscount: 0, points: 0, rewardName: "", problems: [] as string[], cap: { maxPoints: 0, minPoints: 0, maxAmount: 0, reason: "" }, payload: {} as Record<string, unknown> };
  if (!lk || !c || !lk.enabled || c.status !== "active") return none;
  const cfg = lk.config;
  const cat = new Map(x.products.map((p) => [p.id, p.category]));
  const catOf = (pid: string | null) => (pid ? cat.get(pid) ?? "" : "");
  const afterManual = Math.max(0, base.subtotal - base.couponDiscount - base.manualDiscount);
  const problems: string[] = [];

  let rewardDiscount = 0;
  let rewardName = "";
  let spend = 0;
  const payload: Record<string, unknown> = {};
  if (x.sel.startsWith("v:")) {
    const v = lk.vouchers.find((y) => y.ref === x.sel.slice(2));
    if (v && voucherLive(v)) {
      const r = rewardValue(v, items, afterManual);
      if (r.reason) problems.push(r.reason + ".");
      rewardDiscount = r.amount;
      rewardName = v.name;
      payload.voucherRef = v.ref;
    }
  } else if (x.sel.startsWith("r:")) {
    const rw = lk.rewards.find((y) => y.id === x.sel.slice(2));
    if (rw) {
      if (rw.pointsCost > c.available) problems.push(`${rw.name} needs ${rw.pointsCost} points.`);
      const r = rewardValue(rw, items, afterManual);
      if (r.reason) problems.push(r.reason + ".");
      rewardDiscount = r.amount;
      rewardName = rw.name;
      spend = rw.pointsCost;
      payload.rewardId = rw.id;
    }
  }
  const cap = redeemCap({ cfg, items: items.filter((i) => !i.free), catOf, subtotal: base.subtotal, remaining: afterManual - rewardDiscount, available: Math.max(0, c.available - spend), couponApplied: base.couponDiscount > 0, manualApplied: base.manualDiscount > 0, rewardApplied: !!payload.rewardId || !!payload.voucherRef });
  /* If points can't be used on this bill at all (the customer has too few, or no range fits), whatever was typed
     is simply ignored — it never stops the bill from being saved. */
  const points = cap.reason ? 0 : Math.max(0, Math.floor(Number(x.pts) || 0));
  if (points) {
    if (points < cap.minPoints) problems.push(`Use at least ${cap.minPoints} points on a bill this size.`);
    else if (points > cap.maxPoints) problems.push(`At most ${cap.maxPoints} points can be used on this bill.`);
    payload.loyaltyPoints = points;
  }
  return { active: true, rewardDiscount, pointsDiscount: points ? pointsValue(Math.min(points, cap.maxPoints), cfg) : 0, points, rewardName, problems, cap, payload };
}

/** Points the bill should earn — the same formula the server runs after payment. */
export function earnPreview(lk: LoyaltyLookup | null, items: OrderItem[], products: Product[], subtotal: number, discount: number) {
  const c = lk?.customer;
  if (!lk || !c || !lk.enabled || c.status !== "active") return 0;
  const cat = new Map(products.map((p) => [p.id, p.category]));
  const catOf = (pid: string | null) => (pid ? cat.get(pid) ?? "" : "");
  const own = new Map(products.map((p) => [p.id, p.loyaltyPoints]));
  const pointsOf = (pid: string | null) => (pid ? own.get(pid) ?? null : null);
  return earnFor({ cfg: lk.config, items, catOf, pointsOf, subtotal, discount, tier: c.tier, firstPurchase: false, campaigns: [] }).total;
}

/* ---------------- customer strip (under Customer details) ---------------- */
export function MemberStrip({ phone, name, lk, loading, onEnrolled, onJoined }: { phone: string; name: string; lk: LoyaltyLookup | null; loading: boolean; onEnrolled: () => void; onJoined: (j: Joined) => void }) {
  const [enrol, setEnrol] = useState(false);
  /* The form closes as soon as the customer is added; the welcome-message step that follows is shown by the Billing page
     itself (onJoined), because adding the customer replaces this strip and would take anything inside it away. */
  const modal = enrol ? <EnrolModal phone={phone} name={name || lk?.knownName || ""} onClose={() => setEnrol(false)} onDone={onEnrolled} onJoined={onJoined} /> : null;
  if (!okPhone(phone) && !enrol) return null;
  if (loading && !lk) return <>{modal ?? <p className="mt-3 text-[12px] text-slate-400">Checking loyalty…</p>}</>;
  if (!lk || !lk.enabled) return modal;
  const c = lk.customer;
  if (!c)
    return (
      <>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5 text-[12.5px]">
          <span className="text-slate-600">Not in the loyalty programme — billing works as usual.</span>
          <Btn size="sm" kind="dark" icon="star" onClick={() => setEnrol(true)}>
            Add to loyalty
          </Btn>
        </div>
        {modal}
      </>
    );
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-[12.5px]">
        <span className="flex items-center gap-2">
          <Icon name="star" size={14} className="text-amber-600" />
          <b className="text-slate-900">{c.name}</b>
          {c.status !== "active" && <Badge tone="red">Deactivated</Badge>}
        </span>
        <span className="text-slate-700">
          <b className="adm-num text-slate-900">{c.available}</b> points <span className="text-slate-500">(worth {rupee(pointsValue(c.available, lk.config))})</span>
        </span>
        {lk.vouchers.length > 0 && <span className="font-semibold text-emerald-700">{lk.vouchers.length} reward{lk.vouchers.length === 1 ? "" : "s"} unlocked</span>}
      </div>
      {modal}
    </>
  );
}

function EnrolModal({ phone, name: start, onClose, onDone, onJoined }: { phone: string; name: string; onClose: () => void; onDone: () => void; onJoined: (j: Joined) => void }) {
  const { act, toast, s } = useAdmin();
  const [f, setF] = useState({ name: start, whatsapp: "", consent: s.loyaltyEarn.display.defaultConsent });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act<LoyaltyCustomer & { message: LoyaltyMessage | null }>("loyalty.register", { phone, ...f });
    setBusy(false);
    if (!r.ok) return;
    toast({ kind: "ok", title: `${r.result.name} joined the loyalty programme` });
    onJoined({ id: r.result.id, name: r.result.name, message: r.result.message });
    onDone();
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Add ${phone} to loyalty`}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="red" disabled={busy || !f.name.trim()} onClick={save}>
            {busy ? "Adding…" : "Add customer"}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className={labelCls}>Name *</span>
          <input className={inputLineCls} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </label>
        <label className="block">
          <span className={labelCls}>WhatsApp number</span>
          <input className={inputLineCls} inputMode="tel" value={f.whatsapp} maxLength={14} onChange={(e) => setF({ ...f, whatsapp: e.target.value.replace(/[^\d+ ]/g, "") })} placeholder="Same as mobile" />
        </label>
        <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
          <span>
            <b>The customer agrees to get WhatsApp messages</b> about their points and gifts.
          </span>
        </label>
      </div>
    </Modal>
  );
}

/* ---------------- redeem box (bill summary) ---------------- */
export function RedeemBox({ lk, sel, setSel, pts, setPts, info, earn, net = 0, nameOf }: { lk: LoyaltyLookup | null; sel: string; setSel: (v: string) => void; pts: string; setPts: (v: string) => void; info: ReturnType<typeof loyaltyCalc>; earn: number; /** what this bill adds to the customer's spending */ net?: number; nameOf?: (productId: string | null) => string }) {
  const c = lk?.customer;
  if (!lk || !c || !lk.enabled) return null;
  if (c.status !== "active") return <p className="border-t border-dashed border-slate-200 pt-4 text-[12.5px] text-slate-500">This customer&apos;s loyalty account is deactivated — no points on this bill.</p>;
  const cfg = lk.config;
  const live = lk.vouchers.filter((v) => voucherLive(v));
  const gifts = lk.rewards.filter((r) => r.kind === "free_item");
  return (
    <div className="space-y-2 border-t border-dashed border-slate-200 pt-4">
      <div className="flex items-center justify-between">
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700">Loyalty</span>
        <span className="text-[12px] font-semibold text-slate-500">{c.available} points</span>
      </div>
      {(live.length > 0 || gifts.length > 0) && (
        <select className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-800 outline-none focus:border-slate-400" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Free gift reward">
          <option value="">No free gift reward</option>
          {live.length > 0 && (
            <optgroup label="Unlocked">
              {live.map((v) => (
                <option key={v.id} value={`v:${v.ref}`}>
                  {v.name} · {v.ref}
                </option>
              ))}
            </optgroup>
          )}
          {gifts.length > 0 && (
            <optgroup label="Free gifts with points">
              {gifts.map((r) => (
                <option key={r.id} value={`r:${r.id}`} disabled={r.pointsCost > c.available}>
                  {r.name} — {r.pointsCost} points{r.pointsCost > c.available ? " · locked" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      {cfg.redeem.enabled && (
        <div className="flex gap-2">
          <input type="number" min={0} inputMode="numeric" placeholder="Points to use" className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-right text-[14px] outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} aria-label="Points to use" />
          <Btn className="h-11" disabled={!info.cap.maxPoints} onClick={() => setPts(String(info.cap.maxPoints))}>
            Max {info.cap.maxPoints || ""}
          </Btn>
        </div>
      )}
      {cfg.redeem.enabled && !pts && info.cap.reason && <p className="text-[11.5px] text-slate-400">{info.cap.reason}.</p>}
      {cfg.redeem.enabled && !!pts && info.cap.reason && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-800">These points are NOT being used: {info.cap.reason.charAt(0).toLowerCase() + info.cap.reason.slice(1)}. (The owner can change this in Loyalty → Settings → Using points.)</p>
      )}
      {cfg.redeem.enabled && !info.cap.reason && !pts && (
        <p className="text-[11.5px] text-slate-400">
          Use {info.cap.minPoints} to {info.cap.maxPoints} points on this bill ({rupee(pointsValue(info.cap.minPoints, cfg))} to {rupee(info.cap.maxAmount)} off) · 1 point = {rupee(cfg.redeem.pointValue)}
        </p>
      )}
      {info.pointsDiscount > 0 && (
        <p className="text-[12px] font-semibold text-emerald-600">
          {info.points} points → {rupee(info.pointsDiscount)} off · {c.available - info.points - (sel.startsWith("r:") ? lk.rewards.find((r) => `r:${r.id}` === sel)?.pointsCost ?? 0 : 0)} points left
        </p>
      )}
      {earn > 0 && <p className="text-[12px] font-semibold text-amber-700">This bill earns about {earn} points</p>}
      {lk.spendRewards.map((r) => {
        const after = r.progress + net;
        const unlocks = Math.floor(after / r.amount) > Math.floor(r.progress / r.amount);
        const gift = `${r.giftQty > 1 ? `${r.giftQty} × ` : ""}${nameOf?.(r.productId) || "gift"}`;
        return (
          <p key={r.id} className={unlocks ? "rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-800" : "text-[11.5px] text-slate-500"}>
            {unlocks ? (
              <>
                🎁 <b>{r.name}</b> ({gift}) unlocks when you save this bill — the customer claims it on their <b>next</b> bill.
              </>
            ) : (
              <>
                {r.name} ({gift}): {rupee(r.progress % r.amount)} of {rupee(r.amount)} spent{net > 0 ? ` — this bill brings it to ${rupee((after) % r.amount)}` : ""}. It unlocks on the bill that reaches {rupee(r.amount)}, then is claimed on the next one.
              </>
            )}
          </p>
        );
      })}
    </div>
  );
}

/* ---------------- free gifts this bill qualifies for ---------------- */
export function GiftPanel({ ents, added, toggle, products }: { ents: Entitlement[]; added: string[]; toggle: (key: string) => void; products: Product[] }) {
  if (!ents.length) return null;
  return (
    <div className="space-y-2 border-t border-dashed border-slate-200 pt-4">
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700">Free gifts for this bill</span>
      {ents.map((e) => {
        const p = products.find((x) => x.id === e.productId);
        const out = p?.stock !== null && p?.stock !== undefined && p.stock < e.qty;
        const on = added.includes(e.key);
        return (
          <div key={e.key} className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
            <span className="min-w-0 text-[12.5px]">
              <b className="block truncate text-slate-900">
                {e.qty} × {p?.name ?? "gift"} <span className="text-emerald-700">FREE</span>
              </b>
              <span className="text-slate-500">{e.name}</span>
              {out && <span className="ml-1.5 font-semibold text-red-600">· out of stock</span>}
            </span>
            <Btn size="sm" kind={on ? "ghost" : "dark"} disabled={out && !on} onClick={() => toggle(e.key)}>
              {on ? "Remove" : "Add gift"}
            </Btn>
          </div>
        );
      })}
    </div>
  );
}

/** Points, gifts and the WhatsApp messages for a saved bill, in the "Bill saved" dialog. */
export function SavedLoyalty({ bill }: { bill: Bill }) {
  const [msgs, setMsgs] = useState<LoyaltyMessage[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!bill.loyaltyCustomerId) return;
    let live = true;
    fetch(`/api/admin/loyalty/messages?billId=${bill.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => live && setMsgs(Array.isArray(x) ? x : []))
      .catch(() => live && setMsgs([]));
    return () => {
      live = false;
    };
  }, [bill.id, bill.loyaltyCustomerId, tick]);
  const gifts = bill.items.filter((i) => i.free);
  if (!bill.loyaltyCustomerId && !gifts.length) return null;
  return (
    <div className="space-y-2">
      {gifts.length > 0 && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-800">
          Free gift: {gifts.map((g) => `${g.qty} × ${g.name}`).join(", ")}
        </p>
      )}
      {bill.loyaltyCustomerId && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">
          {bill.pointsEarned > 0 ? `Earned ${bill.pointsEarned} points` : "No points on this bill"}
          {bill.pointsRedeemed > 0 && ` · used ${bill.pointsRedeemed} points`}
          {bill.rewardName && ` · ${bill.rewardName}`}
          {bill.loyaltyBalance !== null && ` · balance ${bill.loyaltyBalance} points`}
        </p>
      )}
      {msgs && msgs.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">WhatsApp messages for this customer</p>
          <MessageList messages={msgs} onChanged={() => setTick((n) => n + 1)} />
        </div>
      )}
    </div>
  );
}
