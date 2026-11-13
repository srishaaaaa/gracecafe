import { bigint, boolean, index, integer, jsonb, numeric, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Audit, CampaignType, LedgerType, LoyaltyStatus, Segment, VoucherSource, VoucherStatus } from "../loyalty/types";
import type { LoyaltyConfig, RewardKind, TierKey } from "../loyalty/config";
import type { BillSource, UpiChannel, CouponSource, DiscountType, IngredientUnit, OrderItem, OrderSource, OrderStatus, PayMethod, SessionStatus, StockMoveType } from "../types";

/* One database table per type in lib/types.ts. Ids stay the app's own short text ids and
   timestamps stay epoch milliseconds, so rows map 1:1 onto the shapes the UI
   already consumes. Money is numeric(12,2), read back as a JS number. */

const ms = (name: string) => bigint(name, { mode: "number" });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
/** Ingredient quantities are measured in grams or millilitres — three decimals is enough for a pinch. */
const amount = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "number" });
/** Per-unit cost (₹ / g or ₹ / ml) stays accurate even for cheap bulk goods. */
const unitCost = (name: string) => numeric(name, { precision: 14, scale: 6, mode: "number" });

/** Single row (id = 1). */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  shopName: text("shop_name").notNull(),
  publicUrl: text("public_url").notNull().default(""),
  /** Shop details printed on receipts and invoices — editable from Settings. */
  ownerName: text("owner_name").notNull().default("Grace Cafe"),
  location: text("location").notNull().default("Valliyur, Tamil Nadu"),
  /** Postal address, one line per row. */
  address: text("address").notNull().default("New, 792, Main Rd\nValliyur, Tamil Nadu - 627117"),
  email: text("email").notNull().default("gracecafevalliyur@gmail.com"),
  /** Second branch (blank until filled in), a WhatsApp number per branch, and the other contact points. */
  address2: text("address2").notNull().default(""),
  whatsapp1: text("whatsapp1").notNull().default("9042001476"),
  whatsapp2: text("whatsapp2").notNull().default(""),
  customerCare: text("customer_care").notNull().default("9042001476"),
  mapsUrl: text("maps_url").notNull().default(""),
  logoUrl: text("logo_url").notNull().default(""),
  /** Hide the "Customer tab" flow in POS Billing — the shop only takes walk-ins. */
  walkInsOnly: boolean("walk_ins_only").notNull().default(false),
  /** On-screen kitchen ticket queue (KOT) — when false the Kitchen page and nav hide. */
  kotEnabled: boolean("kot_enabled").notNull().default(true),
  /** When false the customer-facing site is menu-only: no cart, no tabs, no "send to kitchen".
      Admin's "Open tabs" and the Billing "Customer tab" mode also hide. */
  orderingEnabled: boolean("ordering_enabled").notNull().default(true),
  /** the shop's UPI ID (name@bank) that guests pay to, the name shown in their UPI app, and how long one QR stays up before a fresh one replaces it */
  upiId: text("upi_id").notNull().default(""),
  upiName: text("upi_name").notNull().default(""),
  /** the shop's GPay / PhonePe mobile number — shown as another way to pay (blank = not shown) */
  upiPhone: text("upi_phone").notNull().default(""),
  upiQrMinutes: integer("upi_qr_minutes").notNull().default(5),
  /** how many tables the shop has (tables are numbered 1..N for the table QR cards; 0 = none set up) */
  tableCount: integer("table_count").notNull().default(0),
});

