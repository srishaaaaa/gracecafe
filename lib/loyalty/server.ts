/* Loyalty on the server: the points ledger, earning and redemption at billing,
   reversals when a bill is voided or deleted, rewards, stamps, referrals, occasions,
   campaigns and the admin/reporting reads.

   Integrity rules:
   - Every points movement is one immutable row in loyalty_ledger, written in the same
     transaction as the cached balances on loyalty_customers and the point lots.
   - Writes already run one at a time (store.mutate locks the meta row), so two tills
     can't spend the same points.
   - Credits carry an idempotency `key` (unique in the database): a bill can't earn twice.
   - Balances never go below zero. Points a refund should take back but which were
     already spent become `debt`, recovered from the customer's next earnings.
   - Nothing here trusts amounts from the browser: points, values and eligibility are
     recomputed from the database. */

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, like, lt, lte, or, sql, ilike } from "drizzle-orm";
import { db, type Db, type Tx } from "../db";
import { bills, giftOffers, loyaltyAudit, loyaltyCustomers, loyaltyLedger, loyaltyLots, loyaltyMessages, loyaltyReferrals, loyaltyRewards, loyaltySettings, loyaltyStamps, loyaltyVouchers, products, settings } from "../db/schema";
import { ApiError } from "../store";
import { code, uid } from "../seed";
import { round2, shopToday } from "../money";
import type { Bill, OrderItem } from "../types";
import { DEFAULT_CONFIG, rangesValid, sanitizeConfig, type LoyaltyConfig, type MessageKey } from "./config";
import { earnFor, pointsValue, redeemCap, rewardAvailable, rewardValue, shopDate, tierFor, voucherLive, type CatOf } from "./engine";
import { giftProblems, offerEntitlements, type Entitlement } from "./gifts";
import { fillMessage } from "./messages";
import type { GiftOffer, LedgerEntry, LedgerType, LoyaltyCustomer, LoyaltyLookup, LoyaltyMessage, LoyaltyState, Reward, Voucher, VoucherSource } from "./types";
import type { RewardKind } from "./config";

type Q = Db | Tx;
type Args = Record<string, unknown>;
const DAY = 86_400_000;

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const x = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const first = async <T>(rows: Promise<T[]>): Promise<T | null> => (await rows)[0] ?? null;
const day = (v: unknown) => {
  const x = str(v, 10);
  if (x && !/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new ApiError("Dates should be picked from the calendar.");
  return x;
};

/** 10-digit Indian mobile, tolerant of +91 / spaces. "" if absent, null if invalid. */
export function mobile(v: unknown): string | null {
  const d = str(v, 24).replace(/\D/g, "");
  if (!d) return "";
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const SYSTEM = "system";

/* ================================ config ================================ */

export async function getConfig(q: Q): Promise<LoyaltyConfig> {
  const r = await first(q.select().from(loyaltySettings).where(eq(loyaltySettings.id, 1)));
  return r ? sanitizeConfig(r.config) : DEFAULT_CONFIG;
}

/** The fixed points per unit the admin set on products (absent = the earn rule). */
async function pointsMap(q: Q) {
  const rows = await q.select({ id: products.id, pts: products.loyaltyPoints }).from(products);
  const m = new Map(rows.filter((r) => r.pts !== null).map((r) => [r.id, r.pts as number]));
  return (pid: string | null) => (pid ? m.get(pid) ?? null : null);
}

async function catMap(q: Q): Promise<CatOf> {
  const rows = await q.select({ id: products.id, category: products.category }).from(products);
  const m = new Map(rows.map((r) => [r.id, r.category]));
  return (pid) => (pid ? m.get(pid) ?? "" : "");
}

async function audit(tx: Tx, actor: string, action: string, x: { customerId?: string | null; ref?: string; before?: unknown; after?: unknown; reason?: string }) {
  await tx.insert(loyaltyAudit).values({ id: uid(), actor, action, customerId: x.customerId ?? null, ref: x.ref ?? "", before: (x.before ?? null) as never, after: (x.after ?? null) as never, reason: x.reason ?? "", createdAt: Date.now() });
}

/* ================================ customers ================================ */

const byPhone = (q: Q, phone: string) => first(q.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.phone, phone)));
const byId = (q: Q, id: string) => first(q.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.id, id)));

async function mustCustomer(q: Q, id: string): Promise<LoyaltyCustomer> {
  const c = await byId(q, str(id, 40));
  if (!c) throw new ApiError("Loyalty member not found.", 404);
  return c;
}

async function uniqueValue(q: Q, make: () => string, col: typeof loyaltyCustomers.code | typeof loyaltyCustomers.referralCode | typeof loyaltyCustomers.walletToken) {
  for (;;) {
    const v = make();
    if (!(await first(q.select({ id: loyaltyCustomers.id }).from(loyaltyCustomers).where(eq(col, v))))) return v;
  }
}

async function billsOf(q: Q, phone: string) {
  return q.select({ id: bills.id, total: bills.total, createdAt: bills.createdAt, status: bills.status, customerName: bills.customerName }).from(bills).where(eq(bills.customerPhone, phone)).orderBy(desc(bills.createdAt));
}

/** What a customer has spent in total, from their paid bills: after every discount, without GST or extra charges,
    and without free gifts (their price is ₹0). Drives the spending-milestone rewards. `skipBill` leaves one bill out. */
export async function spendOf(q: Q, phone: string, skipBill?: string, since = 0): Promise<number> {
  const rows = await q.select({ id: bills.id, subtotal: bills.subtotal, discount: bills.discount }).from(bills).where(and(eq(bills.customerPhone, phone), eq(bills.status, "completed"), gte(bills.createdAt, since)));
  return round2(rows.filter((b) => b.id !== skipBill).reduce((a, b) => a + Math.max(0, b.subtotal - b.discount), 0));
}

/** The number a customer's WhatsApp messages go to, as a wa.me number (91XXXXXXXXXX), or null if it isn't usable. */
export function waNumber(c: Pick<LoyaltyCustomer, "phone" | "whatsapp">): string | null {
  const n = mobile(c.whatsapp || c.phone);
  return n ? `91${n}` : null;
}

export async function registerCustomer(tx: Tx, a: Args, actor: string): Promise<LoyaltyCustomer & { message: LoyaltyMessage | null }> {
  const phone = mobile(a.phone);
  if (!phone) throw new ApiError("Enter the customer's 10-digit mobile number.");
  const existing = await byPhone(tx, phone);
  if (existing) throw new ApiError(`${phone} is already a loyalty customer (${existing.name}).`);
  const history = await billsOf(tx, phone);
  const name = str(a.name, 60) || history.find((b) => b.customerName && b.customerName !== "Walk-in customer")?.customerName || "";
  if (!name) throw new ApiError("Enter the customer's name.");
  const wa = a.whatsapp === undefined || str(a.whatsapp, 24) === "" ? "" : mobile(a.whatsapp);
  if (wa === null) throw new ApiError("The WhatsApp number should be a 10-digit number.");
  const now = Date.now();
  const c: LoyaltyCustomer = {
    id: uid(),
    code: await uniqueValue(tx, () => `CK${code(6)}`, loyaltyCustomers.code),
    phone,
    name,
    email: "",
    birthday: "",
    anniversary: "",
    status: "active",
    /* WhatsApp messages only go to a customer who has explicitly said yes */
    consent: a.consent === true,
    whatsapp: wa === phone ? "" : wa,
    referralCode: await uniqueValue(tx, () => code(7), loyaltyCustomers.referralCode),
    referredBy: null,
    walletToken: await uniqueValue(tx, () => uid(24), loyaltyCustomers.walletToken),
    tier: "member",
    tierSince: now,
    available: 0,
    lifetime: 0,
    redeemed: 0,
    expired: 0,
    debt: 0,
    stamps: 0,
    note: str(a.note, 300),
    createdAt: now,
    updatedAt: now,
  };
  await tx.insert(loyaltyCustomers).values(c);
  await audit(tx, actor, "customer.register", { customerId: c.id, ref: c.code, after: { name, phone, whatsapp: c.whatsapp, consent: c.consent } });
  const message = await queueMessage(tx, c, "enrol", {}, `enrol:${c.id}`, null, now);
  return { ...c, message };
}

/** Removes a member from the loyalty programme for good: their points history and balances, point lots, rewards,
    stamps and referral links, and the audit lines about them. Their bills stay (money records, and still in
    Orders) but stop pointing at a member. Friends they referred simply lose the "referred by" link. One audit
    line records that the member was deleted, and who did it. */
export async function deleteCustomer(tx: Tx, a: Args, actor: string) {
  const c = await mustCustomer(tx, str(a.id, 40));
  const held = c.available;
  await tx.delete(loyaltyLots).where(eq(loyaltyLots.customerId, c.id));
  await tx.delete(loyaltyLedger).where(eq(loyaltyLedger.customerId, c.id));
  await tx.delete(loyaltyVouchers).where(eq(loyaltyVouchers.customerId, c.id));
  await tx.delete(loyaltyStamps).where(eq(loyaltyStamps.customerId, c.id));
  await tx.delete(loyaltyReferrals).where(or(eq(loyaltyReferrals.referrerId, c.id), eq(loyaltyReferrals.refereeId, c.id)));
  await tx.update(loyaltyCustomers).set({ referredBy: null }).where(eq(loyaltyCustomers.referredBy, c.id));
  await tx.update(bills).set({ loyaltyCustomerId: null }).where(eq(bills.loyaltyCustomerId, c.id));
  await tx.delete(loyaltyAudit).where(eq(loyaltyAudit.customerId, c.id));
  await tx.delete(loyaltyMessages).where(eq(loyaltyMessages.customerId, c.id));
  await tx.delete(loyaltyCustomers).where(eq(loyaltyCustomers.id, c.id));
  await audit(tx, actor, "customer.delete", { ref: c.code, before: { name: c.name, phone: c.phone, tier: c.tier, pointsHeld: held, lifetime: c.lifetime }, reason: str(a.reason, 300) });
  return { id: c.id, name: c.name };
}

