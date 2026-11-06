import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { ApiError, mutate, read } from "./store";
import { code, uid } from "./seed";
import { TZ, checkCoupon, computeBill, round2, shopToday } from "./money";
import { hashPassword } from "./auth";
import { db, type Db, type Tx } from "./db";
import { batches, bills, coupons, expenseCategories, expenses, ingredientMoves, ingredients, meta, orders, products, recipes, sessions, settings, staffUsers, stockMovements, supplierInvoices, suppliers, approvalRequests, activityLog, loyaltyCustomers, loyaltyRewards, loyaltyCampaigns, loyaltyVouchers, giftOffers, productCategories } from "./db/schema";
import * as L from "./loyalty/server";
import { pointsPerUnit } from "./loyalty/engine";
import type { LoyaltyConfig } from "./loyalty/config";
import { INGREDIENT_UNITS, UPI_CHANNELS, type AdminState, type Coupon, type UpiChannel, Bill, Ingredient, IngredientLedger, IngredientMove, IngredientMoveType, IngredientUnit, StockLedger, MenuItem, Order, OrderItem, OrderStatus, PayMethod, Product, PublicUser, Recipe, RecipeItem, Session, StaffUser, StockMoveType, TabClose, TabView, ShopDetails } from "./types";

/* Every read/write the app makes, with validation. Route handlers are thin wrappers.
   Writes run inside store.mutate(), which serializes them and rolls back on error. */

type Args = Record<string, unknown>;
type Q = Db | Tx;

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.floor(num(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const optNum = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));

/** 10-digit Indian mobile, tolerant of +91 / spaces. Returns "" if absent, null if invalid. */
function mobile(v: unknown): string | null {
  const d = str(v, 24).replace(/\D/g, "");
  if (!d) return "";
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const first = async <T>(rows: Promise<T[]>): Promise<T | null> => (await rows)[0] ?? null;

/* Ingredient quantities use three decimals (down to the milligram); per-unit cost
   uses six so a cheap bulk good like sugar doesn't round away to ₹0 per gram. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
/** Prints a g/ml quantity for an error message, dropping trailing zeros. */
const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toString();

async function must<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const hit = await first(rows);
  if (!hit) throw new ApiError(`${what} not found — it may have just been removed.`, 404);
  return hit;
}

/** The fields of a user that may leave the server. Named one by one on purpose:
    anything added to StaffUser later stays server-side until it is listed here. */
const publicUser = (u: StaffUser): PublicUser => ({ id: u.id, name: u.name, mobile: u.mobile, email: u.email, createdAt: u.createdAt });

/** A guest's mobile as the key to their tab. Unlike the optional phone on a counter bill, this one is required. */
function phoneOf(v: unknown): string {
  const p = mobile(v);
  if (!p) throw new ApiError("Please enter a valid 10-digit mobile number.");
  return p;
}

/** The open tab for a mobile, if it has one. */
export async function openSession(q: Q, phone: string): Promise<Session | null> {
  if (!phone) return null;
  return first(q.select().from(sessions).where(and(eq(sessions.customerPhone, phone), eq(sessions.status, "open"))));
}

/* ============================== customer side ============================== */

/* Uploaded pictures are stored as base64 text. Sending that along with every page load and every
   refresh is what made the app crawl, so the screens get a small link instead — the browser
   fetches the picture once and keeps it (the ?v= changes when the picture does). */
const imgLink = (id: string, v: number, src: string) => (src.startsWith("data:") ? `/api/img/product/${id}?v=${v}` : src);
const logoLink = (src: string) => (src.startsWith("data:") ? `/shop-logo?v=${src.length}` : src);

export function menuOf(all: Product[], cfg: { enabled: boolean; earn: LoyaltyConfig["earn"] }): MenuItem[] {
  const order: string[] = [];
  for (const p of all) if (!order.includes(p.category)) order.push(p.category);
  return all
    .filter((p) => p.active)
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.createdAt - b.createdAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      description: p.description,
      image: imgLink(p.id, p.updatedAt, p.image),
      tags: p.tags,
      soldOut: p.stock !== null && p.stock <= 0,
      left: p.stock !== null && p.stock <= p.lowAt ? p.stock : null,
      points: pointsPerUnit(p, cfg),
    }));
}

/** How long after a tab closes the guest's phone still gets the goodbye. */
const CLOSE_WINDOW = 20 * 60_000;

async function lastClose(q: Q, phone: string): Promise<TabClose | null> {
  const [hit] = await q
    .select({ s: sessions, b: bills })
    .from(sessions)
    .leftJoin(bills, eq(bills.id, sessions.billId))
    .where(and(eq(sessions.customerPhone, phone), ne(sessions.status, "open"), sql`${sessions.closedAt} is not null`))
    .orderBy(desc(sessions.closedAt))
    .limit(1);
  if (!hit || Date.now() - hit.s.closedAt! > CLOSE_WINDOW) return null;
  const { s: last, b: bill } = hit;
  return bill && bill.status === "completed"
    ? { kind: "paid", invoiceNo: bill.invoiceNo, total: bill.total, itemCount: bill.itemCount, name: bill.customerName, at: last.closedAt! }
    : { kind: "cleared", invoiceNo: null, total: 0, itemCount: 0, name: last.customerName, at: last.closedAt! };
}

/* Every query is a network round trip to the database, so a view is built as two
   hops: the tab, then everything else at once. A phone with no tab (or no phone
   yet) just gets the menu. */
async function view(q: Q, phone: string): Promise<TabView> {
  const s = await openSession(q, phone);
  const sid = s?.id;
  const [all, st, list, closed, cps, member, lcfg] = await Promise.all([
    q.select().from(products).orderBy(asc(products.createdAt), asc(products.id)),
    first(q.select().from(settings).where(eq(settings.id, 1))),
    sid ? q.select().from(orders).where(eq(orders.sessionId, sid)).orderBy(asc(orders.createdAt), asc(orders.no)) : Promise.resolve([] as Order[]),
    !s && phone ? lastClose(q, phone) : Promise.resolve(null),
    s?.couponCode ? q.select().from(coupons) : Promise.resolve([]),
    s?.couponCode ? L.isMember(q, s.customerPhone) : Promise.resolve(false),
    L.getConfig(q),
  ]);
  const name = st?.shopName ?? "Cafe";
  const orderingEnabled = st?.orderingEnabled ?? true;
  const live = list.filter((o) => o.status !== "cancelled");
  const total = round2(live.reduce((a, o) => a + o.subtotal, 0));
  const cp = s?.couponCode ? cps.find((c) => c.code === s.couponCode) ?? null : null;
  const check = cp ? checkCoupon(cp, total, s?.customerPhone, member) : null;
  const discount = cp && check?.ok ? computeBill({ items: live.flatMap((o) => o.items), coupon: cp, manualType: "amount", manualValue: 0, extra: 0, phone: s?.customerPhone, member }).couponDiscount : 0;
  return {
    shopName: name,
    details: {
      ownerName: st?.ownerName ?? "", location: st?.location ?? "", address: st?.address ?? "", email: st?.email ?? "",
      address2: st?.address2 ?? "", whatsapp1: st?.whatsapp1 ?? "", whatsapp2: st?.whatsapp2 ?? "",
      customerCare: st?.customerCare ?? "", mapsUrl: st?.mapsUrl ?? "", logoUrl: logoLink(st?.logoUrl ?? ""),
    },
    orderingEnabled,
    menu: menuOf(all, lcfg),
    closed,
    tab: !orderingEnabled ? null : s
      ? {
          orders: list.map((o) => ({ no: o.no, items: o.items, status: o.status, subtotal: o.subtotal, createdAt: o.createdAt })),
          total,
          billRequested: !!s.billRequestedAt,
          name: s.customerName.split(" ")[0] ?? "",
          coupon: cp ? { code: cp.code, percent: cp.percent, discount, ok: !!check?.ok, reason: check && !check.ok ? check.reason : "" } : null,
          payable: round2(Math.max(0, total - discount)),
          upi: st?.upiId ? { id: st.upiId, name: st.upiName || name, minutes: st.upiQrMinutes, phone: st.upiPhone } : null,
          approved: s.billApprovedAt ? { amount: s.approvedAmount, at: s.billApprovedAt } : null,
          payClaim: s.payClaimedAt ? { amount: s.payClaimedAmount, at: s.payClaimedAt } : null,
        }
      : null,
  };
}

async function shopDetailsOf(q: Q): Promise<ShopDetails> {
  const r = await first(q.select({ ownerName: settings.ownerName, location: settings.location, address: settings.address, email: settings.email, address2: settings.address2, whatsapp1: settings.whatsapp1, whatsapp2: settings.whatsapp2, customerCare: settings.customerCare, mapsUrl: settings.mapsUrl, logoUrl: settings.logoUrl }).from(settings).where(eq(settings.id, 1)));
  return r ?? { ownerName: "", location: "", address: "", email: "", address2: "", whatsapp1: "", whatsapp2: "", customerCare: "", mapsUrl: "", logoUrl: "" };
}

async function shopNameOf(q: Q) {
  return (await first(q.select({ n: settings.shopName }).from(settings).where(eq(settings.id, 1))))?.n ?? "Cafe";
}

/** The menu, and the tab for this mobile if there is one open. A bad or missing number just gets the menu. */
export function tabView(phone: unknown) {
  return read(async (q) => view(q, mobile(phone) || ""));
}

/** One bill plus the shop's name, for the printable invoice page. Accepts the bill id or invoice number. */
export function billForInvoice(key: string): Promise<{ bill: Bill; shop: string; details: ShopDetails } | null> {
  return read(async (q) => {
    const bill = await first(q.select().from(bills).where(or(eq(bills.id, key), eq(bills.invoiceNo, key))));
    return bill ? { bill, shop: await shopNameOf(q), details: await shopDetailsOf(q) } : null;
  });
}

/** The shop's name, for pages that show it without loading the whole menu. */
export function shopName(): Promise<string> {
  return shopNameOf(db);
}

/** The logo from Settings: a data URL, an http(s) link, or "" for none. */
export async function shopLogo(): Promise<string> {
  return (await first(db.select({ l: settings.logoUrl }).from(settings).where(eq(settings.id, 1))))?.l ?? "";
}

/** Validates the lines, takes stock, opens a tab if needed and files the order.
    A guest names their mobile; staff may instead name an open tab by its id. */