/** Single row (id = 1): the change counter the admin panel polls, and the order-number sequence. */
export const meta = pgTable("meta", {
  id: integer("id").primaryKey().default(1),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  orderSeq: integer("order_seq").notNull().default(0),
});

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: money("price").notNull(),
  stock: integer("stock"),
  lowAt: integer("low_at").notNull().default(4),
  /** loyalty points one unit earns; null = use the shop-wide earn rule. Set by the admin. */
  loyaltyPoints: integer("loyalty_points"),
  description: text("description").notNull().default(""),
  image: text("image").notNull().default(""),
  eggless: boolean("eggless").notNull().default(false),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  /** Variants: every size/flavour is a real product row. `family` ("Popcorn") and `variant` ("Large") only group and
      label them; `name` always holds the full text "Popcorn (Large)". Both empty = an ordinary product. */
  family: text("family").notNull().default(""),
  variant: text("variant").notNull().default(""),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    status: text("status").$type<SessionStatus>().notNull(),
    openedAt: ms("opened_at").notNull(),
    closedAt: ms("closed_at"),
    customerName: text("customer_name").notNull().default(""),
    /** 10-digit mobile: the key a tab is found by */
    customerPhone: text("customer_phone").notNull(),
    billRequestedAt: ms("bill_requested_at"),
    billId: text("bill_id"),
    /** coupon the guest applied from their phone; validated again when the bill is made */
    couponCode: text("coupon_code"),
    /** the guest tapped "I've paid" after paying by UPI: when, how much, and the QR reference they paid with.
        Nothing is confirmed by this — staff check their UPI app and then bill the tab. */
    /** staff approved the bill for payment at this final amount — only then does the guest's phone show the payment QR */
    billApprovedAt: ms("bill_approved_at"),
    approvedAmount: money("approved_amount").notNull().default(0),
    payClaimedAt: ms("pay_claimed_at"),
    payClaimedAmount: money("pay_claimed_amount").notNull().default(0),
    payClaimedRef: text("pay_claimed_ref").notNull().default(""),
  },
  (t) => [
    // a phone number can never have two open tabs
    uniqueIndex("sessions_one_open_per_phone").on(t.customerPhone).where(sql`${t.status} = 'open'`),
    index("sessions_phone_idx").on(t.customerPhone),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    no: integer("no").notNull(),
    sessionId: text("session_id").notNull(),
    items: jsonb("items").$type<OrderItem[]>().notNull(),
    note: text("note").notNull().default(""),
    customerName: text("customer_name").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    /** the table number carried by the QR the guest scanned ("" = no table: counter order or the plain shop QR) */
    tableNo: text("table_no").notNull().default(""),
    status: text("status").$type<OrderStatus>().notNull(),
    source: text("source").$type<OrderSource>().notNull(),
    subtotal: money("subtotal").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("orders_session_idx").on(t.sessionId), index("orders_created_idx").on(t.createdAt)],
);

export const bills = pgTable(
  "bills",
  {
    id: text("id").primaryKey(),
    invoiceNo: text("invoice_no").notNull(),
    source: text("source").$type<BillSource>().notNull(),
    sessionId: text("session_id"),
    customerName: text("customer_name").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    items: jsonb("items").$type<OrderItem[]>().notNull(),
    itemCount: integer("item_count").notNull(),
    subtotal: money("subtotal").notNull(),
    couponCode: text("coupon_code"),
    couponPercent: money("coupon_percent").notNull().default(0),
    couponDiscount: money("coupon_discount").notNull().default(0),
    couponSource: text("coupon_source").$type<CouponSource>(),
    manualType: text("manual_type").$type<DiscountType>().notNull(),
    manualValue: money("manual_value").notNull().default(0),
    manualDiscount: money("manual_discount").notNull().default(0),
    discount: money("discount").notNull().default(0),
    extra: money("extra").notNull().default(0),
    isGst: boolean("is_gst").notNull().default(false),
    gstPercent: money("gst_percent").notNull().default(0),
    taxableAmount: money("taxable_amount").notNull().default(0),
    gstAmount: money("gst_amount").notNull().default(0),
    total: money("total").notNull(),
    payment: text("payment").$type<PayMethod>().notNull(),
    cashAmount: money("cash_amount").notNull().default(0),
    upiAmount: money("upi_amount").notNull().default(0),
    cardAmount: money("card_amount").notNull().default(0),
    /** how the UPI part reached the shop: counter QR, WhatsApp link, guest's phone, GPay number… */
    upiChannel: text("upi_channel").$type<UpiChannel | "">().notNull().default(""),
    received: money("received").notNull(),
    change: money("change").notNull().default(0),
    status: text("status").$type<"completed" | "void">().notNull(),
    /* loyalty (all zero / null on bills without a member) */
    loyaltyCustomerId: text("loyalty_customer_id"),
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    pointsDiscount: money("points_discount").notNull().default(0),
    rewardRef: text("reward_ref"),
    rewardName: text("reward_name"),
    rewardDiscount: money("reward_discount").notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),
    /** the member's points just before and just after this bill (null on bills without a member) */
    loyaltyPrev: integer("loyalty_prev"),
    loyaltyBalance: integer("loyalty_balance"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("bills_invoice_uq").on(t.invoiceNo), index("bills_created_idx").on(t.createdAt)],
);