export async function updateCustomer(tx: Tx, a: Args, actor: string): Promise<LoyaltyCustomer> {
  const c = await mustCustomer(tx, str(a.id, 40));
  const wa = a.whatsapp === undefined ? c.whatsapp : str(a.whatsapp, 24) === "" ? "" : mobile(a.whatsapp);
  if (wa === null) throw new ApiError("The WhatsApp number should be a 10-digit number.");
  const patch = {
    name: a.name === undefined ? c.name : str(a.name, 60) || c.name,
    whatsapp: wa === c.phone ? "" : wa,
    consent: typeof a.consent === "boolean" ? a.consent : c.consent,
    note: a.note === undefined ? c.note : str(a.note, 300),
    updatedAt: Date.now(),
  };
  const [u] = await tx.update(loyaltyCustomers).set(patch).where(eq(loyaltyCustomers.id, c.id)).returning();
  await audit(tx, actor, "customer.update", { customerId: c.id, ref: c.code, before: { name: c.name, whatsapp: c.whatsapp, consent: c.consent, note: c.note }, after: { name: u.name, whatsapp: u.whatsapp, consent: u.consent, note: u.note } });
  return u;
}

export async function setStatus(tx: Tx, a: Args, actor: string) {
  const c = await mustCustomer(tx, str(a.id, 40));
  const status = a.status === "inactive" ? "inactive" : "active";
  const reason = str(a.reason, 300);
  if (!reason) throw new ApiError("Give a reason — it goes in the audit log.");
  if (status === c.status) return c;
  const [u] = await tx.update(loyaltyCustomers).set({ status, updatedAt: Date.now() }).where(eq(loyaltyCustomers.id, c.id)).returning();
  await audit(tx, actor, status === "active" ? "customer.activate" : "customer.deactivate", { customerId: c.id, ref: c.code, before: { status: c.status }, after: { status }, reason });
  return u;
}

/* ================================ ledger ================================ */

/** Types that count towards lifetime points (and so membership). */
const EARNS: LedgerType[] = ["purchase", "bonus", "promo", "referral", "occasion"];

type Post = {
  type: LedgerType;
  points: number;
  billId?: string | null;
  invoiceNo?: string | null;
  ref?: string;
  key?: string | null;
  description: string;
  actor?: string;
  reversalOf?: string | null;
  /** debit: take what's there rather than refusing (refunds); the rest becomes debt */
  partial?: boolean;
  /** debit this one lot only (expiry) */
  lotId?: string;
  /** lifetime change; defaults to +points for earning types */
  lifetime?: number;
};

/** Writes one ledger row and keeps the member's balances and lots in step. Mutates `c`
    so several posts in one transaction see each other. Returns null if `key` was used before. */
async function post(tx: Tx, c: LoyaltyCustomer, p: Post, cfg: LoyaltyConfig, now = Date.now()): Promise<LedgerEntry | null> {
  if (p.key && (await first(tx.select({ id: loyaltyLedger.id }).from(loyaltyLedger).where(eq(loyaltyLedger.key, p.key))))) return null;
  let pts = Math.trunc(p.points);
  if (!pts) return null;
  let shortfall = 0;
  let expiresAt: number | null = null;

  if (pts < 0) {
    let need = -pts;
    if (need > c.available) {
      if (!p.partial) throw new ApiError(`Only ${c.available} points available.`);
      shortfall = need - c.available;
      need = c.available;
      pts = -need;
    }
    if (need > 0) {
      const lots = p.lotId
        ? await tx.select().from(loyaltyLots).where(and(eq(loyaltyLots.id, p.lotId), gt(loyaltyLots.remaining, 0)))
        : await tx
            .select()
            .from(loyaltyLots)
            .where(and(eq(loyaltyLots.customerId, c.id), gt(loyaltyLots.remaining, 0)))
            .orderBy(sql`${loyaltyLots.expiresAt} asc nulls last`, asc(loyaltyLots.earnedAt));
      let left = need;
      for (const l of lots) {
        if (!left) break;
        const take = Math.min(l.remaining, left);
        await tx.update(loyaltyLots).set({ remaining: l.remaining - take }).where(eq(loyaltyLots.id, l.id));
        left -= take;
      }
      if (left > 0) throw new ApiError("Points records are out of step for this member — run the reconcile check on the Loyalty page.");
    }
  } else {
    expiresAt = cfg.expiry.days > 0 ? now + cfg.expiry.days * DAY : null;
  }

  const before = c.available;
  const entry: LedgerEntry = {
    id: uid(),
    customerId: c.id,
    type: p.type,
    points: pts,
    balanceBefore: before,
    balanceAfter: before + pts,
    billId: p.billId ?? null,
    invoiceNo: p.invoiceNo ?? null,
    ref: p.ref ?? "",
    key: p.key ?? null,
    description: shortfall ? `${p.description} — ${shortfall} pts already spent, recovered from future earnings` : p.description,
    expiresAt,
    actor: p.actor ?? SYSTEM,
    reversalOf: p.reversalOf ?? null,
    createdAt: now,
  };
  if (pts !== 0 || shortfall) await tx.insert(loyaltyLedger).values(entry);
  if (pts > 0) await tx.insert(loyaltyLots).values({ id: uid(), customerId: c.id, ledgerId: entry.id, points: pts, remaining: pts, earnedAt: now, expiresAt });

  c.available = before + pts;
  const life = p.lifetime ?? (EARNS.includes(p.type) ? pts : 0);
  c.lifetime = Math.max(0, c.lifetime + life);
  if (p.type === "redemption" || p.type === "reward") c.redeemed += -pts;
  if (p.type === "refund_restore" || p.type === "reward_reversal") c.redeemed = Math.max(0, c.redeemed - pts);
  if (p.type === "expiry") c.expired += -pts;
  c.debt += shortfall;
  if (p.type === "debt_recovery") c.debt = Math.max(0, c.debt + pts);

  const t = tierFor(c.lifetime, cfg).key;
  if (t !== c.tier) {
    c.tier = t;
    c.tierSince = now;
  }
  c.updatedAt = now;
  await tx.update(loyaltyCustomers).set({ available: c.available, lifetime: c.lifetime, redeemed: c.redeemed, expired: c.expired, debt: c.debt, tier: c.tier, tierSince: c.tierSince, updatedAt: now }).where(eq(loyaltyCustomers.id, c.id));

  // new points first pay back points a refund couldn't take
  if (pts > 0 && c.debt > 0 && p.type !== "refund_restore") {
    const take = Math.min(c.debt, c.available);
    if (take > 0) await post(tx, c, { type: "debt_recovery", points: -take, billId: p.billId, invoiceNo: p.invoiceNo, description: "Recovered points from an earlier refund", lifetime: 0 }, cfg, now);
  }
  return entry;
}

/** Expires a member's points whose date has passed — one ledger row per lot, so it stays auditable. */
async function expireFor(tx: Tx, c: LoyaltyCustomer, cfg: LoyaltyConfig, now = Date.now()) {
  const due = await tx.select().from(loyaltyLots).where(and(eq(loyaltyLots.customerId, c.id), gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt), lt(loyaltyLots.expiresAt, now)));
  let n = 0;
  for (const l of due) {
    const e = await post(tx, c, { type: "expiry", points: -l.remaining, lotId: l.id, key: `exp:${l.id}`, description: `Points earned ${shopDate(l.earnedAt)} expired`, partial: true, lifetime: 0 }, cfg, now);
    if (e) n += -e.points;
  }
  return n;
}

/* ================================ vouchers ================================ */

async function newRef(tx: Tx) {
  for (;;) {
    const r = `RW-${code(7)}`;
    if (!(await first(tx.select({ id: loyaltyVouchers.id }).from(loyaltyVouchers).where(eq(loyaltyVouchers.ref, r))))) return r;
  }
}

async function issueVoucher(tx: Tx, c: LoyaltyCustomer, x: { name: string; kind: RewardKind; value: number; productId: string | null; source: VoucherSource; key: string; validityDays: number; note?: string; rewardId?: string | null; pointsCost?: number; giftQty?: number; status?: "issued" | "used"; billId?: string | null; invoiceNo?: string | null }, now = Date.now()) {
  if (await first(tx.select({ id: loyaltyVouchers.id }).from(loyaltyVouchers).where(eq(loyaltyVouchers.key, x.key)))) return null;
  const v: Voucher = {
    id: uid(),
    ref: await newRef(tx),
    customerId: c.id,
    rewardId: x.rewardId ?? null,
    name: x.name,
    kind: x.kind,
    value: x.value,
    productId: x.productId,
    source: x.source,
    pointsCost: x.pointsCost ?? 0,
    giftQty: x.giftQty ?? 1,
    status: x.status ?? "issued",
    billId: x.billId ?? null,
    invoiceNo: x.invoiceNo ?? null,
    key: x.key,
    issuedAt: now,
    usedAt: x.status === "used" ? now : null,
    expiresAt: x.validityDays > 0 && x.status !== "used" ? now + x.validityDays * DAY : null,
    note: x.note ?? "",
  };
  await tx.insert(loyaltyVouchers).values(v);
  return v;
}

