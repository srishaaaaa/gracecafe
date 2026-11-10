"use client";

import { useState } from "react";
import { rupee } from "@/lib/money";
import { Qr } from "@/app/admin/_ui/Qr";
import { mmss, spacedPhone, useUpiQr } from "@/app/_components/upiQr";

/* The page behind the WhatsApp payment link. The QR and the "Open my UPI app" button carry the amount and the
   shop's UPI ID; the QR is renewed every few minutes. Nothing here confirms a payment — the counter checks
   their UPI app — so it asks the customer to show the payment confirmation. */
export function PayClient({ amount, name, shop, logoUrl, upi }: { amount: number; name: string; shop: string; logoUrl: string; upi: { id: string; name: string; minutes: number; phone: string } }) {
  const { link, apps, ref, left, ready } = useUpiQr(upi, amount, shop, "W");
  const [copied, setCopied] = useState("");
  const copy = async (what: string, v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {}
  };
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f3f4e1] px-4 py-10 text-slate-900">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="bg-[#2b3022] p-6 text-center text-white">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ height: 44, width: "auto", margin: "0 auto 10px", objectFit: "contain" }} />
          )}
          <p className="text-[12px] font-extrabold uppercase tracking-[0.2em] text-[#c9d3a0]">{shop}</p>
          <p className="mt-1 text-[14px] text-slate-300">{name ? `Hi ${name.split(" ")[0]}, your bill` : "Your bill"}</p>
          <p className="mt-1 text-[44px] font-black leading-none">{rupee(amount)}</p>
        </div>
        <div className="space-y-4 p-6 text-center">
          <p className="text-[13px] font-bold text-slate-700">
            Pay {rupee(amount)} to {upi.name} with
          </p>
          <div className="grid grid-cols-2 gap-2">
            <a href={ready ? apps.gpay : undefined} aria-disabled={!ready} className="inline-flex h-12 items-center justify-center rounded-xl bg-[#1a73e8] text-[15px] font-bold text-white aria-disabled:opacity-50">
              GPay
            </a>
            <a href={ready ? apps.phonepe : undefined} aria-disabled={!ready} className="inline-flex h-12 items-center justify-center rounded-xl bg-[#5f259f] text-[15px] font-bold text-white aria-disabled:opacity-50">
              PhonePe
            </a>
          </div>
          <a href={ready ? link : undefined} aria-disabled={!ready} className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#9a7420] text-[15px] font-bold text-white hover:bg-[#765712] aria-disabled:opacity-50">
            Any other UPI app
          </a>
          <div className="mx-auto w-52 rounded-2xl border border-slate-200 bg-white p-2">{ready ? <Qr text={link} className="block h-auto w-full" /> : <div className="aspect-square w-full" aria-hidden="true" />}</div>
          <p className="text-[12.5px] text-slate-500">
            On a phone, tap your app. If nothing opens, that app isn&apos;t installed — try another button. Or scan this QR from another phone. New QR in <b>{ready ? mmss(left) : "…"}</b>.
          </p>
          <dl className="space-y-2 rounded-2xl bg-slate-50 p-4 text-left text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Pay to</dt>
              <dd className="font-bold">{upi.name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">UPI ID</dt>
              <dd className="flex items-center gap-2 font-bold">
                {upi.id}
                <button type="button" onClick={() => copy("id", upi.id)} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                  {copied === "id" ? "Copied ✓" : "Copy"}
                </button>
              </dd>
            </div>
            {upi.phone && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">GPay number</dt>
                <dd className="flex items-center gap-2 font-bold">
                  {spacedPhone(upi.phone)}
                  <button type="button" onClick={() => copy("phone", upi.phone)} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                    {copied === "phone" ? "Copied ✓" : "Copy"}
                  </button>
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Amount</dt>
              <dd className="font-bold">{rupee(amount)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Note</dt>
              <dd className="font-mono text-[12px]">{ref || "…"}</dd>
            </div>
          </dl>
          <p className="text-[12px] text-slate-500">If your app says it can&apos;t process the payment, copy the UPI ID above and pay it from inside your UPI app instead.</p>
          <p className="text-[12px] text-slate-500">After paying, show the confirmation on your phone at the counter.</p>
        </div>
      </div>
    </div>
  );
}
