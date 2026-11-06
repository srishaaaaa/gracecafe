/* Loyalty programme settings: one JSON document, edited by the admin. Shared by the
   server (which enforces it) and the admin screens (which preview with it).
   Every value here is a default the owner can change on the Loyalty → Settings tab. */

/** A tier's short id (lower-case letters, digits, - or _). The owner can add, rename and remove tiers. */
export type TierKey = string;
/** The starter set that comes with a new programme. */
export const TIER_KEYS: TierKey[] = ["bronze", "silver", "gold", "platinum"];
export const MAX_TIERS = 8;

/** The WhatsApp messages sent to members when something changes on their account. */
export type MessageKey = "enrol" | "earned" | "redeemed" | "unlock" | "claimed" | "milestone" | "adjust";
export type LoyaltyMessages = { enabled: boolean; /** each kind of message can be switched off on its own */ events: Record<MessageKey, boolean>; templates: Record<MessageKey, string> };

export const MESSAGE_META: { key: MessageKey; label: string; when: string }[] = [
  { key: "enrol", label: "Welcome", when: "When a customer joins the loyalty programme" },
  { key: "earned", label: "Points earned", when: "After a paid bill that earned points" },
  { key: "redeemed", label: "Points used", when: "After a bill where points were used" },
  { key: "unlock", label: "Reward unlocked", when: "When a customer collects enough points for a free gift" },
  { key: "claimed", label: "Free gift claimed", when: "After a free gift is handed over on a paid bill" },
  { key: "milestone", label: "Spending reward unlocked", when: "When total spending reaches a reward milestone" },
  { key: "adjust", label: "Points adjusted", when: "When the admin adds or removes points" },
];
/** Words that are filled in for each member. */
export const MESSAGE_FIELDS = ["name", "shop", "date", "points", "balance", "bill", "amount", "discount", "reward", "quantity", "reason", "wallet"] as const;

export type Tier = { key: TierKey; name: string; min: number; multiplier: number; benefits: string };

export type RewardKind = "free_item" | "percent" | "amount";

/** A reward handed out automatically (visit milestone, birthday, …). */
export type AutoReward = { kind: RewardKind | "none"; name: string; value: number; productId: string | null };

export type Milestone = { visits: number; reward: AutoReward; validityDays: number };

export type Occasion = { enabled: boolean; bonusPoints: number; reward: AutoReward; windowDays: number; validityDays: number; tiers: TierKey[] };

export type RedeemRange = { from: number; to: number | null; min: number; max: number };

/** Which kinds of free gift are switched on, and the rules that apply to all of them. */
export type GiftSwitches = {
  points: boolean;
  milestone: boolean;
  offers: boolean;
  /** spending rewards count every paid bill ever (true) or only bills from the day the reward was created (false) */
  countOldBills: boolean;
  /** voiding or deleting a bill also puts its free gifts back in stock (false: they were handed over, so they are not restocked) */
  restockOnVoid: boolean;
  /** days an unlocked spending reward stays valid (0 = it never expires) */
  validityDays: number;
};

/** What the loyalty programme shows and does around billing. */
export type LoyaltyDisplay = {
  /** the loyalty box (previous balance, earned, redeemed, remaining) on printed receipts and the invoice page */
  receiptSummary: boolean;
  /** the "agrees to WhatsApp messages" box starts ticked when adding a customer */
  defaultConsent: boolean;
  /** tidy the records of deleted bills automatically when the Loyalty page opens */
  autoTidy: boolean;
};

export type EarnRule = { target: "product" | "category"; key: string; multiplier: number };

