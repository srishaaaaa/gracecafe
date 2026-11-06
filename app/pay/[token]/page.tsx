import type { Metadata } from "next";
import { payPageInfo } from "@/lib/ops";
import { readPayLink } from "@/lib/paylink";
import { PayClient } from "./PayClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay your bill", robots: { index: false, follow: false } };

/* Opened from the WhatsApp message staff send: the amount, the shop's UPI ID, and a QR to pay it. */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = readPayLink(decodeURIComponent(token));
  const info = await payPageInfo();

  const note = !r.ok ? (r.expired ? "This payment link has expired. Please ask the counter for a new one." : "This payment link isn't valid. Please ask the counter for a new one.") : !info.upi ? "Online payment isn't switched on for this shop right now. Please pay at the counter." : "";
  if (!r.ok || !info.upi) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f3f4e1] p-6 text-center text-slate-800">
        <h1 className="mb-1 text-base font-semibold text-slate-900">{info.shopName}</h1>
        <p className="max-w-sm text-sm text-slate-500">{note}</p>
      </div>
    );
  }
  return <PayClient amount={r.link.a} name={r.link.n} shop={info.shopName} logoUrl={info.logoUrl} upi={info.upi} />;
}
