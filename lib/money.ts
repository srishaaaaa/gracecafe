import { UPI_CHANNELS, type Bill, type Coupon, type DiscountType, type OrderItem } from "./types";

/* Shared by the server (authoritative totals) and the billing screen (live preview). */

export const TZ = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹1,47,246 */
export const rupee = (n: number) => `₹${inr.format(Math.round(n * 100) / 100)}`;

export const round2 = (n: number) => Math.round(n * 100) / 100;

type Paid = { payment: "cash" | "upi" | "card" | "split"; cashAmount: number; upiAmount: number; cardAmount: number; upiChannel?: string };

/** "UPI", or "UPI · WhatsApp payment link" when it is known how the payment arrived. */
export function upiText(channel?: string | null) {
  const c = UPI_CHANNELS.find((x) => x.key === channel);
  return c && c.key !== "other" ? `UPI · ${c.label}` : "UPI";
}

/** How a bill was paid, part by part — a split can be any mix of cash, UPI and card. */
export function payParts(b: Paid): [string, number][] {
  const all: [string, number][] = [
    ["Cash", b.cashAmount],
    [upiText(b.upiChannel), b.upiAmount],
    ["Card", b.cardAmount],
  ];
  return all.filter(([, n]) => n > 0);
}

/** "Cash", "UPI", "Card", or for a split the methods used, e.g. "Cash + UPI". */
export function payLabel(b: Paid): string {
  if (b.payment !== "split") return { cash: "Cash", upi: upiText(b.upiChannel), card: "Card" }[b.payment];
  const parts = payParts(b);
  return parts.length ? parts.map(([m]) => m).join(" + ") : "Split";
}

/** YYYY-MM-DD for "today" in the shop's timezone. */
export function shopToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type CouponCheck = { ok: true } | { ok: false; reason: string };

/** Last 10 digits of a mobile, for comparing against the phones a coupon was sent to. */
export const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

/** `phone` is the customer's mobile; a coupon locked to the phones it was sent to needs it.
    `member` is whether that mobile is an active loyalty member (false/null = not). */
export function checkCoupon(c: Coupon, subtotal: number, phone?: string | null, member?: boolean | null, now = Date.now()): CouponCheck {
  if (!c.active) return { ok: false, reason: "Paused" };
  if (c.audience === "loyalty" && !member) return { ok: false, reason: last10(phone) ? "For loyalty members only" : "For loyalty members only — enter their mobile" };
  if (c.audience === "regular" && member) return { ok: false, reason: "For non-loyalty customers only" };
  if (c.restricted) {
    const p = last10(phone);
    if (!p) return { ok: false, reason: "Only for the customer it was sent to — enter their mobile" };
    if (!(c.phones ?? []).includes(p)) return { ok: false, reason: "Not valid for this mobile number" };
  }
  if (c.expiresAt && c.expiresAt < shopToday(now)) return { ok: false, reason: "Expired" };
  if (c.limit !== null && c.used >= c.limit) return { ok: false, reason: "Usage limit reached" };
  if (subtotal < c.minOrder) return { ok: false, reason: `Needs ${rupee(c.minOrder)} subtotal` };
  return { ok: true };
}

export function couponStatus(c: Coupon, now = Date.now()): "active" | "expired" | "exhausted" | "paused" {
  if (!c.active) return "paused";
  if (c.expiresAt && c.expiresAt < shopToday(now)) return "expired";
  if (c.limit !== null && c.used >= c.limit) return "exhausted";
  return "active";
}

export type BillInput = {
  items: OrderItem[];
  coupon: Coupon | null;
  manualType: DiscountType;
  manualValue: number;
  extra: number;
  /** GST bill: tax is added on top of the prices (exclusive). A non-GST bill carries none. */
  gst?: boolean;
  gstPercent?: number;
  /** customer's mobile — checked against coupons locked to certain phones */
  phone?: string | null;
  /** whether that mobile is an active loyalty member — for coupons meant for members / non-members */
  member?: boolean | null;
  /** loyalty: a reward's value and the rupee value of redeemed points, both worked out
      (and checked) by lib/loyalty — they come off after the coupon and manual discount */
  rewardDiscount?: number;
  pointsDiscount?: number;
};