export type LoyaltyConfig = {
  enabled: boolean;
  earn: {
    /** per100: N points for every ₹100; percent: N% of the amount, as points */
    mode: "per100" | "percent";
    per100: number;
    percent: number;
    fixedPerBill: number;
    minBill: number;
    /** 0 = no cap (applies to purchase points, not bonuses) */
    maxPerBill: number;
    rounding: "floor" | "round" | "ceil";
    firstPurchaseBonus: number;
    excludedProductIds: string[];
    excludedCategories: string[];
    rules: EarnRule[];
  };
  redeem: {
    enabled: boolean;
    /** rupees per point */
    pointValue: number;
    minPoints: number;
    /** % of the eligible bill that points may pay for */
    maxPercent: number;
    /** ₹ cap per bill, 0 = none */
    maxAmount: number;
    /** how many points may be used, by the size of the bill (₹ from – to, points min – max). `to` null = no upper end */
    ranges: RedeemRange[];
    withCoupon: boolean;
    withManual: boolean;
    withReward: boolean;
    excludedProductIds: string[];
    excludedCategories: string[];
  };
  tiers: Tier[];
  gifts: GiftSwitches;
  display: LoyaltyDisplay;
  expiry: { days: number; warnDays: number };
  stamps: { enabled: boolean; minBill: number; rule: "per_day" | "per_bill"; tiers: TierKey[]; milestones: Milestone[] };
  birthday: Occasion;
  anniversary: Occasion;
  referral: { enabled: boolean; referrerBonus: number; refereeBonus: number; minPurchase: number; startsOn: string; endsOn: string; maxPerReferrer: number; tiers: TierKey[] };
  messages: LoyaltyMessages;
  crm: { newDays: number; regularVisits: number; frequentVisits: number; frequentDays: number; highValue: number; vipSpend: number; atRiskDays: number; inactiveDays: number; lostDays: number };
};

const none: AutoReward = { kind: "none", name: "", value: 0, productId: null };

export const DEFAULT_CONFIG: LoyaltyConfig = {
  enabled: true,
  earn: { mode: "per100", per100: 5, percent: 5, fixedPerBill: 0, minBill: 0, maxPerBill: 0, rounding: "floor", firstPurchaseBonus: 0, excludedProductIds: [], excludedCategories: [], rules: [] },
  redeem: { enabled: true, pointValue: 0.5, minPoints: 20, maxPercent: 20, maxAmount: 0,
    ranges: [
      { from: 100, to: 200, min: 20, max: 40 },
      { from: 201, to: 500, min: 50, max: 100 },
      { from: 501, to: 1000, min: 100, max: 200 },
      { from: 1001, to: 2000, min: 150, max: 400 },
      { from: 2001, to: null, min: 200, max: 600 },
    ],
    withCoupon: true, withManual: true, withReward: true, excludedProductIds: [], excludedCategories: [] },
  /* One membership level for everyone: the programme is deliberately simple, with no tiers. */
  tiers: [{ key: "member", name: "Member", min: 0, multiplier: 1, benefits: "" }],
  gifts: { points: true, milestone: true, offers: true, countOldBills: false, restockOnVoid: false, validityDays: 0 },
  display: { receiptSummary: true, defaultConsent: false, autoTidy: true },
  expiry: { days: 0, warnDays: 30 },
  stamps: {
    enabled: false,
    minBill: 100,
    rule: "per_day",
    tiers: [],
    milestones: [
      { visits: 5, reward: { kind: "amount", name: "Free tea", value: 20, productId: null }, validityDays: 30 },
      { visits: 10, reward: { kind: "amount", name: "Free snack", value: 50, productId: null }, validityDays: 30 },
      { visits: 15, reward: { kind: "percent", name: "15th visit treat — 25% off", value: 25, productId: null }, validityDays: 30 },
    ],
  },
  birthday: { enabled: false, bonusPoints: 50, reward: { kind: "percent", name: "Birthday treat — 15% off", value: 15, productId: null }, windowDays: 7, validityDays: 14, tiers: [] },
  anniversary: { enabled: false, bonusPoints: 50, reward: none, windowDays: 7, validityDays: 14, tiers: [] },
  referral: { enabled: false, referrerBonus: 50, refereeBonus: 25, minPurchase: 200, startsOn: "", endsOn: "", maxPerReferrer: 20, tiers: [] },
  messages: {
    enabled: true,
    events: { enrol: true, earned: true, redeemed: true, unlock: true, claimed: true, milestone: true, adjust: true },
    templates: {
      enrol: "Welcome to {shop}, {name}! You are now part of our loyalty programme. Start collecting points and enjoy free gifts and rewards. {wallet}",
      earned: "Thank you for visiting {shop}! You earned {points} loyalty points on bill {bill}. Your available balance is {balance} points.",
      redeemed: "You redeemed {points} points and received a ₹{discount} discount on bill {bill}. Your remaining balance is {balance} points.",
      unlock: "Congratulations {name}! You have unlocked a FREE {reward} with your loyalty points. Visit {shop} and claim your reward.",
      claimed: "Enjoy your FREE {quantity} × {reward}! It was added to bill {bill} at {shop}. Your reward has been claimed.",
      milestone: "Congratulations {name}! You reached the {amount} spending milestone and unlocked a FREE {reward}. Visit {shop} and claim it on your next bill.",
      adjust: "Hi {name}, your {shop} loyalty points were updated by {points} points ({reason}). Your new balance is {balance} points.",
    },
  },
  crm: { newDays: 30, regularVisits: 3, frequentVisits: 6, frequentDays: 90, highValue: 5000, vipSpend: 15000, atRiskDays: 30, inactiveDays: 60, lostDays: 90 },
};