async function addOrder(tx: Tx, a: Args, opts: { fromCustomer: boolean }): Promise<Order> {
  const now = Date.now();
  const raw = Array.isArray(a.items) ? (a.items as Args[]) : [];
  if (raw.length > 60) throw new ApiError("That's a big order — please split it in two.");
  const want = new Map<string, number>();
  for (const r of raw) {
    const id = str(r?.productId, 40);
    const q = Math.floor(num(r?.qty));
    if (id && q >= 1) want.set(id, (want.get(id) ?? 0) + q);
  }
  if (!want.size) throw new ApiError("The order is empty.");

  const found = await tx.select().from(products).where(inArray(products.id, [...want.keys()]));
  const items: OrderItem[] = [];
  for (const [id, q] of want) {
    const p = found.find((x) => x.id === id);
    if (!p || (!p.active && opts.fromCustomer)) throw new ApiError("Something in your order was just taken off the menu. Please review it and try again.", 409);
    if (q > 30) throw new ApiError(`Maximum 30 × ${p.name} per order.`);
    if (p.stock !== null && p.stock < q) throw new ApiError(p.stock <= 0 ? `${p.name} just sold out.` : `Only ${p.stock} × ${p.name} left.`, 409);
    items.push({ productId: p.id, name: p.name, price: p.price, qty: q });
  }

  let s: Session | null;
  const sid = opts.fromCustomer ? "" : str(a.sessionId, 40);
  if (sid) {
    s = await must(tx.select().from(sessions).where(and(eq(sessions.id, sid), eq(sessions.status, "open"))), "Tab");
  } else {
    const phone = phoneOf(a.phone);
    s = await openSession(tx, phone);
    if (!s) {
      const name = str(a.name, 60);
      if (opts.fromCustomer && !name) throw new ApiError("Please tell us your name.");
      [s] = await tx
        .insert(sessions)
        .values({ id: uid(), status: "open", openedAt: now, closedAt: null, customerName: name, customerPhone: phone, billRequestedAt: null, billId: null, couponCode: null })
        .returning();
    }
  }
  // more on the tab: an earlier approval or "I've paid" no longer matches what is owed
  [s] = await tx.update(sessions).set({ billRequestedAt: null, ...{ billApprovedAt: null, approvedAmount: 0, payClaimedAt: null, payClaimedAmount: 0, payClaimedRef: "" } }).where(eq(sessions.id, s.id)).returning();

  const [seq] = await tx.update(meta).set({ orderSeq: sql`${meta.orderSeq} + 1` }).where(eq(meta.id, 1)).returning({ n: meta.orderSeq });
  const [o] = await tx
    .insert(orders)
    .values({
      id: uid(),
      no: seq.n,
      sessionId: s.id,
      items,
      note: str(a.note, 240),
      customerName: s.customerName,
      customerPhone: s.customerPhone,
      status: opts.fromCustomer ? "new" : "preparing",
      source: opts.fromCustomer ? "customer" : "counter",
      subtotal: round2(items.reduce((x, i) => x + i.price * i.qty, 0)),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await moveStock(tx, tally(items, -1), { type: "sale", ref: `Order #${o.no}`, note: opts.fromCustomer ? "Guest order" : "Counter order" }, now);
  return o;
}

export function placeOrder(a: Args) {
  return mutate(async (tx) => {
    const o = await addOrder(tx, a, { fromCustomer: true });
    return { no: o.no, phone: o.customerPhone };
  }).then(async ({ no, phone }) => ({ no, view: await tabView(phone) }));
}

export function requestBill(raw: unknown) {
  return mutate(async (tx) => {
    const phone = phoneOf(raw);
    const s = await openSession(tx, phone);
    if (!s) throw new ApiError("There's nothing on your tab yet.");
    if (!s.billRequestedAt) await tx.update(sessions).set({ billRequestedAt: Date.now() }).where(eq(sessions.id, s.id));
    return phone;
  }).then(async (phone) => ({ view: await tabView(phone) }));
}

/** Puts a coupon on the guest's open tab. Usage is only counted when the bill is made. */
export function applyCoupon(raw: unknown, couponRaw: unknown) {
  return mutate(async (tx) => {
    const phone = phoneOf(raw);
    const s = await openSession(tx, phone);
    if (!s) throw new ApiError("Order something first, then apply your coupon.");
    const cc = str(couponRaw, 24).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cc) throw new ApiError("Enter a coupon code.");
    const cp = await first(tx.select().from(coupons).where(eq(coupons.code, cc)));
    if (!cp) throw new ApiError(`Coupon ${cc} doesn't exist.`);
    const live = (await tx.select().from(orders).where(eq(orders.sessionId, s.id))).filter((o) => o.status !== "cancelled");
    const sub = round2(live.reduce((a, o) => a + o.subtotal, 0));
    const ok = checkCoupon(cp, sub, phone, await L.isMember(tx, phone));
    if (!ok.ok) throw new ApiError(`Coupon ${cp.code}: ${ok.reason}.`);
    await tx.update(sessions).set({ couponCode: cp.code, ...{ billApprovedAt: null, approvedAmount: 0, payClaimedAt: null, payClaimedAmount: 0, payClaimedRef: "" } }).where(eq(sessions.id, s.id));
    return phone;
  }).then(async (phone) => ({ view: await tabView(phone) }));
}

/** What the public payment page needs: who is being paid, and how. */
export async function payPageInfo() {
  const r = await first(db.select({ n: settings.shopName, logo: settings.logoUrl, id: settings.upiId, pn: settings.upiName, ph: settings.upiPhone, m: settings.upiQrMinutes, url: settings.publicUrl }).from(settings).where(eq(settings.id, 1)));
  return { shopName: r?.n ?? "Cafe", logoUrl: logoLink(r?.logo ?? ""), upi: r?.id ? { id: r.id, name: r.pn || (r.n ?? "Cafe"), minutes: r.m ?? 5, phone: r.ph ?? "" } : null, publicUrl: (r?.url ?? "").replace(/\/+$/, "") };
}

/** What a guest owes on their open tab right now: their orders, less the coupon they applied. */
async function payableOf(q: Q, s: { id: string; customerPhone: string; couponCode: string | null }) {
  const live = (await q.select().from(orders).where(eq(orders.sessionId, s.id))).filter((o) => o.status !== "cancelled");
  const total = round2(live.reduce((a, o) => a + o.subtotal, 0));
  if (!s.couponCode) return total;
  const cp = await first(q.select().from(coupons).where(eq(coupons.code, s.couponCode)));
  if (!cp) return total;
  const member = await L.isMember(q, s.customerPhone);
  if (!checkCoupon(cp, total, s.customerPhone, member).ok) return total;
  const off = computeBill({ items: live.flatMap((o) => o.items), coupon: cp, manualType: "amount", manualValue: 0, extra: 0, phone: s.customerPhone, member }).couponDiscount;
  return round2(Math.max(0, total - off));
}

/** The guest paid by UPI and says so. Nothing is confirmed — the amount, the time and the QR reference are
    kept for staff, who check their own UPI app and then bill the tab. The counter is told the guest is ready. */
export function payClaim(raw: unknown, refRaw: unknown) {
  return mutate(async (tx) => {
    const phone = phoneOf(raw);
    const s = await openSession(tx, phone);
    if (!s) throw new ApiError("There's nothing on your tab yet.");
    if (!s.billApprovedAt) throw new ApiError("The counter hasn't approved your bill yet — your payment QR appears once they have.");
    const amount = s.approvedAmount;
    if (!(amount > 0)) throw new ApiError("There's nothing to pay yet.");
    const now = Date.now();
    await tx
      .update(sessions)
      .set({ payClaimedAt: now, payClaimedAmount: amount, payClaimedRef: str(refRaw, 40).replace(/[^A-Za-z0-9-]/g, ""), billRequestedAt: s.billRequestedAt ?? now })
      .where(eq(sessions.id, s.id));
    return phone;
  }).then(async (phone) => ({ view: await tabView(phone) }));
}

/** The guest changed their mind (tapped "I've paid" by mistake). */
export function payUnclaim(raw: unknown) {
  return mutate(async (tx) => {
    const phone = phoneOf(raw);
    const s = await openSession(tx, phone);
    if (s) await tx.update(sessions).set({ payClaimedAt: null, payClaimedAmount: 0, payClaimedRef: "" }).where(eq(sessions.id, s.id));
    return phone;
  }).then(async (phone) => ({ view: await tabView(phone) }));
}

export function removeCoupon(raw: unknown) {
  return mutate(async (tx) => {
    const phone = phoneOf(raw);
    const s = await openSession(tx, phone);
    if (s) await tx.update(sessions).set({ couponCode: null, ...{ billApprovedAt: null, approvedAmount: 0, payClaimedAt: null, payClaimedAmount: 0, payClaimedRef: "" } }).where(eq(sessions.id, s.id));
    return phone;
  }).then(async (phone) => ({ view: await tabView(phone) }));
}

/* ================================ admin side ================================ */

export async function adminState(): Promise<AdminState> {
  const [m, st, prods, sess, ords, bls, cps, us, exps, ecats, ings, btchs, rcps, sups, supInvs, apprs, lc, pcats] = await Promise.all([
    db.select().from(meta).where(eq(meta.id, 1)),
    db.select().from(settings).where(eq(settings.id, 1)),
    db.select().from(products).orderBy(asc(products.createdAt), asc(products.id)),
    db.select().from(sessions).orderBy(asc(sessions.openedAt), asc(sessions.id)),
    db.select().from(orders).orderBy(asc(orders.createdAt), asc(orders.no)),
    db.select().from(bills).orderBy(asc(bills.createdAt), asc(bills.id)),
    db.select().from(coupons).orderBy(desc(coupons.createdAt), desc(coupons.id)),
    db.select().from(staffUsers).orderBy(asc(staffUsers.createdAt), asc(staffUsers.id)),
    db.select().from(expenses).orderBy(desc(expenses.expenseDate), desc(expenses.createdAt)),
    db.select().from(expenseCategories).orderBy(asc(expenseCategories.createdAt), asc(expenseCategories.name)),
    db.select().from(ingredients).orderBy(asc(ingredients.name)),
    db.select().from(batches).orderBy(desc(batches.createdAt), desc(batches.id)).limit(100),
    db.select().from(recipes).orderBy(asc(recipes.name)),
    db.select().from(suppliers).orderBy(asc(suppliers.name)),
    db.select().from(supplierInvoices).orderBy(desc(supplierInvoices.invoiceDate), desc(supplierInvoices.createdAt)),
    db.select().from(approvalRequests).orderBy(desc(approvalRequests.createdAt)).limit(50),
    L.getConfig(db),
    db.select().from(productCategories).orderBy(asc(productCategories.createdAt)),
  ]);
  return {
    version: m[0]?.version ?? 0,
    seq: { order: m[0]?.orderSeq ?? 0 },
    settings: {
      shopName: st[0]?.shopName ?? "Cafe",
      publicUrl: st[0]?.publicUrl ?? "",
      ownerName: st[0]?.ownerName ?? "",
      location: st[0]?.location ?? "",
      address: st[0]?.address ?? "",
      email: st[0]?.email ?? "",
      address2: st[0]?.address2 ?? "",
      whatsapp1: st[0]?.whatsapp1 ?? "",
      whatsapp2: st[0]?.whatsapp2 ?? "",
      customerCare: st[0]?.customerCare ?? "",
      mapsUrl: st[0]?.mapsUrl ?? "",
      logoUrl: logoLink(st[0]?.logoUrl ?? ""),
      walkInsOnly: st[0]?.walkInsOnly ?? false,
      kotEnabled: st[0]?.kotEnabled ?? true,
      orderingEnabled: st[0]?.orderingEnabled ?? true,
      upiId: st[0]?.upiId ?? "",
      upiName: st[0]?.upiName ?? "",
      upiPhone: st[0]?.upiPhone ?? "",
      upiQrMinutes: st[0]?.upiQrMinutes ?? 5,
    },
    products: prods.map((p) => ({ ...p, image: imgLink(p.id, p.updatedAt, p.image) })),
    sessions: sess,
    orders: ords,
    bills: bls,
    coupons: cps,
    users: us.map(publicUser),
    loyaltyEarn: { enabled: lc.enabled, earn: lc.earn, display: lc.display },
    expenses: exps,
    expenseCategories: ecats,
    suppliers: sups,
    categories: pcats,
    approvals: apprs,
    supplierInvoices: supInvs,
    ingredients: ings,
    batches: btchs,
    recipes: rcps,
  };
}

/** The stock ledger, one page at a time. Filters narrow the rows; the totals and the
    per-product summary cover the whole date range so they don't change as you page. */
export async function stockLedger(p: URLSearchParams): Promise<StockLedger> {
  const from = Number(p.get("from")) || null;
  const to = Number(p.get("to")) || null;
  const size = Math.min(p.get("export") ? 5000 : 100, Math.max(1, Math.floor(Number(p.get("size"))) || 20)); // ?export=1 lifts the page cap for the CSV download
  const type = p.get("type") ?? "all";
  const pid = p.get("pid") ?? "all";
  const q = (p.get("q") ?? "").trim().slice(0, 80).replace(/[\\%_]/g, (c) => "\\" + c);
  const M = stockMovements;

  const inRange = and(from ? gte(M.createdAt, from) : undefined, to ? lte(M.createdAt, to) : undefined);
  const where = and(
    inRange,
    type !== "all" ? eq(M.type, type as StockMoveType) : undefined,
    pid !== "all" ? eq(M.productId, pid) : undefined,
    q ? or(ilike(M.productName, `%${q}%`), ilike(M.note, `%${q}%`), ilike(M.ref, `%${q}%`)) : undefined,
  );

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(M).where(where);
  const pages = Math.max(1, Math.ceil(n / size));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(p.get("page"))) || 1));

  const [rows, byType, perProduct, products] = await Promise.all([
    db.select().from(M).where(where).orderBy(desc(M.createdAt), desc(M.id)).limit(size).offset((page - 1) * size),
    db.select({ type: M.type, qty: sql<number>`coalesce(sum(${M.qty}), 0)::int` }).from(M).where(inRange).groupBy(M.type),
    db
      .select({
        id: M.productId,
        name: sql<string>`max(${M.productName})`,
        in: sql<number>`coalesce(sum(case when ${M.qty} > 0 then ${M.qty} else 0 end), 0)::int`,
        out: sql<number>`coalesce(sum(case when ${M.qty} < 0 then -${M.qty} else 0 end), 0)::int`,
        close: sql<number | null>`(array_agg(${M.balanceAfter} order by ${M.createdAt} desc, ${M.id} desc) filter (where ${M.note} not like '%stock not counted%'))[1]`,
      })
      .from(M)
      .where(inRange)
      .groupBy(M.productId)
      .orderBy(sql`sum(abs(${M.qty})) desc`)
      .limit(15),
    db.select({ id: M.productId, name: sql<string>`max(${M.productName})` }).from(M).groupBy(M.productId).orderBy(sql`max(${M.productName})`),
  ]);

  const sum = (t: StockMoveType) => byType.find((r) => r.type === t)?.qty ?? 0;
  const added = sum("added") + sum("initial");
  const sold = -sum("sale");
  const removed = -sum("removed");
  const returned = sum("cancelled_order") + sum("void_bill");
  const adjusted = sum("adjustment");
  const gifts = -sum("gift");
  return { rows, total: n, page, pages, stats: { added, sold, removed, returned, adjusted, gifts, net: added - sold - removed - gifts + returned + adjusted }, perProduct, products };
}

