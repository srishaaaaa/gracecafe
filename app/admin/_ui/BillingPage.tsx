"use client";

import { useEffect, useState } from "react";
import { UPI_CHANNELS, type Bill, type UpiChannel, type Coupon, type DiscountType, type OrderItem, type PayMethod } from "@/lib/types";
import { checkCoupon, computeBill, couponStatus, mergeItems, round2, rupee } from "@/lib/money";
import { useAdmin, whoIs, type FloorTab } from "./Store";
import Catalog from "./Catalog";
import PrintModal, { PrintFormats } from "./PrintModal";
import { Receipt, billText, waLink, type PrintFormat } from "./receipt";
import { Badge, Btn, Icon, Modal, WaIcon, cx, fmtTime, ago } from "./kit";
import { UpiQrCard } from "./UpiQrCard";
import { pointsPerUnit } from "@/lib/loyalty/engine";
import { WelcomeStep, type Joined } from "./loyalty/notify";
import { GiftPanel, MemberStrip, RedeemBox, SavedLoyalty, earnPreview, giftEntitlements, loyaltyCalc, selectedGift, useBillOffers, useLoyaltyLookup } from "./loyalty/billing";

type Line = { key: number; productId: string | null; name: string; price: string; qty: number };

const box = "rounded-[18px] border border-slate-100 bg-white p-4 shadow-[0_2px_12px_-4px_rgba(15,23,42,.1)] sm:p-5";
const lbl = "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700";
const big = "h-10 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100";
/* Mobiles are stored and sent as a bare 10-digit number — the country code is
   added at the wa.me link, so anything longer here is a prefix to drop, not
   part of the number. Kept in the change handler rather than maxLength so a
   pasted "+91 98765 43210" loses the prefix instead of its last two digits. */
const tenDigits = (v: string) => {
  const d = v.replace(/\D/g, "");
  const bare = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return bare.slice(0, 10);
};
const okPhone = (p: string) => /^[6-9]\d{9}$/.test(p);
const sigOf = (f: FloorTab) => f.orders.map((o) => o.id + o.status).join("|");

const DEFAULT_GST = "18";

/** The bill being typed. It lives outside the component, so going to another page and coming back to Billing finds
    everything as it was — it is only cleared when the bill is saved (or the cashier clears it). */
type Draft = {
  mode: "tab" | "counter"; sel: string | null; lines: Line[]; name: string; phone: string; sig: string; coupon: string; mType: DiscountType; mVal: string; extra: string;
  isGst: boolean; gstPct: string; pay: PayMethod; received: string; splitCash: string; splitCard: string; splitUpi: string; upiVia: UpiChannel | ""; linkSent: boolean; lSel: string; lPts: string; addedGifts: string[];
};
let DRAFT: Draft | null = null;

let seq = 0;
const blank = (): Line => ({ key: ++seq, productId: null, name: "", price: "", qty: 1 });
const linesOf = (f: FloorTab): Line[] => {
  const items = mergeItems(f.orders.filter((o) => o.status !== "cancelled").flatMap((o) => o.items));
  return items.length ? items.map((i) => ({ key: ++seq, productId: i.productId, name: i.name, price: String(i.price), qty: i.qty })) : [blank()];
};