export const coupons = pgTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    percent: money("percent").notNull(),
    minOrder: money("min_order").notNull().default(0),
    expiresAt: text("expires_at"),
    limit: integer("usage_limit"),
    used: integer("used").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** when on, only the phones in `phones` can use it */
    restricted: boolean("restricted").notNull().default(false),
    /** 10-digit mobiles the coupon has been sent to */
    phones: jsonb("phones").$type<string[]>().notNull().default([]),
    /** how many times it has been sent */
    sent: integer("sent").notNull().default(0),
    /** who may use it: everyone, only non-loyalty customers, or only loyalty members */
    audience: text("audience").$type<"all" | "regular" | "loyalty">().notNull().default("all"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("coupons_code_uq").on(t.code)],
);

export const staffUsers = pgTable(
  "staff_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email").notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("staff_mobile_uq").on(t.mobile)],
);

/** Failed admin sign-ins per client, so the lockout holds across serverless instances. */
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  fails: integer("fails").notNull().default(0),
  lockedUntil: ms("locked_until").notNull().default(0),
});

export const expenses = pgTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    amount: money("amount").notNull(),
    paymentMode: text("payment_mode").notNull().default("cash"),
    notes: text("notes").notNull().default(""),
    /** YYYY-MM-DD, shop-local */
    expenseDate: text("expense_date").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("expenses_date_idx").on(t.expenseDate)],
);

/** Changes staff ask for that the admin must approve before they take effect. */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),
    /** the op to run if approved, e.g. "ingredient.save" */
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    targetName: text("target_name").notNull().default(""),
    /** the arguments the op will run with */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** what the target looked like when the request was made, for the admin to compare */
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    requestedBy: text("requested_by").notNull().default("staff"),
    status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
    decidedBy: text("decided_by").notNull().default(""),
    createdAt: ms("created_at").notNull(),
    decidedAt: ms("decided_at"),
  },
  (t) => [index("approval_requests_status_idx").on(t.status, t.createdAt)],
);

/** Product categories the shop has set up — including ones with no products yet. (A product keeps
    its category as plain text, so the menu still works from the products alone.) */
export const productCategories = pgTable(
  "product_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("product_categories_name_uq").on(sql`lower(${t.name})`)],
);

/** Who the shop buys from — kept apart from expenses so each purchase invoice can be tracked. */
export const suppliers = pgTable(
  "suppliers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    contactPerson: text("contact_person").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    /** 15-character GST number of the supplier */
    gstin: text("gstin").notNull().default(""),
    address: text("address").notNull().default(""),
    /** what they supply, e.g. "Milk, dairy" */
    supplies: text("supplies").notNull().default(""),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("suppliers_name_uq").on(t.name)],
);

/** A purchase invoice from a supplier: price before GST, the GST on it, and what has been paid. */
export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    invoiceNo: text("invoice_no").notNull(),
    /** YYYY-MM-DD on the supplier's invoice */
    invoiceDate: text("invoice_date").notNull(),
    /** price before GST */
    price: money("price").notNull(),
    gstPercent: money("gst_percent").notNull().default(0),
    gstAmount: money("gst_amount").notNull().default(0),
    /** price + GST */
    total: money("total").notNull(),
    paidAmount: money("paid_amount").notNull().default(0),
    paymentMode: text("payment_mode").notNull().default("cash"),
    /** YYYY-MM-DD, blank when unpaid / no due date */
    dueDate: text("due_date").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("supplier_invoices_supplier_idx").on(t.supplierId), index("supplier_invoices_date_idx").on(t.invoiceDate)],
);

/** The shop's own list of expense categories. Expenses keep the category as plain text,
    so renaming here renames them there too. */
export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("expense_categories_name_uq").on(sql`lower(${t.name})`)],
);

/* ---------------- Raw-ingredient inventory ----------------
   The shop buys sugar, milk, flour by the gram or millilitre. Each ingredient
   keeps a running stock and a weighted-average per-unit cost (so adding a new
   batch of sugar at a different price updates the cost per gram smoothly).
   Every movement — purchase, batch use, waste or adjustment — is journalled
   so the ledger below can filter, sum and export to Excel. */