/* ================================ WhatsApp messages ================================ */

/** Prepares a WhatsApp message for a customer and records it in their history. Nothing is sent from here — the
    owner's WhatsApp can't be driven by the server — so a message waits as "pending" until staff open it.
    Returns null when messages are off for this kind, the customer hasn't agreed, or this event was already recorded
    (`key` prevents duplicates). A number that can't receive WhatsApp is recorded as "failed" with the reason. */
export async function queueMessage(tx: Tx, c: LoyaltyCustomer, type: MessageKey, vars: Record<string, string | number | null | undefined>, key: string, billId: string | null = null, now = Date.now()): Promise<LoyaltyMessage | null> {
  const cfg = await getConfig(tx);
  if (!cfg.enabled || !cfg.messages.enabled || !cfg.messages.events[type]) return null;
  if (!c.consent) return null;
  if (await first(tx.select({ id: loyaltyMessages.id }).from(loyaltyMessages).where(eq(loyaltyMessages.key, key)))) return null;
  const shop = await first(tx.select({ n: settings.shopName, url: settings.publicUrl }).from(settings).where(eq(settings.id, 1)));
  const [dd, mm, yy] = shopToday().split("-").reverse();
  const base = (shop?.url ?? "").replace(/\/$/, "");
  const text = fillMessage(cfg.messages.templates[type], { name: c.name.split(" ")[0], shop: shop?.n ?? "our shop", date: `${dd}/${mm}/${yy}`, balance: c.available, wallet: base ? `${base}/w/${c.walletToken}` : "", ...vars });
  const to = waNumber(c);
  const [m] = await tx
    .insert(loyaltyMessages)
    .values({ id: uid(), customerId: c.id, type, phone: to ?? "", text, status: to ? "pending" : "failed", error: to ? "" : "This customer's WhatsApp number isn't a valid 10-digit number.", billId, key, createdAt: now, openedAt: null, opens: 0 })
    .returning();
  return m;
}

/** The welcome message for a customer who has just agreed to WhatsApp messages (they didn't tick the box when they
    joined). Records their consent, then prepares the message — or returns the one that already exists. */
export async function welcomeMessage(tx: Tx, a: Args, actor: string): Promise<LoyaltyMessage> {
  const c = await mustCustomer(tx, str(a.id, 40));
  if (!c.consent) {
    await tx.update(loyaltyCustomers).set({ consent: true, updatedAt: Date.now() }).where(eq(loyaltyCustomers.id, c.id));
    c.consent = true;
    await audit(tx, actor, "customer.update", { customerId: c.id, ref: c.code, before: { consent: false }, after: { consent: true }, reason: "Agreed to WhatsApp messages when joining" });
  }
  const made = await queueMessage(tx, c, "enrol", {}, `enrol:${c.id}`);
  const m = made ?? (await first(tx.select().from(loyaltyMessages).where(eq(loyaltyMessages.key, `enrol:${c.id}`))));
  if (!m) throw new ApiError("Welcome messages are switched off in Loyalty settings.");
  return m;
}

/** Staff opened WhatsApp with this message. We can't know it was delivered, so it is recorded as "opened", never "sent". */
export async function openMessage(tx: Tx, a: Args) {
  const m = await first(tx.select().from(loyaltyMessages).where(eq(loyaltyMessages.id, str(a.id, 40))));
  if (!m) throw new ApiError("Message not found.", 404);
  if (m.status === "failed") throw new ApiError(m.error || "This message can't be sent — fix the number and retry it first.");
  const [u] = await tx.update(loyaltyMessages).set({ status: "opened", openedAt: Date.now(), opens: sql`${loyaltyMessages.opens} + 1` }).where(eq(loyaltyMessages.id, m.id)).returning();
  return u;
}

/** Re-checks a failed message against the customer's current number and consent, so it can be sent after the number is fixed. */
export async function retryMessage(tx: Tx, a: Args) {
  const m = await first(tx.select().from(loyaltyMessages).where(eq(loyaltyMessages.id, str(a.id, 40))));
  if (!m) throw new ApiError("Message not found.", 404);
  const c = await byId(tx, m.customerId);
  if (!c) throw new ApiError("That customer no longer exists.", 404);
  const to = waNumber(c);
  if (!c.consent) throw new ApiError("This customer hasn't agreed to WhatsApp messages.");
  if (!to) throw new ApiError("This customer's WhatsApp number isn't a valid 10-digit number — edit the customer first.");
  const [u] = await tx.update(loyaltyMessages).set({ phone: to, status: "pending", error: "" }).where(eq(loyaltyMessages.id, m.id)).returning();
  return u;
}

/* ================================ spending-milestone rewards ================================ */

/** Gives the customer every spending-milestone reward they have now earned (once each time they cross another
    multiple of the reward's amount), and removes unused ones that are no longer earned (a bill was voided). */
export async function syncMilestones(tx: Tx, c: LoyaltyCustomer, cfg: LoyaltyConfig, now = Date.now(), skipBill?: string, billId: string | null = null) {
  const rewards = await tx.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.trigger, "milestone"), eq(loyaltyRewards.active, true)));
  const issued: Voucher[] = [];
  for (const rw of rewards) {
    if (!rw.productId || !(rw.milestoneAmount > 0)) continue;
    // spending counts from the day the reward was created (unless the owner chose to count every old bill)
    const spent = await spendOf(tx, c.phone, skipBill, cfg.gifts.countOldBills ? 0 : rw.createdAt);
    const earned = Math.floor((spent + 1e-9) / rw.milestoneAmount);
    if (cfg.gifts.milestone && !rewardAvailable(rw, c.tier, now)) {
      let have = rw.perCustomerLimit === null ? 0 : (await tx.select({ n: sql<number>`count(*)::int` }).from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), eq(loyaltyVouchers.rewardId, rw.id), inArray(loyaltyVouchers.status, ["issued", "used"]))))[0].n;
      for (let n = 1; n <= earned; n++) {
        if (rw.perCustomerLimit !== null && have >= rw.perCustomerLimit && !(await first(tx.select({ id: loyaltyVouchers.id }).from(loyaltyVouchers).where(eq(loyaltyVouchers.key, `msr:${rw.id}:${c.id}:${n}`))))) break;
        const v = await issueVoucher(tx, c, { name: rw.name, kind: "free_item", value: 0, productId: rw.productId, giftQty: rw.giftQty, source: "milestone", key: `msr:${rw.id}:${c.id}:${n}`, validityDays: cfg.gifts.validityDays, rewardId: rw.id, note: `Spent ₹${round2(rw.milestoneAmount * n)} in total` }, now);
        if (v) have++;
        if (v) {
          issued.push(v);
          await queueMessage(tx, c, "milestone", { reward: rw.name, amount: `₹${round2(rw.milestoneAmount * n)}`, quantity: rw.giftQty }, `milestone:${v.id}`, billId, now);
        }
      }
    }
    // an unused reward whose spending was taken back (a voided bill) goes away; a used one stays
    const mine = await tx.select().from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), eq(loyaltyVouchers.rewardId, rw.id), eq(loyaltyVouchers.source, "milestone"), eq(loyaltyVouchers.status, "issued")));
    for (const v of mine) {
      const n = Number(v.key?.split(":")[3] ?? 0);
      if (n > earned) await tx.update(loyaltyVouchers).set({ status: "cancelled", key: null, note: "The spending that unlocked this reward was cancelled" }).where(eq(loyaltyVouchers.id, v.id));
    }
  }
  return issued;
}

/** Points-based gifts a customer has just become able to claim (their balance crossed the cost). */
async function notifyUnlocked(tx: Tx, c: LoyaltyCustomer, before: number, cfg: LoyaltyConfig, billId: string | null, now: number) {
  if (!cfg.gifts.points || c.available <= before) return;
  const rewards = await tx.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.trigger, "points"), eq(loyaltyRewards.active, true)));
  for (const rw of rewards) {
    if (rw.pointsCost > 0 && before < rw.pointsCost && c.available >= rw.pointsCost) await queueMessage(tx, c, "unlock", { reward: rw.name, points: rw.pointsCost, quantity: rw.giftQty }, `unlock:${c.id}:${rw.id}:${billId ?? c.available}`, billId, now);
  }
}

/* ================================ billing ================================ */

export type LoyaltyPlan = {
  cfg: LoyaltyConfig;
  customer: LoyaltyCustomer;
  reward: { voucher: Voucher } | { reward: Reward } | null;
  /** the free gift the chosen reward entitles the customer to (a ₹0 line must be on the bill) */
  gift: Entitlement | null;
  rewardDiscount: number;
  rewardName: string | null;
  points: number;
  pointsDiscount: number;
};

/** Before the bill is written: checks the reward and points the cashier asked for, and
    works out what they take off. Throws (and the whole bill is refused) if anything is off. */