/* ---------- sanitising: whatever comes in, a valid config goes out ---------- */
const n = (v: unknown, lo: number, hi: number, d: number) => {
  const x = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};
const i = (v: unknown, lo: number, hi: number, d: number) => Math.round(n(v, lo, hi, d));
const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const s = (v: unknown, max: number, d = "") => (typeof v === "string" ? v.trim().slice(0, max) : d);
const strs = (v: unknown, max = 200) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 80)))].slice(0, max) : []);
const slug = (v: unknown) => s(v, 20).toLowerCase().replace(/[^a-z0-9_-]/g, "");
const tiersOf = (v: unknown): TierKey[] => strs(v).filter((x) => /^[a-z0-9_-]{1,20}$/.test(x));
const day = (v: unknown) => {
  const x = s(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : "";
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function autoReward(v: unknown, d: AutoReward): AutoReward {
  const o = obj(v);
  const kind = ["none", "free_item", "percent", "amount"].includes(String(o.kind)) ? (o.kind as AutoReward["kind"]) : d.kind;
  return { kind, name: s(o.name, 80, d.name), value: kind === "percent" ? n(o.value, 0, 100, d.value) : n(o.value, 0, 100000, d.value), productId: s(o.productId, 40) || null };
}

function occasion(v: unknown, d: Occasion): Occasion {
  const o = obj(v);
  return { enabled: b(o.enabled, d.enabled), bonusPoints: i(o.bonusPoints, 0, 100000, d.bonusPoints), reward: autoReward(o.reward, d.reward), windowDays: i(o.windowDays, 0, 31, d.windowDays), validityDays: i(o.validityDays, 1, 365, d.validityDays), tiers: o.tiers === undefined ? d.tiers : tiersOf(o.tiers) };
}

export function sanitizeConfig(raw: unknown): LoyaltyConfig {
  const D = DEFAULT_CONFIG;
  const r = obj(raw);
  const e = obj(r.earn);
  const rd = obj(r.redeem);
  const ex = obj(r.expiry);
  const st = obj(r.stamps);
  const rf = obj(r.referral);
  const c = obj(r.crm);
  const rawTiers = Array.isArray(r.tiers) ? (r.tiers as unknown[]).map(obj) : [];
  /* The owner can add, rename and remove tiers: whatever list comes in is cleaned up — unique ids,
     lowest first, the first starting at 0 points — and the starter set stands in if it is empty. */
  const seen = new Set<string>();
  let tiers: Tier[] = rawTiers
    .slice(0, MAX_TIERS)
    .map((x, k) => {
      const name = s(x.name, 30);
      let key = slug(x.key) || slug(name) || `tier${k + 1}`;
      while (seen.has(key)) key = `${key.slice(0, 17)}-${k + 1}`;
      seen.add(key);
      return { key, name, min: i(x.min, 0, 10_000_000, 0), multiplier: n(x.multiplier, 0, 20, 1), benefits: s(x.benefits, 300) };
    })
    .filter((t) => t.name);
  tiers = D.tiers.map((t) => ({ ...t })); // one level for everyone — tiers are not part of the simple programme
  tiers.sort((a, b) => a.min - b.min);
  tiers[0].min = 0;
  for (let k = 1; k < tiers.length; k++) if (tiers[k].min <= tiers[k - 1].min) tiers[k].min = tiers[k - 1].min + 1;
  const mg = obj(r.messages);
  const mt = obj(mg.templates);
  /* wordings that shipped before the programme was simplified: a saved copy of one of these just means "never edited" */
  const OLD_WORDING = [
    "Hi {name}! You used {points} loyalty points at {shop} on {date}. Your balance is {balance} pts. {wallet}",
    "Hi {name}, your {shop} loyalty points were updated by {points} pts ({reason}). New balance: {balance} pts. {wallet}",
  ];
  const ev = obj(mg.events);
  const messages: LoyaltyMessages = { enabled: b(mg.enabled, D.messages.enabled), events: { ...D.messages.events }, templates: { ...D.messages.templates } };
  for (const k of Object.keys(D.messages.templates) as MessageKey[]) {
    // a wording saved before the programme was simplified may use words that no longer exist ({tier}, {code}…): start from the new one
    const own = s(mt[k], 600);
    const unknown = [...own.matchAll(/\{(\w+)\}/g)].some((m) => !(MESSAGE_FIELDS as readonly string[]).includes(m[1]));
    messages.templates[k] = own && !unknown && !OLD_WORDING.includes(own) ? own : D.messages.templates[k];
    messages.events[k] = b(ev[k], D.messages.events[k]);
  }
  const gf = obj(r.gifts);
  const dp = obj(r.display);
  const ranges: RedeemRange[] = (Array.isArray(rd.ranges) ? (rd.ranges as unknown[]) : D.redeem.ranges)
    .map(obj)
    .map((x) => ({ from: i(x.from, 0, 100_000_000, 0), to: x.to === null || x.to === undefined || x.to === "" ? null : i(x.to, 0, 100_000_000, 0), min: i(x.min, 0, 10_000_000, 0), max: i(x.max, 0, 10_000_000, 0) }))
    .sort((a, b) => a.from - b.from)
    .slice(0, 30);

  const milestones = (Array.isArray(st.milestones) ? (st.milestones as unknown[]) : D.stamps.milestones)
    .map(obj)
    .map((m) => ({ visits: i(m.visits, 1, 1000, 0), reward: autoReward(m.reward, none), validityDays: i(m.validityDays, 1, 365, 30) }))
    .filter((m) => m.visits > 0 && m.reward.kind !== "none")
    .sort((a, b) => a.visits - b.visits)
    .filter((m, k, all) => k === 0 || all[k - 1].visits !== m.visits)
    .slice(0, 20);

  return {
    enabled: b(r.enabled, D.enabled),
    earn: {
      mode: e.mode === "percent" ? "percent" : e.mode === "per100" ? "per100" : D.earn.mode,
      per100: n(e.per100, 0, 1000, D.earn.per100),
      percent: n(e.percent, 0, 100, D.earn.percent),
      fixedPerBill: 0, // the simple programme has one rule: points for every ₹100
      minBill: n(e.minBill, 0, 1_000_000, D.earn.minBill),
      maxPerBill: 0,
      // two choices only: part-points are rounded down (12.5 → 12) or up (12.5 → 13); an older "nearest" setting becomes round down
      rounding: e.rounding === "ceil" ? "ceil" : "floor",
      firstPurchaseBonus: 0,
      excludedProductIds: e.excludedProductIds === undefined ? D.earn.excludedProductIds : strs(e.excludedProductIds),
      excludedCategories: e.excludedCategories === undefined ? D.earn.excludedCategories : strs(e.excludedCategories),
      rules: [],
    },
    redeem: {
      enabled: b(rd.enabled, D.redeem.enabled),
      pointValue: n(rd.pointValue, 0.01, 1000, D.redeem.pointValue),
      minPoints: i(rd.minPoints, 1, 1_000_000, D.redeem.minPoints),
      maxPercent: n(rd.maxPercent, 0, 100, D.redeem.maxPercent),
      maxAmount: n(rd.maxAmount, 0, 1_000_000, D.redeem.maxAmount),
      ranges,
      withCoupon: b(rd.withCoupon, D.redeem.withCoupon),
      withManual: b(rd.withManual, D.redeem.withManual),
      withReward: b(rd.withReward, D.redeem.withReward),
      excludedProductIds: rd.excludedProductIds === undefined ? D.redeem.excludedProductIds : strs(rd.excludedProductIds),
      excludedCategories: rd.excludedCategories === undefined ? D.redeem.excludedCategories : strs(rd.excludedCategories),
    },
    tiers,
    messages,
    gifts: {
      points: b(gf.points, D.gifts.points),
      milestone: b(gf.milestone, D.gifts.milestone),
      offers: b(gf.offers, D.gifts.offers),
      countOldBills: b(gf.countOldBills, D.gifts.countOldBills),
      restockOnVoid: b(gf.restockOnVoid, D.gifts.restockOnVoid),
      validityDays: i(gf.validityDays, 0, 3650, D.gifts.validityDays),
    },
    display: { receiptSummary: b(dp.receiptSummary, D.display.receiptSummary), defaultConsent: b(dp.defaultConsent, D.display.defaultConsent), autoTidy: b(dp.autoTidy, D.display.autoTidy) },
    expiry: { days: i(ex.days, 0, 3650, D.expiry.days), warnDays: i(ex.warnDays, 1, 365, D.expiry.warnDays) },
    stamps: { enabled: false, minBill: n(st.minBill, 0, 1_000_000, D.stamps.minBill), rule: st.rule === "per_bill" ? "per_bill" : st.rule === "per_day" ? "per_day" : D.stamps.rule, tiers: st.tiers === undefined ? D.stamps.tiers : tiersOf(st.tiers), milestones },
    birthday: { ...occasion(r.birthday, D.birthday), enabled: false },
    anniversary: { ...occasion(r.anniversary, D.anniversary), enabled: false },
    referral: {
      enabled: false,
      referrerBonus: i(rf.referrerBonus, 0, 100000, D.referral.referrerBonus),
      refereeBonus: i(rf.refereeBonus, 0, 100000, D.referral.refereeBonus),
      minPurchase: n(rf.minPurchase, 0, 1_000_000, D.referral.minPurchase),
      startsOn: rf.startsOn === undefined ? D.referral.startsOn : day(rf.startsOn),
      endsOn: rf.endsOn === undefined ? D.referral.endsOn : day(rf.endsOn),
      maxPerReferrer: i(rf.maxPerReferrer, 0, 100000, D.referral.maxPerReferrer),
      tiers: rf.tiers === undefined ? D.referral.tiers : tiersOf(rf.tiers),
    },
    crm: crmOrdered({
      newDays: i(c.newDays, 1, 3650, D.crm.newDays),
      regularVisits: i(c.regularVisits, 1, 1000, D.crm.regularVisits),
      frequentVisits: i(c.frequentVisits, 1, 1000, D.crm.frequentVisits),
      frequentDays: i(c.frequentDays, 1, 3650, D.crm.frequentDays),
      highValue: n(c.highValue, 0, 100_000_000, D.crm.highValue),
      vipSpend: n(c.vipSpend, 0, 100_000_000, D.crm.vipSpend),
      atRiskDays: i(c.atRiskDays, 1, 3650, D.crm.atRiskDays),
      inactiveDays: i(c.inactiveDays, 1, 3650, D.crm.inactiveDays),
      lostDays: i(c.lostDays, 1, 3650, D.crm.lostDays),
    }),
  };
}

type Crm = LoyaltyConfig["crm"];

/** Customer-group lines must run in order (a customer can't be "lost" before they are "inactive"), so a saved set is always put in order. */
export function crmOrdered(c: Crm): Crm {
  const inactiveDays = Math.max(c.inactiveDays, c.atRiskDays);
  return { ...c, frequentVisits: Math.max(c.frequentVisits, c.regularVisits), inactiveDays, lostDays: Math.max(c.lostDays, inactiveDays), vipSpend: Math.max(c.vipSpend, c.highValue) };
}

/** What the customer-group numbers contradict, in plain words — saving puts them in order. */
export function crmWarnings(c: Crm): string[] {
  const out: string[] = [];
  if (c.frequentVisits < c.regularVisits) out.push(`“Frequent” (${c.frequentVisits} visits) should be more than “Regular” (${c.regularVisits} visits).`);
  if (c.inactiveDays < c.atRiskDays) out.push(`“Inactive” (${c.inactiveDays} days) should come after “At risk” (${c.atRiskDays} days).`);
  if (c.lostDays < c.inactiveDays) out.push(`“Lost” (${c.lostDays} days) should come after “Inactive” (${c.inactiveDays} days).`);
  if (c.vipSpend < c.highValue) out.push(`“VIP” spending (₹${c.vipSpend}) should be more than “High value” (₹${c.highValue}).`);
  return out;
}

/** Plain-language problems with a set of redemption ranges (empty = all good). Gaps and overlaps are warned about, never silently fixed. */
export function rangeWarnings(ranges: RedeemRange[], pointValue = 0): string[] {
  const out: string[] = [];
  const list = [...ranges].sort((a, b) => a.from - b.from);
  const label = (r: RedeemRange) => `₹${r.from}${r.to === null ? " and above" : `–₹${r.to}`}`;
  if (!list.length) out.push("No ranges are set, so points can't be used on any bill.");
  for (const r of list) {
    if (r.to !== null && r.to < r.from) out.push(`${label(r)}: the top of the range is lower than the start.`);
    if (r.min < 1) out.push(`${label(r)}: the minimum points should be at least 1.`);
    if (r.max < r.min) out.push(`${label(r)}: the maximum (${r.max}) is lower than the minimum (${r.min}).`);
    // the smallest bill in a range must be able to cover the minimum points, or customers with such a bill are turned away
    if (pointValue > 0 && r.min >= 1 && r.min * pointValue > r.from + 1e-9) out.push(`${label(r)}: the minimum ${r.min} points is worth ₹${Math.round(r.min * pointValue * 100) / 100}, which is more than the smallest bill in this range (₹${r.from}) — those bills can't use points. Lower the minimum or the point value.`);
  }
  for (let k = 1; k < list.length; k++) {
    const a = list[k - 1];
    const b = list[k];
    if (a.to === null) out.push(`${label(a)} has no upper end, so ${label(b)} can never be reached.`);
    else if (b.from <= a.to) out.push(`${label(a)} and ${label(b)} overlap.`);
    else if (b.from > a.to + 1) out.push(`Gap: bills from ₹${a.to + 1} to ₹${b.from - 1} have no range, so points can't be used on them.`);
  }
  return out;
}

/** True when a set of ranges can be saved at all (gaps and overlaps are only warnings). */
export const rangesValid = (ranges: RedeemRange[]) => ranges.every((r) => r.min >= 1 && r.max >= r.min && (r.to === null || r.to >= r.from));
