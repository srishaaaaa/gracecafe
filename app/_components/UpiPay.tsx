"use client";

import { useState } from "react";
import type { TabView } from "@/lib/types";
import { rupee } from "@/lib/money";
import { Qr } from "../admin/_ui/Qr";
import { mmss, spacedPhone, useUpiQr } from "./upiQr";

type Tab = NonNullable<TabView["tab"]>;

/* Pay by UPI from the guest's own tab. Staff set the final amount at billing (discounts, GST…) and approve it;
   only then does the QR appear here, for exactly that amount, with the shop's UPI ID and name. Every few minutes
   — the shop sets how many — the QR is replaced by a fresh one. The shop's UPI account can't tell the app a
   payment arrived, so "I've paid" only tells the counter; staff check their own UPI app before billing. */

export function UpiPay({ tab, shop, phone, onView }: { tab: Tab; shop: string; phone: string; onView: (v: TabView) => void }) {
  const upi = tab.upi!;
  const approved = tab.approved;
  const amount = approved?.amount ?? tab.payable;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState("");
  const { link, apps, ref, left, ready } = useUpiQr(upi, amount, shop, `T${phone.slice(-4)}`);

  const claim = tab.payClaim;
  const claimedFull = !!claim && Math.abs(claim.amount - amount) < 0.01;

  const call = async (action: "pay.claim" | "pay.unclaim") => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/tab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, phone, ref }) });
      const d = await r.json();
      if (!r.ok) setMsg(d.error || "Couldn't tell the counter. Try again.");
      else onView(d.view);
    } catch {
      setMsg("You seem to be offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (what: string, v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {}
  };

  if (!approved) {
    return (
      <section className="tm-upi" aria-label="Pay by UPI">
        <h4>Pay by UPI</h4>
        <p className="tm-upi__hint">The counter is checking your bill. Your payment QR will appear here as soon as they approve it.</p>
      </section>
    );
  }
  return (
    <section className="tm-upi" aria-label="Pay by UPI">
      <header className="tm-upi__head">
        <h4>
          Pay <b>{rupee(amount)}</b> by UPI
        </h4>
        <p className="tm-upi__sub">Choose your app</p>
      </header>
      <div className="tm-upi__apps">
        <a className="tm-upi__app tm-upi__app--gpay" href={ready ? apps.gpay : undefined} aria-disabled={!ready}>
          Google Pay
        </a>
        <a className="tm-upi__app tm-upi__app--phonepe" href={ready ? apps.phonepe : undefined} aria-disabled={!ready}>
          PhonePe
        </a>
        <a className="tm-upi__app tm-upi__app--paytm" href={ready ? apps.paytm : undefined} aria-disabled={!ready}>
          Paytm
        </a>
      </div>
      <p className="tm-upi__hint">Tap your app: it opens with the amount ready. If it can&apos;t, scan the QR or enter the UPI ID in the app.</p>
      <div className="tm-upi__body">
        <figure className="tm-upi__qrbox">
          <div className="tm-upi__qr">{ready ? <Qr text={link} className="tm-upi__svg" color="#1f2218" /> : <div className="tm-upi__svg" style={{ aspectRatio: "1" }} aria-hidden="true" />}</div>
          <figcaption>
            Scan with any UPI app
            <small>
              New QR in <b>{ready ? mmss(left) : "…"}</b>
            </small>
          </figcaption>
        </figure>
        <dl className="tm-upi__rows">
          <div>
            <dt>Pay to</dt>
            <dd>{upi.name}</dd>
          </div>
          <div>
            <dt>UPI ID</dt>
            <dd>
              <span className="tm-upi__val">{upi.id}</span>
              <button type="button" onClick={() => copy("id", upi.id)}>
                {copied === "id" ? "Copied ✓" : "Copy"}
              </button>
            </dd>
          </div>
          {upi.phone && (
            <div>
              <dt>GPay number</dt>
              <dd>
                <span className="tm-upi__val">{spacedPhone(upi.phone)}</span>
                <button type="button" onClick={() => copy("phone", upi.phone)}>
                  {copied === "phone" ? "Copied ✓" : "Copy"}
                </button>
              </dd>
            </div>
          )}
          <div>
            <dt>Amount</dt>
            <dd>
              <span className="tm-upi__val">{rupee(amount)}</span>
            </dd>
          </div>
        </dl>
      </div>
      {claimedFull ? (
        <div className="tm-upi__done">
          <b>Thanks — the counter will confirm your payment ✓</b>
          <button type="button" disabled={busy} onClick={() => call("pay.unclaim")}>
            I didn&apos;t pay yet
          </button>
        </div>
      ) : (
        <button type="button" className="tm-send" disabled={busy || !ready} onClick={() => call("pay.claim")}>
          {busy ? "Telling the counter…" : "I've paid"}
        </button>
      )}
      {msg && <p className="tm-upi__err">{msg}</p>}
    </section>
  );
}