export async function planBill(tx: Tx, x: { phone: string; items: OrderItem[]; subtotal: number; afterManual: number; couponApplied: boolean; manualApplied: boolean; points: unknown; rewardId: unknown; voucherRef: unknown }): Promise<LoyaltyPlan | null> {
  const wantPoints = Math.max(0, Math.floor(num(x.points) || 0));
  const rewardId = str(x.rewardId, 40);
  const voucherRef = str(x.voucherRef, 20).toUpperCase();
  if (!wantPoints && !rewardId && !voucherRef) return null;
  const cfg = await getConfig(tx);
  if (!cfg.enabled) throw new ApiError("The loyalty programme is switched off.");
  if (!x.phone) throw new ApiError("Enter the customer's mobile number to use points or rewards.");
  const c = await byPhone(tx, x.phone);
  if (!c) throw new ApiError("This mobile isn't a loyalty customer yet.");
  if (c.status !== "active") throw new ApiError("This customer's loyalty account is deactivated.");
  await expireFor(tx, c, cfg);
  const catOf = await catMap(tx);
  const paid = x.items.filter((i) => !i.free);

  let reward: LoyaltyPlan["reward"] = null;
  let gift: Entitlement | null = null;
  let rewardDiscount = 0;
  let rewardName: string | null = null;
  let spend = 0;
  if (voucherRef) {
    const v = await first(tx.select().from(loyaltyVouchers).where(eq(loyaltyVouchers.ref, voucherRef)));
    if (!v || v.customerId !== c.id) throw new ApiError(`Reward ${voucherRef} isn't this customer's.`);
    if (!voucherLive(v)) throw new ApiError(`Reward ${voucherRef} is ${v.status === "issued" ? "expired" : v.status}.`);
    const r = rewardValue(v, x.items, x.afterManual);
    if (r.reason) throw new ApiError(r.reason + ".");
    reward = { voucher: v };
    rewardDiscount = r.amount;
    rewardName = v.name;
    if (v.kind === "free_item" && v.productId) gift = { key: `voucher:${v.ref}`, source: "voucher", name: v.name, productId: v.productId, qty: Math.max(1, v.giftQty) };
  } else if (rewardId) {
    const rw = await first(tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId)));
    if (!rw || rw.trigger !== "points") throw new ApiError("That reward no longer exists.");
    if (!cfg.gifts.points) throw new ApiError("Points-based free gifts are switched off.");
    const why = rewardAvailable(rw, c.tier);
    if (why) throw new ApiError(`${rw.name}: ${why}.`);
    if (rw.pointsCost > c.available) throw new ApiError(`${rw.name} needs ${rw.pointsCost} points — ${c.available} available.`);
    if (rw.perCustomerLimit !== null) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), eq(loyaltyVouchers.rewardId, rw.id), inArray(loyaltyVouchers.status, ["issued", "used"])));
      if (n >= rw.perCustomerLimit) throw new ApiError(`${rw.name}: this customer has already had it the maximum ${rw.perCustomerLimit} time(s).`);
    }
    const r = rewardValue(rw, x.items, x.afterManual);
    if (r.reason) throw new ApiError(r.reason + ".");
    reward = { reward: rw };
    rewardDiscount = r.amount;
    rewardName = rw.name;
    spend = rw.pointsCost;
    if (rw.productId) gift = { key: `reward:${rw.id}`, source: "reward", name: rw.name, productId: rw.productId, qty: Math.max(1, rw.giftQty) };
  }

  let pointsDiscount = 0;
  if (wantPoints) {
    const cap = redeemCap({ cfg, items: paid, catOf, subtotal: x.subtotal, remaining: x.afterManual - rewardDiscount, available: c.available - spend, couponApplied: x.couponApplied, manualApplied: x.manualApplied, rewardApplied: !!reward });
    if (cap.reason) throw new ApiError(cap.reason + ".");
    if (wantPoints < cap.minPoints) throw new ApiError(`Redeem at least ${cap.minPoints} points on a bill this size.`);
    if (wantPoints > cap.maxPoints) throw new ApiError(`At most ${cap.maxPoints} points can be used on this bill.`);
    pointsDiscount = pointsValue(wantPoints, cfg);
    if (pointsDiscount > x.afterManual - rewardDiscount + 0.001) throw new ApiError("The points discount can't be more than the bill.");
  }
  return { cfg, customer: c, reward, gift, rewardDiscount, rewardName, points: wantPoints, pointsDiscount };
}

/** Which free gifts this bill may carry: the shop's bill offers (for anyone) plus the reward the member chose.
    Throws if a ₹0 line isn't backed by one of them or the gift is out of stock; otherwise returns the lines with
    what each came from filled in. Nothing the browser says about a gift is trusted. */
export async function checkGifts(tx: Tx, items: OrderItem[], afterManual: number, plan: LoyaltyPlan | null, phone: string, now = Date.now()): Promise<{ items: OrderItem[]; entitlements: Entitlement[]; offerUse: { id: string; times: number }[] }> {
  if (!items.some((i) => i.free)) return { items, entitlements: [], offerUse: [] };
  const cfg = plan?.cfg ?? (await getConfig(tx));
  const offers = cfg.enabled && cfg.gifts.offers ? ((await tx.select().from(giftOffers).where(eq(giftOffers.active, true))) as GiftOffer[]) : [];
  const member = !!plan || (await isMember(tx, phone));
  const offerEnts = offerEntitlements(offers, items, afterManual, now, member);
  const entitlements = [...offerEnts, ...(plan?.gift ? [plan.gift] : [])];
  const prods = await tx.select({ id: products.id, name: products.name, stock: products.stock }).from(products);
  const byId = new Map(prods.map((p) => [p.id, p]));
  const problems = giftProblems(items, entitlements, (pid) => byId.get(pid)?.name ?? "That item");
  if (problems.length) throw new ApiError(problems[0]);
  const used = new Map<string, number>();
  for (const it of items) if (it.free && it.productId) used.set(it.productId, (used.get(it.productId) ?? 0) + it.qty);
  for (const [pid, q] of used) {
    const p = byId.get(pid);
    if (p && p.stock !== null && p.stock < q) throw new ApiError(`${p.name} is out of stock, so it can't be given as a free gift.`);
  }
  // how many times each offer was really used (so an offer with a total limit runs out)
  const left = new Map(used);
  const offerUse: { id: string; times: number }[] = [];
  for (const e of offerEnts) {
    const take = Math.min(e.qty, left.get(e.productId) ?? 0);
    if (take <= 0) continue;
    left.set(e.productId, (left.get(e.productId) ?? 0) - take);
    const o = offers.find((x) => `offer:${x.id}` === e.key);
    if (o) offerUse.push({ id: o.id, times: Math.ceil(take / Math.max(1, o.giftQty)) });
  }
  return {
    entitlements,
    offerUse,
    items: items.map((it) => (it.free ? { ...it, price: 0, gift: entitlements.filter((e) => e.productId === it.productId).map((e) => e.name).join(", ").slice(0, 120) } : it)),
  };
}

/** Is this mobile an active loyalty member? Decides which audience of coupons it can use. */
export async function isMember(q: Q, phone: string | null | undefined) {
  const p = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (!p) return false;
  const c = await byPhone(q, p);
  return !!c && c.status === "active";
}

/** Members' points still on the plan's customer, used by createBill to stamp the bill. */
export async function memberFor(tx: Tx, phone: string) {
  if (!phone) return null;
  const c = await byPhone(tx, phone);
  return c && c.status === "active" ? c : null;
}

/** After the bill is written (same transaction): spend what was planned, then earn, hand out any spending-milestone
    reward the bill unlocked, and record the WhatsApp messages. Returns points earned. */
export async function afterBill(tx: Tx, bill: Bill, plan: LoyaltyPlan | null, actor: string): Promise<{ earned: number; customerId: string | null }> {
  const cfg = plan?.cfg ?? (await getConfig(tx));
  if (!cfg.enabled) return { earned: 0, customerId: null };
  const c = plan?.customer ?? (await memberFor(tx, bill.customerPhone));
  if (!c) return { earned: 0, customerId: null };
  const now = bill.createdAt;
  if (!plan) await expireFor(tx, c, cfg, now);
  const ctx = { billId: bill.id, invoiceNo: bill.invoiceNo, actor };
  const prev = c.available;

  // ---- spend ----
  if (plan?.reward && "reward" in plan.reward) {
    const rw = plan.reward.reward;
    const v = await issueVoucher(tx, c, { name: rw.name, kind: rw.kind, value: rw.value, productId: rw.productId, giftQty: rw.giftQty, source: "points", key: `reward:${bill.id}`, validityDays: 0, rewardId: rw.id, pointsCost: rw.pointsCost, status: "used", billId: bill.id, invoiceNo: bill.invoiceNo }, now);
    if (v) {
      if (rw.pointsCost > 0) await post(tx, c, { type: "reward", points: -rw.pointsCost, ...ctx, ref: v.ref, key: `reward-pts:${bill.id}`, description: `Redeemed reward: ${rw.name}` }, cfg, now);
      await tx.update(loyaltyRewards).set({ redeemed: sql`${loyaltyRewards.redeemed} + 1` }).where(eq(loyaltyRewards.id, rw.id));
      await tx.update(bills).set({ rewardRef: v.ref }).where(eq(bills.id, bill.id));
    }
  } else if (plan?.reward && "voucher" in plan.reward) {
    await tx.update(loyaltyVouchers).set({ status: "used", usedAt: now, billId: bill.id, invoiceNo: bill.invoiceNo }).where(eq(loyaltyVouchers.id, plan.reward.voucher.id));
    if (plan.reward.voucher.rewardId) await tx.update(loyaltyRewards).set({ redeemed: sql`${loyaltyRewards.redeemed} + 1` }).where(eq(loyaltyRewards.id, plan.reward.voucher.rewardId));
  }
  if (plan?.points) await post(tx, c, { type: "redemption", points: -plan.points, ...ctx, key: `redeem:${bill.id}`, description: `Redeemed ${plan.points} pts for ₹${plan.pointsDiscount} off` }, cfg, now);

  // ---- earn: once per bill (the key is unique), on what was paid for eligible items, never on free gifts ----
  const catOf = await catMap(tx);
  const earn = earnFor({ cfg, items: bill.items, catOf, pointsOf: await pointsMap(tx), subtotal: bill.subtotal, discount: bill.discount, tier: c.tier, firstPurchase: false, campaigns: [] });
  let earned = 0;
  for (const p of earn.parts) {
    const e = await post(tx, c, { type: p.type, points: p.points, ...ctx, key: `earn:${bill.id}:${p.type}:`, description: p.label }, cfg, now);
    if (e) earned += e.points;
  }

  // ---- spending-milestone gifts this bill may have unlocked ----
  await syncMilestones(tx, c, cfg, now, undefined, bill.id);

  // ---- WhatsApp messages: only after everything above succeeded (it is the same transaction) ----
  const bn = bill.invoiceNo;
  if (earned > 0) await queueMessage(tx, c, "earned", { points: earned, bill: bn, amount: `₹${earn.eligibleNet}` }, `earned:${bill.id}`, bill.id, now);
  if (plan?.points) await queueMessage(tx, c, "redeemed", { points: plan.points, discount: plan.pointsDiscount, bill: bn }, `redeemed:${bill.id}`, bill.id, now);
  await notifyUnlocked(tx, c, prev, cfg, bill.id, now);
  let k = 0;
  for (const it of bill.items) if (it.free) await queueMessage(tx, c, "claimed", { reward: it.name, quantity: it.qty, bill: bn }, `claimed:${bill.id}:${k++}`, bill.id, now);

  await tx.update(bills).set({ loyaltyCustomerId: c.id, pointsEarned: earned, loyaltyPrev: prev, loyaltyBalance: c.available }).where(eq(bills.id, bill.id));
  return { earned, customerId: c.id };
}