export const ingredients = pgTable(
  "ingredients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    unit: text("unit").$type<IngredientUnit>().notNull(),
    stock: amount("stock").notNull().default(0),
    costPerUnit: unitCost("cost_per_unit").notNull().default(0),
    lowAt: amount("low_at").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ingredients_name_uq").on(sql`lower(${t.name})`)],
);

/** A reusable list of ingredients for a product — "Chocolate cake" with its sugar,
    milk and flour amounts — so logging a repeat batch is a one-click fill of the
    batch form, not a retype. The items array keeps the ingredient id, qty and an
    optional per-line note; qty is in each ingredient's own unit. */
export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    items: jsonb("items").$type<{ ingredientId: string; qty: number; note: string }[]>().notNull().default([]),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [uniqueIndex("recipes_name_uq").on(sql`lower(${t.name})`)],
);

/** One production run — "Chocolate cake × 2" — groups the uses that fed it. */
export const batches = pgTable(
  "batches",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    totalCost: money("total_cost").notNull().default(0),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("batches_created_idx").on(t.createdAt)],
);

/** Every change to a product's tracked stock, newest last. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    type: text("type").$type<StockMoveType>().notNull(),
    /** signed: + into stock, − out of it */
    qty: integer("qty").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    note: text("note").notNull().default(""),
    /** what caused it: an order id, bill id or invoice number */
    ref: text("ref").notNull().default(""),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("stock_moves_created_idx").on(t.createdAt), index("stock_moves_product_idx").on(t.productId)],
);

/* ============================== loyalty ============================== */

/** Single row (id = 1): the whole programme's settings as one JSON document. */
export const loyaltySettings = pgTable("loyalty_settings", {
  id: integer("id").primaryKey().default(1),
  config: jsonb("config").$type<LoyaltyConfig>().notNull(),
  updatedAt: ms("updated_at").notNull(),
});

/** A loyalty member, keyed by the same 10-digit mobile bills and tabs use. Balances are
    a cache of the ledger, always written in the same transaction as the ledger row. */
export const loyaltyCustomers = pgTable(
  "loyalty_customers",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    phone: text("phone").notNull(),
    name: text("name").notNull().default(""),
    email: text("email").notNull().default(""),
    birthday: text("birthday").notNull().default(""),
    anniversary: text("anniversary").notNull().default(""),
    status: text("status").$type<LoyaltyStatus>().notNull().default("active"),
    consent: boolean("consent").notNull().default(true),
    /** the number WhatsApp messages go to (blank = use the mobile number) */
    whatsapp: text("whatsapp").notNull().default(""),
    referralCode: text("referral_code").notNull(),
    referredBy: text("referred_by"),
    walletToken: text("wallet_token").notNull(),
    tier: text("tier").$type<TierKey>().notNull().default("bronze"),
    tierSince: ms("tier_since").notNull(),
    available: integer("available").notNull().default(0),
    lifetime: integer("lifetime").notNull().default(0),
    redeemed: integer("redeemed").notNull().default(0),
    expired: integer("expired").notNull().default(0),
    debt: integer("debt").notNull().default(0),
    stamps: integer("stamps").notNull().default(0),
    note: text("note").notNull().default(""),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("loyalty_customers_phone_uq").on(t.phone),
    uniqueIndex("loyalty_customers_code_uq").on(t.code),
    uniqueIndex("loyalty_customers_ref_uq").on(t.referralCode),
    uniqueIndex("loyalty_customers_wallet_uq").on(t.walletToken),
  ],
);

/** Every points movement, never edited or deleted. `key` makes credits idempotent. */
export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => loyaltyCustomers.id),
    type: text("type").$type<LedgerType>().notNull(),
    points: integer("points").notNull(),
    balanceBefore: integer("balance_before").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    billId: text("bill_id"),
    invoiceNo: text("invoice_no"),
    ref: text("ref").notNull().default(""),
    key: text("key"),
    description: text("description").notNull().default(""),
    expiresAt: ms("expires_at"),
    actor: text("actor").notNull().default("system"),
    reversalOf: text("reversal_of"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("loyalty_ledger_key_uq").on(t.key),
    index("loyalty_ledger_customer_idx").on(t.customerId, t.createdAt),
    index("loyalty_ledger_created_idx").on(t.createdAt),
    index("loyalty_ledger_bill_idx").on(t.billId),
  ],
);

