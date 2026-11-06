import type { LoyaltyConfig } from "./loyalty/config";
/* Shared shapes for the phone-number ordering system (server + client). */

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  /** null = not tracked (always available) */
  stock: number | null;
  /** warn in admin when stock falls to this or below */
  lowAt: number;
  /** loyalty points one unit earns; null = the shop-wide earn rule. Only the admin sets it. */
  loyaltyPoints: number | null;
  description: string;
  image: string;
  eggless: boolean;
  tags: string[];
  /** hidden from the customer menu when false */
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SessionStatus = "open" | "closed" | "void";

/** One customer's tab, found by their mobile: opens with the first order, closes when the bill is paid. */
export type Session = {
  id: string;
  status: SessionStatus;
  openedAt: number;
  closedAt: number | null;
  customerName: string;
  customerPhone: string;
  billRequestedAt: number | null;
  billId: string | null;
  couponCode: string | null;
  /** staff approved the bill for payment at this final amount (null until then) */
  billApprovedAt: number | null;
  approvedAmount: number;
  /** the guest said they paid by UPI (when, how much, the QR reference) — staff still have to confirm it */
  payClaimedAt: number | null;
  payClaimedAmount: number;
  payClaimedRef: string;
};

export type OrderItem = {
  productId: string | null;
  name: string;
  price: number;
  qty: number;
  /** A free gift line (loyalty reward or bill offer): always ₹0, never earns points, and its stock is
      recorded as a "free gift" movement. `gift` says what it came from, e.g. "Spend ₹500 get a Juice". */
  free?: boolean;
  gift?: string;
};

export type OrderStatus = "new" | "preparing" | "served" | "cancelled";

/** Who put the order in: the guest's phone, or staff at the counter. */
export type OrderSource = "customer" | "counter";

export type Order = {
  id: string;
  no: number;
  sessionId: string;
  items: OrderItem[];
  note: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  source: OrderSource;
  subtotal: number;
  createdAt: number;
  updatedAt: number;
};

export type BillSource = "tab" | "counter";
/** "split" = paid with two or more of cash, UPI and card; cashAmount / upiAmount / cardAmount say how much each. */
export type PayMethod = "cash" | "upi" | "card" | "split";
export type DiscountType = "amount" | "percent";

/** How a UPI payment reached the shop — kept on the bill so invoices and reports can tell them apart. */
export const UPI_CHANNELS = [
  { key: "counter_qr", label: "Counter QR" },
  { key: "whatsapp_link", label: "WhatsApp payment link" },
  { key: "guest_phone", label: "Guest's phone QR" },
  { key: "gpay_number", label: "GPay number" },
  { key: "other", label: "Other UPI" },
] as const;
export type UpiChannel = (typeof UPI_CHANNELS)[number]["key"];
/** Who applied the coupon on a bill: the guest from their phone, or staff at billing. */
export type CouponSource = "guest" | "staff";

export type Bill = {
  id: string;
  invoiceNo: string;
  source: BillSource;
  sessionId: string | null;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  itemCount: number;
  subtotal: number;
  couponCode: string | null;
  couponPercent: number;
  couponDiscount: number;
  couponSource: CouponSource | null;
  manualType: DiscountType;
  manualValue: number;
  manualDiscount: number;
  discount: number;
  extra: number;
  /** true = GST invoice (tax added on top); false = non-GST bill */
  isGst: boolean;
  gstPercent: number;
  /** amount GST is charged on: subtotal − discount + extra */
  taxableAmount: number;
  gstAmount: number;
  total: number;
  payment: PayMethod;
  /** How the total was tendered. Always sums to `total`, whichever method was used. */
  cashAmount: number;
  upiAmount: number;
  cardAmount: number;
  /** how the UPI part arrived ("" when nothing was paid by UPI, or for older bills) */
  upiChannel: UpiChannel | "";
  received: number;
  change: number;
  status: "completed" | "void";
  /** loyalty member this bill belongs to, and what loyalty did on it */
  loyaltyCustomerId: string | null;
  pointsRedeemed: number;
  pointsDiscount: number;
  rewardRef: string | null;
  rewardName: string | null;
  rewardDiscount: number;
  pointsEarned: number;
  /** the member's points just before / after this bill (null without a member) — printed on the receipt */
  loyaltyPrev: number | null;
  loyaltyBalance: number | null;
  createdAt: number;
};

/** Who a coupon is for: everyone, only customers who are not loyalty members, or only loyalty members. */
export type CouponAudience = "all" | "regular" | "loyalty";