/** The raw-ingredient ledger: paged rows, with totals and a per-ingredient summary
    that both cover the whole filtered period (so paging doesn't change the numbers).
    Filters: from/to (ms), type ("all" | purchase | use | waste | adjust), iid, q. */
export async function ingredientLedger(p: URLSearchParams): Promise<IngredientLedger> {
  const from = Number(p.get("from")) || null;
  const to = Number(p.get("to")) || null;
  const size = Math.min(p.get("export") ? 10000 : 200, Math.max(1, Math.floor(Number(p.get("size"))) || 25));
  const type = p.get("type") ?? "all";
  const iid = p.get("iid") ?? "all";
  const q = (p.get("q") ?? "").trim().slice(0, 80).replace(/[\\%_]/g, (c) => "\\" + c);
  const M = ingredientMoves;

  const inRange = and(from ? gte(M.createdAt, from) : undefined, to ? lte(M.createdAt, to) : undefined);
  const where = and(
    inRange,
    type !== "all" ? eq(M.type, type as IngredientMoveType) : undefined,
    iid !== "all" ? eq(M.ingredientId, iid) : undefined,
    q ? or(ilike(M.ingredientName, `%${q}%`), ilike(M.note, `%${q}%`), ilike(batches.note, `%${q}%`), ilike(batches.name, `%${q}%`)) : undefined,
  );

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(M).leftJoin(batches, eq(batches.id, M.batchId)).where(where);
  const pages = Math.max(1, Math.ceil(n / size));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(p.get("page"))) || 1));

  /* Column sort — clicking a header on the admin page flips to desc/asc on that key.
     Default is newest-first by date, matching how the user reads a running log. */
  const sort = (p.get("sort") ?? "date").toLowerCase();
  const dir = (p.get("dir") ?? "desc").toLowerCase() === "asc" ? asc : desc;
  const sortCol =
    sort === "ingredient" ? M.ingredientName
    : sort === "type" ? M.type
    : sort === "qty" ? sql`abs(${M.qty})`
    : sort === "cost" ? M.cost
    : sort === "balance" ? M.balanceAfter
    : M.createdAt;
  const orderBy = sort === "date"
    ? [dir(M.createdAt), dir(M.id)]
    : [dir(sortCol), desc(M.createdAt), desc(M.id)];

  const [rows, byType, perIngredient, ingList] = await Promise.all([
    db
      .select({
        id: M.id,
        ingredientId: M.ingredientId,
        ingredientName: M.ingredientName,
        unit: M.unit,
        qty: M.qty,
        type: M.type,
        cost: M.cost,
        balanceAfter: M.balanceAfter,
        batchId: M.batchId,
        batchName: sql<string>`coalesce(${batches.name}, '')`,
        batchNote: sql<string>`coalesce(${batches.note}, '')`,
        // what the batch was made into, e.g. "2 × Veg Burger" (the inventory items logged as produced in the same batch)
        madeFor: sql<string>`coalesce((select string_agg(sm.qty || ' × ' || sm.product_name, ', ') from stock_movements sm where sm.ref = ${batches.name} and sm.created_at = ${batches.createdAt} and sm.type in ('added', 'initial')), '')`,
        note: M.note,
        createdAt: M.createdAt,
      })
      .from(M)
      .leftJoin(batches, eq(batches.id, M.batchId))
      .where(where)
      .orderBy(...orderBy)
      .limit(size)
      .offset((page - 1) * size),
    db
      .select({ type: M.type, qty: sql<number>`coalesce(sum(abs(${M.qty})), 0)::float`, cost: sql<number>`coalesce(sum(${M.cost}), 0)::float` })
      .from(M)
      .where(inRange)
      .groupBy(M.type),
    db
      .select({
        id: M.ingredientId,
        name: sql<string>`max(${M.ingredientName})`,
        unit: sql<IngredientUnit>`max(${M.unit})`,
        in: sql<number>`coalesce(sum(case when ${M.type} = 'purchase' then ${M.qty} else 0 end), 0)::float`,
        used: sql<number>`coalesce(sum(case when ${M.type} = 'use' then -${M.qty} else 0 end), 0)::float`,
        wasted: sql<number>`coalesce(sum(case when ${M.type} = 'waste' then -${M.qty} else 0 end), 0)::float`,
        close: sql<number>`coalesce((array_agg(${M.balanceAfter} order by ${M.createdAt} desc, ${M.id} desc))[1], 0)::float`,
      })
      .from(M)
      .where(inRange)
      .groupBy(M.ingredientId)
      .orderBy(sql`sum(abs(${M.qty})) desc`),
    db
      .select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit })
      .from(ingredients)
      .where(eq(ingredients.active, true))
      .orderBy(asc(ingredients.name)),
  ]);

  const kind = (t: IngredientMoveType) => byType.find((r) => r.type === t) ?? { qty: 0, cost: 0 };
  const purchased = kind("purchase");
  const used = kind("use");
  const wasted = kind("waste");
  const adjustQty = byType.find((r) => r.type === "adjust")?.qty ?? 0;
  return {
    rows,
    total: n,
    page,
    pages,
    stats: {
      purchased: { qty: round3(purchased.qty), cost: round2(purchased.cost) },
      used: { qty: round3(used.qty), cost: round2(used.cost) },
      wasted: { qty: round3(wasted.qty), cost: round2(wasted.cost) },
      adjusted: { qty: round3(adjustQty) },
    },
    perIngredient: perIngredient.map((r) => ({ ...r, in: round3(r.in), used: round3(r.used), wasted: round3(r.wasted), close: round3(r.close) })),
    ingredients: ingList,
  };
}

type Move = { type: StockMoveType; ref?: string; note?: string };

/** One row in the stock ledger. */
const logMove = (tx: Tx, p: { id: string; name: string }, m: Move, qty: number, balanceAfter: number, at: number) =>
  tx.insert(stockMovements).values({ id: uid(), productId: p.id, productName: p.name, type: m.type, qty, balanceAfter, note: m.note ?? "", ref: m.ref ?? "", createdAt: at });

/** Moves stock for many products in one statement (untracked stock stays null) and
    writes what really changed — after clamping at zero — to the stock ledger. */
type Moved = { id: string; name: string; new_stock: number | null; old_stock: number | null };

async function moveStock(tx: Tx, deltas: Map<string, number>, m: Move, stamp?: number): Promise<Moved[]> {
  const rows = [...deltas].filter(([, d]) => d !== 0);
  if (!rows.length) return [];
  const at = stamp ?? Date.now();
  const vals = sql.join(rows.map(([id, d]) => sql`(${id}::text, ${d}::int)`), sql`, `);
  const res = await tx.execute(sql`
    with v(id, d) as (values ${vals}),
    old as (select p.id, p.stock from products p join v on v.id = p.id),
    upd as (
      update products p
      set stock = case when p.stock is null then null else greatest(0, p.stock + v.d) end,
          updated_at = ${stamp === undefined ? sql`p.updated_at` : sql`${stamp}::bigint`}
      from v
      where p.id = v.id
      returning p.id, p.name, p.stock)
    select upd.id, upd.name, upd.stock as new_stock, old.stock as old_stock from upd join old on old.id = upd.id`);
  const all = res.rows as Moved[];
  const moved = all.filter((r) => r.new_stock !== null && r.old_stock !== null && r.new_stock !== r.old_stock);
  if (moved.length)
    await tx.insert(stockMovements).values(
      moved.map((r) => ({ id: uid(), productId: r.id, productName: r.name, type: m.type, qty: r.new_stock! - r.old_stock!, balanceAfter: r.new_stock!, note: m.note ?? "", ref: m.ref ?? "", createdAt: at })),
    );
  return all;
}

const tally = (items: OrderItem[], sign: 1 | -1, into = new Map<string, number>()) => {
  for (const it of items) if (it.productId) into.set(it.productId, (into.get(it.productId) ?? 0) + sign * it.qty);
  return into;
};

const restock = (tx: Tx, items: OrderItem[], m: Move) => moveStock(tx, tally(items, 1), m);

async function saveProduct(tx: Tx, a: Args, role = "admin") {
  const now = Date.now();
  const name = str(a.name, 80);
  const category = str(a.category, 40) || "Uncategorised";
  const price = round2(num(a.price));
  const stockRaw = optNum(a.stock);
  if (!name) throw new ApiError("Give the product a name.");
  if (!(price >= 0)) throw new ApiError("Enter a valid price.");
  if (stockRaw !== null && !(stockRaw >= 0)) throw new ApiError("Stock can't be negative.");
  const fields = {
    name,
    category,
    price,
    stock: stockRaw === null ? null : Math.floor(stockRaw),
    lowAt: int(a.lowAt, 0, 9999, 4),
    description: str(a.description, 240),
    // the screens show uploaded pictures as /api/img links; saving one of those back must not replace the real picture
    ...(typeof a.image === "string" && a.image.startsWith("/api/img/product/") ? {} : { image: str(a.image, 6_500_000) }), // room for a ~4 MB base64 data URL (plus headroom)
    tags: Array.isArray(a.tags) ? (a.tags as unknown[]).map((x) => str(x, 20).toLowerCase()).filter(Boolean).slice(0, 6) : [],
    active: a.active !== false,
    // how many loyalty points one of these earns is the admin's call; staff edits leave it as it is
    ...(role === "admin" && a.loyaltyPoints !== undefined ? { loyaltyPoints: optNum(a.loyaltyPoints) === null ? null : Math.max(0, Math.floor(num(a.loyaltyPoints))) } : {}),
  };
  const id = str(a.id, 40);
  const dupe = (await tx.select().from(products)).find((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== id);
  if (dupe) throw new ApiError(`"${dupe.name}" already exists.`);
  if (id) {
    const before = await must(tx.select().from(products).where(eq(products.id, id)), "Product");
    const [p] = await tx.update(products).set({ ...fields, updatedAt: now }).where(eq(products.id, id)).returning();
    if (p.stock !== null) {
      if (before.stock === null && p.stock > 0) await logMove(tx, p, { type: "initial", note: "Stock tracking turned on" }, p.stock, p.stock, now);
      else if (before.stock !== null && p.stock !== before.stock) await logMove(tx, p, { type: "adjustment", note: "Edited in product form" }, p.stock - before.stock, p.stock, now);
    }
    return p;
  }
  const [p] = await tx.insert(products).values({ id: uid(), ...fields, createdAt: now, updatedAt: now }).returning();
  if (p.stock) await logMove(tx, p, { type: "initial", note: "Opening stock" }, p.stock, p.stock, now);
  return p;
}

async function saveCoupon(tx: Tx, a: Args) {
  const c = str(a.code, 24).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const percent = round2(num(a.percent));
  const minOrder = optNum(a.minOrder) ?? 0;
  const limit = optNum(a.limit);
  const exp = str(a.expiresAt, 10);
  if (c.length < 3) throw new ApiError("Coupon code needs at least 3 letters or digits.");
  if (!(percent > 0 && percent <= 100)) throw new ApiError("Discount must be between 1 and 100%.");
  if (!(minOrder >= 0)) throw new ApiError("Minimum order can't be negative.");
  if (limit !== null && !(limit >= 1)) throw new ApiError("Usage limit must be at least 1 (or leave it blank).");
  if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) throw new ApiError("Pick a valid expiry date.");
  const id = str(a.id, 40);
  const clash = await first(tx.select().from(coupons).where(eq(coupons.code, c)));
  if (clash && clash.id !== id) throw new ApiError(`${c} already exists.`);
  const audience: "all" | "regular" | "loyalty" = a.audience === "loyalty" || a.audience === "regular" ? a.audience : "all";
  const fields = { code: c, percent, minOrder: round2(minOrder), expiresAt: exp || null, limit: limit === null ? null : Math.floor(limit), active: a.active !== false, audience, ...(typeof a.restricted === "boolean" ? { restricted: a.restricted } : {}) };
  if (id) {
    await must(tx.select().from(coupons).where(eq(coupons.id, id)), "Coupon");
    const [x] = await tx.update(coupons).set(fields).where(eq(coupons.id, id)).returning();
    return x;
  }
  const [x] = await tx.insert(coupons).values({ id: uid(), ...fields, used: 0, createdAt: Date.now() }).returning();
  return x;
}

