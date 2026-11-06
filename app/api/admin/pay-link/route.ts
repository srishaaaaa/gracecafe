import { isAuthed } from "@/lib/auth";
import { body, handle } from "@/lib/http";
import { payPageInfo } from "@/lib/ops";
import { signPayLink } from "@/lib/paylink";
import { ApiError } from "@/lib/store";

/* POST {amount, name} → {url, text-ready fields} — the signed payment link staff send a customer on WhatsApp.
   Admin and staff both may; nothing is written. */
export async function POST(req: Request) {
  return handle(async () => {
    if (!(await isAuthed())) throw new ApiError("You've been signed out. Please sign in again.", 401);
    const b = await body(req);
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!(amount > 0 && amount <= 10_000_000)) throw new ApiError("Enter a bill amount first.");
    const info = await payPageInfo();
    if (!info.upi) throw new ApiError("Add the shop's UPI ID in Settings first.");
    const base = info.publicUrl || new URL(req.url).origin;
    const name = typeof b.name === "string" ? b.name : "";
    return { url: `${base}/pay/${signPayLink(amount, name)}`, upiId: info.upi.id, upiName: info.upi.name, upiPhone: info.upi.phone, shopName: info.shopName };
  });
}