export type Coupon = {
  id: string;
  audience: CouponAudience;
  code: string;
  percent: number;
  minOrder: number;
  /** YYYY-MM-DD, valid through the end of that day */
  expiresAt: string | null;
  /** null = unlimited */
  limit: number | null;
  used: number;
  active: boolean;
  /** only the phones it was sent to can use it */
  restricted: boolean;
  /** 10-digit mobiles it was sent to */
  phones: string[];
  /** times sent on WhatsApp / as a PDF */
  sent: number;
  createdAt: number;
};

export type Expense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  paymentMode: string;
  notes: string;
  /** YYYY-MM-DD */
  expenseDate: string;
  createdAt: number;
};

export type ActivityRow = { id: string; actor: "admin" | "staff"; action: string; target: string; outcome: "done" | "requested"; createdAt: number };

/** Plain-words names for what was done (anything not listed shows its code, tidied). */
export const ACTIVITY_LABELS: Record<string, string> = {
  "settings.update": "Changed shop settings",
  "user.promote": "Made a staff user an admin",
  "user.demote": "Made an admin a staff user",
  "tab.clear": "Cleared a customer tab",
  "session.update": "Edited a customer tab",
  "order.create": "Created an order",
  "order.status": "Changed an order's status",
  "product.save": "Saved a product",
  "product.delete": "Deleted a product",
  "product.stock": "Changed a product's stock",
  "product.toggle": "Switched a product on/off the menu",
  "category.rename": "Renamed a category",
  "category.add": "Added a category",
  "category.delete": "Removed a category",
  "ingredient.save": "Saved an ingredient",
  "ingredient.delete": "Removed an ingredient",
  "ingredient.purchase": "Bought ingredient stock",
  "ingredient.waste": "Logged ingredient waste",
  "ingredient.adjust": "Adjusted ingredient stock",
  "recipe.save": "Saved a recipe",
  "recipe.delete": "Removed a recipe",
  "batch.save": "Logged a batch",
  "coupon.save": "Saved a coupon",
  "coupon.send": "Sent a coupon",
  "coupon.delete": "Deleted a coupon",
  "expense.save": "Saved an expense",
  "expense.delete": "Deleted an expense",
  "expcat.save": "Saved an expense category",
  "expcat.delete": "Deleted an expense category",
  "supplier.save": "Saved a supplier",
  "supplier.delete": "Deleted a supplier",
  "supplierinv.save": "Saved a supplier invoice",
  "supplierinv.delete": "Deleted a supplier invoice",
  "bill.create": "Created a bill",
  "bill.edit": "Edited a bill's details",
  "bill.delete": "Deleted a bill",
  "bill.void": "Voided a bill",
  "loyalty.register": "Enrolled a loyalty member",
  "loyalty.update": "Edited a loyalty member",
  "loyalty.delete": "Deleted a loyalty member",
  "loyalty.status": "Changed a member's status",
  "loyalty.adjust": "Adjusted loyalty points",
  "loyalty.issueReward": "Issued a reward",
  "loyalty.cancelVoucher": "Cancelled a reward voucher",
  "loyalty.refund": "Refunded loyalty points",
  "loyalty.grant": "Granted points / rewards",
  "loyalty.maintain": "Ran loyalty housekeeping",
  "loyalty.config": "Changed loyalty settings",
  "loyalty.reward.save": "Saved a reward",
  "loyalty.offer.save": "Saved a bill offer",
  "loyalty.offer.delete": "Removed a bill offer",
  "loyalty.msg.open": "Opened a loyalty WhatsApp message",
  "loyalty.msg.retry": "Retried a loyalty WhatsApp message",
  "loyalty.welcome": "Prepared a loyalty welcome message",
  "loyalty.reward.delete": "Removed a reward",
  "loyalty.campaign.save": "Saved a campaign",
  "loyalty.campaign.delete": "Removed a campaign",
  "tab.approve": "Approved a tab's bill for payment",
  "tab.unapprove": "Withdrew a tab's bill approval",
  "tab.payclaim.clear": "Marked a guest's UPI payment as not received",
  "approval.approve": "Approved a staff change",
  "approval.reject": "Rejected a staff change",
};

/** What each approval-gated change reads as in a sentence: "<staff> wants to <verb> <name>". */
export const APPROVAL_VERBS: Record<string, string> = {
  "ingredient.save": "edit the ingredient",
  "ingredient.delete": "remove the ingredient",
  "product.save": "edit the product",
  "bill.edit": "edit the details of bill",
  "loyalty.update": "edit the loyalty member",
  "loyalty.status": "change the loyalty status of",
  "loyalty.adjust": "adjust loyalty points for",
  "loyalty.reward.save": "edit the reward",
  "loyalty.campaign.save": "edit the campaign",
};