/** Records that a coupon went to a customer (WhatsApp link or PDF), and whether it is
    locked to the phones it was sent to. */
async function sendCoupon(tx: Tx, a: Args) {
  const cp = await must(tx.select().from(coupons).where(eq(coupons.id, str(a.id, 40))), "Coupon");
  const phone = mobile(a.phone);
  if (!phone) throw new ApiError("Enter the customer's 10-digit WhatsApp number.");
  const phones = cp.phones.includes(phone) ? cp.phones : [...cp.phones, phone];
  const [x] = await tx
    .update(coupons)
    .set({ phones, sent: sql`${coupons.sent} + 1`, ...(typeof a.restricted === "boolean" ? { restricted: a.restricted } : {}) })
    .where(eq(coupons.id, cp.id))
    .returning();
  return x;
}

/** What the public coupon page shows. Paused, expired or used-up coupons still show, marked as such. */
export function couponForPage(raw: unknown) {
  return read(async (q) => {
    const cc = str(raw, 24).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cc) return null;
    const cp = await first(q.select().from(coupons).where(eq(coupons.code, cc)));
    if (!cp) return null;
    const shop = await first(q.select({ n: settings.shopName, logoUrl: settings.logoUrl }).from(settings).where(eq(settings.id, 1)));
    return { coupon: { code: cp.code, percent: cp.percent, minOrder: cp.minOrder, expiresAt: cp.expiresAt, restricted: cp.restricted, audience: cp.audience, active: cp.active, limit: cp.limit, used: cp.used }, shopName: shop?.n ?? "Cafe", logoUrl: logoLink(shop?.logoUrl ?? "") };
  });
}

async function createBill(tx: Tx, a: Args, actor = "admin"): Promise<Bill> {
  const now = Date.now();
  const source = a.source === "counter" ? "counter" : "tab";
  let s: Session | null = null;
  if (source === "tab") {
    s = await first(tx.select().from(sessions).where(and(eq(sessions.id, str(a.sessionId, 40)), eq(sessions.status, "open"))));
    if (!s) throw new ApiError("That tab is no longer open — it may have just been billed.", 409);
  }

  const allProducts = await tx.select({ id: products.id }).from(products);
  const known = new Set(allProducts.map((p) => p.id));
  const raw = Array.isArray(a.items) ? (a.items as Args[]) : [];
  const items: OrderItem[] = [];
  for (const r of raw) {
    const name = str(r?.name, 120);
    const price = round2(num(r?.price));
    const qty = Math.floor(num(r?.qty));
    if (!name && !(price > 0)) continue; // untouched blank row
    if (!name) throw new ApiError("Every item needs a name.");
    if (!(price >= 0)) throw new ApiError(`Enter a price for "${name}".`);
    if (!(qty >= 1 && qty <= 999)) throw new ApiError(`Check the quantity for "${name}".`);
    const pid = str(r?.productId, 40);
    if (r?.free === true) {
      // a free gift: always ₹0, and always an item from the menu (checked against the bill's offers and reward below)
      if (!pid || !known.has(pid)) throw new ApiError(`"${name}" isn't a menu item, so it can't be a free gift.`);
      items.push({ productId: pid, name, price: 0, qty, free: true });
      continue;
    }
    items.push({ productId: pid && known.has(pid) ? pid : null, name, price, qty });
  }
  if (!items.length) throw new ApiError("Add at least one item to the bill.");

  // no code sent → use the one the guest applied from their phone
  const cc = a.couponCode === undefined ? s?.couponCode ?? "" : str(a.couponCode, 24).toUpperCase();
  const coupon = cc ? await first(tx.select().from(coupons).where(eq(coupons.code, cc))) : null;
  if (cc && !coupon) throw new ApiError(`Coupon ${cc} doesn't exist.`);
  const manualType = a.manualType === "percent" ? "percent" : "amount";
  const manualValue = Math.max(0, num(a.manualValue) || 0);
  const isGst = a.isGst === true;
  const gstRaw = num(a.gstPercent);
  if (isGst && !(gstRaw >= 0 && gstRaw <= 100)) throw new ApiError("GST should be between 0 and 100%.");
  const phone = mobile(a.customerPhone);
  if (phone === null) throw new ApiError("Customer mobile should be a 10-digit number.");
  const billPhone = phone || s?.customerPhone;
  const billInput = { items, coupon, manualType, manualValue, extra: num(a.extra) || 0, gst: isGst, gstPercent: isGst ? gstRaw : 0, phone: billPhone, member: coupon && coupon.audience !== "all" ? await L.isMember(tx, billPhone) : false } as const;
  const base = computeBill(billInput);
  if (coupon && base.couponOk && !base.couponOk.ok) throw new ApiError(`Coupon ${coupon.code}: ${base.couponOk.reason}.`);
  // loyalty points / reward asked for at the till — checked against the database, never the browser's numbers
  const plan = await L.planBill(tx, {
    phone: phone || s?.customerPhone || "",
    items,
    subtotal: base.subtotal,
    afterManual: Math.max(0, base.subtotal - base.couponDiscount - base.manualDiscount),
    couponApplied: base.couponDiscount > 0,
    manualApplied: base.manualDiscount > 0,
    points: a.loyaltyPoints,
    rewardId: a.rewardId,
    voucherRef: a.voucherRef,
  });
  const calc = plan ? computeBill({ ...billInput, rewardDiscount: plan.rewardDiscount, pointsDiscount: plan.pointsDiscount }) : base;
  // free gifts must be backed by a bill offer or the reward chosen; their labels are filled in here, never trusted from the browser
  const gifted = await L.checkGifts(tx, items, Math.max(0, base.subtotal - base.couponDiscount - base.manualDiscount), plan, phone || s?.customerPhone || "", now);
  items.splice(0, items.length, ...gifted.items);

  const payment: PayMethod = a.payment === "upi" || a.payment === "card" || a.payment === "split" ? a.payment : "cash";
  const got = num(a.received);
  const received = payment === "cash" && got > 0 ? round2(got) : calc.total;
  if (received < calc.total) throw new ApiError(`Amount received is less than the grand total.`);

  // How the total was tendered (change is never part of it). A split names each part —
  // any two or all three of cash, UPI and card.
  let cashAmount = payment === "cash" ? calc.total : 0;
  let cardAmount = payment === "card" ? calc.total : 0;
  let upiAmount = payment === "upi" ? calc.total : 0;
  if (payment === "split") {
    const part = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : round2(num(v)));
    cashAmount = part(a.cashAmount);
    upiAmount = part(a.upiAmount);
    cardAmount = part(a.cardAmount);
    if (![cashAmount, upiAmount, cardAmount].every((n) => n >= 0)) throw new ApiError("Split amounts can't be negative.");
    if ([cashAmount, upiAmount, cardAmount].filter((n) => n > 0).length < 2) throw new ApiError("Split payment needs amounts for at least two of cash, UPI and card.");
    if (round2(cashAmount + upiAmount + cardAmount) !== calc.total) throw new ApiError("The split amounts must add up to the grand total.");
  }

  // Stock: tab orders already took stock when they were placed, so only the
  // difference between what's billed and what was ordered moves stock now.
  const delta = new Map<string, number>();
  for (const it of items) if (it.productId && !it.free) delta.set(it.productId, (delta.get(it.productId) ?? 0) + it.qty);
  if (s) {
    const placed = await tx.select().from(orders).where(eq(orders.sessionId, s.id));
    for (const o of placed) {
      if (o.status === "cancelled") continue;
      for (const it of o.items) if (it.productId) delta.set(it.productId, (delta.get(it.productId) ?? 0) - it.qty);
    }
  }

  let invoiceNo = "";
  do invoiceNo = `INV-${new Date(now).getFullYear()}-${code(7)}`;
  while (await first(tx.select({ id: bills.id }).from(bills).where(eq(bills.invoiceNo, invoiceNo))));

  const out = new Map<string, number>();
  const back = new Map<string, number>();
  for (const [pid, d] of delta) (d > 0 ? out : back).set(pid, -d);
  await moveStock(tx, out, { type: "sale", ref: invoiceNo, note: "Sold at billing" }, now);
  await moveStock(tx, back, { type: "adjustment", ref: invoiceNo, note: "Billed fewer than ordered" }, now);
  // free gifts leave the same stock as anything sold, but are recorded as their own kind of movement
  const who = [str(a.customerName, 60) || s?.customerName || "Walk-in customer", billPhone].filter(Boolean).join(" ");
  for (const it of items) {
    if (!(it.free && it.productId)) continue;
    const note = `FREE GIFT / LOYALTY REWARD · ${it.gift || "Free gift"} · ${who} · by ${actor}`;
    const moved = await moveStock(tx, new Map([[it.productId, -it.qty]]), { type: "gift", ref: invoiceNo, note }, now);
    // an item whose stock isn't counted has nothing to reduce, but the gift is still recorded in the Stock movement log
    if (moved[0] && moved[0].new_stock === null) await tx.insert(stockMovements).values({ id: uid(), productId: it.productId, productName: moved[0].name, type: "gift", qty: -it.qty, balanceAfter: 0, note: `${note} · stock not counted for this item`, ref: invoiceNo, createdAt: now });
  }

  const [bill] = await tx
    .insert(bills)
    .values({
      id: uid(),
      invoiceNo,
      source,
      sessionId: s?.id ?? null,
      customerName: str(a.customerName, 60) || s?.customerName || (source === "counter" ? "Walk-in customer" : ""),
      customerPhone: phone || s?.customerPhone || "",
      items,
      itemCount: calc.itemCount,
      subtotal: calc.subtotal,
      couponCode: coupon && calc.couponDiscount > 0 ? coupon.code : null,
      couponPercent: coupon && calc.couponDiscount > 0 ? coupon.percent : 0,
      couponDiscount: calc.couponDiscount,
      couponSource: coupon && calc.couponDiscount > 0 ? (s?.couponCode === coupon.code ? "guest" : "staff") : null,
      manualType,
      manualValue,
      manualDiscount: calc.manualDiscount,
      discount: calc.discount,
      extra: calc.extra,
      isGst,
      gstPercent: calc.gstPercent,
      taxableAmount: calc.taxable,
      gstAmount: calc.gstAmount,
      total: calc.total,
      payment,
      cashAmount,
      upiAmount,
      cardAmount,
      upiChannel: upiAmount > 0 ? upiChannelOf(a.upiChannel) : "",
      received,
      change: round2(received - calc.total),
      status: "completed",
      loyaltyCustomerId: plan?.customer.id ?? null,
      pointsRedeemed: plan && calc.pointsDiscount > 0 ? plan.points : 0,
      pointsDiscount: calc.pointsDiscount,
      rewardRef: plan?.reward && "voucher" in plan.reward ? plan.reward.voucher.ref : null,
      rewardName: plan?.rewardName ?? null,
      rewardDiscount: calc.rewardDiscount,
      pointsEarned: 0,
      createdAt: now,
    })
    .returning();
  if (bill.couponCode && coupon) await tx.update(coupons).set({ used: sql`${coupons.used} + 1` }).where(eq(coupons.id, coupon.id));
  // spend, earn, stamp — in this same transaction, so a failed bill leaves points untouched
  const loyal = await L.afterBill(tx, bill, plan, actor);
  for (const u of gifted.offerUse) await tx.update(giftOffers).set({ given: sql`${giftOffers.given} + ${u.times}` }).where(eq(giftOffers.id, u.id));

  if (s) {
    // the tab's phone is its key, so a different one typed at billing goes on the bill only
    await tx.update(sessions).set({ status: "closed", closedAt: now, billId: bill.id, customerName: bill.customerName }).where(eq(sessions.id, s.id));
    await tx
      .update(orders)
      .set({ status: "served", updatedAt: now })
      .where(and(eq(orders.sessionId, s.id), inArray(orders.status, ["new", "preparing"])));
  }
  return loyal.customerId ? (await first(tx.select().from(bills).where(eq(bills.id, bill.id)))) ?? bill : bill;
}

