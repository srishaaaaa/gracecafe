/* Loyalty maths, with no database access — shared by the server (which decides) and
   the billing screen (which previews). The server always recomputes; nothing a
   browser sends about points, values or eligibility is trusted. */

import { TZ, round2 } from "../money";
import type { OrderItem } from "../types";
import type { LoyaltyConfig, RewardKind, Tier, TierKey } from "./config";
import type { Campaign, PurchaseStats, Reward, Segment, Voucher } from "./types";

const DAY = 86_400_000;

/* ---------------- tiers ---------------- */
export function tierFor(lifetime: number, cfg: LoyaltyConfig): Tier {
  let t = cfg.tiers[0];
  for (const x of cfg.tiers) if (lifetime >= x.min) t = x;
  return t;
}
export const tierByKey = (k: TierKey, cfg: LoyaltyConfig) => cfg.tiers.find((t) => t.key === k) ?? cfg.tiers[0];
export function nextTier(lifetime: number, cfg: LoyaltyConfig): { tier: Tier; need: number } | null {
  const t = cfg.tiers.find((x) => x.min > lifetime);
  return t ? { tier: t, need: t.min - lifetime } : null;
}
export const tierOk = (tiers: TierKey[], t: TierKey) => !tiers.length || tiers.includes(t);

/* ---------------- shop-local time ---------------- */
const parts = (t: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(t).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, wd, year: Number(p.year) };
};
export const shopDate = (t: number) => parts(t).date;
export const shopYear = (t: number) => parts(t).year;