/** What is left of each credit, so the oldest points are spent (and expire) first. */
export const loyaltyLots = pgTable(
  "loyalty_lots",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => loyaltyCustomers.id),
    ledgerId: text("ledger_id").notNull().references(() => loyaltyLedger.id),
    points: integer("points").notNull(),
    remaining: integer("remaining").notNull(),
    earnedAt: ms("earned_at").notNull(),
    expiresAt: ms("expires_at"),
  },
  (t) => [index("loyalty_lots_customer_idx").on(t.customerId)],
);

export const loyaltyRewards = pgTable("loyalty_rewards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  category: text("category").notNull().default(""),
  kind: text("kind").$type<RewardKind>().notNull(),
  value: money("value").notNull().default(0),
  productId: text("product_id"),
  pointsCost: integer("points_cost").notNull().default(0),
  /** "points": unlocked by collecting points. "milestone": unlocked by spending (milestoneAmount) in total */
  trigger: text("trigger").$type<"points" | "milestone">().notNull().default("points"),
  milestoneAmount: money("milestone_amount").notNull().default(0),
  giftQty: integer("gift_qty").notNull().default(1),
  tiers: jsonb("tiers").$type<TierKey[]>().notNull().default([]),
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  active: boolean("active").notNull().default(true),
  maxRedemptions: integer("max_redemptions"),
  perCustomerLimit: integer("per_customer_limit"),
  terms: text("terms").notNull().default(""),
  redeemed: integer("redeemed").notNull().default(0),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

/** Reward redemptions and free rewards handed out, each with a unique reference. */
export const loyaltyVouchers = pgTable(
  "loyalty_vouchers",
  {
    id: text("id").primaryKey(),
    ref: text("ref").notNull(),
    customerId: text("customer_id").notNull().references(() => loyaltyCustomers.id),
    rewardId: text("reward_id"),
    name: text("name").notNull(),
    kind: text("kind").$type<RewardKind>().notNull(),
    value: money("value").notNull().default(0),
    productId: text("product_id"),
    source: text("source").$type<VoucherSource>().notNull(),
    pointsCost: integer("points_cost").notNull().default(0),
    giftQty: integer("gift_qty").notNull().default(1),
    status: text("status").$type<VoucherStatus>().notNull(),
    billId: text("bill_id"),
    invoiceNo: text("invoice_no"),
    key: text("key"),
    issuedAt: ms("issued_at").notNull(),
    usedAt: ms("used_at"),
    expiresAt: ms("expires_at"),
    note: text("note").notNull().default(""),
  },
  (t) => [uniqueIndex("loyalty_vouchers_ref_uq").on(t.ref), uniqueIndex("loyalty_vouchers_key_uq").on(t.key), index("loyalty_vouchers_customer_idx").on(t.customerId)],
);

/** One digital stamp per qualifying visit; `visitKey` stops a visit counting twice. */
export const loyaltyStamps = pgTable(
  "loyalty_stamps",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => loyaltyCustomers.id),
    billId: text("bill_id").notNull(),
    visitKey: text("visit_key").notNull(),
    status: text("status").$type<"active" | "reversed">().notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("loyalty_stamps_visit_uq").on(t.visitKey), index("loyalty_stamps_customer_idx").on(t.customerId)],
);

export const loyaltyReferrals = pgTable(
  "loyalty_referrals",
  {
    id: text("id").primaryKey(),
    referrerId: text("referrer_id").notNull().references(() => loyaltyCustomers.id),
    refereeId: text("referee_id").notNull().references(() => loyaltyCustomers.id),
    status: text("status").$type<"pending" | "rewarded" | "reversed" | "rejected">().notNull(),
    billId: text("bill_id"),
    referrerPoints: integer("referrer_points").notNull().default(0),
    refereePoints: integer("referee_points").notNull().default(0),
    createdAt: ms("created_at").notNull(),
    rewardedAt: ms("rewarded_at"),
  },
  (t) => [uniqueIndex("loyalty_referrals_referee_uq").on(t.refereeId), index("loyalty_referrals_referrer_idx").on(t.referrerId)],
);