/** The saved spelling of a category, adding it to the shop's list if it is new. */
async function ensureExpenseCategory(tx: Tx, name: string, now: number): Promise<string> {
  const hit = await first(tx.select().from(expenseCategories).where(sql`lower(${expenseCategories.name}) = ${name.toLowerCase()}`));
  if (hit) return hit.name;
  await tx.insert(expenseCategories).values({ id: uid(), name, createdAt: now }).onConflictDoNothing();
  return name;
}

export function adminOp(op: string, a: Args, role = "admin") {
  return mutate(async (tx) => {
    const result = await runOp(tx, op, a, role);
    await logActivity(tx, op, a, role, result);
    return result;
  });
}

/** Writes who did what to the activity log, in the same transaction as the change itself. */
async function logActivity(tx: Tx, op: string, a: Args, role: string, result: unknown) {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const pending = r.pendingApproval === true;
  const inner = (pending ? (r.request as Record<string, unknown> | undefined) : r) ?? {};
  let target = "";
  for (const k of ["targetName", "invoiceNo", "name", "code", "title", "customerName"]) {
    const v = inner[k];
    if (typeof v === "string" && v) {
      target = v;
      break;
    }
  }
  if (!target) for (const k of ["name", "code", "title"]) if (typeof a[k] === "string" && a[k]) { target = String(a[k]); break; }
  await tx.insert(activityLog).values({ id: uid(), actor: role === "admin" ? "admin" : "staff", action: op, target: target.slice(0, 120), outcome: pending ? "requested" : "done", createdAt: Date.now() });
}

export async function activityPage() {
  return db.select().from(activityLog).orderBy(desc(activityLog.createdAt)).limit(2000);
}

/** Edits staff may ask for, but that only take effect with the admin's say-so: when staff run
    one of these on an existing record it is parked as a request and runs (through runOp, as
    the admin) once approved. `always` = the op only ever edits an existing record; `create` =
    with no id it makes a new record, which staff may still do directly (otherwise that is
    admin-only). */
const APPROVAL_OPS: Record<string, { always?: boolean; create?: boolean }> = {
  "ingredient.save": { create: true },
  "product.save": { create: true },
  "bill.edit": { always: true },
  "loyalty.update": { always: true },
  "loyalty.status": { always: true },
};

/** Only plain, short values — what the admin compares in the popup. */
const plain = (row: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 200)));

async function describeTarget(tx: Tx, op: string, id: string): Promise<{ name: string; before: Record<string, unknown> }> {
  switch (op) {
    case "ingredient.save": {
      const r = await must(tx.select().from(ingredients).where(eq(ingredients.id, id)), "Ingredient");
      return { name: r.name, before: plain(r) };
    }
    case "product.save": {
      const r = await must(tx.select().from(products).where(eq(products.id, id)), "Product");
      return { name: r.name, before: plain(r) };
    }
    case "bill.edit": {
      const r = await must(tx.select().from(bills).where(eq(bills.id, id)), "Bill");
      return { name: r.invoiceNo, before: { ...plain(r), items: r.items } };
    }
    default: {
      const r = await must(tx.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.id, id)), "Member");
      return { name: r.name, before: plain(r) };
    }
  }
}

