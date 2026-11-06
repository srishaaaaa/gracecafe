import { body, handle } from "@/lib/http";
import { applyCoupon, payClaim, payUnclaim, placeOrder, removeCoupon, requestBill, tabView } from "@/lib/ops";
import { ApiError } from "@/lib/store";

/* Customer endpoints. A guest is known by their mobile, which travels in the
   body (never the URL, so it stays out of access logs). */

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (b.action === "view") return tabView(b.phone);
    if (b.action === "order") return placeOrder(b);
    if (b.action === "bill") return requestBill(b.phone);
    if (b.action === "coupon") return applyCoupon(b.phone, b.code);
    if (b.action === "coupon.remove") return removeCoupon(b.phone);
    if (b.action === "pay.claim") return payClaim(b.phone, b.ref);
    if (b.action === "pay.unclaim") return payUnclaim(b.phone);
    throw new ApiError("Unknown action.");
  });
}