export const loyaltyCampaigns = pgTable("loyalty_campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").$type<CampaignType>().notNull(),
  value: money("value").notNull().default(0),
  startsOn: text("starts_on").notNull().default(""),
  endsOn: text("ends_on").notNull().default(""),
  startTime: text("start_time").notNull().default(""),
  endTime: text("end_time").notNull().default(""),
  days: jsonb("days").$type<number[]>().notNull().default([]),
  minPurchase: money("min_purchase").notNull().default(0),
  tiers: jsonb("tiers").$type<TierKey[]>().notNull().default([]),
  segments: jsonb("segments").$type<Segment[]>().notNull().default([]),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
  usageLimit: integer("usage_limit"),
  perCustomerLimit: integer("per_customer_limit"),
  active: boolean("active").notNull().default(true),
  used: integer("used").notNull().default(0),
  pointsGiven: integer("points_given").notNull().default(0),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

/** Sensitive loyalty actions: settings changes, manual adjustments, reversals, status changes. */
export const loyaltyAudit = pgTable(
  "loyalty_audit",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    customerId: text("customer_id"),
    ref: text("ref").notNull().default(""),
    before: jsonb("before").$type<Audit["before"]>(),
    after: jsonb("after").$type<Audit["after"]>(),
    reason: text("reason").notNull().default(""),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("loyalty_audit_created_idx").on(t.createdAt), index("loyalty_audit_customer_idx").on(t.customerId)],
);

/** A free-gift offer on the current bill ("spend ₹500, get a free juice", "buy 2 burgers, get 1 tea"). Works for everyone, member or not. */
export const giftOffers = pgTable("gift_offers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** "spend": the bill reaches minBill. "buy": the bill has buyQty of the qualifying product. */
  type: text("type").$type<"spend" | "buy">().notNull(),
  minBill: money("min_bill").notNull().default(0),
  productId: text("product_id"),
  buyQty: integer("buy_qty").notNull().default(1),
  giftProductId: text("gift_product_id").notNull(),
  giftQty: integer("gift_qty").notNull().default(1),
  /** may the gift be given again for every multiple on one bill (spend ₹1000 twice → two gifts) */
  repeatable: boolean("repeatable").notNull().default(false),
  /** who gets it: everyone, or only loyalty customers */
  audience: text("audience").$type<"all" | "members">().notNull().default("all"),
  /** the most times the shop will give this gift in total (null = no limit); `given` counts so far */
  maxTotal: integer("max_total"),
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  active: boolean("active").notNull().default(true),
  given: integer("given").notNull().default(0),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

/** Every WhatsApp message the loyalty programme prepares for a customer. There is no automatic sender:
    "pending" = ready to send, "opened" = staff opened WhatsApp with it (delivery can't be confirmed),
    "failed" = it could not be prepared (no valid number, or the customer has not agreed). `key` stops duplicates. */
export const loyaltyMessages = pgTable(
  "loyalty_messages",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    type: text("type").notNull(),
    phone: text("phone").notNull().default(""),
    text: text("text").notNull(),
    status: text("status").$type<"pending" | "opened" | "failed">().notNull(),
    error: text("error").notNull().default(""),
    billId: text("bill_id"),
    key: text("key"),
    createdAt: ms("created_at").notNull(),
    openedAt: ms("opened_at"),
    opens: integer("opens").notNull().default(0),
  },
  (t) => [uniqueIndex("loyalty_messages_key_uq").on(t.key), index("loyalty_messages_customer_idx").on(t.customerId, t.createdAt)],
);

/* ============================== birthdays ============================== */

/** A customer's date of birth, keyed by mobile number (billing customers need not be loyalty members).
    `dob` is "YYYY-MM-DD"; only the month and day matter for the birthday offer. */
export const birthdays = pgTable("birthdays", {
  phone: text("phone").primaryKey(),
  name: text("name").notNull().default(""),
  dob: text("dob").notNull(),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

/** Single row (id = 1): the birthday offers staff can pick from, which one is selected, and the WhatsApp wording. */
export const birthdayConfig = pgTable("birthday_config", {
  id: integer("id").primaryKey().default(1),
  offers: jsonb("offers").$type<{ id: string; name: string; text: string }[]>().notNull().default([]),
  selected: text("selected").notNull().default(""),
  template: text("template").notNull().default(""),
});
