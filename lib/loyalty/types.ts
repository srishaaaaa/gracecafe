import type { LoyaltyConfig, RewardKind, TierKey } from "./config";

export type LoyaltyStatus = "active" | "inactive";

export type LoyaltyCustomer = {
  id: string;
  /** short public id, e.g. CK4F7Q2 */
  code: string;
  phone: string;
  name: string;
  email: string;
  /** YYYY-MM-DD or MM-DD, "" when unknown */
  birthday: string;
  anniversary: string;
  status: LoyaltyStatus;
  /** may we message them about offers */
  consent: boolean;
  /** number WhatsApp messages go to; "" = the mobile number */
  whatsapp: string;
  referralCode: string;
  referredBy: string | null;
  /** secret for the customer's own wallet page — never shown in lists */
  walletToken: string;
  tier: TierKey;
  tierSince: number;
  available: number;
  lifetime: number;
  redeemed: number;
  expired: number;
  /** points a refund should have taken back but couldn't (already spent); recovered from future earnings */
  debt: number;
  stamps: number;
  note: string;
  createdAt: number;
  updatedAt: number;
};

export type LedgerType =
  | "purchase"
  | "bonus"
  | "promo"
  | "referral"
  | "occasion"
  | "redemption"
  | "reward"
  | "expiry"
  | "refund_reversal"
  | "refund_restore"
  | "reward_reversal"
  | "adjustment"
  | "debt_recovery";

export type LedgerEntry = {
  id: string;
  customerId: string;
  type: LedgerType;
  /** signed: credits positive, debits negative */
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  billId: string | null;
  invoiceNo: string | null;
  ref: string;
  key: string | null;
  description: string;
  expiresAt: number | null;
  actor: string;
  reversalOf: string | null;
  createdAt: number;
};

export type PointLot = { id: string; customerId: string; ledgerId: string; points: number; remaining: number; earnedAt: number; expiresAt: number | null };

export type Reward = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  category: string;
  kind: RewardKind;
  value: number;
  productId: string | null;
  /** 0 = free promotional reward */
  pointsCost: number;
  /** "points": unlocked by collecting points. "milestone": unlocked by spending `milestoneAmount` in total. */
  trigger: "points" | "milestone";
  milestoneAmount: number;
  giftQty: number;
  tiers: TierKey[];
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  terms: string;
  redeemed: number;
  createdAt: number;
  updatedAt: number;
};

export type VoucherSource = "points" | "milestone" | "birthday" | "anniversary" | "campaign" | "manual";
export type VoucherStatus = "issued" | "used" | "cancelled" | "expired";

/** One redemption of a reward: a points purchase from the catalogue, or a free reward
    handed out (visit milestone, birthday…). Has a unique reference staff can quote. */
export type Voucher = {
  id: string;
  ref: string;
  customerId: string;
  rewardId: string | null;
  name: string;
  kind: RewardKind;
  value: number;
  productId: string | null;
  source: VoucherSource;
  pointsCost: number;
  giftQty: number;
  status: VoucherStatus;
  billId: string | null;
  invoiceNo: string | null;
  key: string | null;
  issuedAt: number;
  usedAt: number | null;
  expiresAt: number | null;
  note: string;
};

export type Stamp = { id: string; customerId: string; billId: string; visitKey: string; status: "active" | "reversed"; createdAt: number };

export type Referral = {
  id: string;
  referrerId: string;
  refereeId: string;
  status: "pending" | "rewarded" | "reversed" | "rejected";
  billId: string | null;
  referrerPoints: number;
  refereePoints: number;
  createdAt: number;
  rewardedAt: number | null;
};

export type CampaignType = "multiplier" | "bonus";

/** A points promotion: double-points days, weekend or festival bonuses, tier- or
    segment-only offers. Discount codes stay on the Coupons page. */
export type Campaign = {
  id: string;
  name: string;
  description: string;
  type: CampaignType;
  /** multiplier (e.g. 2 = double points) or bonus points */
  value: number;
  startsOn: string;
  endsOn: string;
  /** "HH:MM", "" = all day */
  startTime: string;
  endTime: string;
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  days: number[];
  minPurchase: number;
  tiers: TierKey[];
  segments: Segment[];
  categories: string[];
  productIds: string[];
  usageLimit: number | null;
  perCustomerLimit: number | null;
  active: boolean;
  used: number;
  pointsGiven: number;
  createdAt: number;
  updatedAt: number;
};

export type Audit = { id: string; actor: string; action: string; customerId: string | null; ref: string; before: unknown; after: unknown; reason: string; createdAt: number };

export type Segment = "new" | "regular" | "frequent" | "high_value" | "vip" | "at_risk" | "inactive" | "lost";

/** Visits and spend for one mobile, from the bills. */
export type PurchaseStats = { orders: number; visits: number; spent: number; aov: number; first: number | null; last: number | null; recentVisits: number };

export type MonthRow = { month: string; earned: number; redeemed: number; expired: number; registrations: number };

/** A free-gift offer on the bill itself — works for any customer, member or not. */
export type GiftOffer = {
  id: string;
  name: string;
  type: "spend" | "buy";
  minBill: number;
  productId: string | null;
  buyQty: number;
  giftProductId: string;
  giftQty: number;
  repeatable: boolean;
  audience: "all" | "members";
  maxTotal: number | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  given: number;
  createdAt: number;
  updatedAt: number;
};

export type MessageStatus = "pending" | "opened" | "failed";

/** A WhatsApp message prepared for a customer. Nothing is sent automatically — see the loyalty_messages table. */
export type LoyaltyMessage = {
  id: string;
  customerId: string;
  type: string;
  phone: string;
  text: string;
  status: MessageStatus;
  error: string;
  billId: string | null;
  createdAt: number;
  openedAt: number | null;
  opens: number;
};

/** Everything the Loyalty admin page needs in one round trip. */
export type LoyaltyState = {
  config: LoyaltyConfig;
  customers: LoyaltyCustomer[];
  rewards: Reward[];
  offers: GiftOffer[];
  vouchers: Voucher[];
  audit: Audit[];
  messages: LoyaltyMessage[];
  /** each customer's total eligible spending (completed bills, free gifts excluded) — drives spending rewards */
  spend: Record<string, number>;
  /** per customer, per spending reward: spending that counts towards it */
  rewardSpend: Record<string, Record<string, number>>;
  totals: { earned: number; redeemed: number; outstanding: number; giftsGiven: number };
  /** customer ids whose balance doesn't match their ledger / point lots — should stay empty */
  mismatched: string[];
  /** points earned and redeemed per month */
  months: { month: string; earned: number; redeemed: number }[];
  /** points about to expire, per customer */
  expiring: Record<string, { points: number; expiresAt: number }>;
};

/** What Billing gets back when a mobile is looked up. */
export type LoyaltyLookup = {
  enabled: boolean;
  config: LoyaltyConfig;
  customer: LoyaltyCustomer | null;
  /** name from the customer's earlier bills, to prefill enrolment */
  knownName: string;
  /** the customer's unlocked, unused free rewards (spending milestones and others) */
  vouchers: Voucher[];
  /** point rewards they can claim on this bill right now */
  rewards: Reward[];
  /** the shop's active bill offers (these work for anyone, member or not) */
  offers: GiftOffer[];
  /** the customer's progress towards each spending reward (it unlocks once a paid bill takes them past the amount) */
  spendRewards: { id: string; name: string; giftQty: number; productId: string | null; amount: number; progress: number }[];
  firstPurchase: boolean;
};