/** Undo what a bill did to loyalty — on void or delete (fraction 1), or a partial refund
    (fraction < 1, earned points only). Safe to call twice: reversal keys are unique. */
export async function reverseBill(tx: Tx, bill: Pick<Bill, "id" | "invoiceNo" | "total" | "loyaltyCustomerId">, actor: string, fraction = 1, reason = "Bill voided") {
  if (!bill.loyaltyCustomerId) return;
  const c = await byId(tx, bill.loyaltyCustomerId);
  if (!c) return;
  const cfg = await getConfig(tx);
  const now = Date.now();
  const ctx = { billId: bill.id, invoiceNo: bill.invoiceNo, actor };
  const startAvail = c.available;
  const rows = await tx.select().from(loyaltyLedger).where(eq(loyaltyLedger.billId, bill.id));
  const mine = rows.filter((r) => r.customerId === c.id);
  const full = fraction >= 0.9999;

  // earned points (purchase / bonus / promo / this member's referral welcome)
  const earned = mine.filter((r) => ["purchase", "bonus", "promo"].includes(r.type) || (r.type === "referral" && r.key?.endsWith(":n"))).reduce((a, r) => a + r.points, 0);
  // what earlier partial refunds already took back (points taken + what became debt)
  const already = mine.filter((r) => r.type === "refund_reversal").reduce((a, r) => a - r.points + debtOf(r.description), 0);
  const target = full ? earned : Math.min(earned, Math.round(earned * fraction) + already);
  const take = Math.max(0, target - already);
  if (take > 0) await post(tx, c, { type: "refund_reversal", points: -take, ...ctx, key: full ? `rev:${bill.id}:earn` : `rev:${bill.id}:earn:${uid(6)}`, partial: true, description: `${reason}: points from ${bill.invoiceNo} taken back`, lifetime: -take }, cfg, now);

  if (full) {
    // points spent on the bill come back
    const spent = -mine.filter((r) => r.type === "redemption").reduce((a, r) => a + r.points, 0);
    if (spent > 0) await post(tx, c, { type: "refund_restore", points: spent, ...ctx, key: `rev:${bill.id}:redeem`, description: `${reason}: ${spent} redeemed pts returned`, lifetime: 0 }, cfg, now);
    // reward used on the bill
    const v = await first(tx.select().from(loyaltyVouchers).where(and(eq(loyaltyVouchers.billId, bill.id), eq(loyaltyVouchers.status, "used"))));
    if (v) {
      if (v.source === "points") {
        await tx.update(loyaltyVouchers).set({ status: "cancelled", note: `${reason} (${bill.invoiceNo})` }).where(eq(loyaltyVouchers.id, v.id));
        if (v.pointsCost > 0) await post(tx, c, { type: "reward_reversal", points: v.pointsCost, ...ctx, ref: v.ref, key: `rev:${bill.id}:reward`, description: `${reason}: points for ${v.name} returned`, lifetime: 0 }, cfg, now);
        if (v.rewardId) await tx.update(loyaltyRewards).set({ redeemed: sql`greatest(0, ${loyaltyRewards.redeemed} - 1)` }).where(eq(loyaltyRewards.id, v.rewardId));
      } else {
        await tx.update(loyaltyVouchers).set({ status: "issued", usedAt: null, billId: null, invoiceNo: null }).where(eq(loyaltyVouchers.id, v.id));
        if (v.rewardId) await tx.update(loyaltyRewards).set({ redeemed: sql`greatest(0, ${loyaltyRewards.redeemed} - 1)` }).where(eq(loyaltyRewards.id, v.rewardId));
      }
    }
    // the visit stamp, and an unused milestone reward it unlocked
    const stamp = await first(tx.select().from(loyaltyStamps).where(and(eq(loyaltyStamps.billId, bill.id), eq(loyaltyStamps.status, "active"))));
    if (stamp) {
      const size = cfg.stamps.milestones.length ? cfg.stamps.milestones[cfg.stamps.milestones.length - 1].visits : 0;
      if (size && c.stamps > 0) {
        const pos = ((c.stamps - 1) % size) + 1;
        const cycle = Math.floor((c.stamps - 1) / size);
        await tx.update(loyaltyVouchers).set({ status: "cancelled", key: null, note: `Visit stamp reversed (${bill.invoiceNo})` }).where(and(eq(loyaltyVouchers.key, `ms:${c.id}:${cycle}:${pos}`), eq(loyaltyVouchers.status, "issued")));
      }
      // free the visit key, so another bill on the same visit can still earn the stamp
      await tx.update(loyaltyStamps).set({ status: "reversed", visitKey: `${stamp.visitKey}:reversed:${stamp.id}` }).where(eq(loyaltyStamps.id, stamp.id));
      c.stamps = Math.max(0, c.stamps - 1);
      await tx.update(loyaltyCustomers).set({ stamps: c.stamps }).where(eq(loyaltyCustomers.id, c.id));
    }
    // a referral this bill qualified
    const ref = await first(tx.select().from(loyaltyReferrals).where(and(eq(loyaltyReferrals.billId, bill.id), eq(loyaltyReferrals.status, "rewarded"))));
    if (ref) {
      const referrer = await byId(tx, ref.referrerId);
      if (referrer && ref.referrerPoints > 0) await post(tx, referrer, { type: "refund_reversal", points: -ref.referrerPoints, ...ctx, ref: ref.id, key: `rev:${ref.id}:r`, partial: true, description: `${reason}: referral reward taken back`, lifetime: -ref.referrerPoints }, cfg, now);
      await tx.update(loyaltyReferrals).set({ status: "reversed" }).where(eq(loyaltyReferrals.id, ref.id));
    }
  }
  if (full) await syncMilestones(tx, c, cfg, now, bill.id);
  // tell the customer when their points moved because a bill was cancelled or refunded
  const moved = c.available - startAvail;
  if (moved !== 0) await queueMessage(tx, c, "adjust", { points: `${moved > 0 ? "+" : ""}${moved}`, reason: `${reason} — bill ${bill.invoiceNo}` }, `rev-msg:${bill.id}:${uid(6)}`, bill.id, now);
  await audit(tx, actor, full ? "bill.reverse" : "bill.partial_refund", { customerId: c.id, ref: bill.invoiceNo, after: { fraction: round2(fraction), pointsTakenBack: take }, reason });
}
/** A bill is deleted for good: undo what it did to points, rewards, stamps and referrals (so balances are
    right), then erase every record that mentions it — the points it earned, the "taken back" correction,
    the reversed stamp, the cancelled reward, the audit lines — so nothing about it is left behind. */
export async function purgeBill(tx: Tx, bill: Pick<Bill, "id" | "invoiceNo" | "total" | "loyaltyCustomerId" | "status">, actor: string) {
  if (!bill.loyaltyCustomerId) return;
  if (bill.status === "completed") await reverseBill(tx, bill, actor, 1, "Bill deleted");
  await wipeBillTraces(tx, bill.id, bill.invoiceNo);
}

/** Erases the loyalty records that belong to one bill. A member's points rows are only erased when they cancel
    out exactly (earned = taken back, spent = returned), so balances and lifetime totals stay right; if a refund
    ever had to be recorded as debt, those rows are kept. */