/** A change staff asked for, waiting for (or decided by) the admin. */
export type ApprovalRequest = {
  id: string;
  kind: string;
  targetId: string;
  targetName: string;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  requestedBy: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string;
  createdAt: number;
  decidedAt: number | null;
};

export type Supplier = {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  supplies: string;
  notes: string;
  active: boolean;
  createdAt: number;
};

export type SupplierInvoice = {
  id: string;
  supplierId: string;
  invoiceNo: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  /** price before GST */
  price: number;
  gstPercent: number;
  gstAmount: number;
  /** price + GST */
  total: number;
  paidAmount: number;
  paymentMode: string;
  /** YYYY-MM-DD or "" */
  dueDate: string;
  notes: string;
  createdAt: number;
};

export type ProductCategory = {
  id: string;
  name: string;
  createdAt: number;
};

export type ExpenseCategory = {
  id: string;
  name: string;
  createdAt: number;
};

/** "gift" = a free gift handed out on a bill (loyalty reward or bill offer) */
export type StockMoveType = "initial" | "added" | "removed" | "sale" | "cancelled_order" | "void_bill" | "adjustment" | "gift";

/** One page of the stock ledger plus totals for the whole selected period. */
export type StockLedger = {
  rows: StockMovement[];
  total: number;
  page: number;
  pages: number;
  stats: { added: number; sold: number; removed: number; returned: number; adjusted: number; /** free gifts handed out */ gifts: number; net: number };
  perProduct: { id: string; name: string; in: number; out: number; close: number | null }[];
  products: { id: string; name: string }[];
};

export type StockMovement = {
  id: string;
  productId: string;
  productName: string;
  type: StockMoveType;
  qty: number;
  balanceAfter: number;
  note: string;
  ref: string;
  createdAt: number;
};

/* ---------------- Raw-ingredient inventory ---------------- */

/** Each ingredient is counted in one unit of its own — stock, recipes and costs all use it as is. */
export const INGREDIENT_UNITS = [
  { key: "g", label: "Grams (g)" },
  { key: "kg", label: "Kilograms (kg)" },
  { key: "ml", label: "Millilitres (ml)" },
  { key: "l", label: "Litres (l)" },
  { key: "pcs", label: "Pieces (pcs)" },
  { key: "dozen", label: "Dozen" },
  { key: "pack", label: "Packs" },
  { key: "tsp", label: "Teaspoons (tsp)" },
  { key: "tbsp", label: "Tablespoons (tbsp)" },
  { key: "cup", label: "Cups" },
  { key: "oz", label: "Ounces (oz)" },
  { key: "lb", label: "Pounds (lb)" },
] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number]["key"];

export type Ingredient = {
  id: string;
  name: string;
  unit: IngredientUnit;
  /** How much is on hand right now (same unit as `unit`). */
  stock: number;
  /** Weighted-average rupees per gram / ml, kept up to date on each purchase. */
  costPerUnit: number;
  /** warn in admin when stock falls to this or below */
  lowAt: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

/** A reusable ingredient list for a product. Picking a recipe fills the batch
    logger with these rows (still editable) so a repeat run is one click. */
export type RecipeItem = { ingredientId: string; qty: number; note: string };
export type Recipe = {
  id: string;
  name: string;
  note: string;
  items: RecipeItem[];
  createdAt: number;
  updatedAt: number;
};

/** A production run (e.g. "Chocolate cake × 2"), with the uses that fed it. */
export type Batch = {
  id: string;
  name: string;
  note: string;
  /** Sum of the `cost` of all uses booked to this batch. */
  totalCost: number;
  createdAt: number;
};

export type IngredientMoveType = "purchase" | "use" | "waste" | "adjust";

export type IngredientMove = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: IngredientUnit;
  /** signed: + into stock, − out of it */
  qty: number;
  type: IngredientMoveType;
  /** rupee value of this line, always ≥ 0 */
  cost: number;
  balanceAfter: number;
  batchId: string | null;
  /** Human-readable name of the batch this line came from, when a batch produced it. */
  batchName: string;
  /** the note typed for the whole batch ("Any details to remember") */
  batchNote: string;
  /** the inventory items this batch produced, e.g. "2 × Veg Burger" — where the ingredient was used */
  madeFor: string;
  note: string;
  createdAt: number;
};

/** One page of the ingredient ledger, plus period totals and per-ingredient summary. */
export type IngredientLedger = {
  rows: IngredientMove[];
  total: number;
  page: number;
  pages: number;
  stats: {
    purchased: { qty: number; cost: number };
    used: { qty: number; cost: number };
    wasted: { qty: number; cost: number };
    adjusted: { qty: number };
  };
  perIngredient: { id: string; name: string; unit: IngredientUnit; in: number; used: number; wasted: number; close: number }[];
  ingredients: { id: string; name: string; unit: IngredientUnit }[];
};