export default function BillingPage({ sessionId }: { sessionId?: string }) {
  const { s, floor, act, print, now, toast } = useAdmin();
  const shop = s.settings.shopName;
  /* "Walk-ins only" and the ordering toggle both reduce POS to counter walk-ins.
     Either one on → the "Customer tab" mode and its tab picker drop out. */
  const counterOnly = s.settings.walkInsOnly || !s.settings.orderingEnabled;

  const openTabs = counterOnly ? [] : floor;
  const start = !counterOnly && sessionId ? floor.find((f) => f.session.id === sessionId) : undefined;
  const d = start ? null : DRAFT; // a bill typed earlier (a link that names a tab starts fresh)

  /* Default to Counter (walk-in). A direct link that names a tab still opens
     it in tab mode; open tabs on their own don't flip the default any more. */
  const [mode, setMode] = useState<"tab" | "counter">(counterOnly ? "counter" : start ? "tab" : d?.mode ?? "counter");
  const [sel, setSel] = useState<string | null>(start?.session.id ?? d?.sel ?? null);
  const [lines, setLines] = useState<Line[]>(() => (start ? linesOf(start) : d?.lines.length ? d.lines : [blank()]));
  const [name, setName] = useState(start?.session.customerName ?? d?.name ?? "");
  const [phone, setPhone] = useState(start?.session.customerPhone ?? d?.phone ?? "");
  const [sig, setSig] = useState(start ? sigOf(start) : d?.sig ?? "");
  const [coupon, setCoupon] = useState(start?.session.couponCode ?? d?.coupon ?? "");
  const [newCp, setNewCp] = useState<{ code: string; percent: string; minOrder: string } | null>(null);
  const [mType, setMType] = useState<DiscountType>(d?.mType ?? "amount");
  const [mVal, setMVal] = useState(d?.mVal ?? "");
  const [extra, setExtra] = useState(d?.extra ?? "");
  const [isGst, setIsGst] = useState(d?.isGst ?? false);
  const [gstPct, setGstPct] = useState(d?.gstPct ?? DEFAULT_GST);
  const [pay, setPay] = useState<PayMethod>(d?.pay ?? "cash");
  const [received, setReceived] = useState(d?.received ?? "");
  const [splitCash, setSplitCash] = useState(d?.splitCash ?? "");
  const [splitCard, setSplitCard] = useState(d?.splitCard ?? "");
  const [splitUpi, setSplitUpi] = useState(d?.splitUpi ?? "");
  const [saveOpen, setSaveOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printFor, setPrintFor] = useState<Bill | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [picking, setPicking] = useState(false); // "Pick from catalog" (multi-add) modal
  const [done, setDone] = useState<Bill | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null); // a customer just added to loyalty: the welcome-message step
  const [addedGifts, setAddedGifts] = useState<string[]>(d?.addedGifts ?? []); // free gifts (by what entitles them) staff added to this bill
  const [busy, setBusy] = useState(false);
  // loyalty: a reward ("v:REF" voucher or "r:id" catalogue reward) and points to redeem
  // how a UPI payment reaches the shop: picked by staff, or worked out (guest's phone / the WhatsApp link we sent / the counter QR)
  const [upiVia, setUpiVia] = useState<UpiChannel | "">(d?.upiVia ?? "");
  const [linkSent, setLinkSent] = useState(d?.linkSent ?? false);
  const [lSel, setLSel] = useState(d?.lSel ?? "");
  const [lPts, setLPts] = useState(d?.lPts ?? "");
  const loyal = useLoyaltyLookup(phone, s.version);
  const offerLk = useBillOffers(s.version); // the shop's bill offers — they work for anyone, member or not
  // an active loyalty member decides which audience of coupons applies
  const member = loyal.lk?.customer?.status === "active";

  // remember the bill as it is typed, so leaving this page and coming back doesn't lose it
  useEffect(() => {
    DRAFT = { mode, sel, lines, name, phone, sig, coupon, mType, mVal, extra, isGst, gstPct, pay, received, splitCash, splitCard, splitUpi, upiVia, linkSent, lSel, lPts, addedGifts };
  }, [mode, sel, lines, name, phone, sig, coupon, mType, mVal, extra, isGst, gstPct, pay, received, splitCash, splitCard, splitUpi, upiVia, linkSent, lSel, lPts, addedGifts]);

  const f = mode === "tab" && sel ? floor.find((x) => x.session.id === sel) ?? null : null;
  const stale = f && sig && sigOf(f) !== sig;
  const lost = mode === "tab" && sel && !f;

  const reset = (keepMode = true) => {
    setUpiVia("");
    setLinkSent(false);
    setSel(null);
    setLines([blank()]);
    setName("");
    setPhone("");
    setSig("");
    setCoupon("");
    setMType("amount");
    setMVal("");
    setExtra("");
    setIsGst(false);
    setGstPct(DEFAULT_GST);
    setPay("cash");
    setReceived("");
    setSplitCash("");
    setSplitCard("");
    setSplitUpi("");
    setLSel("");
    setLPts("");
    setAddedGifts([]);
    if (!keepMode) setMode("counter");
  };

  const pickTab = (x: FloorTab) => {
    setSel(x.session.id);
    setLines(linesOf(x));
    setName(x.session.customerName);
    setPhone(x.session.customerPhone);
    setLSel("");
    setLPts("");
    setAddedGifts([]);
    setCoupon(x.session.couponCode ?? "");
    setUpiVia("");
    setLinkSent(false);
    if (x.session.payClaimedAt) setPay("upi"); // the guest says they paid by UPI
    setSig(sigOf(x));
  };

  const createCoupon = async () => {
    if (!newCp) return;
    setBusy(true);
    const r = await act<Coupon>("coupon.save", { code: newCp.code, percent: newCp.percent, minOrder: newCp.minOrder || 0, active: true });
    setBusy(false);
    if (r.ok) {
      setCoupon(r.result.code);
      setNewCp(null);
    }
  };

  /* Points one unit of an item earns: the product's own number if the admin set one, otherwise the shop's rule */
  const ptsOf = (productId: string | null, price: number) => pointsPerUnit(s.products.find((p) => p.id === productId) ?? { id: "", category: "", price, loyaltyPoints: null }, s.loyaltyEarn);
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /* ---------- totals ---------- */
  const paidItems: OrderItem[] = lines
    .filter((l) => l.name.trim() || Number(l.price) > 0)
    .map((l) => ({ productId: l.productId, name: l.name.trim(), price: Math.max(0, Number(l.price) || 0), qty: l.qty }));
  const cp = s.coupons.find((c) => c.code === coupon) ?? null;
  const billIn = { items: paidItems, coupon: cp, manualType: mType, manualValue: Number(mVal) || 0, extra: Number(extra) || 0, gst: isGst, gstPercent: Number(gstPct) || 0, phone, member };
  const base = computeBill(billIn);
  /* Free gifts: from the shop's bill offers (anyone) and the reward the customer chose. A gift is its own ₹0 line. */
  const rewardGift = selectedGift(loyal.lk, lSel);
  const ents = giftEntitlements(offerLk, paidItems, Math.max(0, base.subtotal - base.couponDiscount - base.manualDiscount), rewardGift, loyal.lk?.customer?.status === "active");
  const giftItems: OrderItem[] = ents.filter((e) => addedGifts.includes(e.key)).map((e) => ({ productId: e.productId, name: s.products.find((p) => p.id === e.productId)?.name ?? "Free gift", price: 0, qty: e.qty, free: true }));
  const items: OrderItem[] = [...paidItems, ...giftItems];
  const toggleGift = (key: string) => setAddedGifts((a) => (a.includes(key) ? a.filter((k) => k !== key) : [...a, key]));
  const chooseReward = (v: string) => {
    setLSel(v);
    const g = selectedGift(loyal.lk, v);
    // picking a free-gift reward adds its gift to the bill; clearing it takes it off again
    setAddedGifts((a) => [...a.filter((k) => !k.startsWith("reward:") && !k.startsWith("voucher:")), ...(g ? [g.key] : [])]);
  };
  const loy = loyaltyCalc({ lk: loyal.lk, sel: lSel, pts: lPts, items, products: s.products, base });
  const calc = loy.active ? computeBill({ ...billIn, rewardDiscount: loy.rewardDiscount, pointsDiscount: loy.pointsDiscount }) : base;
  const earns = earnPreview(loyal.lk, items, s.products, calc.subtotal, calc.discount);
  const recv = Number(received) || 0;
  const change = pay === "cash" && recv > 0 ? recv - calc.total : 0;

  /* ---------- asking the customer to pay by UPI ---------- */
  const upiOn = !!s.settings.upiId;
  const approved = f?.session.billApprovedAt ? { amount: f.session.approvedAmount, at: f.session.billApprovedAt } : null;
  const approveBill = () => f && act("tab.approve", { id: f.session.id, amount: calc.total });
  const withdrawBill = () => f && act("tab.unapprove", { id: f.session.id });
  /* WhatsApp message with the amount, the UPI ID and a link to the payment page (a QR + "Open my UPI app") */
  const sendPayLink = async () => {
    const amount = approved?.amount ?? calc.total;
    const w = window.open("about:blank", "_blank"); // opened first so the browser doesn't block it
    try {
      const r = await fetch("/api/admin/pay-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, name }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't make the payment link.");
      const text = [
        `Hi ${(name || "there").split(" ")[0]}! Your bill at ${d.shopName} is ${rupee(amount)}.`,
        "",
        `Pay by UPI: ${d.url}`,
        `Pay to: ${d.upiName}`,
        `UPI ID: ${d.upiId}`,
        ...(d.upiPhone ? [`GPay number: ${d.upiPhone.slice(0, 5)} ${d.upiPhone.slice(5)}`] : []),
        `Amount: ${rupee(amount)}`,
        "",
        "After paying, please show the confirmation at the counter.",
      ].join("\n");
      if (w) w.location.href = waLink(phone, text);
      setLinkSent(true); // if they then pay, it is recorded as paid through the WhatsApp link
    } catch (e) {
      w?.close();
      toast({ kind: "err", title: (e as Error).message });
    }
  };

  /* a split is any mix of cash, UPI and card; each box can take "the rest" in one tap */
  const sCash = Number(splitCash) || 0;
  const sUpi = Number(splitUpi) || 0;
  const sCard = Number(splitCard) || 0;
  const splitOff = round2(calc.total - sCash - sUpi - sCard);
  const splitUsed = [sCash, sUpi, sCard].filter((n) => n > 0).length;
  const upiUsed = pay === "upi" || (pay === "split" && sUpi > 0);
  const defaultVia: UpiChannel = f?.session.payClaimedAt ? "guest_phone" : linkSent ? "whatsapp_link" : "counter_qr";
  const via: UpiChannel = upiVia || defaultVia;

  const problems: string[] = [];
  if (mode === "tab" && !f) problems.push("Pick a customer with an open tab.");
  if (!paidItems.length) problems.push("Add at least one item.");
  if (items.some((i) => !i.name)) problems.push("Every item needs a name.");
  if (cp && calc.couponOk && !calc.couponOk.ok) problems.push(`Coupon ${cp.code}: ${calc.couponOk.reason}.`);
  if (isGst && !(gstPct !== "" && Number(gstPct) >= 0 && Number(gstPct) <= 100)) problems.push("GST should be a percentage between 0 and 100.");
  if (pay === "cash" && recv > 0 && recv < calc.total) problems.push("Amount received is less than the total.");
  if (pay === "split" && splitUsed < 2) problems.push("Split payment: enter amounts for at least two of cash, UPI and card.");
  else if (pay === "split" && splitOff !== 0) problems.push(`Split payment: the parts should add up to ${rupee(calc.total)}.`);
  if (phone && !okPhone(phone)) problems.push("Mobile should be a 10-digit number.");
  problems.push(...loy.problems);
  const ready = !problems.length && !busy;

  const complete = async (via: "wa" | "print" | "none", fmt?: PrintFormat) => {
    if (!ready) return;
    const w = via === "wa" ? window.open("about:blank", "_blank") : null;
    setBusy(true);
    const r = await act<Bill>("bill.create", {
      source: mode,
      sessionId: f?.session.id,
      customerName: name,
      customerPhone: phone,
      items,
      couponCode: coupon || null,
      manualType: mType,
      manualValue: mVal,
      extra,
      isGst,
      gstPercent: gstPct,
      payment: pay,
      received,
      cashAmount: splitCash,
      upiAmount: splitUpi,
      cardAmount: splitCard,
      ...(upiUsed ? { upiChannel: via } : {}),
      ...loy.payload,
    });
    setBusy(false);
    if (!r.ok) {
      w?.close();
      return;
    }
    const b = r.result;
    if (w) w.location.href = waLink(b.customerPhone, billText(b, shop, s.settings.publicUrl));
    if (via === "print") print(<Receipt b={b} shop={shop} details={s.settings} fmt={fmt} showLoyalty={s.loyaltyEarn.display.receiptSummary} />);
    setSaveOpen(false);
    setPrinting(false);
    setDone(b);
    reset();
  };

  const couponOptions = s.coupons.filter((c) => couponStatus(c) === "active" || c.code === coupon);

  return (
    <div className="adm-in rounded-[22px] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,.06),0_8px_24px_-12px_rgba(15,23,42,.1)] sm:p-5">
      {/* ---------- header ---------- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="h-6 w-[4px] rounded-full bg-red-600" />
          <h1 className="adm-title text-[22px] leading-none text-slate-900">POS Billing Panel</h1>
          <span className="hidden h-5 w-px bg-slate-300 sm:block" />
          <span className="text-[13px] text-slate-500">Quick invoice generator &amp; database synced checkout</span>
        </div>
        {counterOnly ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1.5 text-[11.5px] font-extrabold uppercase tracking-wide text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Counter · walk-ins only
          </span>
        ) : (
          <div className="flex rounded-2xl bg-slate-100 p-1">
            {(
              [
                ["counter", "Counter (walk-in)", "bg-emerald-500"],
                ["tab", "Customer tab", "bg-red-500"],
              ] as const
            ).map(([m, t, dot]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  if (m === mode) return;
                  setMode(m);
                  reset();
                }}
                className={cx("flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12px] font-extrabold uppercase tracking-wide transition", mode === m ? "bg-white text-slate-900 shadow" : "text-slate-500 hover:text-slate-800")}
              >
                <span className={cx("h-2 w-2 rounded-full", dot)} />
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* ================= left ================= */}
        <div className="min-w-0 space-y-4">
          {mode === "tab" && (
            <section className={box}>
              <h2 className="mb-3 flex items-center gap-2.5 text-[16px] font-bold text-slate-900">
                <Icon name="tables" size={18} className="text-red-600" /> Select Open Tab
              </h2>
              {openTabs.length ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
                  {openTabs.map((x) => (
                    <button
                      key={x.session.id}
                      type="button"
                      onClick={() => pickTab(x)}
                      className={cx(
                        "relative rounded-2xl border p-3 text-left transition",
                        sel === x.session.id ? "border-slate-700 bg-slate-50 ring-4 ring-slate-100" : "border-slate-200 hover:border-slate-400",
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <b className="block truncate text-[16px] font-extrabold text-slate-900">{x.session.customerName || "Guest"}</b>
                        {x.session.payClaimedAt ? <span className="adm-pulse h-2.5 w-2.5 rounded-full bg-emerald-500 text-emerald-500" title="Says they paid by UPI" /> : x.billRequested && <span className="adm-pulse h-2.5 w-2.5 rounded-full bg-amber-400 text-amber-400" title="Asked for the bill" />}
                      </span>
                      <span className="adm-num block text-[15px] font-bold text-red-600">{rupee(x.total)}</span>
                      <span className="adm-num block truncate text-[11.5px] text-slate-500">
                        {x.session.customerPhone} · {ago(x.session.openedAt, now)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-[13px] text-slate-500">No open tabs right now. Tabs open automatically when a guest orders — or switch to Counter for a walk-in.</p>
              )}
              {stale && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                  <span>
                    <b>{whoIs(f!.session)}</b> has new activity since you opened it.
                  </span>
                  <Btn size="sm" kind="dark" icon="refresh" onClick={() => pickTab(f!)}>
                    Reload items
                  </Btn>
                </div>
              )}
              {lost && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                  <span>That tab was just closed from another screen.</span>
                  <Btn size="sm" onClick={() => reset()}>
                    Start over
                  </Btn>
                </div>
              )}
            </section>
          )}

          <section className={box}>
            <h2 className="mb-4 flex items-center gap-2.5 text-[16px] font-bold text-slate-900">
              <Icon name="users" size={18} className="text-red-600" /> Customer Details
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className={lbl}>Customer name</span>
                <input className={big} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter name" maxLength={60} />
              </label>
              <label>
                <span className={lbl}>Mobile number (WhatsApp)</span>
                <input className={cx(big, phone && !okPhone(phone) && "border-amber-500")} value={phone} onChange={(e) => (setPhone(tenDigits(e.target.value)), setLSel(""), setLPts(""))} placeholder="Enter 10-digit number" inputMode="numeric" autoComplete="tel-national" />
              </label>
            </div>
            <MemberStrip phone={phone} name={name} lk={loyal.lk} loading={loyal.loading} onEnrolled={loyal.reload} onJoined={setJoined} />
          </section>

          <section className={box}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2.5 text-[16px] font-bold text-slate-900">
                <Icon name="orders" size={18} className="text-red-600" /> Order Items
              </h2>
              <div className="flex flex-wrap gap-2">
                <Btn size="md" className="border-0 bg-slate-100 hover:bg-slate-200" onClick={() => setLines([blank()])}>
                  Clear Order
                </Btn>
                <Btn size="md" kind="dark" icon="list" onClick={() => setPicking(true)}>
                  Pick from catalog
                </Btn>
                <Btn size="md" kind="soft" className="text-[14px] font-bold" onClick={() => setLines((ls) => [...ls, blank()])}>
                  + Add Item
                </Btn>
              </div>
            </div>
            <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              {lines.map((l) => (
                <div key={l.key} className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 pb-2 last:border-0 last:pb-0 sm:flex-nowrap">
                  <input
                    className="h-10 min-w-[180px] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-[14px] outline-none transition placeholder:text-slate-400 sm:min-w-0 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                    placeholder="Item name / description…"
                    value={l.name}
                    onChange={(e) => setLine(l.key, { name: e.target.value })}
                  />
                  <button type="button" onClick={() => setPicker(l.key)} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] font-bold text-slate-700 transition hover:bg-slate-100">
                    <Icon name="list" size={15} /> Catalog
                  </button>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    inputMode="decimal"
                    className="h-10 w-24 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-[14px] outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                    placeholder="₹ Price"
                    value={l.price}
                    onChange={(e) => setLine(l.key, { price: e.target.value })}
                    aria-label="Price"
                  />
                  <div className="flex h-10 w-[112px] shrink-0 items-center overflow-hidden rounded-xl border border-slate-300 bg-white">
                    <button type="button" className="h-full w-8 text-[16px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => setLine(l.key, { qty: Math.max(1, l.qty - 1) })} aria-label="Less">
                      −
                    </button>
                    <input
                      className="h-full w-full min-w-0 border-x border-slate-200 text-center text-[14px] font-bold outline-none"
                      value={l.qty}
                      inputMode="numeric"
                      onChange={(e) => setLine(l.key, { qty: Math.max(1, Math.min(999, parseInt(e.target.value.replace(/\D/g, "")) || 1)) })}
                      aria-label="Quantity"
                    />
                    <button type="button" className="h-full w-8 text-[16px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => setLine(l.key, { qty: Math.min(999, l.qty + 1) })} aria-label="More">
                      +
                    </button>
                  </div>
                  <span className="adm-num w-[96px] shrink-0 text-right leading-tight" aria-label="Line total">
                    <b className="block text-[14px] text-slate-900">{rupee((Number(l.price) || 0) * l.qty)}</b>
                    {l.qty > 1 && Number(l.price) > 0 && <small className="block text-[11px] font-semibold text-slate-500">{rupee(Number(l.price) || 0)} / pc</small>}
                    {ptsOf(l.productId, Number(l.price) || 0) > 0 && <small className="block text-[11px] font-bold text-amber-700">+{ptsOf(l.productId, Number(l.price) || 0) * l.qty} pts</small>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Remove item"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ================= right: summary ================= */}
        <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <div className={cx(box, "space-y-4")}>
            <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 text-[12px]">
              <div className="flex items-center justify-between py-3">
                <dt className="font-bold uppercase tracking-[0.12em] text-slate-400">Source</dt>
                <dd>{mode === "tab" ? <Badge tone="red">Customer tab</Badge> : <Badge tone="green">Counter</Badge>}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-3">
                <dt className="font-bold uppercase tracking-[0.12em] text-slate-400">Customer</dt>
                <dd className="truncate font-semibold text-slate-800">{name || "-"}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="font-bold uppercase tracking-[0.12em] text-slate-400">Phone</dt>
                <dd className="font-semibold text-slate-800">{phone || "-"}</dd>
              </div>
              {f && (
                <div className="flex items-center justify-between py-3">
                  <dt className="font-bold uppercase tracking-[0.12em] text-slate-400">Opened</dt>
                  <dd className="font-semibold text-slate-800">{fmtTime(f.session.openedAt)}</dd>
                </div>
              )}
            </dl>

            {items.length ? (
              <ul className="adm-scroll max-h-56 space-y-2 overflow-y-auto pr-1 text-[13px]">
                {items.map((i, k) => (
                  <li key={k} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-slate-700">
                      <b>{i.qty}×</b> {i.name || <em className="text-slate-400">unnamed</em>}
                    </span>
                    <span className="shrink-0 text-right leading-tight">
                      <b className="block">{rupee(i.price * i.qty)}</b>
                      {i.qty > 1 && <small className="block text-[11px] font-semibold text-slate-500">{rupee(i.price)} / pc</small>}
                      {!i.free && ptsOf(i.productId, i.price) > 0 && <small className="block text-[11px] font-bold text-amber-700">+{ptsOf(i.productId, i.price) * i.qty} pts</small>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-center text-[12.5px] text-slate-400">No items added yet</p>
            )}

            {f?.session.payClaimedAt && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-emerald-900">
                <b>Guest says they paid {rupee(f.session.payClaimedAmount)} by UPI</b> at {new Date(f.session.payClaimedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Look for it in your UPI app{f.session.payClaimedRef ? ` (note ${f.session.payClaimedRef})` : ""}, then save this bill as UPI.
                {Math.abs(f.session.payClaimedAmount - calc.total) > 0.5 && <span className="font-semibold"> The bill now comes to {rupee(calc.total)}.</span>}
                <button type="button" className="ml-2 font-bold text-red-700 underline" onClick={() => act("tab.payclaim.clear", { id: f.session.id })}>
                  Not received
                </button>
              </div>
            )}

            <div className="border-t border-dashed border-slate-200 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700">Apply coupon</span>
                <button type="button" className="text-[12px] font-extrabold text-red-600 hover:underline" onClick={() => setNewCp({ code: "", percent: "", minOrder: "" })}>
                  + New coupon
                </button>
              </div>
              {f?.session.couponCode && f.session.couponCode === coupon && <p className="mb-2 text-[12px] font-semibold text-sky-600">Applied by the guest from their phone.</p>}
              <select className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-800 outline-none focus:border-slate-400" value={coupon} onChange={(e) => setCoupon(e.target.value)}>
                <option value="">No Coupon</option>
                {(["all", "regular", "loyalty"] as const).map((aud) => {
                  const group = couponOptions.filter((c) => c.audience === aud);
                  if (!group.length) return null;
                  return (
                    <optgroup key={aud} label={{ all: "Everyone", regular: "Non-loyalty customers", loyalty: "Loyalty members" }[aud]}>
                      {group.map((c) => {
                        const ok = checkCoupon(c, calc.subtotal, phone, member);
                        return (
                          <option key={c.id} value={c.code} disabled={!ok.ok && c.code !== coupon}>
                            {c.code} — {c.percent}% off{c.minOrder ? ` (min ${rupee(c.minOrder)})` : ""}
                            {!ok.ok ? ` · ${ok.reason}` : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  );
                })}
              </select>
              {cp && calc.couponOk?.ok && <p className="mt-2 text-[12px] font-semibold text-emerald-600">{cp.code} applied — saves {rupee(calc.couponDiscount)}</p>}
              {cp && calc.couponOk && !calc.couponOk.ok && <p className="mt-2 text-[12px] font-semibold text-red-600">{calc.couponOk.reason}</p>}
            </div>

            <div className="border-t border-dashed border-slate-200 pt-4">
              <span className={lbl}>Manual discount</span>
              <div className="flex gap-2">
                <select className="h-11 w-[84px] rounded-xl border border-slate-300 bg-white px-3 text-[14px] font-bold outline-none focus:border-slate-400" value={mType} onChange={(e) => setMType(e.target.value as DiscountType)} aria-label="Discount type">
                  <option value="amount">₹</option>
                  <option value="percent">%</option>
                </select>
                <input type="number" min={0} inputMode="decimal" placeholder="0" className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-right text-[14px] outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" value={mVal} onChange={(e) => setMVal(e.target.value)} aria-label="Discount value" />
              </div>
            </div>

            <RedeemBox lk={loyal.lk} sel={lSel} setSel={chooseReward} pts={lPts} setPts={setLPts} info={loy} earn={earns} net={Math.max(0, calc.subtotal - calc.discount)} nameOf={(id) => s.products.find((p) => p.id === id)?.name ?? ""} />

            <GiftPanel ents={ents} added={addedGifts} toggle={toggleGift} products={s.products} />

            <dl className="space-y-3 border-t border-dashed border-slate-200 pt-4 text-[14px]">
              <div className="flex justify-between">
                <dt className="text-slate-600">
                  Subtotal ({calc.itemCount} items){isGst && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-800/70">excl. GST</span>}
                </dt>
                <dd className="font-semibold">{rupee(calc.subtotal)}</dd>
              </div>
              {calc.couponDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>Coupon {cp?.code}</dt>
                  <dd className="font-semibold">-{rupee(calc.couponDiscount)}</dd>
                </div>
              )}
              {calc.manualDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>Discount</dt>
                  <dd className="font-semibold">-{rupee(calc.manualDiscount)}</dd>
                </div>
              )}
              {giftItems.map((g) => (
                <div key={g.name + g.qty} className="flex justify-between text-emerald-700">
                  <dt>FREE GIFT · {g.qty} × {g.name}</dt>
                  <dd className="font-semibold">₹0</dd>
                </div>
              ))}
              {calc.rewardDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>Reward · {loy.rewardName}</dt>
                  <dd className="font-semibold">-{rupee(calc.rewardDiscount)}</dd>
                </div>
              )}
              {calc.pointsDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <dt>Loyalty points ({loy.points} pts)</dt>
                  <dd className="font-semibold">-{rupee(calc.pointsDiscount)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt className="text-slate-600">Extra charges</dt>
                <dd>
                  <input type="number" min={0} inputMode="decimal" placeholder="0" className="h-10 w-24 rounded-lg border border-slate-300 px-3 text-right text-[14px] outline-none focus:border-slate-400" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Extra charges" />
                </dd>
              </div>
            </dl>

            <div className="space-y-3 border-t border-dashed border-slate-200 pt-4">
              <div className="grid grid-cols-2 rounded-full border border-slate-200 bg-white p-1" role="group" aria-label="Bill type">
                {(
                  [
                    [false, "Non-GST bill"],
                    [true, "GST invoice"],
                  ] as const
                ).map(([g, t]) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={isGst === g}
                    onClick={() => setIsGst(g)}
                    className={cx("h-10 rounded-full text-[12.5px] font-extrabold uppercase tracking-wide transition", isGst === g ? "bg-slate-800 text-white shadow" : "text-slate-600 hover:text-slate-900")}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {isGst && (
                <div className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="font-bold text-slate-800">
                    GST <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800/70">(added)</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <input type="number" min={0} max={100} step="0.1" inputMode="decimal" className="h-10 w-20 rounded-lg border border-slate-300 px-3 text-right text-[14px] font-bold outline-none focus:border-slate-400" value={gstPct} onChange={(e) => setGstPct(e.target.value)} aria-label="GST percent" />
                    <span className="text-slate-600">%</span>
                    <b className="adm-num w-24 text-right font-semibold text-slate-700">{rupee(calc.gstAmount)}</b>
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <span className="text-[15px] font-extrabold uppercase tracking-[0.04em] text-slate-900">Grand total</span>
              <b className="adm-num text-[22px] font-extrabold text-slate-900">{rupee(calc.total)}</b>
            </div>
            {isGst && calc.gstAmount > 0 && <p className="-mt-3 text-right text-[11.5px] text-slate-400">includes {rupee(calc.gstAmount)} GST on {rupee(calc.taxable)}</p>}

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Payment</span>
                <div className="adm-scroll -mx-1 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
                  {(["cash", "upi", "card", "split"] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setPay(p)} className={cx("h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-bold uppercase transition", pay === p ? "bg-white text-slate-900 shadow" : "text-slate-500")}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              {pay === "cash" ? (
                <>
                  <span className="mb-2 block text-[12px] font-bold text-slate-700">Amount Received (₹)</span>
                  <input type="number" min={0} inputMode="decimal" placeholder={calc.total ? calc.total.toFixed(2) : "0.00"} className="h-12 w-full rounded-xl border border-slate-300 px-4 text-[18px] font-bold outline-none placeholder:text-slate-300 focus:border-slate-400 focus:ring-4 focus:ring-slate-100" value={received} onChange={(e) => setReceived(e.target.value)} />
                  {recv > 0 && (
                    <p className={cx("mt-2 flex justify-between text-[13px] font-semibold", change < 0 ? "text-red-600" : "text-emerald-600")}>
                      <span>{change < 0 ? "Still due" : "Change to return"}</span>
                      <span>{rupee(Math.abs(change))}</span>
                    </p>
                  )}
                </>
              ) : pay === "split" ? (
                <div className="space-y-2">
                  <p className="text-[12.5px] text-slate-500">Customer pays with two or more methods — enter how much of each. Tap “rest” to put the remaining amount in that box.</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["Cash", splitCash, setSplitCash, sCash],
                        ["UPI", splitUpi, setSplitUpi, sUpi],
                        ["Card", splitCard, setSplitCard, sCard],
                      ] as const
                    ).map(([label, val, set, n]) => (
                      <label key={label} className="min-w-0">
                        <span className="mb-1 flex items-center justify-between gap-1 text-[12px] font-bold text-slate-700">
                          {label} (₹)
                          {splitOff > 0 && (
                            <button type="button" onClick={(e) => (e.preventDefault(), set(String(round2(n + splitOff))))} className="text-[11px] font-extrabold text-red-600 hover:underline">
                              rest
                            </button>
                          )}
                        </span>
                        <input type="number" min={0} inputMode="decimal" placeholder="0.00" className="h-12 w-full min-w-0 rounded-xl border border-slate-300 px-3 text-[16px] font-bold outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" value={val} onChange={(e) => set(e.target.value)} />
                      </label>
                    ))}
                  </div>
                  {(sCash > 0 || sUpi > 0 || sCard > 0) && (
                    <p className={cx("flex justify-between text-[13px] font-semibold", splitOff === 0 ? "text-emerald-600" : "text-red-600")}>
                      <span>{splitOff === 0 ? "Adds up to the total" : splitOff > 0 ? "Still to collect" : "Over by"}</span>
                      <span>{splitOff === 0 ? rupee(calc.total) : rupee(Math.abs(splitOff))}</span>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[12.5px] text-slate-500">Collect {rupee(calc.total)} by {pay === "upi" ? "UPI" : "card"}, then complete the bill.</p>
              )}
              {upiUsed && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">UPI payment came through</span>
                  <select className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-800 outline-none focus:border-slate-400" value={via} onChange={(e) => setUpiVia(e.target.value as UpiChannel)}>
                    {UPI_CHANNELS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11.5px] text-slate-500">Printed on the invoice and kept in reports, so payments from a WhatsApp link, the counter QR and a guest&apos;s phone can be told apart.</span>
                </label>
              )}
              {s.settings.upiId && (pay === "upi" ? calc.total : pay === "split" ? sUpi : 0) > 0 && (
                <UpiQrCard upi={{ id: s.settings.upiId, name: s.settings.upiName || shop, minutes: s.settings.upiQrMinutes, phone: s.settings.upiPhone }} amount={pay === "upi" ? calc.total : sUpi} shop={shop} label={pay === "upi" ? "Scan to pay" : "Scan to pay the UPI part:"} />
              )}
              {upiOn && calc.total > 0 && ((mode === "tab" && !!f) || okPhone(phone)) && (
                <div className="mt-3 space-y-2 rounded-2xl border border-dashed border-slate-300 p-3">
                  <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Ask the customer to pay by UPI</span>
                  {mode === "tab" && f && !approved && (
                    <>
                      <Btn kind="dark" className="w-full" onClick={approveBill}>
                        Approve bill {rupee(calc.total)} · show QR on the guest&apos;s phone
                      </Btn>
                      <p className="text-[11.5px] text-slate-500">Their phone shows the QR, UPI ID and this amount as soon as you approve. Set the discount, extra charges and GST first.</p>
                    </>
                  )}
                  {mode === "tab" && f && approved && (
                    <div className="space-y-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-900">
                      <p>
                        <b>Approved {rupee(approved.amount)}</b> — the QR is on the guest&apos;s phone.
                      </p>
                      {Math.abs(approved.amount - calc.total) > 0.005 && (
                        <p className="font-semibold text-amber-800">
                          The bill now comes to {rupee(calc.total)}.{" "}
                          <button type="button" className="underline" onClick={approveBill}>
                            Approve {rupee(calc.total)} instead
                          </button>
                        </p>
                      )}
                      <button type="button" className="font-bold text-red-700 underline" onClick={withdrawBill}>
                        Withdraw approval
                      </button>
                    </div>
                  )}
                  {okPhone(phone) && (
                    <button type="button" onClick={sendPayLink} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#22c55e] bg-white text-[13px] font-bold text-[#16a34a] hover:bg-emerald-50">
                      <WaIcon size={16} /> Send payment link on WhatsApp
                    </button>
                  )}
                </div>
              )}
            </div>

            {problems.length > 0 && (items.length > 0 || mode === "tab") && <p className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">{problems[0]}</p>}

            <div className="space-y-2">
              <Btn size="lg" kind="red" disabled={!ready} onClick={() => (setPrinting(false), setSaveOpen(true))} className="w-full uppercase">
                Save order
              </Btn>
              {mode === "tab" && f && <p className="pt-1 text-center text-[11.5px] text-slate-400">Completing closes {whoIs(f.session)}&apos;s tab — their next order starts a fresh one.</p>}
            </div>
          </div>
        </aside>
      </div>

      <Catalog
        open={picker !== null}
        onClose={() => setPicker(null)}
        title="Swap this line — pick one or more"
        addLabel="OK"
        onAdd={(picks) => {
          /* Tick as many items as you like, then OK: the first one takes the place of the
             line being swapped and the rest are added to the bill — merged into a line
             that already has the same item, otherwise as new lines. */
          const at = picker;
          setLines((ls) => {
            let next = [...ls];
            picks.forEach(({ productId, qty }, n) => {
              const prod = s.products.find((x) => x.id === productId);
              if (!prod) return;
              const same = next.findIndex((l) => l.productId === prod.id && !(n === 0 && l.key === at));
              if (same >= 0) {
                next[same] = { ...next[same], qty: Math.min(999, next[same].qty + qty) };
                if (n === 0 && at !== null && next.length > 1) next = next.filter((l) => l.key !== at); // the swapped line folded into the existing one
                return;
              }
              const line: Line = { key: ++seq, productId: prod.id, name: prod.name, price: String(prod.price), qty };
              const i = n === 0 && at !== null ? next.findIndex((l) => l.key === at) : -1;
              if (i >= 0) next[i] = { ...line, key: next[i].key };
              else next.push(line);
            });
            return next;
          });
          return true;
        }}
      />
      <Catalog
        open={picking}
        onClose={() => setPicking(false)}
        title="Pick items for this bill"
        addLabel="OK"
        onAdd={(picks) => {
          /* Each pick is a {productId, qty} from the catalog cart. For items
             the bill already has, bump the qty; otherwise add a fresh line.
             A blank starter line (name + price empty) is replaced instead of
             pushed down, so the first pick fills the row the user just saw. */
          setLines((ls) => {
            let next = [...ls];
            for (const { productId, qty } of picks) {
              const prod = s.products.find((x) => x.id === productId);
              if (!prod) continue;
              const existing = next.findIndex((l) => l.productId === prod.id);
              if (existing >= 0) {
                next[existing] = { ...next[existing], qty: Math.min(999, next[existing].qty + qty) };
                continue;
              }
              const line: Line = { key: ++seq, productId: prod.id, name: prod.name, price: String(prod.price), qty };
              if (next.length === 1 && !next[0].name.trim() && !next[0].price) next = [line];
              else next.push(line);
            }
            return next;
          });
          return true;
        }}
      />

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={printing ? "Print — choose printer & paper" : "Save order"}>
        {printing ? (
          <div className="space-y-4">
            <PrintFormats onPick={(fmt) => complete("print", fmt)} />
            <Btn kind="plain" size="sm" onClick={() => setPrinting(false)}>
              ← Back
            </Btn>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="mb-1 text-[13px] text-slate-500">{rupee(calc.total)} · how do you want to finish this bill?</p>
            <button
              type="button"
              disabled={!okPhone(phone) || busy}
              onClick={() => complete("wa")}
              className="flex h-12 w-full items-center gap-3 rounded-xl bg-[#22c55e] px-4 text-[14px] font-extrabold text-white transition hover:bg-[#16a34a] disabled:opacity-45"
            >
              <WaIcon size={20} /> Send to WhatsApp
              {!okPhone(phone) && <span className="ml-auto text-[11px] font-semibold opacity-90">needs a 10-digit mobile</span>}
            </button>
            <Btn size="lg" kind="dark" icon="print" disabled={busy} onClick={() => setPrinting(true)} className="w-full justify-start">
              Print
            </Btn>
            <Btn size="lg" disabled={busy} onClick={() => complete("none")} className="w-full justify-start">
              Save bill
            </Btn>
          </div>
        )}
      </Modal>
      <PrintModal bill={printFor} onClose={() => setPrintFor(null)} />
      <Modal
        open={!!done}
        onClose={() => setDone(null)}
        title="Bill saved"
        footer={
          done && (
            <div className={cx("grid w-full gap-2", done.customerPhone ? "grid-cols-3" : "grid-cols-2")}>
              {done.customerPhone && (
                <a href={waLink(done.customerPhone, billText(done, shop, s.settings.publicUrl))} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#22c55e] px-3 text-[13px] font-semibold text-white hover:bg-[#16a34a]">
                  <WaIcon size={16} /> WhatsApp
                </a>
              )}
              <Btn icon="print" className="w-full" onClick={() => setPrintFor(done)}>
                Print receipt
              </Btn>
              <Btn kind="red" className="w-full" onClick={() => setDone(null)}>
                New bill
              </Btn>
            </div>
          )
        }
      >
        {done && (
          <div className="grid place-items-center gap-2 py-2 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <Icon name="check" size={28} stroke={2.6} />
            </span>
            <p className="font-bold text-slate-900">{done.invoiceNo}</p>
            <p className="adm-num text-[32px] font-extrabold">{rupee(done.total)}</p>
            <p className="text-[13px] text-slate-500">
              {done.source === "tab" ? `${whoIs(done)}'s tab is closed.` : "Counter sale recorded."}
              {done.change > 0 && ` Give back ${rupee(done.change)} change.`}
            </p>
            <SavedLoyalty bill={done} />
          </div>
        )}
      </Modal>
      {joined && <WelcomeStep joined={joined} onClose={() => setJoined(null)} />}
      <Modal
        open={!!newCp}
        onClose={() => setNewCp(null)}
        title="New coupon"
        footer={
          <>
            <Btn onClick={() => setNewCp(null)}>Cancel</Btn>
            <Btn kind="red" onClick={createCoupon} disabled={busy || !newCp?.code || !newCp?.percent}>
              Create &amp; apply
            </Btn>
          </>
        }
      >
        {newCp && (
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="sm:col-span-1">
              <span className={lbl}>Code</span>
              <input className={cx(big, "uppercase")} value={newCp.code} maxLength={24} placeholder="SUMMER20" onChange={(e) => setNewCp({ ...newCp, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            </label>
            <label>
              <span className={lbl}>Discount %</span>
              <input className={big} type="number" min={1} max={100} value={newCp.percent} onChange={(e) => setNewCp({ ...newCp, percent: e.target.value })} />
            </label>
            <label>
              <span className={lbl}>Min order ₹</span>
              <input className={big} type="number" min={0} value={newCp.minOrder} onChange={(e) => setNewCp({ ...newCp, minOrder: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