export async function wipeBillTraces(tx: Tx, billId: string, invoiceNo: string | null) {
  const rows = await tx.select().from(loyaltyLedger).where(eq(loyaltyLedger.billId, billId));
  const net = new Map<string, number>();
  for (const r of rows) net.set(r.customerId, (net.get(r.customerId) ?? 0) + r.points);
  const now = Date.now();
  let erased = 0;
  for (const [customerId, n] of net) {
    if (n !== 0) continue; // doesn't cancel out (a refund became debt): keep these rows
    const ids = rows.filter((r) => r.customerId === customerId).map((r) => r.id);
    /* Points are used oldest-expiry first, so a "taken back" row may have used up OTHER lots, not the one
       this bill created. Erasing the bill's lots would then lose track of those points — so what is left
       in the bill's own lots goes back into the lots it was taken from. */
    const mine = await tx.select().from(loyaltyLots).where(inArray(loyaltyLots.ledgerId, ids));
    const owed = mine.reduce((a, l) => a + l.remaining, 0);
    const others = (await tx.select().from(loyaltyLots).where(eq(loyaltyLots.customerId, customerId)))
      .filter((l) => !ids.includes(l.ledgerId) && l.points > l.remaining && (l.expiresAt === null || l.expiresAt >= now))
      .sort((x, y) => (x.expiresAt ?? Infinity) - (y.expiresAt ?? Infinity) || x.earnedAt - y.earnedAt);
    if (others.reduce((a, l) => a + (l.points - l.remaining), 0) < owed) continue; // can't put them back cleanly: keep these rows
    let left = owed;
    for (const l of others) {
      if (!left) break;
      const add = Math.min(left, l.points - l.remaining);
      await tx.update(loyaltyLots).set({ remaining: l.remaining + add }).where(eq(loyaltyLots.id, l.id));
      left -= add;
    }
    await tx.delete(loyaltyLots).where(inArray(loyaltyLots.ledgerId, ids));
    await tx.delete(loyaltyLedger).where(inArray(loyaltyLedger.id, ids));
    erased += ids.length;
  }
  await tx.delete(loyaltyStamps).where(and(eq(loyaltyStamps.billId, billId), eq(loyaltyStamps.status, "reversed")));
  await tx.delete(loyaltyMessages).where(eq(loyaltyMessages.billId, billId));
  await tx.delete(loyaltyVouchers).where(and(eq(loyaltyVouchers.billId, billId), eq(loyaltyVouchers.status, "cancelled")));
  if (invoiceNo) {
    await tx.delete(loyaltyVouchers).where(and(eq(loyaltyVouchers.status, "cancelled"), like(loyaltyVouchers.note, `%(${invoiceNo})%`)));
    await tx.delete(loyaltyAudit).where(and(eq(loyaltyAudit.ref, invoiceNo), inArray(loyaltyAudit.action, ["bill.reverse", "bill.partial_refund"])));
  }
  // a referral this bill had qualified goes back to waiting for the friend's next first bill
  await tx.update(loyaltyReferrals).set({ status: "pending", billId: null, referrerPoints: 0, refereePoints: 0, rewardedAt: null }).where(and(eq(loyaltyReferrals.billId, billId), eq(loyaltyReferrals.status, "reversed")));
  return erased;
}

/** Clears the loyalty records of bills that were deleted before this tidy-up existed. Only records whose bill is
    gone are touched, and only when they cancel out. Returns how many points rows were erased. */
export async function purgeOrphans(tx: Tx) {
  const gone = await tx.execute(sql`
    select distinct l.bill_id as id, l.invoice_no as inv from ${loyaltyLedger} l
    where l.bill_id is not null and not exists (select 1 from ${bills} b where b.id = l.bill_id)`);
  let n = 0;
  for (const r of gone.rows as { id: string; inv: string | null }[]) n += (await wipeBillTraces(tx, r.id, r.inv)) ?? 0;
  return n;
}

const debtOf = (desc: string) => Number(/— (\d+) pts already spent/.exec(desc)?.[1] ?? 0);

/* ================================ admin actions ================================ */

export async function adjustPoints(tx: Tx, a: Args, actor: string) {
  const c = await mustCustomer(tx, str(a.id, 40));
  const pts = Math.trunc(num(a.points));
  const reason = str(a.reason, 300);
  if (!pts) throw new ApiError("Enter the points to add (e.g. 50) or remove (e.g. -50).");
  if (Math.abs(pts) > 100000) throw new ApiError("That adjustment is too large.");
  if (!reason) throw new ApiError("A reason is required for manual adjustments.");
  const cfg = await getConfig(tx);
  await expireFor(tx, c, cfg);
  if (pts < 0 && -pts > c.available) throw new ApiError(`Only ${c.available} points available to remove.`);
  const before = c.available;
  const e = await post(tx, c, { type: "adjustment", points: pts, description: `Manual adjustment: ${reason}`, actor, key: `adj:${uid(8)}`, lifetime: 0 }, cfg);
  await audit(tx, actor, "points.adjust", { customerId: c.id, ref: c.code, before: { available: before }, after: { available: c.available, change: pts }, reason });
  let message: LoyaltyMessage | null = null;
  if (e) {
    message = await queueMessage(tx, c, "adjust", { points: `${pts > 0 ? "+" : ""}${pts}`, reason }, `adj-msg:${e.id}`, null);
    await notifyUnlocked(tx, c, before, cfg, null, Date.now());
  }
  return { ...c, message };
}

export async function cancelVoucher(tx: Tx, a: Args, actor: string) {
  const v = await first(tx.select().from(loyaltyVouchers).where(eq(loyaltyVouchers.id, str(a.id, 40))));
  if (!v) throw new ApiError("Reward not found.", 404);
  if (v.status !== "issued") throw new ApiError(`This reward is already ${v.status}.`);
  const reason = str(a.reason, 300);
  if (!reason) throw new ApiError("Give a reason — it goes in the audit log.");
  const c = await mustCustomer(tx, v.customerId);
  const cfg = await getConfig(tx);
  await tx.update(loyaltyVouchers).set({ status: "cancelled", note: reason }).where(eq(loyaltyVouchers.id, v.id));
  if (v.source === "points" && v.pointsCost > 0) await post(tx, c, { type: "reward_reversal", points: v.pointsCost, ref: v.ref, key: `cancel:${v.id}`, description: `Reward ${v.name} cancelled — points returned`, actor, lifetime: 0 }, cfg);
  if (v.rewardId) await tx.update(loyaltyRewards).set({ redeemed: sql`greatest(0, ${loyaltyRewards.redeemed} - 1)` }).where(eq(loyaltyRewards.id, v.rewardId));
  await audit(tx, actor, "reward.cancel", { customerId: c.id, ref: v.ref, reason });
  return null;
}

/** A partial refund on a bill: takes back that share of the points it earned. */
export async function partialRefund(tx: Tx, a: Args, actor: string) {
  const b = await first(tx.select().from(bills).where(eq(bills.id, str(a.billId, 40))));
  if (!b) throw new ApiError("Bill not found.", 404);
  if (b.status !== "completed") throw new ApiError("That bill is already void.");
  if (!b.loyaltyCustomerId) throw new ApiError("That bill isn't linked to a loyalty customer.");
  const amount = round2(num(a.amount));
  if (!(amount > 0 && amount <= b.total)) throw new ApiError(`Refund amount should be between ₹1 and ₹${b.total}.`);
  const reason = str(a.reason, 300);
  if (!reason) throw new ApiError("Give a reason — it goes in the audit log.");
  await reverseBill(tx, b, actor, amount / b.total, `Partial refund ₹${amount} (${reason})`);
  return null;
}

/** Housekeeping, run when the Loyalty page opens: tidy records of bills that were deleted, retire old rewards. */
export async function maintain(tx: Tx) {
  const cfg = await getConfig(tx);
  const now = Date.now();
  if (cfg.display.autoTidy) await purgeOrphans(tx);
  const due = await tx.selectDistinct({ id: loyaltyLots.customerId }).from(loyaltyLots).where(and(gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt), lt(loyaltyLots.expiresAt, now)));
  let expired = 0;
  for (const { id } of due) {
    const c = await byId(tx, id);
    if (c) expired += await expireFor(tx, c, cfg, now);
  }
  const old = await tx.update(loyaltyVouchers).set({ status: "expired" }).where(and(eq(loyaltyVouchers.status, "issued"), isNotNull(loyaltyVouchers.expiresAt), lt(loyaltyVouchers.expiresAt, now))).returning({ id: loyaltyVouchers.id });
  return { expired, vouchersExpired: old.length };
}

export async function saveConfig(tx: Tx, a: Args, actor: string) {
  const before = await getConfig(tx);
  const cfg = sanitizeConfig(a.config);
  if (!rangesValid(cfg.redeem.ranges)) throw new ApiError("Fix the points ranges first: each needs a minimum of at least 1 point, a maximum that is not below it, and an end that is not below its start.");
  await tx.insert(loyaltySettings).values({ id: 1, config: cfg, updatedAt: Date.now() }).onConflictDoUpdate({ target: loyaltySettings.id, set: { config: cfg, updatedAt: Date.now() } });
  await audit(tx, actor, "settings.update", { before, after: cfg, reason: str(a.reason, 300) });
  return cfg;
}

const intIn = (v: unknown, lo: number, hi: number, label: string) => {
  const n = Math.floor(num(v));
  if (!(n >= lo && n <= hi)) throw new ApiError(`${label} should be a whole number from ${lo} to ${hi}.`);
  return n;
};