/* Guests never hold an account — they order from the shop's QR code and are known
   by the mobile they leave with the order. So every stored user is someone who has
   been given admin access, keyed by that same mobile, which is what lets a regular
   be promoted straight from the Users page. */
export type StaffUser = {
  id: string;
  name: string;
  /** 10-digit mobile: the identity this app actually collects */
  mobile: string;
  email: string;
  passwordHash: string;
  createdAt: number;
};

/** A user as the admin panel sees one — never the hash. */
export type PublicUser = Omit<StaffUser, "passwordHash">;

/** Shop details printed on receipts and invoices. */
export type ShopDetails = {
  ownerName: string;
  location: string;
  /** postal address, one line per row */
  address: string;
  email: string;
  /** second branch's postal address, one line per row (blank if none) */
  address2: string;
  /** 10-digit WhatsApp numbers, one per branch (blank if none) */
  whatsapp1: string;
  whatsapp2: string;
  customerCare: string;
  /** Google Maps link for the shop */
  mapsUrl: string;
  /** image URL; blank falls back to the built-in icon */
  logoUrl: string;
};

export type Settings = ShopDetails & {
  shopName: string;
  /** origin printed into QR codes, e.g. https://order.cheflovingcakes.in */
  publicUrl: string;
  /** When true, POS Billing is counter-only — the customer-tab flow is hidden. */
  walkInsOnly: boolean;
  /** When false, the on-screen kitchen ticket queue (KOT) hides for everyone. */
  kotEnabled: boolean;
  /** When false the customer site is menu-only (no cart, no tabs) and the admin's
      "Open tabs" page + Billing's "Customer tab" mode hide too. */
  orderingEnabled: boolean;
  adminHash: string | null;
  secret: string;
};

export type DB = {
  version: number;
  seq: { order: number };
  settings: Settings;
  products: Product[];
  sessions: Session[];
  orders: Order[];
  bills: Bill[];
  coupons: Coupon[];
  users: StaffUser[];
  expenses: Expense[];
  suppliers: Supplier[];
  categories: ProductCategory[];
  approvals: ApprovalRequest[];
  supplierInvoices: SupplierInvoice[];
  expenseCategories: ExpenseCategory[];
  ingredients: Ingredient[];
  batches: Batch[];
  recipes: Recipe[];
};

/** What the admin panel receives (no secrets). */
export type AdminState = Omit<DB, "settings" | "users"> & {
  settings: ShopDetails & { shopName: string; publicUrl: string; walkInsOnly: boolean; kotEnabled: boolean; orderingEnabled: boolean; upiId: string; upiName: string; upiPhone: string; upiQrMinutes: number };
  users: PublicUser[];
  /** how loyalty points are earned, so each item can show what it earns */
  loyaltyEarn: Pick<LoyaltyConfig, "enabled" | "earn" | "display">;
};

/** A tab that closed in the last few minutes — "paid" once it was billed, "cleared"
    if staff wiped it without taking payment. Lets the guest's phone close the loop
    and reset itself for the next visit. */
export type TabClose = {
  kind: "paid" | "cleared";
  invoiceNo: string | null;
  total: number;
  itemCount: number;
  name: string;
  at: number;
};

/** What a customer receives: the menu, plus their tab when their mobile has one open. */
export type TabView = {
  shopName: string;
  /** public shop details — contact info and logo for the menu page */
  details: ShopDetails;
  /** Mirrors Settings.orderingEnabled — when false the menu renders without
      cart / tab / ordering controls. */
  orderingEnabled: boolean;
  menu: MenuItem[];
  closed: TabClose | null;
  tab: {
    orders: { no: number; items: OrderItem[]; status: OrderStatus; subtotal: number; createdAt: number }[];
    total: number;
    billRequested: boolean;
    /** first name only — a phone number is not a password */
    name: string;
    /** the coupon this guest applied, with what it saves right now */
    coupon: { code: string; percent: number; discount: number; ok: boolean; reason: string } | null;
    /** what the guest should expect to pay: total minus the coupon */
    payable: number;
    /** where to pay by UPI, when the shop has set it up */
    upi: { id: string; name: string; minutes: number; phone: string } | null;
    /** the final amount staff approved — the payment QR shows on the guest's phone only after this */
    approved: { amount: number; at: number } | null;
    /** the guest has said they paid this much (it is for staff to confirm) */
    payClaim: { amount: number; at: number } | null;
  } | null;
};

export type MenuItem = Pick<Product, "id" | "name" | "category" | "price" | "description" | "image" | "tags"> & {
  soldOut: boolean;
  left: number | null;
  /** loyalty points one of this item earns (0 = none) */
  points: number;
};
