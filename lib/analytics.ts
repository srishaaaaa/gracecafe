import type { Bill, Expense } from "./types";

/* Pure analytics over completed bills. Runs in the browser, in the viewer's local time. */

export type Period = "all" | "today" | "week" | "month" | "year" | "custom";
export type Range = { from: number; to: number } | null;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Monday 00:00 of the week containing `d`. */
export function startOfWeek(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
}

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7), year: t.getUTCFullYear() };
}

export function rangeOf(p: Period, from = "", to = "", now = new Date()): Range {
  switch (p) {
    case "all":
      return null;
    case "today":
      return { from: startOfDay(now), to: Infinity };
    case "week":
      return { from: startOfWeek(now), to: Infinity };
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: Infinity };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1).getTime(), to: Infinity };
    case "custom":
      return {
        from: from ? new Date(`${from}T00:00:00`).getTime() : -Infinity,
        to: to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity,
      };
  }
}

export const inRange = (t: number, r: Range) => !r || (t >= r.from && t <= r.to);
export const completedIn = (bills: Bill[], r: Range) => bills.filter((b) => b.status === "completed" && inRange(b.createdAt, r));

const keyOf = (i: { productId: string | null; name: string }) => i.productId ?? `custom:${i.name.trim().toLowerCase()}`;

export type ItemStat = { key: string; productId: string | null; name: string; qty: number; revenue: number };

export function itemStats(bills: Bill[]): ItemStat[] {
  const m = new Map<string, ItemStat>();
  for (const b of bills)
    for (const i of b.items) {
      const k = keyOf(i);
      const cur = m.get(k) ?? { key: k, productId: i.productId, name: i.name, qty: 0, revenue: 0 };
      cur.qty += i.qty;
      cur.revenue += i.qty * i.price;
      m.set(k, cur);
    }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}

export function summary(bills: Bill[]) {
  let revenue = 0, tabRev = 0, counterRev = 0, tabN = 0, counterN = 0, items = 0, discount = 0, discounted = 0;
  let gst = 0, gstN = 0, gstRev = 0, taxable = 0, nonGstRev = 0;
  for (const b of bills) {
    revenue += b.total;
    items += b.itemCount;
    discount += b.discount;
    if (b.discount > 0) discounted++;
    if (b.isGst) {
      gstN++;
      gst += b.gstAmount;
      gstRev += b.total;
      taxable += b.taxableAmount;
    } else {
      nonGstRev += b.total;
    }
    if (b.source === "tab") {
      tabRev += b.total;
      tabN++;
    } else {
      counterRev += b.total;
      counterN++;
    }
  }
  const byQty = itemStats(bills).sort((a, b) => b.qty - a.qty);
  return {
    revenue,
    count: bills.length,
    tabRev,
    counterRev,
    tabN,
    counterN,
    items,
    discount,
    discounted,
    gst,
    gstN,
    gstRev,
    taxable,
    nonGstN: bills.length - gstN,
    nonGstRev,
    aov: bills.length ? revenue / bills.length : 0,
    top: byQty[0]?.name ?? "—",
  };
}

export function monthly(bills: Bill[], year: number) {
  const out = Array(12).fill(0) as number[];
  for (const b of bills) {
    const d = new Date(b.createdAt);
    if (b.status === "completed" && d.getFullYear() === year) out[d.getMonth()] += b.total;
  }
  return out;
}

export function weekly(bills: Bill[], weekStart: number) {
  const out = Array(7).fill(0) as number[];
  for (const b of bills) {
    if (b.status !== "completed" || b.createdAt < weekStart) continue;
    const day = Math.floor((startOfDay(new Date(b.createdAt)) - weekStart) / 86400000 + 0.5);
    if (day >= 0 && day < 7) out[day] += b.total;
  }
  return out;
}

/* ---------------- GST ---------------- */