/** A free gift reward: unlocked by points, or by spending a set amount in total. The gift is always an existing menu item. */
export async function saveReward(tx: Tx, a: Args, actor: string) {
  const name = str(a.name, 80);
  if (!name) throw new ApiError("Give the reward a name.");
  const trigger = a.trigger === "milestone" ? "milestone" : "points";
  const productId = str(a.productId, 40);
  if (!productId) throw new ApiError("Pick the free gift from your menu.");
  if (!(await first(tx.select({ id: products.id }).from(products).where(eq(products.id, productId))))) throw new ApiError("That item is no longer on the menu.");
  const giftQty = intIn(a.giftQty ?? 1, 1, 99, "The gift quantity");
  const pointsCost = trigger === "points" ? intIn(a.pointsCost, 1, 10_000_000, "The points needed") : 0;
  const milestoneAmount = trigger === "milestone" ? round2(num(a.milestoneAmount)) : 0;
  if (trigger === "milestone" && !(milestoneAmount > 0)) throw new ApiError("Enter the spending amount that unlocks this reward.");
  const startsOn = day(a.startsOn) || null;
  const endsOn = day(a.endsOn) || null;
  if (startsOn && endsOn && endsOn < startsOn) throw new ApiError("The end date is before the start date.");
  const limit = (v: unknown, label: string) => {
    if (v === null || v === undefined || str(String(v), 12) === "") return null;
    const n = Math.floor(num(v));
    if (!(n >= 1)) throw new ApiError(`${label} should be at least 1, or left blank for no limit.`);
    return n;
  };
  const maxRedemptions = limit(a.maxRedemptions, "The total limit");
  const perCustomerLimit = limit(a.perCustomerLimit, "The limit per customer");
  const now = Date.now();
  const fields = { name, description: str(a.description, 300), imageUrl: "", category: "", kind: "free_item" as RewardKind, value: 0, productId, pointsCost, trigger: trigger as "points" | "milestone", milestoneAmount, giftQty, tiers: [] as string[], startsOn, endsOn, active: a.active !== false, maxRedemptions, perCustomerLimit, terms: "", updatedAt: now };
  const id = str(a.id, 40);
  if (id) {
    const before = await first(tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, id)));
    if (!before) throw new ApiError("Reward not found.", 404);
    const [r] = await tx.update(loyaltyRewards).set(fields).where(eq(loyaltyRewards.id, id)).returning();
    await audit(tx, actor, "reward.update", { ref: r.name, before, after: r });
    return r;
  }
  const [r] = await tx.insert(loyaltyRewards).values({ id: uid(), ...fields, redeemed: 0, createdAt: now }).returning();
  await audit(tx, actor, "reward.create", { ref: r.name, after: r });
  return r;
}

export async function deleteReward(tx: Tx, a: Args, actor: string) {
  const r = await first(tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, str(a.id, 40))));
  if (!r) throw new ApiError("Reward not found.", 404);
  // a reward that's been unlocked or claimed stays for the history; it's just switched off
  if (r.redeemed > 0 || (await first(tx.select({ id: loyaltyVouchers.id }).from(loyaltyVouchers).where(eq(loyaltyVouchers.rewardId, r.id))))) {
    await tx.update(loyaltyRewards).set({ active: false, updatedAt: Date.now() }).where(eq(loyaltyRewards.id, r.id));
    await audit(tx, actor, "reward.archive", { ref: r.name });
    return { archived: true };
  }
  await tx.delete(loyaltyRewards).where(eq(loyaltyRewards.id, r.id));
  await audit(tx, actor, "reward.delete", { ref: r.name, before: r });
  return { archived: false };
}

/** A free-gift offer on the bill itself. */
export async function saveOffer(tx: Tx, a: Args, actor: string) {
  const name = str(a.name, 80);
  if (!name) throw new ApiError("Give the offer a name.");
  const type = a.type === "buy" ? "buy" : "spend";
  const prod = async (v: unknown, label: string) => {
    const id = str(v, 40);
    if (!id) throw new ApiError(`Pick ${label}.`);
    if (!(await first(tx.select({ id: products.id }).from(products).where(eq(products.id, id))))) throw new ApiError("That item is no longer on the menu.");
    return id;
  };
  const giftProductId = await prod(a.giftProductId, "the free gift");
  const giftQty = intIn(a.giftQty ?? 1, 1, 99, "The gift quantity");
  let minBill = 0;
  let productId: string | null = null;
  let buyQty = 1;
  if (type === "spend") {
    minBill = round2(num(a.minBill));
    if (!(minBill > 0)) throw new ApiError("Enter the bill amount that earns the gift.");
    if (str(a.productId, 40)) {
      productId = await prod(a.productId, "the qualifying item");
      buyQty = intIn(a.buyQty ?? 1, 1, 999, "The quantity to buy");
    }
  } else {
    productId = await prod(a.productId, "the item the customer buys");
    buyQty = intIn(a.buyQty, 1, 999, "The quantity to buy");
  }
  const startsOn = day(a.startsOn) || null;
  const endsOn = day(a.endsOn) || null;
  if (startsOn && endsOn && endsOn < startsOn) throw new ApiError("The end date is before the start date.");
  const maxTotal = a.maxTotal === null || a.maxTotal === undefined || str(String(a.maxTotal), 12) === "" ? null : Math.floor(num(a.maxTotal));
  if (maxTotal !== null && !(maxTotal >= 1)) throw new ApiError("The total limit should be at least 1, or left blank for no limit.");
  const now = Date.now();
  const fields = { name, type: type as "spend" | "buy", minBill, productId, buyQty, giftProductId, giftQty, repeatable: a.repeatable === true, audience: (a.audience === "members" ? "members" : "all") as "all" | "members", maxTotal, startsOn, endsOn, active: a.active !== false, updatedAt: now };
  const id = str(a.id, 40);
  if (id) {
    const before = await first(tx.select().from(giftOffers).where(eq(giftOffers.id, id)));
    if (!before) throw new ApiError("Offer not found.", 404);
    const [r] = await tx.update(giftOffers).set(fields).where(eq(giftOffers.id, id)).returning();
    await audit(tx, actor, "offer.update", { ref: r.name, before, after: r });
    return r;
  }
  const [r] = await tx.insert(giftOffers).values({ id: uid(), ...fields, given: 0, createdAt: now }).returning();
  await audit(tx, actor, "offer.create", { ref: r.name, after: r });
  return r;
}

export async function deleteOffer(tx: Tx, a: Args, actor: string) {
  const r = await first(tx.select().from(giftOffers).where(eq(giftOffers.id, str(a.id, 40))));
  if (!r) throw new ApiError("Offer not found.", 404);
  await tx.delete(giftOffers).where(eq(giftOffers.id, r.id));
  await audit(tx, actor, "offer.delete", { ref: r.name, before: r });
  return null;
}

/** One row per member whose cached balance disagrees with the ledger or the point lots. */
async function mismatches(q: Q): Promise<string[]> {
  const rows = await q.execute(sql`
    select c.id from ${loyaltyCustomers} c
    left join (select customer_id, sum(points)::int s from ${loyaltyLedger} group by customer_id) l on l.customer_id = c.id
    left join (select customer_id, sum(remaining)::int s from ${loyaltyLots} group by customer_id) p on p.customer_id = c.id
    where c.available <> coalesce(l.s, 0) or c.available <> coalesce(p.s, 0)`);
  return (rows.rows as { id: string }[]).map((r) => r.id);
}

/* ================================ reads ================================ */

export async function loyaltyState(): Promise<LoyaltyState> {
  const q = db;
  const cfg = await getConfig(q);
  const [customers, rewards, offers, vouchers, auditRows, messages, totalRows, giftRows, spendRows, mism, soon, monthRows] = await Promise.all([
    q.select().from(loyaltyCustomers).orderBy(desc(loyaltyCustomers.createdAt)),
    q.select().from(loyaltyRewards).orderBy(desc(loyaltyRewards.createdAt)),
    q.select().from(giftOffers).orderBy(desc(giftOffers.createdAt)),
    q.select().from(loyaltyVouchers).orderBy(desc(loyaltyVouchers.issuedAt)).limit(3000),
    q.select().from(loyaltyAudit).orderBy(desc(loyaltyAudit.createdAt)).limit(300),
    q.select().from(loyaltyMessages).orderBy(desc(loyaltyMessages.createdAt)).limit(1500),
    q.execute(sql`
      select
        coalesce(sum(points) filter (where type in ('purchase','bonus','promo','referral','occasion')), 0)::int earned,
        coalesce(-sum(points) filter (where type in ('redemption','reward')), 0)::int redeemed
      from ${loyaltyLedger}`),
    q.execute(sql`select coalesce(sum((i->>'qty')::int), 0)::int n from ${bills} b, jsonb_array_elements(b.items) i where b.status = 'completed' and (i->>'free') = 'true'`),
    q.select({ phone: bills.customerPhone, subtotal: bills.subtotal, discount: bills.discount, createdAt: bills.createdAt }).from(bills).where(eq(bills.status, "completed")),
    mismatches(q),
    q
      .select({ customerId: loyaltyLots.customerId, points: sql<number>`sum(${loyaltyLots.remaining})::int`, expiresAt: sql<number>`min(${loyaltyLots.expiresAt})` })
      .from(loyaltyLots)
      .where(and(gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt), gte(loyaltyLots.expiresAt, Date.now()), lte(loyaltyLots.expiresAt, Date.now() + cfg.expiry.warnDays * DAY)))
      .groupBy(loyaltyLots.customerId),
    q.execute(sql`
      select to_char(to_timestamp(created_at / 1000) at time zone 'Asia/Kolkata', 'YYYY-MM') m,
        coalesce(sum(points) filter (where type in ('purchase','bonus','promo','referral','occasion')), 0)::int earned,
        coalesce(-sum(points) filter (where type in ('redemption','reward')), 0)::int redeemed
      from ${loyaltyLedger} group by 1 order by 1`),
  ]);
  const byPhoneId = new Map(customers.map((c) => [c.phone, c.id]));
  const spend: Record<string, number> = {};
  for (const b of spendRows) {
    const id = byPhoneId.get(b.phone);
    if (id) spend[id] = round2((spend[id] ?? 0) + Math.max(0, b.subtotal - b.discount));
  }
  // spending that counts towards each spending-milestone reward (from the day the reward was created)
  const rewardSpend: Record<string, Record<string, number>> = {};
  for (const rw of rewards.filter((r) => r.trigger === "milestone")) {
    for (const b of spendRows) {
      const id = byPhoneId.get(b.phone);
      if (!id || (!cfg.gifts.countOldBills && b.createdAt < rw.createdAt)) continue;
      (rewardSpend[id] ??= {})[rw.id] = round2(((rewardSpend[id] ?? {})[rw.id] ?? 0) + Math.max(0, b.subtotal - b.discount));
    }
  }
  const t = (totalRows.rows[0] ?? { earned: 0, redeemed: 0 }) as { earned: number; redeemed: number };
  return {
    config: cfg,
    customers,
    rewards,
    offers: offers as GiftOffer[],
    vouchers,
    audit: auditRows,
    messages,
    spend,
    rewardSpend,
    totals: { earned: t.earned, redeemed: t.redeemed, outstanding: customers.reduce((a, c) => a + c.available, 0), giftsGiven: Number((giftRows.rows[0] as { n: number } | undefined)?.n ?? 0) },
    mismatched: mism,
    months: (monthRows.rows as { m: string; earned: number; redeemed: number }[]).map((r) => ({ month: r.m, earned: r.earned, redeemed: r.redeemed })),
    expiring: Object.fromEntries(soon.map((r) => [r.customerId, { points: Number(r.points), expiresAt: Number(r.expiresAt) }])),
  };
}

