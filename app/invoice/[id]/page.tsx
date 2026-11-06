import Link from "next/link";
import type { Metadata } from "next";
import { billForInvoice } from "@/lib/ops";
import { getConfig } from "@/lib/loyalty/server";
import { db } from "@/lib/db";
import { TZ, inr2 as inr, loyaltySummary, numberToWords, payLabel, payParts } from "@/lib/money";
import { InvoiceActions } from "./InvoiceActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice", robots: { index: false } };



export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { id } = await params;
  const isEmbed = (await searchParams).embed === "true";
  const found = await billForInvoice(id);
  const showLoyalty = (await getConfig(db)).display.receiptSummary; // the owner can switch the loyalty box off in Loyalty settings

  if (!found) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-6 text-center text-zinc-800">
        <h1 className="mb-1 text-base font-semibold text-zinc-900">Invoice Not Found</h1>
        <p className="mb-5 max-w-sm text-xs text-zinc-800">The requested invoice could not be found.</p>
        <Link href="/admin/orders" className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800">
          ← Back to orders
        </Link>
      </div>
    );
  }

  const { bill: b, shop, details } = found;
  const addrLines = [details.address].flatMap((a) => a.split("\n").filter(Boolean).join(", ") || []);
  const date = new Date(b.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
  const time = new Date(b.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });

  return (
    <div className={`flex min-h-screen flex-col items-center bg-zinc-100/70 font-sans text-zinc-900 print:m-0 print:bg-white print:p-0 ${isEmbed ? "p-2 sm:p-4" : "px-3 py-8 sm:px-6"}`}>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm 10mm; }
          html, body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .invoice-sheet { border: none !important; box-shadow: none !important; max-width: 100% !important; width: 100% !important; padding: 0 !important; }
        }
      `}</style>

      {!isEmbed && (
        <div className="mb-4 w-full max-w-[760px] print:hidden">
          <InvoiceActions invoiceNo={b.invoiceNo} shop={shop} customerName={b.customerName} customerPhone={b.customerPhone} total={b.total} />
        </div>
      )}

      <div className="invoice-sheet w-full max-w-[760px] rounded-sm border border-zinc-200/80 bg-white p-6 text-zinc-900 shadow-xs sm:p-12 print:rounded-none print:border-none print:p-0 print:shadow-none">
        {/* Header */}
        <div className="flex flex-col items-start justify-between gap-6 border-b border-zinc-200 pb-6 sm:flex-row">
          <div className="space-y-1">
            {!details?.logoUrl || details.logoUrl === "/logo.png" ? (
              <>
                {/* the shop's own 8:2 + CHAYAKKADA logo is the whole header mark on an invoice */}
                <img src="/invoice-logo.png" alt={shop} style={{ height: 132, width: "auto", maxWidth: "100%", objectFit: "contain", marginBottom: 6, display: "block" }} />
                <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>{shop}</h1>
              </>
            ) : (
              <>
                <img src={details.logoUrl} alt="" style={{ height: 56, width: "auto", maxWidth: "100%", objectFit: "contain", marginBottom: 6, display: "block" }} />
                <h1 className="text-xl font-bold tracking-tight text-zinc-900 uppercase sm:text-2xl">{shop}</h1>
              </>
            )}
            {addrLines.map((l, i) => (
              <p key={i} className="max-w-xs text-xs leading-relaxed text-zinc-800">{l}</p>
            ))}
            {(details.customerCare || details.email) && (
              <p className="pt-1 text-xs text-zinc-800">{[details.customerCare && `Phone: ${details.customerCare}`, details.email].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <div className="shrink-0 space-y-1.5 sm:text-right">
            <div>
              <span className="text-lg font-bold tracking-tight text-zinc-900 uppercase">{b.isGst ? "Tax Invoice" : "Invoice"}</span>
              <p className="font-mono text-xs text-zinc-800">{b.invoiceNo}</p>
            </div>
            <div className="space-y-0.5 pt-1 text-xs text-zinc-800">
              <div>
                <span className="text-zinc-800">Date: </span>
                <span className="font-medium text-zinc-800">{date}</span>
              </div>
              <div>
                <span className="text-zinc-800">Time: </span>
                <span className="text-zinc-800">{time}</span>
              </div>
              <div>
                <span className="text-zinc-800">Payment: </span>
                <span className="font-medium text-zinc-800 uppercase">
                  {payLabel(b)} • {b.status === "void" ? "Void" : "Paid"}
                </span>
              </div>
              <div>
                <span className="text-zinc-800">Channel: </span>
                <span className="text-zinc-800 uppercase">{b.source === "tab" ? "Order from phone" : "Counter"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Billed to */}
        <div className="border-b border-zinc-200 py-5 text-xs">
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-zinc-800 uppercase">Billed To</div>
          <div className="text-sm font-semibold text-zinc-900">{b.customerName.trim() || "Walk-in customer"}</div>
          {b.customerPhone ? (
            <div className="mt-0.5 font-mono text-xs text-zinc-800">+91 {b.customerPhone}</div>
          ) : (
            <div className="mt-0.5 text-xs text-zinc-800 italic">Walk-in Counter Sale</div>
          )}
        </div>

        {/* Items */}
        <div className="py-4">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-[10px] font-bold tracking-wider text-zinc-800 uppercase">
                <th className="w-8 pb-3 text-center">#</th>
                <th className="pb-3">Item Description</th>
                <th className="w-12 pb-3 text-center">Qty</th>
                <th className="w-24 pb-3 text-right">Rate (₹)</th>
                <th className="w-28 pb-3 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {b.items.map((it, i) => (
                <tr key={i}>
                  <td className="py-3 text-center font-mono text-zinc-800">{i + 1}</td>
                  <td className="py-3 font-medium text-zinc-900">{it.free ? <b>FREE GIFT · {it.name}</b> : it.name}</td>
                  <td className="py-3 text-center font-medium text-zinc-800">{it.qty}</td>
                  <td className="py-3 text-right font-mono text-zinc-800">{it.free ? "FREE" : inr(it.price)}</td>
                  <td className="py-3 text-right font-mono font-semibold text-zinc-900">{it.free ? "0.00" : inr(it.price * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex flex-col items-start justify-between gap-8 border-t border-zinc-200 pt-4 text-xs sm:flex-row">
          <div className="max-w-sm space-y-4">
            <div>
              <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-zinc-800 uppercase">Amount in Words</div>
              <div className="text-xs font-medium text-zinc-800 italic">{numberToWords(b.total)}</div>
            </div>
            {b.payment === "split" && (
              <div className="space-y-0.5 pt-1 text-xs text-zinc-800">
                {payParts(b).map(([m, n]) => (
                  <div key={m}>
                    <span className="text-zinc-800">Paid by {m}: </span>
                    <span className="font-mono font-medium text-zinc-800">₹{inr(n)}</span>
                  </div>
                ))}
              </div>
            )}
            {b.payment === "cash" && b.received > 0 && (
              <div className="space-y-0.5 pt-1 text-xs text-zinc-800">
                <div>
                  <span className="text-zinc-800">Cash Received: </span>
                  <span className="font-mono font-medium text-zinc-800">₹{inr(b.received)}</span>
                </div>
                {b.change > 0 && (
                  <div>
                    <span className="text-zinc-800">Change Returned: </span>
                    <span className="font-mono font-medium text-zinc-800">₹{inr(b.change)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="pt-2 text-[11px] leading-relaxed text-zinc-800">
              <p className="mb-0.5 font-medium text-zinc-800">Terms &amp; Notes:</p>
              <p>{b.isGst ? `• Prices are in Indian Rupees; GST @ ${b.gstPercent}% is added to the amount.` : "• Prices are in Indian Rupees. GST is not applicable on this bill."}</p>
              <p>• Please keep this invoice for your records.</p>
            </div>
          </div>

          <div className="w-full space-y-2 text-xs sm:w-64">
            <div className="flex justify-between text-zinc-800">
              <span>Subtotal ({b.itemCount} items)</span>
              <span className="font-mono text-zinc-900">₹{inr(b.subtotal)}</span>
            </div>
            {b.couponDiscount > 0 && (
              <div className="flex justify-between text-zinc-800">
                <span>
                  Coupon {b.couponCode} ({b.couponPercent}%)
                </span>
                <span className="font-mono text-zinc-900">− ₹{inr(b.couponDiscount)}</span>
              </div>
            )}
            {b.manualDiscount > 0 && (
              <div className="flex justify-between text-zinc-800">
                <span>Discount {b.manualType === "percent" ? `(${b.manualValue}%)` : ""}</span>
                <span className="font-mono text-zinc-900">− ₹{inr(b.manualDiscount)}</span>
              </div>
            )}
            {b.rewardDiscount > 0 && (
              <div className="flex justify-between text-zinc-800">
                <span>Reward {b.rewardName}</span>
                <span className="font-mono text-zinc-900">− ₹{inr(b.rewardDiscount)}</span>
              </div>
            )}
            {b.pointsDiscount > 0 && (
              <div className="flex justify-between text-zinc-800">
                <span>Loyalty points ({b.pointsRedeemed} pts)</span>
                <span className="font-mono text-zinc-900">− ₹{inr(b.pointsDiscount)}</span>
              </div>
            )}
            {b.extra > 0 && (
              <div className="flex justify-between border-t border-dashed border-zinc-200 pt-1 text-zinc-800">
                <span>Extra charges</span>
                <span className="font-mono text-zinc-800">₹{inr(b.extra)}</span>
              </div>
            )}
            {b.isGst && (
              <>
                <div className="flex justify-between border-t border-dashed border-zinc-200 pt-1 text-zinc-800">
                  <span>Taxable amount</span>
                  <span className="font-mono text-zinc-800">₹{inr(b.taxableAmount)}</span>
                </div>
                <div className="flex justify-between text-zinc-800">
                  <span>GST ({b.gstPercent}%)</span>
                  <span className="font-mono text-zinc-900">₹{inr(b.gstAmount)}</span>
                </div>
              </>
            )}
            <div className="mt-2 flex items-baseline justify-between border-t border-zinc-900 pt-2.5">
              <span className="text-sm font-bold text-zinc-900 uppercase">Total</span>
              <span className="font-mono text-lg font-bold text-zinc-900">₹{inr(b.total)}</span>
            </div>
          </div>
        </div>

        {showLoyalty && loyaltySummary(b) && (
          <div className="mt-6 max-w-xs rounded-md border border-zinc-300 p-3 text-xs text-zinc-900">
            <div className="mb-1.5 font-bold uppercase">Loyalty summary</div>
            {loyaltySummary(b)!.map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5">
                <span>{k}</span>
                <span className="font-mono font-semibold">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 flex flex-col items-start justify-between gap-6 border-t border-zinc-200 pt-6 text-xs sm:flex-row sm:items-end">
          <div className="text-[11px] text-zinc-800">Thank you for visiting! • {shop}</div>
          <div className="space-y-1 self-end sm:text-right">
            <div className="mb-1 ml-auto w-36 border-b border-zinc-300" />
            <div className="text-xs font-semibold text-zinc-800">Authorised Signatory</div>
            <div className="text-[10px] text-zinc-800">For {shop}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