export type GstRateRow = { rate: number; invoices: number; taxable: number; gst: number; total: number; cgst: number; sgst: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Splits GST into its Central and State halves. SGST is what's left after CGST, so the two
    always add back to the GST charged, even when it doesn't divide into whole paise. */
export const splitGst = (gst: number) => {
  const cgst = r2(gst / 2);
  return { cgst, sgst: r2(gst - cgst) };
};

/** Full GST picture over the given bills: totals, CGST/SGST halves, and a per-rate breakdown.
   GST in India splits equally into Central (CGST) and State (SGST) halves on an intra-state bill. */
export function gstReport(bills: Bill[]) {
  const gstBills = bills.filter((b) => b.isGst);
  const m = new Map<number, GstRateRow>();
  let taxable = 0, gst = 0, revenue = 0;
  for (const b of gstBills) {
    taxable = r2(taxable + b.taxableAmount);
    gst = r2(gst + b.gstAmount);
    revenue = r2(revenue + b.total);
    const r = m.get(b.gstPercent) ?? { rate: b.gstPercent, invoices: 0, taxable: 0, gst: 0, total: 0, cgst: 0, sgst: 0 };
    const half = splitGst(b.gstAmount);
    r.invoices++;
    r.taxable = r2(r.taxable + b.taxableAmount);
    r.gst = r2(r.gst + b.gstAmount);
    r.total = r2(r.total + b.total);
    r.cgst = r2(r.cgst + half.cgst);
    r.sgst = r2(r.sgst + half.sgst);
    m.set(b.gstPercent, r);
  }
  const rates = [...m.values()].sort((a, b) => a.rate - b.rate);
  const nonGstBills = bills.length - gstBills.length;
  return {
    invoices: gstBills.length,
    nonGstBills,
    taxable,
    gst,
    revenue,
    cgst: rates.reduce((a, r) => r2(a + r.cgst), 0),
    sgst: rates.reduce((a, r) => r2(a + r.sgst), 0),
    avgRate: taxable > 0 ? (gst / taxable) * 100 : 0,
    rates,
  };
}

/** Money taken per method. A split bill adds each part to its own method. */
export function paymentStats(bills: Bill[]) {
  let cash = 0, upi = 0, card = 0, splitN = 0;
  for (const b of bills) {
    cash += b.cashAmount;
    upi += b.upiAmount;
    card += b.cardAmount;
    if (b.payment === "split") splitN++;
  }
  return { cash, upi, card, splitN };
}

/* ---------------- expenses ---------------- */

/** Expense dates are shop-local YYYY-MM-DD; compare them as local midnight like bills are. */
const dayOf = (d: string) => new Date(`${d}T12:00:00`).getTime();
export const expensesIn = (list: Expense[], r: Range) => list.filter((e) => inRange(dayOf(e.expenseDate), r));

export function expenseStats(list: Expense[], r: Range, category = "all", q = "") {
  const needle = q.trim().toLowerCase();
  const rows = expensesIn(list, r).filter(
    (e) => (category === "all" || e.category === category) && (!needle || `${e.title} ${e.category} ${e.notes}`.toLowerCase().includes(needle)),
  );
  const by = new Map<string, number>();
  let total = 0;
  for (const e of rows) {
    total += e.amount;
    by.set(e.category, (by.get(e.category) ?? 0) + e.amount);
  }
  const breakdown = [...by].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  return { rows, total, breakdown, top: breakdown[0] ?? null, count: rows.length };
}

/* ---------------- customers (name + mobile on each bill) ---------------- */

export type CustomerStat = { key: string; name: string; phone: string; visits: number; spent: number; last: number };

export function customerStats(bills: Bill[]): CustomerStat[] {
  const m = new Map<string, CustomerStat>();
  for (const b of bills) {
    if (!b.customerPhone) continue;
    const cur = m.get(b.customerPhone) ?? { key: b.customerPhone, name: "", phone: b.customerPhone, visits: 0, spent: 0, last: 0 };
    cur.visits++;
    cur.spent += b.total;
    if (b.createdAt >= cur.last) {
      cur.last = b.createdAt;
      cur.name = b.customerName || cur.name;
    }
    m.set(b.customerPhone, cur);
  }
  return [...m.values()].sort((a, b) => b.spent - a.spent);
}
