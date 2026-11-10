"use client";

import { useSyncExternalStore } from "react";

/* The UPI link behind a payment QR. The QR is renewed every `minutes`, on the clock: the reference (and so the
   link) changes at each boundary, so a screen left open keeps showing a fresh one. UPI itself doesn't enforce the
   time; it is a freshness rule on screen.

   The clock is read through useSyncExternalStore so the server's page and the phone's first render agree (no
   clock yet → no QR); `ready` turns true as soon as the phone knows the time, and only then is a QR shown. */

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const enc = (v: string) => encodeURIComponent(v).replace(/%40/g, "@");

let cached = 0;
let at = 0;
const snapshot = () => {
  const n = Date.now();
  if (n - at >= 900) {
    at = n;
    cached = Math.floor(n / 1000) * 1000; // whole seconds, steady between reads
  }
  return cached;
};
const subscribe = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};

/** 9876543210 -> "98765 43210", easier to read out and to type */
export const spacedPhone = (p: string) => (/^\d{10}$/.test(p) ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

export function useUpiQr(upi: { id: string; name: string; minutes: number; phone?: string }, amount: number, shop: string, tag: string) {
  const now = useSyncExternalStore(subscribe, snapshot, () => 0);
  const ready = now > 0;
  const period = Math.max(1, upi.minutes) * 60_000;
  const left = ready ? Math.ceil((period - (now % period)) / 1000) : 0;
  const ref = ready ? `${tag}${(Math.floor(now / period) * period).toString(36).toUpperCase().slice(-6)}` : "";
  /* Only the fields every UPI app accepts for any UPI ID: payee, name, amount, currency and a short note. A transaction
     reference ("tr") is for registered merchants — with a personal UPI ID, GPay and PhonePe decline the payment. */
  const query = ready ? `pa=${enc(upi.id)}&pn=${enc(upi.name)}&am=${amount.toFixed(2)}&cu=INR&tn=${enc(`${shop} ${ref}`.slice(0, 40))}` : "";
  const link = ready ? `upi://pay?${query}` : "";
  /* the same payment, addressed to one app so a tap opens GPay or PhonePe straight away (any UPI app uses `link`) */
  const apps = ready ? { gpay: `tez://upi/pay?${query}`, phonepe: `phonepe://pay?${query}`, paytm: `paytmmp://pay?${query}` } : { gpay: "", phonepe: "", paytm: "" };
  return { link, apps, ref, left, ready };
}
