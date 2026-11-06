/* Free gifts on a bill, with no database access — shared by the server (which decides) and the billing
   screen (which shows what is on offer). A gift is a separate ₹0 line marked `free`. It is only allowed when
   something entitles the customer to it: a bill offer that the bill qualifies for, or a reward / voucher that
   the member chose. The server re-checks every free line; nothing a browser sends is trusted. */

import { round2 } from "../money";
import type { OrderItem } from "../types";
import { shopDate } from "./engine";
import type { GiftOffer } from "./types";

export type Entitlement = {
  /** where it came from: "offer:<id>", "reward:<id>" or "voucher:<ref>" */
  key: string;
  source: "offer" | "reward" | "voucher";
  /** label printed on the bill line, e.g. "Spend ₹500 get a Juice" */
  name: string;
  productId: string;
  qty: number;
};

export const offerLive = (o: GiftOffer, now = Date.now()) => {
  const today = shopDate(now);
  return o.active && (!o.startsOn || today >= o.startsOn) && (!o.endsOn || today <= o.endsOn);
};

/** The paid (non-gift) lines of a bill. */
export const paidItems = (items: OrderItem[]) => items.filter((i) => !i.free);

/** How many of this product the bill gives away free. */
export function freeQty(items: OrderItem[]) {
  const m = new Map<string, number>();
  for (const i of items) if (i.free && i.productId) m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty);
  return m;
}

/** Gifts a bill earns from the shop's current offers. `amount` is the bill after coupon and manual discount
    (before points and GST) for paid items only. */
export function offerEntitlements(offers: GiftOffer[], items: OrderItem[], amount: number, now = Date.now(), member = false): Entitlement[] {
  const paid = paidItems(items);
  const out: Entitlement[] = [];
  for (const o of offers) {
    if (!offerLive(o, now) || !o.giftProductId || o.giftQty < 1) continue;
    if (o.audience === "members" && !member) continue;
    const left = o.maxTotal === null ? Infinity : o.maxTotal - o.given;
    if (left <= 0) continue;
    let times = 0;
    if (o.type === "spend") {
      if (o.minBill > 0 && amount + 1e-9 >= o.minBill) {
        // an offer limited to a product only counts when that product is bought too
        const has = !o.productId || paid.some((i) => i.productId === o.productId && i.qty >= Math.max(1, o.buyQty));
        times = has ? Math.floor((amount + 1e-9) / o.minBill) : 0;
      }
    } else if (o.productId && o.buyQty >= 1) {
      times = Math.floor(paid.filter((i) => i.productId === o.productId).reduce((a, i) => a + i.qty, 0) / o.buyQty);
    }
    if (!o.repeatable) times = Math.min(times, 1);
    times = Math.min(times, left);
    if (times > 0) out.push({ key: `offer:${o.id}`, source: "offer", name: o.name, productId: o.giftProductId, qty: times * o.giftQty });
  }
  return out;
}

/** Problems with the free lines of a bill: more of a product given than anything entitles the customer to. Empty = fine. */
export function giftProblems(items: OrderItem[], entitled: Entitlement[], nameOf: (productId: string) => string): string[] {
  const have = new Map<string, number>();
  for (const e of entitled) have.set(e.productId, (have.get(e.productId) ?? 0) + e.qty);
  const out: string[] = [];
  for (const [pid, q] of freeQty(items)) {
    const ok = have.get(pid) ?? 0;
    if (q > ok) out.push(ok === 0 ? `${nameOf(pid)} isn't a free gift on this bill.` : `Only ${ok} free ${nameOf(pid)} can be given on this bill — ${q} were added.`);
  }
  return out;
}

/** Money value of the gifts (what the shop gives away), for the summary only — never added to the bill. */
export const giftValue = (items: OrderItem[], priceOf: (productId: string) => number) => round2(items.filter((i) => i.free && i.productId).reduce((a, i) => a + priceOf(i.productId!) * i.qty, 0));