/** Billing's view of one mobile. Read-only. Also carries the bill offers, which work for people who aren't customers. */
export async function lookup(phoneRaw: unknown): Promise<LoyaltyLookup> {
  const q = db;
  const cfg = await getConfig(q);
  const phone = mobile(phoneRaw);
  const offers = (await q.select().from(giftOffers).where(eq(giftOffers.active, true))) as GiftOffer[];
  const blank = { enabled: cfg.enabled, config: cfg, customer: null, knownName: "", vouchers: [] as Voucher[], rewards: [] as Reward[], offers, spendRewards: [] as LoyaltyLookup["spendRewards"], firstPurchase: true };
  if (!phone) return blank;
  const now = Date.now();
  const [c, history, rewards] = await Promise.all([byPhone(q, phone), billsOf(q, phone), q.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.active, true), eq(loyaltyRewards.trigger, "points")))]);
  const knownName = history.find((b) => b.customerName && b.customerName !== "Walk-in customer")?.customerName ?? "";
  if (!c) return { ...blank, knownName };
  const vouchers = (await q.select().from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), eq(loyaltyVouchers.status, "issued")))).filter((v) => voucherLive(v, now));
  const firstPurchase = !(await first(q.select({ id: loyaltyLedger.id }).from(loyaltyLedger).where(and(eq(loyaltyLedger.customerId, c.id), eq(loyaltyLedger.type, "purchase")))));
  // progress towards each spending reward: paid bills so far, counted the way the server counts them
  const spendRewards: LoyaltyLookup["spendRewards"] = [];
  if (cfg.gifts.milestone) {
    const ms = await q.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.active, true), eq(loyaltyRewards.trigger, "milestone")));
    for (const r of ms) {
      if (!(r.milestoneAmount > 0) || rewardAvailable(r, c.tier, now)) continue;
      spendRewards.push({ id: r.id, name: r.name, giftQty: r.giftQty, productId: r.productId, amount: r.milestoneAmount, progress: await spendOf(q, c.phone, undefined, cfg.gifts.countOldBills ? 0 : r.createdAt) });
    }
  }
  return { ...blank, customer: c, knownName, vouchers, spendRewards, rewards: cfg.gifts.points ? rewards.filter((r) => r.kind === "free_item" && !rewardAvailable(r, c.tier, now)) : [], firstPurchase };
}

/** The WhatsApp messages prepared for one bill or one customer, newest first. */
export async function messagesFor(p: URLSearchParams): Promise<LoyaltyMessage[]> {
  const billId = (p.get("billId") ?? "").slice(0, 40);
  const customerId = (p.get("customerId") ?? "").slice(0, 40);
  if (!billId && !customerId) return [];
  return db.select().from(loyaltyMessages).where(billId ? eq(loyaltyMessages.billId, billId) : eq(loyaltyMessages.customerId, customerId)).orderBy(desc(loyaltyMessages.createdAt)).limit(200);
}

/** One page of the ledger for the reports and a member's history. */
export async function ledgerPage(p: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(p.get("page")) || 1));
  const size = Math.min(5000, Math.max(1, Math.floor(Number(p.get("size")) || 50)));
  const conds = [];
  const cid = p.get("customerId");
  if (cid) conds.push(eq(loyaltyLedger.customerId, cid));
  const types = (p.get("type") ?? "").split(",").filter(Boolean);
  if (types.length) conds.push(inArray(loyaltyLedger.type, types as LedgerType[]));
  const from = Number(p.get("from"));
  const to = Number(p.get("to"));
  if (from > 0) conds.push(gte(loyaltyLedger.createdAt, from));
  if (to > 0) conds.push(lte(loyaltyLedger.createdAt, to));
  const text = (p.get("q") ?? "").trim().slice(0, 60);
  if (text) conds.push(or(ilike(loyaltyLedger.description, `%${text}%`), ilike(loyaltyLedger.invoiceNo, `%${text}%`), ilike(loyaltyLedger.ref, `%${text}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [agg]] = await Promise.all([
    db.select().from(loyaltyLedger).where(where).orderBy(desc(loyaltyLedger.createdAt), desc(loyaltyLedger.id)).limit(size).offset((page - 1) * size),
    db.select({ n: sql<number>`count(*)::int`, credit: sql<number>`coalesce(sum(${loyaltyLedger.points}) filter (where ${loyaltyLedger.points} > 0), 0)::int`, debit: sql<number>`coalesce(-sum(${loyaltyLedger.points}) filter (where ${loyaltyLedger.points} < 0), 0)::int` }).from(loyaltyLedger).where(where),
  ]);
  return { rows, total: agg.n, credit: agg.credit, debit: agg.debit, page, size };
}

/** The customer's own wallet page, found by its secret token. */
export async function walletView(tokenRaw: unknown) {
  const token = str(tokenRaw, 40);
  if (token.length < 16) return null;
  const q = db;
  const c = await first(q.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.walletToken, token)));
  if (!c) return null;
  const now = Date.now();
  const cfg = await getConfig(q);
  const [shop, ledger, vouchers, rewards, lots, history] = await Promise.all([
    first(q.select({ n: settings.shopName, logo: settings.logoUrl }).from(settings).where(eq(settings.id, 1))),
    q.select().from(loyaltyLedger).where(eq(loyaltyLedger.customerId, c.id)).orderBy(desc(loyaltyLedger.createdAt)).limit(50),
    q.select().from(loyaltyVouchers).where(eq(loyaltyVouchers.customerId, c.id)).orderBy(desc(loyaltyVouchers.issuedAt)).limit(30),
    q.select().from(loyaltyRewards).where(eq(loyaltyRewards.active, true)),
    q.select().from(loyaltyLots).where(and(eq(loyaltyLots.customerId, c.id), gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt))).orderBy(asc(loyaltyLots.expiresAt)),
    q.select({ invoiceNo: bills.invoiceNo, total: bills.total, createdAt: bills.createdAt, pointsEarned: bills.pointsEarned, pointsRedeemed: bills.pointsRedeemed, status: bills.status }).from(bills).where(eq(bills.customerPhone, c.phone)).orderBy(desc(bills.createdAt)).limit(20),
  ]);
  const lapsed = lots.filter((l) => (l.expiresAt ?? Infinity) < now).reduce((a, l) => a + l.remaining, 0);
  return {
    shopName: shop?.n ?? "Cafe",
    logoUrl: shop?.logo?.startsWith("data:") ? `/shop-logo?v=${shop.logo.length}` : shop?.logo ?? "",
    config: cfg,
    customer: { code: c.code, name: c.name, tier: c.tier, available: c.available - lapsed, lifetime: c.lifetime, redeemed: c.redeemed, expired: c.expired, stamps: c.stamps, referralCode: c.referralCode, status: c.status, createdAt: c.createdAt },
    ledger: ledger.map((l) => ({ id: l.id, type: l.type, points: l.points, description: l.description, invoiceNo: l.invoiceNo, createdAt: l.createdAt })),
    vouchers: vouchers.map((v) => ({ ref: v.ref, name: v.name, status: voucherLive(v, now) ? "issued" : v.status === "issued" ? "expired" : v.status, expiresAt: v.expiresAt, issuedAt: v.issuedAt })),
    rewards: rewards.filter((r) => r.kind === "free_item" && r.trigger === "points" && !rewardAvailable(r, c.tier, now)).map((r) => ({ id: r.id, name: r.name, description: r.description, pointsCost: r.pointsCost, terms: r.terms, imageUrl: r.imageUrl })),
    expiring: lots.filter((l) => (l.expiresAt ?? 0) >= now).slice(0, 5).map((l) => ({ points: l.remaining, expiresAt: l.expiresAt! })),
    history,
  };
}