/** The time of day of a moment in the shop's timezone, as HH:MM:SS. */
const shopClock = (at: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(at);

/** What a "bill.edit" changes on a bill: who it was for, its date, its items and charges (totals are
    worked out again), and how it was paid. Returns the changes plus the stock to put back or take
    out for items whose quantity changed. Items and amounts of a bill that earned or used loyalty
    points can't be edited — void it and bill again — and nothing on a voided bill's amounts can.
    Throws if the edit isn't allowed. */
/** The way a UPI payment arrived, if it is one we know ("" otherwise). */
const upiChannelOf = (v: unknown): UpiChannel | "" => UPI_CHANNELS.find((c) => c.key === v)?.key ?? "";

export function billEditPatch(b: Bill, a: Args) {
  const patch: Partial<typeof bills.$inferInsert> = {};
  const deltas = new Map<string, number>();
  const loyaltyLocked = b.items.some((i) => i.free) || !!b.loyaltyCustomerId || b.pointsEarned > 0 || b.pointsRedeemed > 0 || b.rewardDiscount > 0 || b.pointsDiscount > 0;

  if (a.customerName !== undefined) {
    const n = str(a.customerName, 80);
    if (n !== b.customerName) patch.customerName = n;
  }
  if (a.customerPhone !== undefined) {
    const ph = mobile(a.customerPhone);
    if (ph === null) throw new ApiError("Customer mobile should be a 10-digit number.");
    if (ph !== b.customerPhone) {
      if (loyaltyLocked) throw new ApiError("This bill earned or used loyalty points for its customer, so the mobile can't be changed. Void it and bill again instead.");
      patch.customerPhone = ph;
    }
  }
  if (a.invoiceDate !== undefined) {
    const d = str(a.invoiceDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ApiError("Pick a valid invoice date.");
    if (d > shopToday()) throw new ApiError("The invoice date can't be in the future.");
    if (d !== shopToday(b.createdAt)) {
      if (loyaltyLocked) throw new ApiError("This bill earned or used loyalty points, so its date can't be changed.");
      const ts = Date.parse(`${d}T${shopClock(b.createdAt)}+05:30`);
      if (!Number.isFinite(ts)) throw new ApiError("Pick a valid invoice date.");
      patch.createdAt = ts;
    }
  }

  // ---- items, discount, charges and GST: totals are worked out again ----
  let total = b.total;
  if (a.items !== undefined) {
    if (!Array.isArray(a.items)) throw new ApiError("Add at least one item to the invoice.");
    const items: OrderItem[] = [];
    for (const raw of a.items as Record<string, unknown>[]) {
      const name = str(raw?.name, 120);
      const price = round2(num(raw?.price));
      const qty = Math.floor(num(raw?.qty));
      if (!name) throw new ApiError("Every item needs a name.");
      if (!(price >= 0)) throw new ApiError(`Enter a price for "${name}".`);
      if (!(qty >= 1 && qty <= 999)) throw new ApiError(`Check the quantity for "${name}".`);
      const pid = str(raw?.productId, 40);
      items.push({ productId: pid || null, name, price, qty });
    }
    if (!items.length) throw new ApiError("Add at least one item to the invoice.");
    const manualType: "amount" | "percent" = a.manualType === "percent" ? "percent" : "amount";
    const manualValue = Math.max(0, num(a.manualValue) || 0);
    const extra = Math.max(0, round2(num(a.extra) || 0));
    const isGst = a.isGst === true;
    const gstRaw = num(a.gstPercent);
    if (isGst && !(gstRaw >= 0 && gstRaw <= 100)) throw new ApiError("GST should be between 0 and 100%.");
    const same =
      items.length === b.items.length &&
      items.every((i, k) => i.name === b.items[k].name && i.price === b.items[k].price && i.qty === b.items[k].qty && (i.productId ?? null) === (b.items[k].productId ?? null)) &&
      manualType === b.manualType && manualValue === b.manualValue && extra === b.extra && isGst === b.isGst && (!isGst || round2(gstRaw) === b.gstPercent);
    if (!same) {
      if (b.status !== "completed") throw new ApiError("A voided bill's items and amounts can't be changed.");
      if (loyaltyLocked) throw new ApiError("This bill earned or used loyalty points, so its items and amounts can't be edited. Void it and bill again instead.");
      // the coupon on the bill stays, at the same percent, on the new subtotal
      const coupon: Coupon | null = b.couponCode ? { id: "", audience: "all", code: b.couponCode, percent: b.couponPercent, minOrder: 0, expiresAt: null, limit: null, used: 0, active: true, restricted: false, phones: [], sent: 0, createdAt: 0 } : null;
      const c = computeBill({ items, coupon, manualType, manualValue, extra, gst: isGst, gstPercent: isGst ? gstRaw : 0 });
      Object.assign(patch, {
        items,
        itemCount: c.itemCount,
        subtotal: c.subtotal,
        couponDiscount: c.couponDiscount,
        manualType,
        manualValue,
        manualDiscount: c.manualDiscount,
        discount: c.discount,
        extra: c.extra,
        isGst,
        gstPercent: c.gstPercent,
        taxableAmount: c.taxable,
        gstAmount: c.gstAmount,
        total: c.total,
      });
      total = c.total;
      // stock: whatever the old items put back and the new items take out, net per product
      for (const [k, v] of tally(b.items, 1)) deltas.set(k, (deltas.get(k) ?? 0) + v);
      for (const [k, v] of tally(items, -1)) deltas.set(k, (deltas.get(k) ?? 0) + v);
    }
  }

  // ---- how it was paid (and re-split when the total moved) ----
  const totalChanged = total !== b.total;
  if (a.payment !== undefined || totalChanged) {
    const pay: PayMethod = a.payment === undefined ? b.payment : a.payment === "upi" || a.payment === "card" || a.payment === "split" ? a.payment : "cash";
    let cash = pay === "cash" ? total : 0;
    let upi = pay === "upi" ? total : 0;
    let card = pay === "card" ? total : 0;
    if (pay === "split") {
      cash = round2(Math.max(0, num(a.cashAmount) || 0));
      upi = round2(Math.max(0, num(a.upiAmount) || 0));
      card = round2(Math.max(0, num(a.cardAmount) || 0));
      if (Math.abs(cash + upi + card - total) > 0.01) throw new ApiError(`The split amounts must add up to the bill total (${total}).`);
      if ([cash, upi, card].filter((n) => n > 0).length < 2) throw new ApiError("A split bill needs two or more payment methods.");
    }
    if (pay !== b.payment || totalChanged || cash !== b.cashAmount || upi !== b.upiAmount || card !== b.cardAmount) {
      if (b.status !== "completed") throw new ApiError("A voided bill's payment can't be changed.");
      patch.payment = pay;
      patch.cashAmount = cash;
      patch.upiAmount = upi;
      patch.cardAmount = card;
      if (pay !== b.payment || totalChanged) {
        patch.received = total;
        patch.change = 0;
      }
    }
  }
  // how the UPI part arrived: kept only while something is paid by UPI
  const upiNow = (patch.upiAmount ?? b.upiAmount) > 0;
  const channel = upiNow ? (a.upiChannel !== undefined ? upiChannelOf(a.upiChannel) : b.upiChannel) : "";
  if (channel !== b.upiChannel) patch.upiChannel = channel;
  return { patch, deltas };
}

async function requestApproval(tx: Tx, op: string, a: Args, role: string, now: number) {
  const id = str(a.id, 40);
  const { name, before } = await describeTarget(tx, op, id);
  if (op === "ingredient.save" && !str(a.name, 80)) throw new ApiError("Give the ingredient a name.");
  if (op === "bill.edit") billEditPatch(await must(tx.select().from(bills).where(eq(bills.id, id)), "Bill"), a); // refuse a bad edit now, not when the admin gets to it
  const payload: Record<string, unknown> = Object.fromEntries(Object.entries(a).filter(([k]) => k !== "op"));
  if (op === "product.save") delete payload.loyaltyPoints; // points per item is the admin's call alone
  // asking again about the same thing replaces the earlier ask — except points adjustments, which each count
  const pending = await first(tx.select().from(approvalRequests).where(and(eq(approvalRequests.targetId, id), eq(approvalRequests.kind, op), eq(approvalRequests.status, "pending"))));
  if (pending) {
    const [x] = await tx.update(approvalRequests).set({ payload, before, requestedBy: role, createdAt: now }).where(eq(approvalRequests.id, pending.id)).returning();
    return { pendingApproval: true, request: x };
  }
  const [x] = await tx.insert(approvalRequests).values({ id: uid(), kind: op, targetId: id, targetName: name, payload, before, requestedBy: role, status: "pending", decidedBy: "", createdAt: now, decidedAt: null }).returning();
  return { pendingApproval: true, request: x };
}

export async function runOp(tx: Tx, op: string, a: Args, role: string): Promise<unknown> {
  {
    const now = Date.now();
    const id = str(a.id, 40);
    const gate = role !== "admin" ? APPROVAL_OPS[op] : undefined;
    if (gate) {
      if (gate.always || id) return requestApproval(tx, op, a, role, now);
      if (!gate.create) throw new ApiError("Only the admin can do that.", 403);
    }
    switch (op) {
      case "bill.edit": {
        const b = await must(tx.select().from(bills).where(eq(bills.id, id)), "Bill");
        const { patch, deltas } = billEditPatch(b, a);
        if (!Object.keys(patch).length) return b;
        const [x] = await tx.update(bills).set(patch).where(eq(bills.id, id)).returning();
        if (deltas.size) {
          const out = new Map([...deltas].filter(([, d]) => d < 0));
          const back = new Map([...deltas].filter(([, d]) => d > 0));
          await moveStock(tx, out, { type: "sale", ref: b.invoiceNo, note: "Bill edited — more sold" }, now);
          await moveStock(tx, back, { type: "adjustment", ref: b.invoiceNo, note: "Bill edited — fewer sold" }, now);
        }
        return x;
      }
      case "approval.approve":
      case "approval.reject": {
        if (role !== "admin") throw new ApiError("Only the admin can do that.", 403);
        const req = await must(tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)), "Request");
        if (req.status !== "pending") throw new ApiError("That request has already been decided.");
        const approve = op === "approval.approve";
        // the change itself runs as the admin, in this same transaction: if it can't be applied, nothing is recorded
        if (approve) await runOp(tx, req.kind, { ...req.payload, id: req.targetId }, "admin");
        const [x] = await tx.update(approvalRequests).set({ status: approve ? "approved" : "rejected", decidedBy: role, decidedAt: now }).where(eq(approvalRequests.id, id)).returning();
        return x;
      }
      /* ---------- settings ---------- */
      case "settings.update": {
        const patch: Record<string, unknown> = {};
        if (a.publicUrl !== undefined) {
          const url = str(a.publicUrl, 200).replace(/\/+$/, "");
          if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new ApiError("Public URL should start with http:// or https://");
          patch.publicUrl = url;
        }
        if (a.shopName !== undefined) {
          const name = str(a.shopName, 60);
          if (name) patch.shopName = name;
        }
        if (a.upiId !== undefined) {
          const v = str(a.upiId, 80).toLowerCase();
          if (v && !/^[a-z0-9._-]{2,64}@[a-z0-9.-]{2,32}$/.test(v)) throw new ApiError("The UPI ID should look like name@bank.");
          patch.upiId = v;
        }
        if (a.upiName !== undefined) patch.upiName = str(a.upiName, 60);
        if (a.upiPhone !== undefined) {
          const raw = str(a.upiPhone, 24);
          const v = raw ? mobile(raw) : "";
          if (v === null || (raw && !v)) throw new ApiError("The GPay number should be a 10-digit mobile number.");
          patch.upiPhone = v;
        }
        if (a.upiQrMinutes !== undefined) patch.upiQrMinutes = int(a.upiQrMinutes, 1, 30, 5);
        if (a.ownerName !== undefined) patch.ownerName = str(a.ownerName, 80);
        if (a.location !== undefined) patch.location = str(a.location, 120);
        for (const k of ["address", "address2"] as const) {
          if (a[k] !== undefined) {
            patch[k] = (typeof a[k] === "string" ? (a[k] as string) : "")
              .split(/\r?\n/)
              .map((l) => l.trim().slice(0, 100))
              .filter(Boolean)
              .slice(0, 8)
              .join("\n");
          }
        }
        for (const k of ["whatsapp1", "whatsapp2", "customerCare"] as const) {
          if (a[k] !== undefined) {
            const v = str(a[k], 30);
            if (v && v.replace(/\D/g, "").length < 7) throw new ApiError("That phone number doesn't look right.");
            patch[k] = v;
          }
        }
        if (a.logoUrl !== undefined && !(typeof a.logoUrl === "string" && a.logoUrl.startsWith("/shop-logo"))) {
          const v = typeof a.logoUrl === "string" ? a.logoUrl.trim() : "";
          if (v === "/logo.png") patch.logoUrl = v; // the built-in 8:2 logo
          else {
          const isUpload = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
          if (v && !isUpload && !/^https?:\/\/[^\s/]+/i.test(v)) throw new ApiError("Logo should be a PNG/JPG file or an http(s) link.");
          if (isUpload && v.length > 150_000) throw new ApiError("That logo image is too large — pick a smaller one.");
          if (!isUpload && v.length > 500) throw new ApiError("That logo link is too long.");
          patch.logoUrl = v;
          }
        }
        for (const k of ["mapsUrl"] as const) {
          if (a[k] !== undefined) {
            const v = str(a[k], 500);
            if (v && !/^https?:\/\/[^\s/]+/i.test(v)) throw new ApiError("Links should start with http:// or https://");
            patch[k] = v;
          }
        }
        if (a.email !== undefined) {
          const email = str(a.email, 120);
          if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) throw new ApiError("That email address doesn't look right.");
          patch.email = email;
        }
        if (a.walkInsOnly !== undefined) patch.walkInsOnly = a.walkInsOnly === true;
        if (a.kotEnabled !== undefined) patch.kotEnabled = a.kotEnabled === true;
        if (a.orderingEnabled !== undefined) patch.orderingEnabled = a.orderingEnabled === true;
        if (Object.keys(patch).length) await tx.update(settings).set(patch).where(eq(settings.id, 1));
        return null;
      }

      /* ---------- users ---------- */
      case "user.promote": {
        const m = mobile(a.mobile);
        if (!m) throw new ApiError("Enter a valid 10-digit mobile number.");
        if (await first(tx.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.mobile, m)))) throw new ApiError("That number already has admin access.");
        const password = typeof a.password === "string" ? a.password : "";
        if (password.length < 6) throw new ApiError("Give them a password of at least 6 characters.");
        const email = str(a.email, 120);
        if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) throw new ApiError("That email address doesn't look right.");
        const [u] = await tx
          .insert(staffUsers)
          .values({ id: uid(), name: str(a.name, 60) || "Unknown", mobile: m, email, passwordHash: hashPassword(password), createdAt: now })
          .returning();
        return publicUser(u);
      }
      case "user.demote": {
        const u = await must(tx.select().from(staffUsers).where(eq(staffUsers.id, id)), "User");
        await tx.delete(staffUsers).where(eq(staffUsers.id, u.id));
        return null;
      }

      /* ---------- tabs ---------- */
      case "tab.approve": {
        // staff set the final amount at billing (discounts, GST, extra charges) and approve it: the guest's phone now shows the payment QR for exactly this
        const s = await must(tx.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.status, "open"))), "Tab");
        const amount = round2(num(a.amount));
        if (!(amount > 0 && amount <= 10_000_000)) throw new ApiError("Enter a bill amount to approve.");
        const [x] = await tx.update(sessions).set({ billApprovedAt: now, approvedAmount: amount, billRequestedAt: s.billRequestedAt ?? now, payClaimedAt: null, payClaimedAmount: 0, payClaimedRef: "" }).where(eq(sessions.id, s.id)).returning();
        return x;
      }
      case "tab.unapprove": {
        const s = await must(tx.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.status, "open"))), "Tab");
        await tx.update(sessions).set({ billApprovedAt: null, approvedAmount: 0, payClaimedAt: null, payClaimedAmount: 0, payClaimedRef: "" }).where(eq(sessions.id, s.id));
        return null;
      }
      case "tab.payclaim.clear": {
        // staff looked in their UPI app and the money isn't there: take the guest's "I've paid" off the tab
        const s = await must(tx.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.status, "open"))), "Tab");
        await tx.update(sessions).set({ payClaimedAt: null, payClaimedAmount: 0, payClaimedRef: "" }).where(eq(sessions.id, s.id));
        return null;
      }
      case "tab.clear": {
        const s = await must(tx.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.status, "open"))), "Tab");
        await tx.update(sessions).set({ status: "void", closedAt: now }).where(eq(sessions.id, s.id));
        const live = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.sessionId, s.id), inArray(orders.status, ["new", "preparing"])));
        if (live.length) {
          await tx.update(orders).set({ status: "cancelled", updatedAt: now }).where(inArray(orders.id, live.map((o) => o.id)));
          await restock(tx, live.flatMap((o) => o.items), { type: "cancelled_order", ref: `${s.customerName || s.customerPhone} cleared`, note: "Tab cleared by staff" });
        }
        return null;
      }
      case "session.update": {
        const s = await must(tx.select().from(sessions).where(eq(sessions.id, id)), "Tab");
        const phone = phoneOf(a.customerPhone);
        const clash = s.status === "open" && phone !== s.customerPhone ? await openSession(tx, phone) : null;
        if (clash) throw new ApiError("That number already has an open tab.");
        const customerName = str(a.customerName, 60);
        const [u] = await tx.update(sessions).set({ customerName, customerPhone: phone }).where(eq(sessions.id, s.id)).returning();
        await tx.update(orders).set({ customerName, customerPhone: phone }).where(eq(orders.sessionId, s.id));
        return u;
      }

      /* ---------- orders ---------- */
      case "order.create": {
        return addOrder(tx, a, { fromCustomer: false });
      }
      case "order.status": {
        const o = await must(tx.select().from(orders).where(eq(orders.id, id)), "Order");
        const next = a.status as OrderStatus;
        if (!["new", "preparing", "served", "cancelled"].includes(next)) throw new ApiError("Unknown status.");
        if (o.status === "cancelled" && next !== "cancelled") throw new ApiError("A cancelled order can't be reopened — ask the guest to order again.");
        const s = await first(tx.select().from(sessions).where(eq(sessions.id, o.sessionId)));
        if (s && s.status !== "open") throw new ApiError("This tab is already closed.");
        if (next === "cancelled" && o.status !== "cancelled") await restock(tx, o.items, { type: "cancelled_order", ref: `Order #${o.no}`, note: "Order cancelled" });
        const [u] = await tx.update(orders).set({ status: next, updatedAt: now }).where(eq(orders.id, o.id)).returning();
        return u;
      }

      /* ---------- inventory ---------- */
      case "product.save":
        return saveProduct(tx, a, role);
      case "product.delete": {
        const p = await must(tx.select().from(products).where(eq(products.id, id)), "Product");
        /* The product's stock history goes with it, so the Stock movement log doesn't keep lines for something
           that no longer exists. Past orders and bills keep their own copy of what was sold (they are money
           records), and the Activity log still shows that the product was deleted. */
        await tx.delete(stockMovements).where(eq(stockMovements.productId, p.id));
        // nothing is left pointing at the deleted product: a free-item reward for it is switched off, waiting
        // free-item vouchers for it are cancelled, and campaigns stop targeting it
        await tx.update(loyaltyRewards).set({ productId: null, active: false }).where(eq(loyaltyRewards.productId, p.id));
        await tx.update(loyaltyVouchers).set({ status: "cancelled", note: "The product was deleted" }).where(and(eq(loyaltyVouchers.productId, p.id), eq(loyaltyVouchers.status, "issued")));
        await tx.update(loyaltyCampaigns).set({ productIds: sql`${loyaltyCampaigns.productIds} - ${p.id}::text` }).where(sql`${loyaltyCampaigns.productIds} ? ${p.id}`);
        await tx.delete(products).where(eq(products.id, p.id));
        return null;
      }
      case "product.stock": {
        /* The +/- steppers and the Stock in/out form only ever send a delta. That takes
           two statements (update-and-read-back, then the ledger row) instead of the
           read, update and insert below — every statement is a round trip to the
           database, and this is the busiest button in Inventory. A product whose stock
           isn't tracked yet falls through to the full path, which turns tracking on. */
        const delta = a.set === undefined ? int(a.delta, -99999, 99999, 0) : 0;
        if (delta !== 0) {
          const note = str(a.note, 120);
          const type: StockMoveType = delta > 0 ? "added" : a.move === "removed" ? "removed" : "adjustment";
          const fallback: Record<string, string> = { added: "Stock added", removed: "Stock removed", adjustment: "Stock corrected" };
          const [hit] = await moveStock(tx, new Map([[id, delta]]), { type, note: note || fallback[type] }, now);
          if (hit && hit.new_stock !== null) return { id: hit.id, stock: hit.new_stock };
        }
        const p = await must(tx.select().from(products).where(eq(products.id, id)), "Product");
        let stock: number | null;
        if (a.set === null) stock = null;
        else if (a.set !== undefined) stock = int(a.set, 0, 999999, 0);
        else stock = Math.max(0, (p.stock ?? 0) + int(a.delta, -99999, 99999, 0));
        const [u] = await tx.update(products).set({ stock, updatedAt: now }).where(eq(products.id, p.id)).returning();
        const note = str(a.note, 120);
        if (stock !== null && stock !== (p.stock ?? 0)) {
          const diff = stock - (p.stock ?? 0);
          // the Inventory "Stock in / out" form says which it is; the +/- steppers and typed totals don't
          const type: StockMoveType =
            p.stock === null ? "initial" : a.move === "added" && diff > 0 ? "added" : a.move === "removed" && diff < 0 ? "removed" : a.set === undefined && diff > 0 ? "added" : "adjustment";
          const fallback = { initial: "Stock tracking turned on", added: "Stock added", removed: "Stock removed", adjustment: "Stock corrected" } as Record<string, string>;
          await logMove(tx, u, { type, note: note || fallback[type] }, diff, stock, now);
        }
        return u;
      }
      case "category.rename": {
        const from = str(a.from, 40);
        const to = str(a.to, 40);
        if (!from || !to) throw new ApiError("Enter a category name.");
        await tx.update(products).set({ category: to, updatedAt: now }).where(eq(products.category, from));
        await tx.update(productCategories).set({ name: to }).where(eq(productCategories.name, from));
        return { from, to };
      }
      case "category.add": {
        const name = str(a.name, 40);
        if (!name) throw new ApiError("Enter a category name.");
        const taken = (await tx.select({ n: products.category }).from(products).groupBy(products.category)).some((r) => r.n.toLowerCase() === name.toLowerCase());
        const clash = await first(tx.select().from(productCategories).where(sql`lower(${productCategories.name}) = lower(${name})`));
        if (taken || clash) throw new ApiError(`"${clash?.name ?? name}" is already a category.`);
        const [x] = await tx.insert(productCategories).values({ id: uid(), name, createdAt: now }).returning();
        return x;
      }
      case "category.delete": {
        const name = str(a.name, 40);
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.category, name));
        if (n) throw new ApiError(`${name} still has ${n} product${n === 1 ? "" : "s"} — move or delete them first.`);
        await tx.delete(productCategories).where(eq(productCategories.name, name));
        return null;
      }
      case "product.toggle": {
        const p = await must(tx.select().from(products).where(eq(products.id, id)), "Product");
        const [u] = await tx.update(products).set({ active: !p.active, updatedAt: now }).where(eq(products.id, p.id)).returning();
        return u;
      }

      /* ---------- raw ingredients (sugar, milk, flour…) ---------- */
      case "ingredient.save": {
        const name = str(a.name, 80);
        const unit: IngredientUnit = INGREDIENT_UNITS.find((u) => u.key === a.unit)?.key ?? "g";
        const lowAt = Math.max(0, num(a.lowAt) || 0);
        if (!name) throw new ApiError("Give the ingredient a name.");
        /* The unique index is case-insensitive and covers inactive rows too, so an
           ingredient that was removed earlier still blocks the name. On an add that
           hits a soft-deleted row we revive it (keeping its ledger history); on one
           that hits an active row we tell the user the name is taken. */
        const existing = await first(tx.select().from(ingredients).where(sql`lower(${ingredients.name}) = lower(${name})`));
        if (id) {
          await must(tx.select().from(ingredients).where(eq(ingredients.id, id)), "Ingredient");
          if (existing && existing.id !== id) throw new ApiError(`Another ingredient is already called "${existing.name}".`);
          const [u] = await tx.update(ingredients).set({ name, unit, lowAt, updatedAt: now }).where(eq(ingredients.id, id)).returning();
          return u;
        }
        if (existing && existing.active) throw new ApiError(`"${existing.name}" is already on the list.`);
        if (existing) {
          const [u] = await tx.update(ingredients).set({ name, unit, lowAt, active: true, updatedAt: now }).where(eq(ingredients.id, existing.id)).returning();
          return u;
        }
        const [u] = await tx
          .insert(ingredients)
          .values({ id: uid(), name, unit, stock: 0, costPerUnit: 0, lowAt, active: true, createdAt: now, updatedAt: now })
          .returning();
        return u;
      }
      case "ingredient.delete": {
        await must(tx.select().from(ingredients).where(eq(ingredients.id, id)), "Ingredient");
        /* The ledger stays — rows carry their own ingredientName — but the active flag
           hides the ingredient from the add/batch pickers. */
        const [u] = await tx.update(ingredients).set({ active: false, updatedAt: now }).where(eq(ingredients.id, id)).returning();
        return u;
      }
      case "ingredient.purchase": {
        /* Buy more of the ingredient: adds to stock and updates the running
           weighted-average cost per unit. qty is in the ingredient's own unit (g/ml),
           cost is the ₹ for the whole purchase. */
        const ing = await must(tx.select().from(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.active, true))), "Ingredient");
        const qty = round3(num(a.qty));
        const cost = round2(num(a.cost));
        if (!(qty > 0)) throw new ApiError(`Enter the quantity bought (${ing.unit}).`);
        if (!(cost >= 0)) throw new ApiError("Enter a valid cost.");
        const newStock = round3(ing.stock + qty);
        const newCost = round6((ing.stock * ing.costPerUnit + cost) / Math.max(newStock, 1e-6));
        const [u] = await tx.update(ingredients).set({ stock: newStock, costPerUnit: newCost, updatedAt: now }).where(eq(ingredients.id, ing.id)).returning();
        await tx.insert(ingredientMoves).values({
          id: uid(), ingredientId: ing.id, ingredientName: ing.name, unit: ing.unit,
          qty, type: "purchase", cost, balanceAfter: newStock, batchId: null,
          note: str(a.note, 200) || `Bought ${qty}${ing.unit} at ₹${cost}`, createdAt: now,
        });
        return u;
      }
      case "ingredient.waste": {
        /* Mark an ingredient as discarded — comes out of stock, costed at the current per-unit price. */
        const ing = await must(tx.select().from(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.active, true))), "Ingredient");
        const qty = round3(num(a.qty));
        if (!(qty > 0)) throw new ApiError(`Enter the quantity wasted (${ing.unit}).`);
        if (qty > ing.stock + 1e-6) throw new ApiError(`Only ${fmtQty(ing.stock)}${ing.unit} of ${ing.name} on hand.`);
        const newStock = round3(ing.stock - qty);
        const cost = round2(qty * ing.costPerUnit);
        const [u] = await tx.update(ingredients).set({ stock: newStock, updatedAt: now }).where(eq(ingredients.id, ing.id)).returning();
        await tx.insert(ingredientMoves).values({
          id: uid(), ingredientId: ing.id, ingredientName: ing.name, unit: ing.unit,
          qty: -qty, type: "waste", cost, balanceAfter: newStock, batchId: null,
          note: str(a.note, 200) || "Wasted / discarded", createdAt: now,
        });
        return u;
      }
      case "ingredient.adjust": {
        /* Manual stock correction (e.g. recount), kept out of waste totals. */
        const ing = await must(tx.select().from(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.active, true))), "Ingredient");
        const target = round3(num(a.stock));
        if (!(target >= 0)) throw new ApiError("Enter the current amount on hand.");
        const delta = round3(target - ing.stock);
        if (delta === 0) return ing;
        const [u] = await tx.update(ingredients).set({ stock: target, updatedAt: now }).where(eq(ingredients.id, ing.id)).returning();
        await tx.insert(ingredientMoves).values({
          id: uid(), ingredientId: ing.id, ingredientName: ing.name, unit: ing.unit,
          qty: delta, type: "adjust", cost: round2(Math.abs(delta) * ing.costPerUnit), balanceAfter: target, batchId: null,
          note: str(a.note, 200) || "Stock corrected", createdAt: now,
        });
        return u;
      }
      case "recipe.save": {
        /* A reusable ingredient list for a product — e.g. "Chocolate cake" with its
           sugar / milk / flour amounts. Picking a recipe fills the batch logger, so a
           repeat run is a one-click fill instead of a retype. */
        const name = str(a.name, 120);
        const note = str(a.note, 300);
        if (!name) throw new ApiError("Give the recipe a name.");
        const raw = Array.isArray(a.items) ? (a.items as Args[]) : [];
        const items: RecipeItem[] = [];
        for (const r of raw) {
          const iid = str(r?.ingredientId, 40);
          const qty = round3(num(r?.qty));
          if (!iid || !(qty > 0)) continue;
          items.push({ ingredientId: iid, qty, note: str(r?.note, 160) });
        }
        if (!items.length) throw new ApiError("Add at least one ingredient to the recipe.");
        const existing = await first(tx.select().from(recipes).where(sql`lower(${recipes.name}) = lower(${name})`));
        if (id) {
          await must(tx.select().from(recipes).where(eq(recipes.id, id)), "Recipe");
          if (existing && existing.id !== id) throw new ApiError(`Another recipe is already called "${existing.name}".`);
          const [u] = await tx.update(recipes).set({ name, note, items, updatedAt: now }).where(eq(recipes.id, id)).returning();
          return u;
        }
        if (existing) {
          /* Resaving a known name overwrites it — the user just edited the quantities
             and hit Save again, so they don't want two "Chocolate cake" recipes. */
          const [u] = await tx.update(recipes).set({ name, note, items, updatedAt: now }).where(eq(recipes.id, existing.id)).returning();
          return u;
        }
        const [u] = await tx.insert(recipes).values({ id: uid(), name, note, items, createdAt: now, updatedAt: now }).returning();
        return u;
      }
      case "recipe.delete": {
        await must(tx.select().from(recipes).where(eq(recipes.id, id)), "Recipe");
        await tx.delete(recipes).where(eq(recipes.id, id));
        return null;
      }
      case "batch.save": {
        /* One production run: name + a list of {ingredientId, qty, note} for raw stock
           CONSUMED, and an optional list of {productId, qty, note} for inventory items
           PRODUCED (added to sellable stock). All ingredient lines are checked against
           current stock first — a batch either books in full or not at all. */
        const name = str(a.name, 120);
        const note = str(a.note, 300);
        if (!name) throw new ApiError("Give the batch a name (e.g. \"Chocolate cake × 2\").");
        const rawUses = Array.isArray(a.uses) ? (a.uses as Args[]) : [];
        const rawProduces = Array.isArray(a.produces) ? (a.produces as Args[]) : [];
        const want: { ing: Ingredient; qty: number; note: string }[] = [];
        for (const r of rawUses) {
          const iid = str(r?.ingredientId, 40);
          const q = round3(num(r?.qty));
          if (!iid || !(q > 0)) continue;
          const ing = await must(tx.select().from(ingredients).where(and(eq(ingredients.id, iid), eq(ingredients.active, true))), "Ingredient");
          if (q > ing.stock + 1e-6) throw new ApiError(`Only ${fmtQty(ing.stock)}${ing.unit} of ${ing.name} on hand — asked for ${fmtQty(q)}${ing.unit}.`);
          want.push({ ing, qty: q, note: str(r?.note, 160) });
        }
        const made: { prod: Product; qty: number; note: string }[] = [];
        for (const r of rawProduces) {
          const pid = str(r?.productId, 40);
          const q = Math.floor(num(r?.qty));
          if (!pid || !(q > 0)) continue;
          const prod = await must(tx.select().from(products).where(eq(products.id, pid)), "Product");
          made.push({ prod, qty: q, note: str(r?.note, 160) });
        }
        if (!want.length && !made.length) throw new ApiError("Add at least one ingredient or inventory item to the batch.");
        let totalCost = 0;
        for (const w of want) totalCost = round2(totalCost + w.qty * w.ing.costPerUnit);
        const [b] = await tx.insert(batches).values({ id: uid(), name, note, totalCost, createdAt: now }).returning();
        for (const w of want) {
          const newStock = round3(w.ing.stock - w.qty);
          const cost = round2(w.qty * w.ing.costPerUnit);
          await tx.update(ingredients).set({ stock: newStock, updatedAt: now }).where(eq(ingredients.id, w.ing.id));
          await tx.insert(ingredientMoves).values({
            id: uid(), ingredientId: w.ing.id, ingredientName: w.ing.name, unit: w.ing.unit,
            qty: -w.qty, type: "use", cost, balanceAfter: newStock, batchId: b.id,
            note: w.note || `Used in ${name}`, createdAt: now,
          });
          /* Keep the ingredient's cached stock in sync for the next loop iteration
             in case the same ingredient appears twice in the batch. */
          w.ing.stock = newStock;
        }
        for (const m of made) {
          /* An untracked product starts tracking now at the produced qty; a tracked
             one is topped up. Either way we log a stock movement that points back
             at the batch via its name as `ref`. */
          const prev = m.prod.stock ?? 0;
          const newStock = prev + m.qty;
          await tx.update(products).set({ stock: newStock, updatedAt: now }).where(eq(products.id, m.prod.id));
          await logMove(
            tx,
            { id: m.prod.id, name: m.prod.name },
            { type: m.prod.stock === null ? "initial" : "added", ref: name, note: m.note || `Produced in ${name}` },
            m.qty,
            newStock,
            now,
          );
          m.prod.stock = newStock;
        }
        return b;
      }

      /* ---------- coupons ---------- */
      case "coupon.save":
        return saveCoupon(tx, a);
      case "coupon.send":
        return sendCoupon(tx, a);
      case "coupon.delete": {
        await must(tx.select().from(coupons).where(eq(coupons.id, id)), "Coupon");
        await tx.delete(coupons).where(eq(coupons.id, id));
        return null;
      }

      /* ---------- expenses ---------- */
      case "expense.save": {
        const title = str(a.title, 120);
        const amount = round2(num(a.amount));
        const date = str(a.expenseDate, 10) || shopToday(now);
        if (!title) throw new ApiError("Give the expense a title.");
        if (!(amount > 0)) throw new ApiError("Enter an amount greater than zero.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError("Pick a valid date.");
        const mode = String(a.paymentMode);
        const category = await ensureExpenseCategory(tx, str(a.category, 40) || "General", now);
        const fields = { title, category, amount, paymentMode: ["cash", "upi", "card", "bank"].includes(mode) ? mode : "cash", notes: str(a.notes, 300), expenseDate: date };
        if (id) {
          await must(tx.select().from(expenses).where(eq(expenses.id, id)), "Expense");
          const [x] = await tx.update(expenses).set(fields).where(eq(expenses.id, id)).returning();
          return x;
        }
        const [x] = await tx.insert(expenses).values({ id: uid(), ...fields, createdAt: now }).returning();
        return x;
      }
      /* ---------- suppliers & their invoices ---------- */
      case "supplier.save": {
        const name = str(a.name, 80);
        if (!name) throw new ApiError("Enter the supplier's name.");
        const phone = str(a.phone, 20).replace(/[^\d+\- ]/g, "");
        const email = str(a.email, 120);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("That email address doesn't look right.");
        const gstin = str(a.gstin, 15).toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin)) throw new ApiError("GSTIN should be 15 characters, like 33ABCDE1234F1Z5.");
        const clash = await first(tx.select().from(suppliers).where(sql`lower(${suppliers.name}) = lower(${name})`));
        if (clash && clash.id !== id) throw new ApiError(`${clash.name} is already on your supplier list.`);
        const fields = { name, contactPerson: str(a.contactPerson, 80), phone, email, gstin, address: str(a.address, 300), supplies: str(a.supplies, 160), notes: str(a.notes, 300), active: a.active !== false };
        if (id) {
          await must(tx.select().from(suppliers).where(eq(suppliers.id, id)), "Supplier");
          const [x] = await tx.update(suppliers).set(fields).where(eq(suppliers.id, id)).returning();
          return x;
        }
        const [x] = await tx.insert(suppliers).values({ id: uid(), ...fields, createdAt: now }).returning();
        return x;
      }
      case "supplier.delete": {
        await must(tx.select().from(suppliers).where(eq(suppliers.id, id)), "Supplier");
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(supplierInvoices).where(eq(supplierInvoices.supplierId, id));
        if (n) throw new ApiError(`This supplier has ${n} invoice${n === 1 ? "" : "s"} on record — delete those first, or mark the supplier inactive instead.`);
        await tx.delete(suppliers).where(eq(suppliers.id, id));
        return null;
      }
      case "supplierinv.save": {
        const sup = await must(tx.select().from(suppliers).where(eq(suppliers.id, str(a.supplierId, 40))), "Supplier");
        const invoiceNo = str(a.invoiceNo, 40);
        const date = str(a.invoiceDate, 10) || shopToday(now);
        const due = str(a.dueDate, 10);
        const price = round2(num(a.price));
        const gstPercent = round2(num(a.gstPercent));
        if (!invoiceNo) throw new ApiError("Enter the supplier's invoice number.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError("Pick a valid invoice date.");
        if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ApiError("Pick a valid due date.");
        if (!(price > 0)) throw new ApiError("Enter the price (before GST).");
        if (!(gstPercent >= 0 && gstPercent <= 100)) throw new ApiError("GST should be between 0 and 100%.");
        const gstAmount = round2((price * gstPercent) / 100);
        const total = round2(price + gstAmount);
        const paidAmount = round2(Math.max(0, num(a.paidAmount)));
        if (paidAmount > total + 0.005) throw new ApiError(`Paid amount can't be more than the invoice total (${total}).`);
        const dupe = await first(tx.select().from(supplierInvoices).where(and(eq(supplierInvoices.supplierId, sup.id), sql`lower(${supplierInvoices.invoiceNo}) = lower(${invoiceNo})`)));
        if (dupe && dupe.id !== id) throw new ApiError(`${sup.name} already has an invoice numbered ${invoiceNo}.`);
        const mode = String(a.paymentMode);
        const fields = { supplierId: sup.id, invoiceNo, invoiceDate: date, price, gstPercent, gstAmount, total, paidAmount, paymentMode: ["cash", "upi", "card", "bank", "cheque"].includes(mode) ? mode : "cash", dueDate: due, notes: str(a.notes, 300) };
        if (id) {
          await must(tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)), "Invoice");
          const [x] = await tx.update(supplierInvoices).set(fields).where(eq(supplierInvoices.id, id)).returning();
          return x;
        }
        const [x] = await tx.insert(supplierInvoices).values({ id: uid(), ...fields, createdAt: now }).returning();
        return x;
      }
      case "supplierinv.delete": {
        await must(tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)), "Invoice");
        await tx.delete(supplierInvoices).where(eq(supplierInvoices.id, id));
        return null;
      }
      case "expcat.save": {
        const name = str(a.name, 40);
        if (!name) throw new ApiError("Give the category a name.");
        const clash = await first(tx.select().from(expenseCategories).where(sql`lower(${expenseCategories.name}) = ${name.toLowerCase()}`));
        if (clash && clash.id !== id) throw new ApiError(`"${clash.name}" already exists.`);
        if (id) {
          const before = await must(tx.select().from(expenseCategories).where(eq(expenseCategories.id, id)), "Category");
          const [c] = await tx.update(expenseCategories).set({ name }).where(eq(expenseCategories.id, id)).returning();
          // expenses carry the category as text, so they follow the rename
          if (before.name !== name) await tx.update(expenses).set({ category: name }).where(eq(expenses.category, before.name));
          return c;
        }
        const [c] = await tx.insert(expenseCategories).values({ id: uid(), name, createdAt: now }).returning();
        return c;
      }
      case "expcat.delete": {
        const c = await must(tx.select().from(expenseCategories).where(eq(expenseCategories.id, id)), "Category");
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.category, c.name));
        if (n > 0) {
          const target = await first(tx.select().from(expenseCategories).where(and(eq(expenseCategories.id, str(a.moveTo, 40)), ne(expenseCategories.id, c.id))));
          if (!target) throw new ApiError(`${n} expense${n === 1 ? " uses" : "s use"} “${c.name}” — choose a category to move ${n === 1 ? "it" : "them"} to.`);
          await tx.update(expenses).set({ category: target.name }).where(eq(expenses.category, c.name));
        }
        await tx.delete(expenseCategories).where(eq(expenseCategories.id, c.id));
        return null;
      }
      case "expense.delete": {
        await must(tx.select().from(expenses).where(eq(expenses.id, id)), "Expense");
        await tx.delete(expenses).where(eq(expenses.id, id));
        return null;
      }

      /* ---------- billing ---------- */
      case "bill.create":
        return createBill(tx, a, role);
      case "bill.delete": {
        const b = await must(tx.select().from(bills).where(eq(bills.id, id)), "Bill");
        // a completed bill still counts — put its stock and coupon use back, same as a void
        if (b.status === "completed") {
          await restock(tx, (await L.getConfig(tx)).gifts.restockOnVoid ? b.items : b.items.filter((i) => !i.free), { type: "void_bill", ref: b.invoiceNo, note: "Bill deleted" }); // free gifts go back only if the owner chose that in Loyalty settings
          if (b.couponCode) await tx.update(coupons).set({ used: sql`greatest(0, ${coupons.used} - 1)` }).where(eq(coupons.code, b.couponCode));
        }
        // points, stamps, rewards and referrals go back to how they were, and every loyalty record of this bill is erased
        await L.purgeBill(tx, b, role);
        await tx.delete(bills).where(eq(bills.id, b.id));
        return null;
      }
      case "bill.void": {
        const b = await must(tx.select().from(bills).where(eq(bills.id, id)), "Bill");
        if (b.status === "void") return b;
        const [u] = await tx.update(bills).set({ status: "void" }).where(eq(bills.id, b.id)).returning();
        await restock(tx, (await L.getConfig(tx)).gifts.restockOnVoid ? b.items : b.items.filter((i) => !i.free), { type: "void_bill", ref: b.invoiceNo, note: "Bill voided" }); // free gifts go back only if the owner chose that in Loyalty settings
        if (b.couponCode) await tx.update(coupons).set({ used: sql`greatest(0, ${coupons.used} - 1)` }).where(eq(coupons.code, b.couponCode));
        await L.reverseBill(tx, b, role, 1, "Bill voided");
        return u;
      }

      /* ---------- loyalty (lib/loyalty/server.ts) ---------- */
      case "loyalty.register":
        return L.registerCustomer(tx, a, role);
      case "loyalty.update":
        return L.updateCustomer(tx, a, role);
      case "loyalty.delete":
        if (role !== "admin") throw new ApiError("Only the admin can do that.", 403);
        return L.deleteCustomer(tx, a, role);
      case "loyalty.status":
        return L.setStatus(tx, a, role);
      case "loyalty.adjust":
        return L.adjustPoints(tx, a, role);
      case "loyalty.cancelVoucher":
        return L.cancelVoucher(tx, a, role);
      case "loyalty.refund":
        return L.partialRefund(tx, a, role);
      case "loyalty.maintain":
        return L.maintain(tx);
      case "loyalty.config":
        return L.saveConfig(tx, a, role);
      case "loyalty.reward.save":
        return L.saveReward(tx, a, role);
      case "loyalty.reward.delete":
        return L.deleteReward(tx, a, role);
      case "loyalty.offer.save":
        return L.saveOffer(tx, a, role);
      case "loyalty.offer.delete":
        return L.deleteOffer(tx, a, role);
      case "loyalty.msg.open":
        return L.openMessage(tx, a);
      case "loyalty.msg.retry":
        return L.retryMessage(tx, a);
      case "loyalty.welcome":
        return L.welcomeMessage(tx, a, role);
    }
    throw new ApiError(`Unknown action: ${op}`);
  }
}