export function computeBill({ items, coupon, manualType, manualValue, extra, gst = false, gstPercent = 0, phone, member, rewardDiscount = 0, pointsDiscount = 0 }: BillInput) {
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  const couponOk = coupon ? checkCoupon(coupon, subtotal, phone, member) : null;
  const couponDiscount = coupon && couponOk?.ok ? Math.round((subtotal * coupon.percent) / 100) : 0;
  const afterCoupon = Math.max(0, subtotal - couponDiscount);
  const mv = Math.max(0, Number(manualValue) || 0);
  const manualDiscount = Math.min(afterCoupon, manualType === "percent" ? Math.round((afterCoupon * Math.min(100, mv)) / 100) : round2(mv));
  const afterManual = Math.max(0, afterCoupon - manualDiscount);
  const rewardOff = Math.min(afterManual, Math.max(0, round2(Number(rewardDiscount) || 0)));
  const pointsOff = Math.min(Math.max(0, afterManual - rewardOff), Math.max(0, round2(Number(pointsDiscount) || 0)));
  const discount = round2(couponDiscount + manualDiscount + rewardOff + pointsOff);
  const ex = Math.max(0, round2(Number(extra) || 0));
  /* GST is charged on what the customer is actually billed for — items after
     discounts, plus any extra charge — and sits on top of it. */
  const taxable = round2(Math.max(0, subtotal - discount) + ex);
  const rate = gst ? Math.min(100, Math.max(0, round2(Number(gstPercent) || 0))) : 0;
  const gstAmount = round2((taxable * rate) / 100);
  const total = round2(taxable + gstAmount);
  return { subtotal, itemCount, couponDiscount, couponOk, manualDiscount, rewardDiscount: rewardOff, pointsDiscount: pointsOff, discount, extra: ex, taxable, gstPercent: rate, gstAmount, total };
}

/** Collapse repeated products/lines into one line each. */
export function mergeItems(items: OrderItem[]): OrderItem[] {
  const out: OrderItem[] = [];
  for (const it of items) {
    const hit = out.find((o) => (it.productId ? o.productId === it.productId : !o.productId && o.name === it.name) && o.price === it.price);
    if (hit) hit.qty += it.qty;
    else out.push({ ...it });
  }
  return out;
}

/** The loyalty box printed on a bill: balance before, what was earned and used, and what is left. Null when the bill
    has no loyalty customer, so a normal bill prints exactly as before. */
export function loyaltySummary(b: Bill): [string, string][] | null {
  if (!b.loyaltyCustomerId) return null;
  const used = b.loyaltyPrev !== null && b.loyaltyBalance !== null ? Math.max(0, b.loyaltyPrev + b.pointsEarned - b.loyaltyBalance) : b.pointsRedeemed;
  const rows: [string, string][] = [];
  if (b.loyaltyPrev !== null) rows.push(["Previous balance", `${b.loyaltyPrev} points`]);
  rows.push(["Points earned", `${b.pointsEarned} points`]);
  rows.push(["Points redeemed", `${used} points`]);
  if (b.pointsDiscount > 0) rows.push(["Loyalty discount", rupee(b.pointsDiscount)]);
  const gifts = b.items.filter((i) => i.free);
  if (gifts.length) rows.push(["Free gift received", gifts.map((g) => `${g.qty} × ${g.name}`).join(", ")]);
  if (b.loyaltyBalance !== null) rows.push(["Remaining balance", `${b.loyaltyBalance} points`]);
  return rows;
}

/** An amount in Indian style with exactly two decimals, e.g. 1,25,000.00 (printed on invoices) */
export const inr2 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Indian-style number to words (lakh / crore)
export function numberToWords(num: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const chunk = (n: number) => {
    let s = "";
    if (n >= 100) {
      s += `${a[Math.floor(n / 100)]} Hundred `;
      n %= 100;
    }
    if (n >= 20) s += `${b[Math.floor(n / 10)]}${n % 10 ? ` ${a[n % 10]}` : ""} `;
    else if (n > 0) s += `${a[n]} `;
    return s.trim();
  };
  const int = Math.floor(Math.abs(num));
  const paise = Math.round((Math.abs(num) - int) * 100);
  if (!int && !paise) return "Zero Rupees Only";
  const parts: [number, string][] = [
    [Math.floor(int / 10000000), "Crore"],
    [Math.floor((int % 10000000) / 100000), "Lakh"],
    [Math.floor((int % 100000) / 1000), "Thousand"],
    [int % 1000, ""],
  ];
  const words = parts
    .filter(([n]) => n > 0)
    .map(([n, u]) => `${chunk(n)} ${u}`.trim())
    .join(" ");
  return `${words || "Zero"} Rupees${paise ? ` and ${chunk(paise)} Paise` : ""} Only`;
}