/** Is `md` (MM-DD) within ±window days of the shop's today? Returns the matching year, or null. */
export function occasionYear(dateStr: string, window: number, now = Date.now()): number | null {
  const m = /(?:^\d{4}-)?(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return null;
  const today = new Date(`${shopDate(now)}T00:00:00Z`).getTime();
  const y = shopYear(now);
  for (const yy of [y - 1, y, y + 1]) {
    const d = new Date(`${yy}-${m[1]}-${m[2]}T00:00:00Z`).getTime();
    if (Number.isFinite(d) && Math.abs(d - today) <= window * DAY) return yy;
  }
  return null;
}

/* ---------------- line eligibility ---------------- */
export type CatOf = (productId: string | null) => string;

const excluded = (it: OrderItem, catOf: CatOf, ids: string[], cats: string[]) => !!it.free || (!!it.productId && ids.includes(it.productId)) || (cats.length > 0 && cats.includes(catOf(it.productId)));

export const eligibleSubtotal = (items: OrderItem[], catOf: CatOf, ids: string[], cats: string[]) => round2(items.reduce((a, it) => a + (excluded(it, catOf, ids, cats) ? 0 : it.price * it.qty), 0));

/* ---------------- rewards & vouchers ---------------- */
type RewardLike = Pick<Reward, "kind" | "value" | "productId" | "name"> & { giftQty?: number };

/** What a reward takes off a bill whose amount after coupon & manual discount is `afterManual`.
    A free item needs that item on the bill; it's worth one of it. */
export function rewardValue(r: RewardLike, items: OrderItem[], afterManual: number): { amount: number; reason: string } {
  if (r.kind === "free_item") {
    /* a free gift costs the customer nothing: it is its own ₹0 "FREE GIFT" line, so there is no discount to take off */
    const given = items.filter((i) => i.free && i.productId && i.productId === r.productId).reduce((a, i) => a + i.qty, 0);
    if (given < Math.max(1, r.giftQty ?? 1)) return { amount: 0, reason: `Add the free gift for "${r.name}" to the bill first` };
    return { amount: 0, reason: "" };
  }
  if (r.kind === "percent") return { amount: Math.round((afterManual * Math.min(100, r.value)) / 100), reason: "" };
  return { amount: round2(Math.min(afterManual, r.value)), reason: "" };
}

export const rewardLabel = (k: RewardKind, value: number, productName?: string) => (k === "free_item" ? `Free ${productName || "item"}` : k === "percent" ? `${value}% off` : `₹${value} off`);

export function rewardAvailable(r: Reward, tier: TierKey, now = Date.now()): string {
  const today = shopDate(now);
  if (!r.active) return "Not available";
  if (r.startsOn && today < r.startsOn) return `Starts ${r.startsOn}`;
  if (r.endsOn && today > r.endsOn) return "Expired";
  if (!tierOk(r.tiers, tier)) return "Not for this membership tier";
  if (r.maxRedemptions !== null && r.redeemed >= r.maxRedemptions) return "Fully redeemed";
  return "";
}

export const voucherLive = (v: Voucher, now = Date.now()) => v.status === "issued" && (v.expiresAt === null || v.expiresAt >= now);

/* ---------------- redemption ---------------- */
export type RedeemCtx = {
  cfg: LoyaltyConfig;
  items: OrderItem[];
  catOf: CatOf;
  subtotal: number;
  /** bill after coupon, manual discount and any reward */
  remaining: number;
  available: number;
  couponApplied: boolean;
  manualApplied: boolean;
  rewardApplied: boolean;
};

/** The most points this bill can take, and why not more. */
export function redeemCap(c: RedeemCtx): { maxPoints: number; minPoints: number; maxAmount: number; reason: string } {
  const r = c.cfg.redeem;
  const no = (reason: string) => ({ maxPoints: 0, minPoints: 0, maxAmount: 0, reason });
  if (!c.cfg.enabled || !r.enabled) return no("Points redemption is switched off");
  if (c.couponApplied && !r.withCoupon) return no("Points can't be used together with a coupon");
  if (c.manualApplied && !r.withManual) return no("Points can't be used together with a manual discount");
  if (c.rewardApplied && !r.withReward) return no("Points can't be used together with a reward");
  const elig = eligibleSubtotal(c.items, c.catOf, r.excludedProductIds, r.excludedCategories);
  const share = c.subtotal > 0 ? elig / c.subtotal : 0;
  /* the "eligible bill amount": what is left to pay for items that may be paid with points */
  const eligible = round2(Math.max(0, c.remaining) * share);
  const range = redeemRange(eligible, r.ranges);
  if (!range) return no(eligible > 0 ? `No points range is set for a bill of ₹${Math.floor(eligible)}` : "Nothing on this bill can be paid with points");
  if (c.available < range.min) return no(`A bill of ₹${Math.floor(eligible)} needs at least ${range.min} points to redeem — ${c.available} available`);
  // never more than the range allows, the customer owns, or the eligible amount itself
  const maxPoints = Math.min(c.available, range.max, Math.floor(eligible / r.pointValue + 1e-9));
  if (maxPoints < range.min) return no(`A bill of ₹${Math.floor(eligible)} can't take the ${range.min}-point minimum for its range (that is ₹${round2(range.min * r.pointValue)} — more than the bill can be paid with points)`);
  return { maxPoints, minPoints: range.min, maxAmount: pointsValue(maxPoints, c.cfg), reason: "" };
}

/** The range that covers a bill of this eligible amount (whole rupees: ₹200.50 counts as ₹200). The lowest range wins if two overlap. */
export function redeemRange(amount: number, ranges: LoyaltyConfig["redeem"]["ranges"]) {
  const a = Math.floor(amount + 1e-9);
  return [...ranges].sort((x, y) => x.from - y.from).find((r) => a >= r.from && (r.to === null || a <= r.to)) ?? null;
}

export const pointsValue = (points: number, cfg: LoyaltyConfig) => round2(points * cfg.redeem.pointValue);

/* ---------------- campaigns ---------------- */
export type CampaignCtx = { now: number; tier: TierKey; segment: Segment | null; eligibleNet: number; items: OrderItem[]; catOf: CatOf };

export function campaignLive(c: Campaign, now: number): boolean {
  if (!c.active) return false;
  const p = parts(now);
  if (c.startsOn && p.date < c.startsOn) return false;
  if (c.endsOn && p.date > c.endsOn) return false;
  if (c.days.length && !c.days.includes(p.wd)) return false;
  if (c.startTime && p.hm < c.startTime) return false;
  if (c.endTime && p.hm > c.endTime) return false;
  if (c.usageLimit !== null && c.used >= c.usageLimit) return false;
  return true;
}

export function campaignApplies(c: Campaign, x: CampaignCtx): boolean {
  if (!campaignLive(c, x.now)) return false;
  if (!tierOk(c.tiers, x.tier)) return false;
  if (c.segments.length && (!x.segment || !c.segments.includes(x.segment))) return false;
  if (x.eligibleNet < c.minPurchase) return false;
  if (c.categories.length || c.productIds.length) {
    const hit = x.items.some((i) => (i.productId && c.productIds.includes(i.productId)) || c.categories.includes(x.catOf(i.productId)));
    if (!hit) return false;
  }
  return true;
}

/* ---------------- earning ---------------- */
export type EarnPart = { type: "purchase" | "bonus" | "promo"; points: number; label: string; campaignId?: string };

export type EarnCtx = {
  cfg: LoyaltyConfig;
  items: OrderItem[];
  catOf: CatOf;
  subtotal: number;
  /** every discount on the bill, loyalty ones included */
  discount: number;
  tier: TierKey;
  firstPurchase: boolean;
  campaigns: Campaign[];
  /** fixed points one unit of a product earns, as set by the admin; null/undefined = use the earn rule */
  pointsOf?: (productId: string | null) => number | null | undefined;
};

/** Points one unit of a product earns: the admin's fixed number if there is one, otherwise the shop-wide rule.
    (A real bill rounds once over all its lines, so for rule-based items this is the per-item share.) */
export function pointsPerUnit(p: { id: string; category: string; price: number; loyaltyPoints?: number | null }, cfg: { enabled: boolean; earn: LoyaltyConfig["earn"] }): number {
  const e = cfg.earn;
  if (!cfg.enabled) return 0;
  if (e.excludedProductIds.includes(p.id) || e.excludedCategories.includes(p.category)) return 0;
  if (p.loyaltyPoints !== null && p.loyaltyPoints !== undefined) return Math.max(0, p.loyaltyPoints);
  const rule = e.rules.find((r) => (r.target === "product" ? r.key === p.id : r.key === p.category));
  const raw = (e.mode === "percent" ? (p.price * e.percent) / 100 : (p.price / 100) * e.per100) * (rule ? rule.multiplier : 1);
  const round = e.rounding === "ceil" ? Math.ceil : e.rounding === "round" ? Math.round : Math.floor;
  return Math.max(0, round(raw + 1e-9));
}

/** Points a paid bill earns, line by line. The base is what the customer actually paid
    for eligible items — after all discounts, without GST or extra charges. */
export function earnFor(c: EarnCtx): { eligibleNet: number; parts: EarnPart[]; total: number } {
  const e = c.cfg.earn;
  const ratio = c.subtotal > 0 ? Math.max(0, c.subtotal - c.discount) / c.subtotal : 0;
  let net = 0;
  let weighted = 0;
  let fixed = 0; // items the admin gave a set number of points
  for (const it of c.items) {
    if (excluded(it, c.catOf, e.excludedProductIds, e.excludedCategories)) continue;
    const amt = it.price * it.qty * ratio;
    net += amt;
    const own = c.pointsOf ? c.pointsOf(it.productId) : null;
    if (own !== null && own !== undefined) {
      fixed += Math.max(0, own) * it.qty;
      continue;
    }
    const rule = e.rules.find((r) => (r.target === "product" ? r.key === it.productId : r.key === c.catOf(it.productId)));
    weighted += amt * (rule ? rule.multiplier : 1);
  }
  const eligibleNet = round2(net);
  if (!c.cfg.enabled || eligibleNet <= 0 || eligibleNet < e.minBill) return { eligibleNet, parts: [], total: 0 };

  const round = e.rounding === "ceil" ? Math.ceil : e.rounding === "round" ? Math.round : Math.floor;
  const tierMult = tierByKey(c.tier, c.cfg).multiplier;
  const multCamps = c.campaigns.filter((x) => x.type === "multiplier");
  const campMult = multCamps.reduce((m, x) => Math.max(m, x.value), 1);
  const raw = (e.mode === "percent" ? (weighted * e.percent) / 100 : (weighted / 100) * e.per100) + fixed;
  let purchase = round(raw * tierMult * campMult + 1e-9) + e.fixedPerBill;
  if (e.maxPerBill > 0) purchase = Math.min(purchase, e.maxPerBill);

  const out: EarnPart[] = [];
  const bits = [tierMult !== 1 ? `${tierMult}× tier` : "", campMult !== 1 ? `${campMult}× ${multCamps.find((x) => x.value === campMult)?.name}` : ""].filter(Boolean);
  if (purchase > 0) out.push({ type: "purchase", points: purchase, label: `Points on ₹${eligibleNet}${bits.length ? ` (${bits.join(", ")})` : ""}`, campaignId: campMult !== 1 ? multCamps.find((x) => x.value === campMult)?.id : undefined });
  if (c.firstPurchase && e.firstPurchaseBonus > 0) out.push({ type: "bonus", points: e.firstPurchaseBonus, label: "First purchase bonus" });
  for (const x of c.campaigns) if (x.type === "bonus" && x.value > 0) out.push({ type: "promo", points: Math.round(x.value), label: `${x.name} bonus`, campaignId: x.id });
  return { eligibleNet, parts: out, total: out.reduce((a, p) => a + p.points, 0) };
}

/* ---------------- CRM segments ---------------- */
export function segmentOf(st: PurchaseStats, cfg: LoyaltyConfig, tier: TierKey | null, now = Date.now()): Segment | null {
  if (!st.orders || st.last === null || st.first === null) return null;
  const c = cfg.crm;
  const since = (now - st.last) / DAY;
  if (since >= c.lostDays) return "lost";
  if (since >= c.inactiveDays) return "inactive";
  if (since >= c.atRiskDays && st.visits >= c.regularVisits) return "at_risk";
  // VIP = the top membership (whatever the owner calls it) or enough total spend
  const top = cfg.tiers.length > 1 ? cfg.tiers[cfg.tiers.length - 1].key : null;
  if ((top !== null && tier === top) || st.spent >= c.vipSpend) return "vip";
  if (st.spent >= c.highValue) return "high_value";
  if (st.recentVisits >= c.frequentVisits) return "frequent";
  if (st.visits >= c.regularVisits) return "regular";
  if ((now - st.first) / DAY <= c.newDays) return "new";
  return "regular";
}

export const SEGMENTS: { key: Segment; label: string; tone: "green" | "sky" | "violet" | "amber" | "red" | "slate" | "orange" }[] = [
  { key: "new", label: "New", tone: "sky" },
  { key: "regular", label: "Regular", tone: "slate" },
  { key: "frequent", label: "Frequent", tone: "green" },
  { key: "high_value", label: "High value", tone: "violet" },
  { key: "vip", label: "VIP", tone: "amber" },
  { key: "at_risk", label: "At risk", tone: "orange" },
  { key: "inactive", label: "Inactive", tone: "red" },
  { key: "lost", label: "Lost", tone: "red" },
];

/** Visits and spend from a customer's completed bills. A visit is a distinct shop day. */
export function statsFrom(bills: { total: number; createdAt: number; status: string }[], frequentDays: number, now = Date.now()): PurchaseStats {
  const done = bills.filter((b) => b.status === "completed");
  if (!done.length) return { orders: 0, visits: 0, spent: 0, aov: 0, first: null, last: null, recentVisits: 0 };
  const days = new Set<string>();
  const recent = new Set<string>();
  let spent = 0;
  let first = Infinity;
  let last = 0;
  for (const b of done) {
    const d = shopDate(b.createdAt);
    days.add(d);
    if (now - b.createdAt <= frequentDays * DAY) recent.add(d);
    spent += b.total;
    first = Math.min(first, b.createdAt);
    last = Math.max(last, b.createdAt);
  }
  return { orders: done.length, visits: days.size, spent: round2(spent), aov: round2(spent / done.length), first, last, recentVisits: recent.size };
}
